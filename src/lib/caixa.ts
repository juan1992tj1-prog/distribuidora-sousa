/**
 * Caixa do balcão: abertura com fundo de troco, sangria/suprimento e fechamento cego.
 *
 * Dinheiro esperado na gaveta =
 *     fundo de troco
 *   + suprimentos − sangrias − estornos
 *   + dinheiro das vendas finalizadas do caixa (já descontado o troco)
 *   + fiado recebido em dinheiro neste caixa
 *
 * Venda cancelada com o caixa ainda aberto simplesmente deixa de contar (o dinheiro volta ao cliente
 * da mesma gaveta). Se o caixa da venda já foi fechado, o dinheiro sai do caixa de quem cancelou (estorno).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { caixaMovimentos, caixas, fiadoLancamentos, logAuditoria, pagamentos, vendas } from "@/db/schema";
import { ErroNegocio } from "./erros";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Executor = DB | Tx;

export type Caixa = typeof caixas.$inferSelect;

/** Caixa aberto do operador (ou null). Com `travar`, bloqueia a linha até o fim da transação. */
export async function caixaAbertoDe(tx: Executor, usuarioId: number, travar = false): Promise<Caixa | null> {
  const consulta = tx
    .select()
    .from(caixas)
    .where(and(eq(caixas.usuarioId, usuarioId), eq(caixas.status, "aberto")));
  const [c] = travar ? await consulta.for("update") : await consulta;
  return c ?? null;
}

export async function abrirCaixa(db: DB, usuarioId: number, valorAbertura: number) {
  if (!Number.isInteger(valorAbertura) || valorAbertura < 0) throw new ErroNegocio("Valor de abertura inválido.");
  return db.transaction(async (tx) => {
    if (await caixaAbertoDe(tx, usuarioId, true)) throw new ErroNegocio("Você já tem um caixa aberto.");
    const [c] = await tx.insert(caixas).values({ usuarioId, valorAbertura }).returning();
    await tx.insert(logAuditoria).values({
      usuarioId,
      acao: "abrir_caixa",
      entidade: "caixa",
      entidadeId: c.id,
      detalhes: { valorAbertura },
    });
    return c;
  });
}

export type ResumoCaixa = {
  abertura: number;
  suprimentos: number;
  sangrias: number;
  estornos: number;
  /** total vendido (vendas finalizadas), por forma de pagamento */
  porForma: { dinheiro: number; pix: number; cartao_debito: number; cartao_credito: number; fiado: number };
  vendasQtd: number;
  vendasTotal: number;
  canceladasQtd: number;
  fiadoRecebidoDinheiro: number;
  fiadoRecebidoOutros: number;
  dinheiroEsperado: number;
};

export async function resumoCaixa(tx: Executor, caixaId: number): Promise<ResumoCaixa> {
  const [c] = await tx
    .select({ abertura: caixas.valorAbertura, fechadoEm: caixas.fechadoEm })
    .from(caixas)
    .where(eq(caixas.id, caixaId));
  if (!c) throw new ErroNegocio("Caixa não encontrado.");
  // Venda cancelada DEPOIS do fechamento continua contando aqui (o dinheiro saiu como estorno de outro caixa).
  // Assim o resumo de um caixa fechado nunca muda.
  const valeu = c.fechadoEm
    ? sql`(${vendas.status} = 'finalizada' or ${vendas.canceladaEm} > ${c.fechadoEm})`
    : sql`${vendas.status} = 'finalizada'`;

  const movs = await tx
    .select({ tipo: caixaMovimentos.tipo, total: sql<number>`coalesce(sum(${caixaMovimentos.valor}), 0)::int` })
    .from(caixaMovimentos)
    .where(eq(caixaMovimentos.caixaId, caixaId))
    .groupBy(caixaMovimentos.tipo);
  const mov = (t: string) => movs.find((m) => m.tipo === t)?.total ?? 0;

  const formas = await tx
    .select({ forma: pagamentos.forma, total: sql<number>`coalesce(sum(${pagamentos.valor}), 0)::int` })
    .from(pagamentos)
    .innerJoin(vendas, eq(vendas.id, pagamentos.vendaId))
    .where(and(eq(vendas.caixaId, caixaId), valeu))
    .groupBy(pagamentos.forma);
  const porForma = { dinheiro: 0, pix: 0, cartao_debito: 0, cartao_credito: 0, fiado: 0 };
  for (const f of formas) porForma[f.forma] = f.total;

  const [v] = await tx
    .select({
      qtd: sql<number>`count(*) filter (where ${valeu})::int`,
      total: sql<number>`coalesce(sum(${vendas.total}) filter (where ${valeu}), 0)::int`,
      canceladas: sql<number>`count(*) filter (where not ${valeu})::int`,
    })
    .from(vendas)
    .where(eq(vendas.caixaId, caixaId));

  const [f] = await tx
    .select({
      dinheiro: sql<number>`coalesce(sum(${fiadoLancamentos.valor}) filter (where ${fiadoLancamentos.forma} = 'dinheiro'), 0)::int`,
      outros: sql<number>`coalesce(sum(${fiadoLancamentos.valor}) filter (where ${fiadoLancamentos.forma} <> 'dinheiro'), 0)::int`,
    })
    .from(fiadoLancamentos)
    .where(and(eq(fiadoLancamentos.caixaId, caixaId), eq(fiadoLancamentos.tipo, "credito")));

  const suprimentos = mov("suprimento");
  const sangrias = mov("sangria");
  const estornos = mov("estorno");
  return {
    abertura: c.abertura,
    suprimentos,
    sangrias,
    estornos,
    porForma,
    vendasQtd: v.qtd,
    vendasTotal: v.total,
    canceladasQtd: v.canceladas,
    fiadoRecebidoDinheiro: f.dinheiro,
    fiadoRecebidoOutros: f.outros,
    dinheiroEsperado: c.abertura + suprimentos - sangrias - estornos + porForma.dinheiro + f.dinheiro,
  };
}

/** Sangria (tira dinheiro da gaveta) ou suprimento (coloca troco). */
export async function movimentarCaixa(
  db: DB,
  m: { usuarioId: number; tipo: "sangria" | "suprimento"; valor: number; motivo?: string },
) {
  if (!Number.isInteger(m.valor) || m.valor <= 0) throw new ErroNegocio("Informe um valor maior que zero.");
  if (m.tipo === "sangria" && !m.motivo?.trim()) throw new ErroNegocio("Informe o motivo da sangria (ex.: cofre, pagamento de fornecedor).");
  return db.transaction(async (tx) => {
    const caixa = await caixaAbertoDe(tx, m.usuarioId, true);
    if (!caixa) throw new ErroNegocio("Abra o caixa primeiro.");
    if (m.tipo === "sangria") {
      const { dinheiroEsperado } = await resumoCaixa(tx, caixa.id);
      if (m.valor > dinheiroEsperado) throw new ErroNegocio("A sangria é maior que o dinheiro que deveria estar na gaveta.");
    }
    const [mov] = await tx
      .insert(caixaMovimentos)
      .values({ caixaId: caixa.id, tipo: m.tipo, valor: m.valor, motivo: m.motivo?.trim() || null, usuarioId: m.usuarioId })
      .returning();
    return mov;
  });
}

/**
 * Fecha o caixa. O operador informa o dinheiro contado; o sistema calcula esperado e diferença.
 * `usuarioId` é quem está fechando (pode ser o gerente fechando o caixa de outro operador).
 */
export async function fecharCaixa(
  db: DB,
  f: { caixaId: number; usuarioId: number; dinheiroContado: number; observacao?: string },
) {
  if (!Number.isInteger(f.dinheiroContado) || f.dinheiroContado < 0) throw new ErroNegocio("Informe o dinheiro contado na gaveta.");
  return db.transaction(async (tx) => {
    const [caixa] = await tx.select().from(caixas).where(eq(caixas.id, f.caixaId)).for("update");
    if (!caixa) throw new ErroNegocio("Caixa não encontrado.");
    if (caixa.status !== "aberto") throw new ErroNegocio("Este caixa já foi fechado.");
    const resumo = await resumoCaixa(tx, caixa.id);
    // Não recusa nem avisa antes de gravar: se avisasse, o operador poderia ir chutando valores até acertar.
    const diferenca = f.dinheiroContado - resumo.dinheiroEsperado;
    await tx
      .update(caixas)
      .set({
        status: "fechado",
        fechadoEm: new Date(),
        fechadoPor: f.usuarioId,
        dinheiroEsperado: resumo.dinheiroEsperado,
        dinheiroContado: f.dinheiroContado,
        diferenca,
        observacao: f.observacao?.trim() || null,
      })
      .where(eq(caixas.id, caixa.id));
    await tx.insert(logAuditoria).values({
      usuarioId: f.usuarioId,
      acao: "fechar_caixa",
      entidade: "caixa",
      entidadeId: caixa.id,
      detalhes: { esperado: resumo.dinheiroEsperado, contado: f.dinheiroContado, diferenca, operador: caixa.usuarioId },
    });
    return { ...resumo, dinheiroContado: f.dinheiroContado, diferenca };
  });
}

export async function caixasRecentes(db: DB, limite = 30) {
  return db.query.caixas.findMany({
    orderBy: desc(caixas.abertoEm),
    limit: limite,
    with: { usuario: { columns: { nome: true } } },
  });
}
