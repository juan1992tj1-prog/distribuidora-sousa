/**
 * Sugestão de compra: quanto pedir de cada produto, olhando o giro (vendas recentes) e o estoque mínimo.
 *
 *   média diária   = unidades vendidas no período ÷ dias do período
 *   estoque alvo   = estoque mínimo + média diária × dias de cobertura desejados
 *   sugerido       = alvo − estoque vendável, arredondado para cima na embalagem de compra (caixa/fardo)
 *
 * Vendas canceladas não contam. Lotes vencidos não contam como estoque.
 */
import { sql } from "drizzle-orm";
import type { DB } from "@/db";
import { hojeIso } from "./formato";

export type ParametrosSugestao = {
  vendidoNoPeriodo: number; // unidades base
  diasPeriodo: number;
  estoque: number; // unidades base vendáveis
  estoqueMinimo: number;
  diasCobertura: number;
  /** unidades por embalagem de compra (ex.: caixa com 12 → 12) */
  fatorCompra: number;
};

export type Sugestao = {
  mediaDiaria: number;
  /** quantos dias o estoque atual dura no ritmo atual (null = sem vendas no período) */
  coberturaDias: number | null;
  alvo: number;
  embalagens: number;
  unidades: number;
};

export function calcularSugestao(p: ParametrosSugestao): Sugestao {
  const dias = Math.max(1, p.diasPeriodo);
  const fator = Math.max(1, p.fatorCompra);
  const mediaDiaria = Math.max(0, p.vendidoNoPeriodo) / dias;
  const estoque = Math.max(0, p.estoque);
  const coberturaDias = mediaDiaria > 0 ? estoque / mediaDiaria : null;
  const alvo = p.estoqueMinimo + Math.ceil(mediaDiaria * p.diasCobertura);
  const falta = alvo - estoque;
  const embalagens = falta > 0 ? Math.ceil(falta / fator) : 0;
  return { mediaDiaria, coberturaDias, alvo, embalagens, unidades: embalagens * fator };
}

export type LinhaCompra = {
  produtoId: number;
  descricao: string;
  fornecedorId: number | null;
  fornecedor: string | null;
  vendido: number;
  estoque: number;
  estoqueMinimo: number;
  /** embalagem de compra: a maior embalagem ativa do produto */
  embalagemTipo: string;
  fatorCompra: number;
  /** centavos por unidade base: custo da última compra, ou o custo médio */
  custoUnitario: number;
} & Sugestao;

export async function sugestaoDeCompra(
  db: DB,
  opcoes: { diasPeriodo?: number; diasCobertura?: number; hoje?: string } = {},
): Promise<LinhaCompra[]> {
  const diasPeriodo = opcoes.diasPeriodo ?? 30;
  const diasCobertura = opcoes.diasCobertura ?? 15;
  const hoje = opcoes.hoje ?? hojeIso();

  type Row = {
    produto_id: number;
    descricao: string;
    estoque_minimo: number;
    custo_medio: number;
    vendido: number;
    estoque: number;
    emb_tipo: string | null;
    emb_fator: number | null;
    fornecedor_id: number | null;
    fornecedor: string | null;
    ultimo_custo: number | null;
  };
  const r = await db.execute(sql`
    select p.id as produto_id, p.descricao, p.estoque_minimo, p.custo_medio,
      coalesce((
        select -sum(m.quantidade) from movimentos m
        where m.produto_id = p.id and m.tipo in ('saida_venda', 'cancelamento_venda')
          and m.criado_em >= (${hoje}::date - make_interval(days => ${diasPeriodo}))
      ), 0)::int as vendido,
      coalesce((
        select sum(s.quantidade) from saldos s join lotes l on l.id = s.lote_id
        where s.produto_id = p.id and (l.validade is null or l.validade >= ${hoje}::date)
      ), 0)::int as estoque,
      emb.tipo as emb_tipo, emb.fator as emb_fator,
      ult.fornecedor_id, f.nome as fornecedor, ult.custo_unitario as ultimo_custo
    from produtos p
    left join lateral (
      select e.tipo, e.fator from embalagens e
      where e.produto_id = p.id and e.ativo
      order by e.fator desc limit 1
    ) emb on true
    left join lateral (
      select en.fornecedor_id, m.custo_unitario from movimentos m
      join entradas en on en.id = m.documento_id
      where m.produto_id = p.id and m.tipo = 'entrada_compra' and m.documento_tipo = 'entrada'
      order by m.criado_em desc, m.id desc limit 1
    ) ult on true
    left join fornecedores f on f.id = ult.fornecedor_id
    where p.ativo
    order by p.descricao`);
  const rows = (r as unknown as { rows: Row[] }).rows ?? [];

  return rows.map((row) => {
    const fatorCompra = row.emb_fator ?? 1;
    const s = calcularSugestao({
      vendidoNoPeriodo: row.vendido,
      diasPeriodo,
      estoque: row.estoque,
      estoqueMinimo: row.estoque_minimo,
      diasCobertura,
      fatorCompra,
    });
    return {
      produtoId: row.produto_id,
      descricao: row.descricao,
      fornecedorId: row.fornecedor_id,
      fornecedor: row.fornecedor,
      vendido: row.vendido,
      estoque: row.estoque,
      estoqueMinimo: row.estoque_minimo,
      embalagemTipo: row.emb_tipo ?? "UN",
      fatorCompra,
      custoUnitario: row.ultimo_custo && row.ultimo_custo > 0 ? row.ultimo_custo : row.custo_medio,
      ...s,
    };
  });
}
