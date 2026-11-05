/**
 * Controle de validade: classifica lotes em faixas e mantém a tabela de alertas.
 * Rodar uma vez por dia (o serviço "rotinas" do docker-compose chama /api/rotinas/validade).
 */
import { and, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { alertasValidade, lotes, produtos, saldos } from "@/db/schema";
import { diasAte, hojeIso, somarDias } from "./formato";
import { auditar, ErroNegocio, registrarSaidaAvulsa } from "./estoque";

/** Faixas em dias, da mais urgente para a menos. Ajuste aqui ou via variável de ambiente. */
export const FAIXAS: number[] = (process.env.FAIXAS_VALIDADE ?? "15,30,60,90")
  .split(",")
  .map(Number)
  .filter((n) => n > 0)
  .sort((a, b) => a - b);

export type Faixa = "vencido" | `${number}`;

export function classificar(validade: string, hoje = hojeIso()): Faixa | null {
  const dias = diasAte(validade, hoje);
  if (dias < 0) return "vencido";
  for (const f of FAIXAS) if (dias <= f) return String(f) as Faixa;
  return null;
}

/**
 * Atualiza os alertas:
 *  - cria alerta para lote com saldo que entrou numa faixa
 *  - muda a faixa (e reabre) quando o lote piora de faixa
 *  - resolve automaticamente alertas de lotes que zeraram
 * Retorna os alertas novos ou que pioraram (para notificar).
 */
export async function atualizarAlertas(db: DB, hoje = hojeIso()) {
  const limite = somarDias(hoje, Math.max(...FAIXAS));
  const candidatos = await db
    .select({
      loteId: lotes.id,
      validade: lotes.validade,
      numero: lotes.numero,
      produto: produtos.descricao,
      quantidade: sql<number>`sum(${saldos.quantidade})::int`,
      valorCusto: sql<number>`sum(${saldos.quantidade} * ${produtos.custoMedio})::bigint`,
    })
    .from(saldos)
    .innerJoin(lotes, eq(lotes.id, saldos.loteId))
    .innerJoin(produtos, eq(produtos.id, lotes.produtoId))
    .where(and(isNotNull(lotes.validade), lte(lotes.validade, limite), gt(saldos.quantidade, 0)))
    .groupBy(lotes.id, produtos.descricao);

  const existentes = new Map(
    (await db.select().from(alertasValidade)).map((a) => [a.loteId, a]),
  );
  const ordem = (f: string) => (f === "vencido" ? -1 : Number(f));
  const notificar: { produto: string; lote: string; validade: string; faixa: Faixa; quantidade: number }[] = [];
  const comSaldo = new Set<number>();

  for (const c of candidatos) {
    comSaldo.add(c.loteId);
    const faixa = classificar(c.validade!, hoje);
    if (!faixa) continue;
    const atual = existentes.get(c.loteId);
    if (!atual) {
      await db.insert(alertasValidade).values({ loteId: c.loteId, faixa });
      notificar.push({ produto: c.produto, lote: c.numero, validade: c.validade!, faixa, quantidade: c.quantidade });
    } else if (ordem(faixa) < ordem(atual.faixa)) {
      // piorou de faixa: atualiza e reabre se estava resolvido
      await db
        .update(alertasValidade)
        .set({
          faixa,
          status: atual.status === "resolvido" ? "aberto" : atual.status,
          atualizadoEm: new Date(),
        })
        .where(eq(alertasValidade.id, atual.id));
      notificar.push({ produto: c.produto, lote: c.numero, validade: c.validade!, faixa, quantidade: c.quantidade });
    }
  }

  // lotes que zeraram: resolve sozinho (vendeu tudo)
  for (const [loteId, a] of existentes) {
    if (!comSaldo.has(loteId) && a.status !== "resolvido") {
      await db
        .update(alertasValidade)
        .set({ status: "resolvido", acao: a.acao ?? "vendido", atualizadoEm: new Date() })
        .where(eq(alertasValidade.id, a.id));
    }
  }
  return notificar;
}

/** Registra a decisão tomada para um lote em alerta. Descarte já baixa o estoque como "vencido"/"perda". */
export async function tratarAlerta(
  db: DB,
  a: {
    alertaId: number;
    acao: "promocao" | "troca_fornecedor" | "descarte";
    observacao?: string;
    usuarioId: number;
    hoje?: string;
  },
) {
  const [alerta] = await db
    .select({ id: alertasValidade.id, loteId: alertasValidade.loteId, produtoId: lotes.produtoId, validade: lotes.validade })
    .from(alertasValidade)
    .innerJoin(lotes, eq(lotes.id, alertasValidade.loteId))
    .where(eq(alertasValidade.id, a.alertaId));
  if (!alerta) throw new ErroNegocio("Alerta não encontrado.");

  if (a.acao === "descarte") {
    const [s] = await db
      .select({ q: sql<number>`coalesce(sum(${saldos.quantidade}),0)::int` })
      .from(saldos)
      .where(eq(saldos.loteId, alerta.loteId));
    if (s.q > 0) {
      const vencido = alerta.validade != null && diasAte(alerta.validade, a.hoje ?? hojeIso()) < 0;
      await registrarSaidaAvulsa(db, {
        tipo: vencido ? "vencido" : "perda",
        produtoId: alerta.produtoId,
        loteId: alerta.loteId,
        quantidadeBase: s.q,
        motivo: a.observacao?.trim() || "Descarte por validade",
        usuarioId: a.usuarioId,
      });
    }
  }

  await db
    .update(alertasValidade)
    .set({
      acao: a.acao,
      status: a.acao === "descarte" ? "resolvido" : "em_acao",
      observacao: a.observacao ?? null,
      responsavelId: a.usuarioId,
      atualizadoEm: new Date(),
    })
    .where(eq(alertasValidade.id, a.alertaId));
  await auditar(db, a.usuarioId, "tratar_alerta_validade", "alerta_validade", a.alertaId, a);
}

/** Envia o resumo para um webhook (ex.: serviço de WhatsApp, n8n, Slack). Opcional. */
export async function notificarResumo(itens: Awaited<ReturnType<typeof atualizarAlertas>>) {
  const url = process.env.WEBHOOK_ALERTAS;
  if (!url || itens.length === 0) return { enviado: false };
  const linhas = itens.map(
    (i) =>
      `• ${i.produto} — lote ${i.lote || "s/n"} — vence ${i.validade.split("-").reverse().join("/")} (${
        i.faixa === "vencido" ? "VENCIDO" : `≤ ${i.faixa} dias`
      }) — ${i.quantidade} un.`,
  );
  const texto = `⚠️ Validade — ${itens.length} lote(s) precisam de atenção:\n${linhas.join("\n")}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ texto, itens }),
  });
  return { enviado: r.ok };
}
