/** Consultas de leitura usadas pelas telas e relatórios. */
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { alertasValidade, categorias, lotes, produtos, saldos, vendas } from "@/db/schema";
import { FUSO, hojeIso } from "./formato";

/** Posição de estoque por produto (unidades base), separando o que está vencido. */
export async function posicaoEstoque(db: DB, hoje = hojeIso()) {
  return db
    .select({
      produtoId: produtos.id,
      descricao: produtos.descricao,
      marca: produtos.marca,
      categoria: categorias.nome,
      estoqueMinimo: produtos.estoqueMinimo,
      custoMedio: produtos.custoMedio,
      ativo: produtos.ativo,
      total: sql<number>`coalesce(sum(${saldos.quantidade}), 0)::int`,
      vencido: sql<number>`coalesce(sum(case when ${lotes.validade} < ${hoje} then ${saldos.quantidade} else 0 end), 0)::int`,
      proximaValidade: sql<string | null>`min(case when ${saldos.quantidade} > 0 and ${lotes.validade} >= ${hoje} then ${lotes.validade} end)`,
      /** validade mais antiga entre os lotes vencidos que ainda têm saldo */
      vencidoDesde: sql<string | null>`min(case when ${saldos.quantidade} > 0 and ${lotes.validade} < ${hoje} then ${lotes.validade} end)`,
    })
    .from(produtos)
    .leftJoin(categorias, eq(categorias.id, produtos.categoriaId))
    .leftJoin(saldos, eq(saldos.produtoId, produtos.id))
    .leftJoin(lotes, eq(lotes.id, saldos.loteId))
    .groupBy(produtos.id, categorias.nome)
    .orderBy(produtos.descricao);
}

export async function lotesDoProduto(db: DB, produtoId: number) {
  return db
    .select({
      loteId: lotes.id,
      numero: lotes.numero,
      validade: lotes.validade,
      quantidade: sql<number>`coalesce(sum(${saldos.quantidade}), 0)::int`,
    })
    .from(lotes)
    .leftJoin(saldos, eq(saldos.loteId, lotes.id))
    .where(eq(lotes.produtoId, produtoId))
    .groupBy(lotes.id)
    .having(sql`coalesce(sum(${saldos.quantidade}), 0) > 0`)
    .orderBy(sql`${lotes.validade} asc nulls last`);
}

export async function alertasAbertos(db: DB) {
  return db
    .select({
      id: alertasValidade.id,
      faixa: alertasValidade.faixa,
      status: alertasValidade.status,
      acao: alertasValidade.acao,
      observacao: alertasValidade.observacao,
      loteId: lotes.id,
      lote: lotes.numero,
      validade: lotes.validade,
      produtoId: produtos.id,
      produto: produtos.descricao,
      quantidade: sql<number>`coalesce(sum(${saldos.quantidade}), 0)::int`,
      valorRisco: sql<number>`coalesce(sum(${saldos.quantidade}), 0)::int * ${produtos.custoMedio}`,
    })
    .from(alertasValidade)
    .innerJoin(lotes, eq(lotes.id, alertasValidade.loteId))
    .innerJoin(produtos, eq(produtos.id, lotes.produtoId))
    .leftJoin(saldos, eq(saldos.loteId, lotes.id))
    .where(ne(alertasValidade.status, "resolvido"))
    .groupBy(alertasValidade.id, lotes.id, produtos.id)
    .orderBy(lotes.validade);
}

export async function vendasDoDia(db: DB, dia = hojeIso()) {
  const [r] = await db
    .select({
      quantidade: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${vendas.total}), 0)::int`,
    })
    .from(vendas)
    .where(
      and(
        eq(vendas.status, "finalizada"),
        sql`(${vendas.criadoEm} at time zone ${FUSO})::date = ${dia}`,
      ),
    );
  return r;
}

export async function vendasRecentes(db: DB, limite = 50) {
  return db.query.vendas.findMany({
    orderBy: desc(vendas.criadoEm),
    limit: limite,
    with: {
      usuario: { columns: { nome: true } },
      cliente: { columns: { nome: true } },
      pagamentos: true,
      itens: { with: { produto: { columns: { descricao: true } }, embalagem: { columns: { tipo: true, fator: true } } } },
    },
  });
}

/** Curva ABC simples por faturamento nos últimos N dias. */
export async function curvaAbc(db: DB, dias = 30) {
  type Linha = { produto_id: number; descricao: string; faturamento: number; unidades: number };
  const resultado = await db.execute(sql`
    select p.id as produto_id, p.descricao,
           sum(vi.total)::int as faturamento, sum(vi.quantidade_base)::int as unidades
    from venda_itens vi
    join vendas v on v.id = vi.venda_id and v.status = 'finalizada'
    join produtos p on p.id = vi.produto_id
    where v.criado_em >= now() - make_interval(days => ${dias})
    group by p.id, p.descricao
    order by faturamento desc`);
  const rows = (resultado as unknown as { rows: Linha[] }).rows ?? [];
  const total = rows.reduce((s, r) => s + r.faturamento, 0) || 1;
  let acumuladoAntes = 0;
  return rows.map((r) => {
    // classe pelo acumulado ANTES do item: o 1º sempre é A, mesmo se sozinho passar de 80%
    const pct = acumuladoAntes / total;
    acumuladoAntes += r.faturamento;
    return { ...r, participacao: r.faturamento / total, classe: pct < 0.8 ? "A" : pct < 0.95 ? "B" : "C" };
  });
}
