/**
 * Importação do XML da NF-e do fornecedor na entrada de mercadorias.
 *
 * Fluxo (conferência cega):
 *  1. O gerente importa o XML: o sistema guarda os itens da nota como "esperado".
 *  2. O estoquista bipa o que chegou SEM ver as quantidades da nota.
 *  3. A tela do gerente compara nota × contado e aponta faltas e sobras.
 *  4. Para finalizar com divergência é preciso confirmar (fica registrado na auditoria).
 *
 * Itens da nota são ligados ao nosso cadastro por: (1) vínculo salvo do fornecedor,
 * (2) código de barras da embalagem comercial (cEAN), (3) código de barras tributável (cEANTrib).
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  embalagens,
  entradaItens,
  entradaNotaItens,
  entradas,
  fornecedores,
  produtoFornecedor,
  produtos,
} from "@/db/schema";
import { ErroNegocio } from "./erros";
import { auditar, buscarPorCodigo, finalizarEntrada } from "./estoque";
import { gtinValido, variacoesGtin } from "./gs1";
import type { NotaExtraida } from "./ia-nota";

// ---------------------------------------------------------------- leitura do XML

export type ItemNfe = {
  numeroItem: number;
  codigo: string;
  ean: string | null;
  eanTrib: string | null;
  descricao: string;
  unidade: string;
  quantidade: number;
  unidadeTrib: string;
  quantidadeTrib: number;
  valorTotal: number; // centavos (vProd)
  lote: string | null;
  validade: string | null; // AAAA-MM-DD
};

export type Nfe = {
  chave: string;
  numero: string;
  serie: string;
  emissao: string | null;
  emitente: { cnpj: string; nome: string };
  itens: ItemNfe[];
};

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodificar(t: string) {
  return t
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTIDADES[e] ?? m;
    })
    .trim();
}

/** Conteúdo da primeira tag com esse nome (aceita prefixo de namespace, ex.: <nfe:xProd>). */
function tag(xml: string, nome: string): string | null {
  const m = new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`).exec(xml);
  return m ? decodificar(m[1]) : null;
}

function blocos(xml: string, nome: string): { conteudo: string; abertura: string }[] {
  const re = new RegExp(`(<(?:\\w+:)?${nome}(?:\\s[^>]*)?>)([\\s\\S]*?)</(?:\\w+:)?${nome}>`, "g");
  return [...xml.matchAll(re)].map((m) => ({ abertura: m[1], conteudo: m[2] }));
}

function gtinOuNull(v: string | null): string | null {
  const so = (v ?? "").replace(/\D/g, "");
  return so && gtinValido(so) ? so : null; // "SEM GTIN" e códigos inválidos viram null
}

export function lerNfe(xml: string): Nfe {
  if (!/<(?:\w+:)?infNFe[\s>]/.test(xml)) {
    throw new ErroNegocio("Este arquivo não parece ser o XML de uma NF-e.");
  }
  const [inf] = blocos(xml, "infNFe");
  const idAttr = /Id="NFe(\d{44})"/.exec(inf.abertura)?.[1];
  const chave = idAttr ?? tag(xml, "chNFe") ?? "";
  if (!/^\d{44}$/.test(chave)) throw new ErroNegocio("Não encontrei a chave de acesso da NF-e no XML.");
  const modelo = tag(inf.conteudo, "mod");
  if (modelo && modelo !== "55") throw new ErroNegocio(`Documento modelo ${modelo}: só NF-e (modelo 55) pode ser importada.`);

  const ide = blocos(inf.conteudo, "ide")[0]?.conteudo ?? "";
  const emit = blocos(inf.conteudo, "emit")[0]?.conteudo ?? "";

  const itens: ItemNfe[] = blocos(inf.conteudo, "det").map(({ abertura, conteudo }, i) => {
    const prod = blocos(conteudo, "prod")[0]?.conteudo ?? conteudo;
    const rastro = blocos(prod, "rastro")[0]?.conteudo;
    const num = (n: string | null) => Number((n ?? "0").replace(",", "."));
    return {
      numeroItem: Number(/nItem="(\d+)"/.exec(abertura)?.[1] ?? i + 1),
      codigo: tag(prod, "cProd") ?? "",
      ean: gtinOuNull(tag(prod, "cEAN")),
      eanTrib: gtinOuNull(tag(prod, "cEANTrib")),
      descricao: tag(prod, "xProd") ?? "(sem descrição)",
      unidade: (tag(prod, "uCom") ?? "").toUpperCase(),
      quantidade: num(tag(prod, "qCom")),
      unidadeTrib: (tag(prod, "uTrib") ?? "").toUpperCase(),
      quantidadeTrib: num(tag(prod, "qTrib")),
      valorTotal: Math.round(num(tag(prod, "vProd")) * 100),
      lote: rastro ? tag(rastro, "nLote") : null,
      validade: rastro ? tag(rastro, "dVal")?.slice(0, 10) ?? null : null,
    };
  });
  if (itens.length === 0) throw new ErroNegocio("A NF-e não tem itens.");

  return {
    chave,
    numero: tag(ide, "nNF") ?? "",
    serie: tag(ide, "serie") ?? "",
    emissao: tag(ide, "dhEmi")?.slice(0, 10) ?? null,
    emitente: { cnpj: (tag(emit, "CNPJ") ?? tag(emit, "CPF") ?? "").replace(/\D/g, ""), nome: tag(emit, "xNome") ?? "Fornecedor" },
    itens,
  };
}

// ---------------------------------------------------------------- importação

async function fornecedorDaNota(db: DB, emitente: Nfe["emitente"]): Promise<number> {
  if (emitente.cnpj) {
    const [f] = await db.select({ id: fornecedores.id }).from(fornecedores).where(eq(fornecedores.cnpj, emitente.cnpj));
    if (f) return f.id;
  } else {
    // nota lida por IA sem CNPJ: reaproveita fornecedor com o mesmo nome, em vez de duplicar
    const [f] = await db.select({ id: fornecedores.id }).from(fornecedores).where(sql`lower(${fornecedores.nome}) = lower(${emitente.nome})`);
    if (f) return f.id;
  }
  const [novo] = await db
    .insert(fornecedores)
    .values({ nome: emitente.nome.slice(0, 160), cnpj: emitente.cnpj || null })
    .returning({ id: fornecedores.id });
  return novo.id;
}

/** Descobre a nossa embalagem para um item da nota e quantas unidades ele representa. */
async function identificarItem(db: DB, fornecedorId: number, item: ItemNfe) {
  const [vinculo] = await db
    .select({ embalagemId: produtoFornecedor.embalagemId, multiplicador: produtoFornecedor.multiplicador, fator: embalagens.fator })
    .from(produtoFornecedor)
    .innerJoin(embalagens, eq(embalagens.id, produtoFornecedor.embalagemId))
    .where(and(eq(produtoFornecedor.fornecedorId, fornecedorId), eq(produtoFornecedor.codigoFornecedor, item.codigo)));
  if (vinculo) {
    return { embalagemId: vinculo.embalagemId, quantidadeBase: Math.round(item.quantidade * vinculo.multiplicador * vinculo.fator) };
  }
  if (item.ean) {
    const e = await buscarPorCodigo(db, variacoesGtin(item.ean));
    if (e) return { embalagemId: e.embalagemId, quantidadeBase: Math.round(item.quantidade * e.fator) };
  }
  if (item.eanTrib && item.quantidadeTrib > 0) {
    const e = await buscarPorCodigo(db, variacoesGtin(item.eanTrib));
    if (e) return { embalagemId: e.embalagemId, quantidadeBase: Math.round(item.quantidadeTrib * e.fator) };
  }
  return { embalagemId: null, quantidadeBase: null };
}

export async function importarNfe(db: DB, entradaId: number, xml: string, usuarioId: number) {
  const nfe = lerNfe(xml);
  const r = await gravarItensDaNota(db, entradaId, nfe);
  await auditar(db, usuarioId, "importar_nfe", "entrada", entradaId, { chave: nfe.chave, itens: r.itens });
  return { ...r, numero: nfe.numero };
}

/**
 * Importa os itens lidos por IA (PDF/foto do DANFE ou pedido em texto) no mesmo fluxo da
 * NF-e: vínculo com o cadastro + conferência cega. Itens sem código do fornecedor são
 * lembrados pela descrição, então o vínculo manual também vale para as próximas notas.
 */
export async function importarNotaLidaPorIa(db: DB, entradaId: number, nota: NotaExtraida, usuarioId: number, modelo: string) {
  const itens: ItemNfe[] = nota.itens.map((it, i) => ({
    numeroItem: i + 1,
    codigo: it.codigo ?? codigoPorDescricao(it.descricao),
    ean: it.ean,
    eanTrib: null,
    descricao: it.descricao,
    unidade: it.unidade,
    quantidade: it.quantidade,
    unidadeTrib: it.unidade,
    quantidadeTrib: 0,
    valorTotal: it.valorTotal,
    lote: it.lote,
    validade: it.validade,
  }));
  const r = await gravarItensDaNota(db, entradaId, { chave: nota.chave, numero: nota.numero ?? "", emitente: nota.emitente, itens });
  await auditar(db, usuarioId, "importar_nota_ia", "entrada", entradaId, {
    modelo,
    chave: nota.chave,
    itens: r.itens,
    observacoes: nota.observacoes,
  });
  return { ...r, numero: nota.numero, observacoes: nota.observacoes };
}

/** Chave estável para lembrar um item sem código: "DESC:" + descrição sem acento/pontuação. */
export function codigoPorDescricao(descricao: string) {
  const norm = descricao
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  return `DESC:${norm}`.slice(0, 60);
}

type DadosNota = { chave: string | null; numero: string; emitente: Nfe["emitente"]; itens: ItemNfe[] };

/** Parte comum a XML e IA: impede nota duplicada, identifica fornecedor e itens e grava o "esperado". */
async function gravarItensDaNota(db: DB, entradaId: number, nfe: DadosNota) {
  const [ent] = await db.select().from(entradas).where(eq(entradas.id, entradaId));
  if (!ent) throw new ErroNegocio("Entrada não encontrada.");
  if (ent.status !== "aberta") throw new ErroNegocio("Esta entrada já foi finalizada.");
  if (ent.chaveNfe && nfe.chave && ent.chaveNfe !== nfe.chave) throw new ErroNegocio("Esta entrada já tem outra nota importada.");
  if (nfe.chave) {
    const [outra] = await db
      .select({ id: entradas.id })
      .from(entradas)
      .where(and(eq(entradas.chaveNfe, nfe.chave), sql`${entradas.id} <> ${entradaId}`));
    if (outra) throw new ErroNegocio(`Esta NF-e já foi importada na entrada nº ${outra.id}.`);
  }

  const fornecedorId = ent.fornecedorId && !nfe.emitente.cnpj ? ent.fornecedorId : await fornecedorDaNota(db, nfe.emitente);
  const linhas: (typeof entradaNotaItens.$inferInsert)[] = [];
  for (const item of nfe.itens) {
    const ident = await identificarItem(db, fornecedorId, item);
    linhas.push({
      entradaId,
      numeroItem: item.numeroItem,
      codigoFornecedor: item.codigo.slice(0, 60),
      gtin: item.ean ?? item.eanTrib,
      descricao: item.descricao.slice(0, 200),
      unidade: item.unidade.slice(0, 10),
      quantidade: item.quantidade,
      valorTotal: item.valorTotal,
      lote: item.lote?.slice(0, 40)?.toUpperCase() ?? null,
      validade: item.validade,
      ...ident,
    });
  }

  await db.transaction(async (tx) => {
    await tx.delete(entradaNotaItens).where(eq(entradaNotaItens.entradaId, entradaId)); // reimportação da mesma nota
    await tx.insert(entradaNotaItens).values(linhas);
    await tx
      .update(entradas)
      .set({ chaveNfe: nfe.chave ?? ent.chaveNfe, numeroNota: nfe.numero.slice(0, 20) || ent.numeroNota, fornecedorId })
      .where(eq(entradas.id, entradaId));
  });
  return { itens: linhas.length, vinculados: linhas.filter((l) => l.embalagemId).length };
}

/** Liga um item da nota a uma embalagem nossa e lembra disso para as próximas notas do fornecedor. */
export async function vincularItemNota(db: DB, notaItemId: number, embalagemId: number, multiplicador: number, usuarioId: number) {
  if (!(multiplicador > 0)) throw new ErroNegocio("Quantidade por unidade da nota inválida.");
  const [item] = await db
    .select({ item: entradaNotaItens, fornecedorId: entradas.fornecedorId, status: entradas.status })
    .from(entradaNotaItens)
    .innerJoin(entradas, eq(entradas.id, entradaNotaItens.entradaId))
    .where(eq(entradaNotaItens.id, notaItemId));
  if (!item) throw new ErroNegocio("Item da nota não encontrado.");
  if (item.status !== "aberta") throw new ErroNegocio("Esta entrada já foi finalizada.");
  const [emb] = await db.select().from(embalagens).where(eq(embalagens.id, embalagemId));
  if (!emb) throw new ErroNegocio("Embalagem não encontrada.");

  await db
    .update(entradaNotaItens)
    .set({ embalagemId, quantidadeBase: Math.round(item.item.quantidade * multiplicador * emb.fator) })
    .where(eq(entradaNotaItens.id, notaItemId));
  if (item.fornecedorId) {
    await db
      .insert(produtoFornecedor)
      .values({ fornecedorId: item.fornecedorId, codigoFornecedor: item.item.codigoFornecedor, embalagemId, multiplicador })
      .onConflictDoUpdate({
        target: [produtoFornecedor.fornecedorId, produtoFornecedor.codigoFornecedor],
        set: { embalagemId, multiplicador },
      });
  }
  await auditar(db, usuarioId, "vincular_item_nota", "entrada", item.item.entradaId, { notaItemId, embalagemId, multiplicador });
}

// ---------------------------------------------------------------- comparação nota × contado

export type LinhaComparacao = {
  produtoId: number;
  descricao: string;
  naNota: number;
  contado: number;
  diferenca: number; // contado − nota
  situacao: "ok" | "falta" | "sobra" | "fora_da_nota";
};

export async function compararComNota(db: DB, entradaId: number) {
  const nota = await db
    .select({
      produtoId: embalagens.produtoId,
      descricao: produtos.descricao,
      quantidade: sql<number>`sum(${entradaNotaItens.quantidadeBase})::int`,
    })
    .from(entradaNotaItens)
    .innerJoin(embalagens, eq(embalagens.id, entradaNotaItens.embalagemId))
    .innerJoin(produtos, eq(produtos.id, embalagens.produtoId))
    .where(eq(entradaNotaItens.entradaId, entradaId))
    .groupBy(embalagens.produtoId, produtos.descricao);

  const contado = await db
    .select({
      produtoId: entradaItens.produtoId,
      descricao: produtos.descricao,
      quantidade: sql<number>`sum(${entradaItens.quantidadeBase})::int`,
    })
    .from(entradaItens)
    .innerJoin(produtos, eq(produtos.id, entradaItens.produtoId))
    .where(eq(entradaItens.entradaId, entradaId))
    .groupBy(entradaItens.produtoId, produtos.descricao);

  const pendentes = await db
    .select()
    .from(entradaNotaItens)
    .where(and(eq(entradaNotaItens.entradaId, entradaId), sql`${entradaNotaItens.embalagemId} is null`))
    .orderBy(entradaNotaItens.numeroItem);

  const mapa = new Map<number, LinhaComparacao>();
  for (const n of nota) {
    mapa.set(n.produtoId, { produtoId: n.produtoId, descricao: n.descricao, naNota: n.quantidade, contado: 0, diferenca: 0, situacao: "ok" });
  }
  for (const c of contado) {
    const linha = mapa.get(c.produtoId) ?? { produtoId: c.produtoId, descricao: c.descricao, naNota: 0, contado: 0, diferenca: 0, situacao: "ok" as const };
    linha.contado = c.quantidade;
    mapa.set(c.produtoId, linha);
  }
  const linhas = [...mapa.values()].map((l) => {
    const diferenca = l.contado - l.naNota;
    const situacao: LinhaComparacao["situacao"] =
      l.naNota === 0 ? "fora_da_nota" : diferenca === 0 ? "ok" : diferenca < 0 ? "falta" : "sobra";
    return { ...l, diferenca, situacao };
  });
  linhas.sort((a, b) => Number(a.situacao === "ok") - Number(b.situacao === "ok") || a.descricao.localeCompare(b.descricao));

  return {
    temNota: nota.length > 0 || pendentes.length > 0,
    linhas,
    pendentes,
    divergencias: linhas.filter((l) => l.situacao !== "ok").length + pendentes.length,
  };
}

/** Custo por unidade de cada produto segundo a nota (para lançar o custo quando não foi digitado). */
export async function custosDaNota(db: DB, entradaId: number): Promise<Map<number, number>> {
  const r = await db
    .select({
      produtoId: embalagens.produtoId,
      valor: sql<number>`sum(${entradaNotaItens.valorTotal})::bigint`,
      unidades: sql<number>`sum(${entradaNotaItens.quantidadeBase})::int`,
    })
    .from(entradaNotaItens)
    .innerJoin(embalagens, eq(embalagens.id, entradaNotaItens.embalagemId))
    .where(and(eq(entradaNotaItens.entradaId, entradaId), isNotNull(entradaNotaItens.quantidadeBase)))
    .groupBy(embalagens.produtoId);
  return new Map(r.filter((x) => x.unidades > 0).map((x) => [x.produtoId, Math.round(Number(x.valor) / x.unidades)]));
}

/** Lote/validade que a nota informa para um produto (sugestão na hora de bipar). */
export async function sugestaoLoteDaNota(db: DB, entradaId: number, produtoId: number) {
  const [r] = await db
    .select({ lote: entradaNotaItens.lote, validade: entradaNotaItens.validade })
    .from(entradaNotaItens)
    .innerJoin(embalagens, eq(embalagens.id, entradaNotaItens.embalagemId))
    .where(and(eq(entradaNotaItens.entradaId, entradaId), eq(embalagens.produtoId, produtoId), isNotNull(entradaNotaItens.validade)))
    .limit(1);
  return r ?? null;
}

/**
 * Finaliza a entrada respeitando a nota: com divergência (falta, sobra, item não vinculado)
 * só finaliza com confirmação explícita, que fica registrada na auditoria.
 */
export async function finalizarEntradaConferida(
  db: DB,
  entradaId: number,
  usuarioId: number,
  opcoes: { confirmarDivergencia?: boolean } = {},
) {
  const comp = await compararComNota(db, entradaId);
  if (comp.temNota && comp.divergencias > 0) {
    if (!opcoes.confirmarDivergencia) {
      throw new ErroNegocio(
        `A conferência tem ${comp.divergencias} divergência(s) com a nota. Revise ou confirme para finalizar mesmo assim.`,
      );
    }
    await auditar(db, usuarioId, "finalizar_entrada_com_divergencia", "entrada", entradaId, {
      divergencias: comp.linhas.filter((l) => l.situacao !== "ok"),
      itensNaoVinculados: comp.pendentes.map((p) => p.descricao),
    });
  }
  const custosPadrao = comp.temNota ? await custosDaNota(db, entradaId) : undefined;
  return finalizarEntrada(db, entradaId, usuarioId, { custosPadrao });
}
