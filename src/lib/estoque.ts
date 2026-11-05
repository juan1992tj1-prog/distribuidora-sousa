/**
 * Regras de estoque. TODA alteração de saldo passa por aqui.
 *
 * - Entradas criam/atualizam lote e somam saldo.
 * - Saídas usam FEFO (o lote que vence primeiro sai primeiro) e nunca deixam o saldo negativo.
 * - Cada alteração grava uma linha em `movimentos` (kardex) com usuário e motivo.
 * - Funções que mexem em várias tabelas rodam dentro de uma transação.
 */
import { and, asc, eq, gt, gte, isNull, or, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  caixaMovimentos,
  caixas,
  clientes,
  depositos,
  embalagens,
  entradaItens,
  entradas,
  fiadoLancamentos,
  logAuditoria,
  lotes,
  movimentos,
  pagamentos,
  produtos,
  saldos,
  vendaItens,
  vendas,
} from "@/db/schema";
import { hojeIso } from "./formato";
import { caixaAbertoDe } from "./caixa";

import { ErroNegocio } from "./erros";
export { ErroNegocio };

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Executor = DB | Tx;

type TipoMovimento = (typeof movimentos.$inferInsert)["tipo"];
type FormaPagamento = (typeof pagamentos.$inferInsert)["forma"];

// ---------------------------------------------------------------- básicos

export async function depositoPadrao(tx: Executor): Promise<number> {
  const [dep] = await tx.select({ id: depositos.id }).from(depositos).orderBy(asc(depositos.id)).limit(1);
  if (dep) return dep.id;
  const [novo] = await tx.insert(depositos).values({ nome: "Loja" }).returning({ id: depositos.id });
  return novo.id;
}

export async function obterOuCriarLote(
  tx: Executor,
  produtoId: number,
  numero: string,
  validade: string | null,
): Promise<number> {
  const numeroLimpo = numero.trim().toUpperCase();
  const [inserido] = await tx
    .insert(lotes)
    .values({ produtoId, numero: numeroLimpo, validade })
    .onConflictDoNothing()
    .returning({ id: lotes.id });
  if (inserido) return inserido.id;
  const [existente] = await tx
    .select({ id: lotes.id })
    .from(lotes)
    .where(
      and(
        eq(lotes.produtoId, produtoId),
        eq(lotes.numero, numeroLimpo),
        validade ? eq(lotes.validade, validade) : isNull(lotes.validade),
      ),
    );
  return existente.id;
}

export async function auditar(
  tx: Executor,
  usuarioId: number | null,
  acao: string,
  entidade: string,
  entidadeId: number | null,
  detalhes?: unknown,
) {
  await tx.insert(logAuditoria).values({ usuarioId, acao, entidade, entidadeId, detalhes: detalhes ?? null });
}

type Movimento = {
  tipo: TipoMovimento;
  produtoId: number;
  loteId: number;
  depositoId: number;
  /** positivo = entra, negativo = sai (em unidades base) */
  quantidade: number;
  custoUnitario?: number;
  documentoTipo?: "entrada" | "venda";
  documentoId?: number;
  motivo?: string;
  usuarioId: number | null;
};

/** Grava o movimento e atualiza o saldo de forma atômica. Lança erro se faltar estoque. */
export async function movimentar(tx: Tx, m: Movimento): Promise<void> {
  if (!Number.isInteger(m.quantidade) || m.quantidade === 0) {
    throw new ErroNegocio("Quantidade de movimentação inválida.");
  }
  if (m.quantidade > 0) {
    await tx
      .insert(saldos)
      .values({ produtoId: m.produtoId, loteId: m.loteId, depositoId: m.depositoId, quantidade: m.quantidade })
      .onConflictDoUpdate({
        target: [saldos.produtoId, saldos.loteId, saldos.depositoId],
        set: { quantidade: sql`${saldos.quantidade} + ${m.quantidade}` },
      });
  } else {
    const retirar = -m.quantidade;
    const atualizado = await tx
      .update(saldos)
      .set({ quantidade: sql`${saldos.quantidade} - ${retirar}` })
      .where(
        and(
          eq(saldos.produtoId, m.produtoId),
          eq(saldos.loteId, m.loteId),
          eq(saldos.depositoId, m.depositoId),
          gte(saldos.quantidade, retirar),
        ),
      )
      .returning({ quantidade: saldos.quantidade });
    if (atualizado.length === 0) throw new ErroNegocio("Estoque insuficiente no lote informado.");
  }
  await tx.insert(movimentos).values({
    tipo: m.tipo,
    produtoId: m.produtoId,
    loteId: m.loteId,
    depositoId: m.depositoId,
    quantidade: m.quantidade,
    custoUnitario: m.custoUnitario ?? 0,
    documentoTipo: m.documentoTipo,
    documentoId: m.documentoId,
    motivo: m.motivo,
    usuarioId: m.usuarioId,
  });
}

export type Alocacao = { loteId: number; quantidade: number; validade: string | null };

/**
 * Escolhe de quais lotes tirar a quantidade pedida, do que vence primeiro para o que vence depois.
 * Lotes vencidos não entram (não se vende produto vencido). Lotes sem validade vão por último.
 * Trava as linhas de saldo (FOR UPDATE) para duas vendas simultâneas não usarem o mesmo saldo.
 */
export async function alocarFefo(
  tx: Tx,
  produtoId: number,
  depositoId: number,
  quantidade: number,
  hoje = hojeIso(),
): Promise<Alocacao[]> {
  const disponiveis = await tx
    .select({ loteId: saldos.loteId, quantidade: saldos.quantidade, validade: lotes.validade })
    .from(saldos)
    .innerJoin(lotes, eq(lotes.id, saldos.loteId))
    .where(
      and(
        eq(saldos.produtoId, produtoId),
        eq(saldos.depositoId, depositoId),
        gt(saldos.quantidade, 0),
        or(isNull(lotes.validade), gte(lotes.validade, hoje)),
      ),
    )
    .orderBy(sql`${lotes.validade} asc nulls last`, asc(lotes.id))
    .for("update", { of: saldos });

  const alocacao: Alocacao[] = [];
  let falta = quantidade;
  for (const lote of disponiveis) {
    if (falta <= 0) break;
    const usar = Math.min(falta, lote.quantidade);
    alocacao.push({ loteId: lote.loteId, quantidade: usar, validade: lote.validade });
    falta -= usar;
  }
  if (falta > 0) {
    const [p] = await tx.select({ descricao: produtos.descricao }).from(produtos).where(eq(produtos.id, produtoId));
    const temDisponivel = quantidade - falta;
    throw new ErroNegocio(
      `Estoque insuficiente de "${p?.descricao ?? produtoId}": pedido ${quantidade} un., disponível ${temDisponivel} un. (lotes vencidos não contam).`,
    );
  }
  return alocacao;
}

// ---------------------------------------------------------------- entrada de mercadorias

export type ItemEntradaInput = {
  embalagemId: number;
  quantidadeEmbalagens: number;
  loteNumero?: string;
  validade?: string | null;
  /** centavos por EMBALAGEM (como vem na nota); convertido para unidade base */
  custoEmbalagem?: number | null;
};

export async function adicionarItemEntrada(db: DB, entradaId: number, item: ItemEntradaInput) {
  if (!Number.isInteger(item.quantidadeEmbalagens) || item.quantidadeEmbalagens <= 0) {
    throw new ErroNegocio("Informe uma quantidade maior que zero.");
  }
  const [ent] = await db.select().from(entradas).where(eq(entradas.id, entradaId));
  if (!ent) throw new ErroNegocio("Entrada não encontrada.");
  if (ent.status !== "aberta") throw new ErroNegocio("Esta entrada já foi finalizada.");

  const [emb] = await db
    .select({ id: embalagens.id, fator: embalagens.fator, produtoId: embalagens.produtoId, perecivel: produtos.perecivel })
    .from(embalagens)
    .innerJoin(produtos, eq(produtos.id, embalagens.produtoId))
    .where(eq(embalagens.id, item.embalagemId));
  if (!emb) throw new ErroNegocio("Embalagem não encontrada.");
  if (emb.perecivel && !item.validade) throw new ErroNegocio("Produto perecível: informe a validade.");

  const custoUnitario =
    item.custoEmbalagem != null ? Math.round(item.custoEmbalagem / emb.fator) : null;

  const [novo] = await db
    .insert(entradaItens)
    .values({
      entradaId,
      produtoId: emb.produtoId,
      embalagemId: emb.id,
      quantidadeEmbalagens: item.quantidadeEmbalagens,
      quantidadeBase: item.quantidadeEmbalagens * emb.fator,
      loteNumero: (item.loteNumero ?? "").trim().toUpperCase(),
      validade: emb.perecivel ? item.validade ?? null : null,
      custoUnitario,
    })
    .returning();
  return novo;
}

/** Lança no estoque todos os itens conferidos e recalcula o custo médio dos produtos. */
export async function finalizarEntrada(
  db: DB,
  entradaId: number,
  usuarioId: number,
  opcoes: { custosPadrao?: Map<number, number> } = {},
) {
  return db.transaction(async (tx) => {
    const [ent] = await tx.select().from(entradas).where(eq(entradas.id, entradaId)).for("update");
    if (!ent) throw new ErroNegocio("Entrada não encontrada.");
    if (ent.status !== "aberta") throw new ErroNegocio("Esta entrada já foi finalizada.");
    const itens = await tx.select().from(entradaItens).where(eq(entradaItens.entradaId, entradaId));
    if (itens.length === 0) throw new ErroNegocio("A entrada não tem itens.");

    const depositoId = await depositoPadrao(tx);
    for (const item of itens) {
      const loteId = await obterOuCriarLote(tx, item.produtoId, item.loteNumero, item.validade);
      // custo digitado na conferência tem prioridade; senão usa o da nota (se houver)
      const custoUnitario = item.custoUnitario ?? opcoes.custosPadrao?.get(item.produtoId) ?? null;

      if (custoUnitario != null) {
        // custo médio ponderado = (saldo atual × custo atual + entrada × custo novo) / saldo final
        const [{ total }] = await tx
          .select({ total: sql<number>`coalesce(sum(${saldos.quantidade}), 0)::int` })
          .from(saldos)
          .where(eq(saldos.produtoId, item.produtoId));
        const [p] = await tx.select({ custoMedio: produtos.custoMedio }).from(produtos).where(eq(produtos.id, item.produtoId));
        const qtdFinal = total + item.quantidadeBase;
        const novoCusto = Math.round((total * p.custoMedio + item.quantidadeBase * custoUnitario) / qtdFinal);
        await tx.update(produtos).set({ custoMedio: novoCusto }).where(eq(produtos.id, item.produtoId));
      }

      await movimentar(tx, {
        tipo: "entrada_compra",
        produtoId: item.produtoId,
        loteId,
        depositoId,
        quantidade: item.quantidadeBase,
        custoUnitario: custoUnitario ?? 0,
        documentoTipo: "entrada",
        documentoId: entradaId,
        usuarioId,
      });
    }
    await tx
      .update(entradas)
      .set({ status: "finalizada", finalizadaEm: new Date() })
      .where(eq(entradas.id, entradaId));
    return { itens: itens.length };
  });
}

// ---------------------------------------------------------------- venda

export type VendaInput = {
  usuarioId: number;
  clienteId?: number | null;
  itens: { embalagemId: number; quantidade: number }[];
  desconto?: number; // centavos
  pagamentos: { forma: FormaPagamento; valor: number }[]; // valor entregue pelo cliente
  /** obrigatório true se houver bebida alcoólica no carrinho */
  idadeConferida?: boolean;
  hoje?: string;
};

export async function registrarVenda(db: DB, v: VendaInput) {
  if (v.itens.length === 0) throw new ErroNegocio("O carrinho está vazio.");
  return db.transaction(async (tx) => {
    // trava o caixa: ninguém fecha o caixa no meio da venda
    const caixa = await caixaAbertoDe(tx, v.usuarioId, true);
    if (!caixa) throw new ErroNegocio("Abra o caixa antes de vender.");
    const depositoId = await depositoPadrao(tx);

    // agrupa itens repetidos da mesma embalagem
    const agrupado = new Map<number, number>();
    for (const i of v.itens) {
      if (!Number.isInteger(i.quantidade) || i.quantidade <= 0) throw new ErroNegocio("Quantidade inválida.");
      agrupado.set(i.embalagemId, (agrupado.get(i.embalagemId) ?? 0) + i.quantidade);
    }

    const linhas: {
      produtoId: number;
      embalagemId: number;
      quantidade: number;
      quantidadeBase: number;
      precoUnitario: number;
      total: number;
      alcoolico: boolean;
      custoMedio: number;
    }[] = [];
    for (const [embalagemId, quantidade] of agrupado) {
      const [e] = await tx
        .select({
          produtoId: embalagens.produtoId,
          fator: embalagens.fator,
          precoVenda: embalagens.precoVenda,
          ativo: embalagens.ativo,
          alcoolico: produtos.alcoolico,
          custoMedio: produtos.custoMedio,
          descricao: produtos.descricao,
        })
        .from(embalagens)
        .innerJoin(produtos, eq(produtos.id, embalagens.produtoId))
        .where(eq(embalagens.id, embalagemId));
      if (!e || !e.ativo) throw new ErroNegocio("Produto/embalagem não encontrado ou inativo.");
      if (e.precoVenda <= 0) throw new ErroNegocio(`"${e.descricao}" está sem preço de venda.`);
      linhas.push({
        produtoId: e.produtoId,
        embalagemId,
        quantidade,
        quantidadeBase: quantidade * e.fator,
        precoUnitario: e.precoVenda,
        total: quantidade * e.precoVenda,
        alcoolico: e.alcoolico,
        custoMedio: e.custoMedio,
      });
    }

    const temAlcool = linhas.some((l) => l.alcoolico);
    if (temAlcool && v.idadeConferida !== true) {
      throw new ErroNegocio("Venda com bebida alcoólica: confirme que a idade do cliente foi conferida.");
    }

    const subtotal = linhas.reduce((s, l) => s + l.total, 0);
    const desconto = v.desconto ?? 0;
    if (desconto < 0 || desconto > subtotal) throw new ErroNegocio("Desconto inválido.");
    const total = subtotal - desconto;

    // pagamentos: só dinheiro pode gerar troco
    const naoDinheiro = v.pagamentos.filter((p) => p.forma !== "dinheiro").reduce((s, p) => s + p.valor, 0);
    const dinheiro = v.pagamentos.filter((p) => p.forma === "dinheiro").reduce((s, p) => s + p.valor, 0);
    if (v.pagamentos.some((p) => !Number.isInteger(p.valor) || p.valor <= 0)) throw new ErroNegocio("Valor de pagamento inválido.");
    if (naoDinheiro > total) throw new ErroNegocio("Pagamentos em cartão/Pix/fiado passam do total da venda.");
    if (naoDinheiro + dinheiro < total) throw new ErroNegocio("Pagamento menor que o total da venda.");
    const dinheiroAbatido = total - naoDinheiro;
    const troco = dinheiro - dinheiroAbatido;

    // fiado: exige cliente e respeita o limite
    const valorFiado = v.pagamentos.filter((p) => p.forma === "fiado").reduce((s, p) => s + p.valor, 0);
    if (valorFiado > 0) {
      if (!v.clienteId) throw new ErroNegocio("Para vender fiado, selecione o cliente.");
      const [c] = await tx.select().from(clientes).where(eq(clientes.id, v.clienteId)).for("update");
      if (!c || !c.ativo) throw new ErroNegocio("Cliente não encontrado ou inativo.");
      const devendo = await saldoFiado(tx, c.id);
      if (devendo + valorFiado > c.limiteFiado) {
        throw new ErroNegocio(
          `Limite de fiado excedido. Limite ${c.limiteFiado / 100}, já deve ${devendo / 100}, nova compra ${valorFiado / 100}.`,
        );
      }
    }

    const [venda] = await tx
      .insert(vendas)
      .values({
        usuarioId: v.usuarioId,
        caixaId: caixa.id,
        clienteId: v.clienteId ?? null,
        subtotal,
        desconto,
        total,
        idadeConferida: temAlcool ? true : null,
      })
      .returning();

    for (const l of linhas) {
      await tx.insert(vendaItens).values({
        vendaId: venda.id,
        produtoId: l.produtoId,
        embalagemId: l.embalagemId,
        quantidade: l.quantidade,
        quantidadeBase: l.quantidadeBase,
        precoUnitario: l.precoUnitario,
        total: l.total,
      });
      const alocacao = await alocarFefo(tx, l.produtoId, depositoId, l.quantidadeBase, v.hoje);
      for (const a of alocacao) {
        await movimentar(tx, {
          tipo: "saida_venda",
          produtoId: l.produtoId,
          loteId: a.loteId,
          depositoId,
          quantidade: -a.quantidade,
          custoUnitario: l.custoMedio,
          documentoTipo: "venda",
          documentoId: venda.id,
          usuarioId: v.usuarioId,
        });
      }
    }

    for (const p of v.pagamentos) {
      if (p.forma === "dinheiro") continue;
      await tx.insert(pagamentos).values({ vendaId: venda.id, forma: p.forma, valor: p.valor });
    }
    if (dinheiro > 0) {
      await tx.insert(pagamentos).values({
        vendaId: venda.id,
        forma: "dinheiro",
        valor: dinheiroAbatido,
        valorRecebido: dinheiro,
        troco,
      });
    }
    if (valorFiado > 0) {
      await tx.insert(fiadoLancamentos).values({
        clienteId: v.clienteId!,
        vendaId: venda.id,
        tipo: "debito",
        valor: valorFiado,
        usuarioId: v.usuarioId,
      });
    }

    return { vendaId: venda.id, total, troco };
  });
}

/** Devolve ao estoque exatamente os lotes que saíram e estorna o fiado. */
export async function cancelarVenda(db: DB, vendaId: number, usuarioId: number, motivo: string) {
  if (!motivo.trim()) throw new ErroNegocio("Informe o motivo do cancelamento.");
  return db.transaction(async (tx) => {
    const [venda] = await tx.select().from(vendas).where(eq(vendas.id, vendaId)).for("update");
    if (!venda) throw new ErroNegocio("Venda não encontrada.");
    if (venda.status === "cancelada") throw new ErroNegocio("Venda já cancelada.");

    // Dinheiro devolvido ao cliente: se o caixa da venda ainda está aberto, a venda só deixa de contar nele.
    // Se já foi fechado, o dinheiro sai do caixa aberto de quem está cancelando (estorno).
    const [{ dinheiro }] = await tx
      .select({ dinheiro: sql<number>`coalesce(sum(${pagamentos.valor}), 0)::int` })
      .from(pagamentos)
      .where(and(eq(pagamentos.vendaId, vendaId), eq(pagamentos.forma, "dinheiro")));
    if (dinheiro > 0) {
      const [original] = venda.caixaId
        ? await tx.select({ status: caixas.status }).from(caixas).where(eq(caixas.id, venda.caixaId)).for("update")
        : [];
      if (original?.status !== "aberto") {
        const meuCaixa = await caixaAbertoDe(tx, usuarioId, true);
        if (!meuCaixa) {
          throw new ErroNegocio("Esta venda é de um caixa já fechado e foi paga em dinheiro: abra o seu caixa para devolver o dinheiro.");
        }
        await tx.insert(caixaMovimentos).values({
          caixaId: meuCaixa.id,
          tipo: "estorno",
          valor: dinheiro,
          motivo: `Cancelamento da venda nº ${vendaId}: ${motivo}`,
          vendaId,
          usuarioId,
        });
      }
    }

    const saidas = await tx
      .select()
      .from(movimentos)
      .where(and(eq(movimentos.documentoTipo, "venda"), eq(movimentos.documentoId, vendaId), eq(movimentos.tipo, "saida_venda")));
    for (const s of saidas) {
      await movimentar(tx, {
        tipo: "cancelamento_venda",
        produtoId: s.produtoId,
        loteId: s.loteId,
        depositoId: s.depositoId,
        quantidade: -s.quantidade,
        custoUnitario: s.custoUnitario,
        documentoTipo: "venda",
        documentoId: vendaId,
        motivo,
        usuarioId,
      });
    }

    const fiado = await tx
      .select()
      .from(fiadoLancamentos)
      .where(and(eq(fiadoLancamentos.vendaId, vendaId), eq(fiadoLancamentos.tipo, "debito")));
    for (const f of fiado) {
      await tx.insert(fiadoLancamentos).values({
        clienteId: f.clienteId,
        vendaId,
        tipo: "credito",
        valor: f.valor,
        usuarioId,
      });
    }

    await tx
      .update(vendas)
      .set({ status: "cancelada", canceladaEm: new Date(), canceladaPor: usuarioId, motivoCancelamento: motivo })
      .where(eq(vendas.id, vendaId));
    await auditar(tx, usuarioId, "cancelar_venda", "venda", vendaId, { motivo, total: venda.total });
  });
}

// ---------------------------------------------------------------- fiado

export async function saldoFiado(tx: Executor, clienteId: number): Promise<number> {
  const [r] = await tx
    .select({
      saldo: sql<number>`coalesce(sum(case when ${fiadoLancamentos.tipo} = 'debito' then ${fiadoLancamentos.valor} else -${fiadoLancamentos.valor} end), 0)::int`,
    })
    .from(fiadoLancamentos)
    .where(eq(fiadoLancamentos.clienteId, clienteId));
  return r.saldo;
}

export async function receberFiado(
  db: DB,
  clienteId: number,
  valor: number,
  forma: Exclude<FormaPagamento, "fiado">,
  usuarioId: number,
) {
  if (!Number.isInteger(valor) || valor <= 0) throw new ErroNegocio("Valor inválido.");
  return db.transaction(async (tx) => {
    // dinheiro entra na gaveta, então precisa de caixa aberto; Pix/cartão ficam ligados ao caixa se houver
    const caixa = await caixaAbertoDe(tx, usuarioId, true);
    if (forma === "dinheiro" && !caixa) throw new ErroNegocio("Para receber em dinheiro, abra o caixa primeiro.");
    const devendo = await saldoFiado(tx, clienteId);
    if (valor > devendo) throw new ErroNegocio(`O cliente deve só ${devendo / 100}.`);
    await tx.insert(fiadoLancamentos).values({ clienteId, tipo: "credito", valor, forma, usuarioId, caixaId: caixa?.id ?? null });
  });
}

// ---------------------------------------------------------------- outras saídas e ajustes

export type SaidaAvulsaInput = {
  tipo: "perda" | "vencido" | "consumo_interno" | "devolucao_fornecedor";
  produtoId: number;
  quantidadeBase: number;
  /** obrigatório para "vencido"; para os demais, se omitido usa FEFO */
  loteId?: number | null;
  motivo: string;
  usuarioId: number;
  hoje?: string;
};

export async function registrarSaidaAvulsa(db: DB, s: SaidaAvulsaInput) {
  if (!s.motivo.trim()) throw new ErroNegocio("Informe o motivo da saída.");
  if (!Number.isInteger(s.quantidadeBase) || s.quantidadeBase <= 0) throw new ErroNegocio("Quantidade inválida.");
  return db.transaction(async (tx) => {
    const depositoId = await depositoPadrao(tx);
    const [p] = await tx.select({ custoMedio: produtos.custoMedio }).from(produtos).where(eq(produtos.id, s.produtoId));
    if (!p) throw new ErroNegocio("Produto não encontrado.");

    let alocacao: { loteId: number; quantidade: number }[];
    if (s.loteId) alocacao = [{ loteId: s.loteId, quantidade: s.quantidadeBase }];
    else if (s.tipo === "vencido") throw new ErroNegocio("Para baixa de vencido, escolha o lote.");
    else alocacao = await alocarFefo(tx, s.produtoId, depositoId, s.quantidadeBase, s.hoje);

    for (const a of alocacao) {
      await movimentar(tx, {
        tipo: s.tipo,
        produtoId: s.produtoId,
        loteId: a.loteId,
        depositoId,
        quantidade: -a.quantidade,
        custoUnitario: p.custoMedio,
        motivo: s.motivo,
        usuarioId: s.usuarioId,
      });
    }
    await auditar(tx, s.usuarioId, `saida_${s.tipo}`, "produto", s.produtoId, {
      quantidade: s.quantidadeBase,
      alocacao,
      motivo: s.motivo,
    });
  });
}

/** Inventário: informa quanto foi contado de um lote; o sistema lança a diferença. */
export async function ajustarInventario(
  db: DB,
  a: { produtoId: number; loteId: number; quantidadeContada: number; motivo: string; usuarioId: number },
) {
  if (!Number.isInteger(a.quantidadeContada) || a.quantidadeContada < 0) throw new ErroNegocio("Contagem inválida.");
  if (!a.motivo.trim()) throw new ErroNegocio("Informe o motivo do ajuste.");
  return db.transaction(async (tx) => {
    const depositoId = await depositoPadrao(tx);
    const [s] = await tx
      .select({ quantidade: saldos.quantidade })
      .from(saldos)
      .where(and(eq(saldos.produtoId, a.produtoId), eq(saldos.loteId, a.loteId), eq(saldos.depositoId, depositoId)))
      .for("update");
    const atual = s?.quantidade ?? 0;
    const diferenca = a.quantidadeContada - atual;
    if (diferenca === 0) return { diferenca: 0 };
    const [p] = await tx.select({ custoMedio: produtos.custoMedio }).from(produtos).where(eq(produtos.id, a.produtoId));
    await movimentar(tx, {
      tipo: "ajuste_inventario",
      produtoId: a.produtoId,
      loteId: a.loteId,
      depositoId,
      quantidade: diferenca,
      custoUnitario: p.custoMedio,
      motivo: a.motivo,
      usuarioId: a.usuarioId,
    });
    await auditar(tx, a.usuarioId, "ajuste_inventario", "produto", a.produtoId, {
      loteId: a.loteId,
      antes: atual,
      depois: a.quantidadeContada,
      motivo: a.motivo,
    });
    return { diferenca };
  });
}

// ---------------------------------------------------------------- consultas

export async function buscarPorCodigo(db: Executor, codigos: string[]) {
  for (const codigo of codigos) {
    const [r] = await db
      .select({
        embalagemId: embalagens.id,
        tipo: embalagens.tipo,
        fator: embalagens.fator,
        precoVenda: embalagens.precoVenda,
        codigoBarras: embalagens.codigoBarras,
        produtoId: produtos.id,
        descricao: produtos.descricao,
        perecivel: produtos.perecivel,
        alcoolico: produtos.alcoolico,
      })
      .from(embalagens)
      .innerJoin(produtos, eq(produtos.id, embalagens.produtoId))
      .where(and(eq(embalagens.codigoBarras, codigo), eq(embalagens.ativo, true), eq(produtos.ativo, true)));
    if (r) return r;
  }
  return null;
}

/** Saldo vendável (exclui vencidos) por produto. */
export async function saldoVendavel(db: Executor, produtoId: number, hoje = hojeIso()): Promise<number> {
  const [r] = await db
    .select({ total: sql<number>`coalesce(sum(${saldos.quantidade}), 0)::int` })
    .from(saldos)
    .innerJoin(lotes, eq(lotes.id, saldos.loteId))
    .where(and(eq(saldos.produtoId, produtoId), or(isNull(lotes.validade), gte(lotes.validade, hoje))));
  return r.total;
}

