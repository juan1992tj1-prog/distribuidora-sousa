"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { entradaItens, entradas } from "@/db/schema";
import { adicionarItemEntrada, buscarPorCodigo } from "@/lib/estoque";
import { finalizarEntradaConferida, importarNfe, importarNotaLidaPorIa, sugestaoLoteDaNota, vincularItemNota } from "@/lib/nfe";
import { extrairNota, MODELO_PADRAO, type Documento } from "@/lib/ia-nota";
import { comAviso, ErroNegocio, resultado, tentar } from "@/lib/erros";
import { lerCodigo, variacoesGtin } from "@/lib/gs1";
import { exigir, pode } from "@/lib/sessao";

export async function criarEntrada(formData: FormData) {
  const s = await exigir("dar_entrada");
  const fornecedorId = Number(formData.get("fornecedorId")) || null;
  const [e] = await db
    .insert(entradas)
    .values({
      usuarioId: s.uid,
      fornecedorId,
      numeroNota: String(formData.get("numeroNota") ?? "").trim() || null,
      observacao: String(formData.get("observacao") ?? "").trim() || null,
    })
    .returning({ id: entradas.id });
  redirect(`/entrada/${e.id}`);
}

/** Interpreta o código bipado na conferência: produto + lote/validade se o código trouxer. */
export async function identificar(codigo: string, entradaId: number) {
  return resultado(async () => {
    await exigir("dar_entrada");
    const leitura = lerCodigo(codigo);
    if (!leitura.gtin) throw new ErroNegocio("Código não reconhecido como código de barras de produto.");
    const item = await buscarPorCodigo(db, variacoesGtin(leitura.gtin));
    // se o código não trouxe lote/validade, sugere os que vieram na NF-e (não revela quantidades)
    const sugestao = item && !leitura.validade ? await sugestaoLoteDaNota(db, entradaId, item.produtoId) : null;
    return { leitura, item, sugestao };
  });
}

export async function importarXml(formData: FormData) {
  const entradaId = Number(formData.get("entradaId"));
  let msg = "";
  const erro = await tentar(async () => {
    const s = await exigir("ver_custo");
    const arquivo = formData.get("xml");
    if (!(arquivo instanceof File) || arquivo.size === 0) throw new ErroNegocio("Escolha o arquivo XML da nota.");
    if (arquivo.size > 5_000_000) throw new ErroNegocio("Arquivo grande demais para um XML de NF-e.");
    const r = await importarNfe(db, entradaId, await arquivo.text(), s.uid);
    const faltam = r.itens - r.vinculados;
    msg = `NF-e ${r.numero} importada: ${r.itens} item(ns)` + (faltam ? `, ${faltam} precisa(m) ser vinculado(s) ao cadastro.` : ", todos reconhecidos.");
  });
  redirect(comAviso(`/entrada/${entradaId}`, erro, msg));
}

const TIPOS_IMAGEM = ["image/jpeg", "image/png", "image/webp"] as const;

/** Nota sem XML: PDF ou foto do DANFE, ou pedido colado como texto, lidos por IA. */
export async function importarComIa(formData: FormData) {
  const entradaId = Number(formData.get("entradaId"));
  let msg = "";
  const erro = await tentar(async () => {
    const s = await exigir("ver_custo");
    const arquivo = formData.get("arquivo");
    const texto = String(formData.get("texto") ?? "").trim();
    let doc: Documento;
    if (arquivo instanceof File && arquivo.size > 0) {
      if (arquivo.size > 8_000_000) throw new ErroNegocio("Arquivo grande demais (máximo 8 MB).");
      const base64 = Buffer.from(await arquivo.arrayBuffer()).toString("base64");
      if (arquivo.type === "application/pdf") doc = { tipo: "pdf", base64 };
      else if ((TIPOS_IMAGEM as readonly string[]).includes(arquivo.type))
        doc = { tipo: "imagem", base64, mime: arquivo.type as (typeof TIPOS_IMAGEM)[number] };
      else throw new ErroNegocio("Envie um PDF ou uma foto (JPG, PNG ou WEBP) da nota.");
    } else if (texto) {
      doc = { tipo: "texto", texto: texto.slice(0, 30_000) };
    } else {
      throw new ErroNegocio("Envie o PDF/foto da nota ou cole o texto do pedido.");
    }
    const nota = await extrairNota(doc);
    const r = await importarNotaLidaPorIa(db, entradaId, nota, s.uid, MODELO_PADRAO);
    const faltam = r.itens - r.vinculados;
    msg =
      `Nota lida pela IA: ${r.itens} item(ns)` +
      (faltam ? `, ${faltam} precisa(m) ser vinculado(s) ao cadastro.` : ", todos reconhecidos.") +
      " Confira a leitura: divergências aparecem na conferência." +
      (r.observacoes.length ? ` Atenção: ${r.observacoes.slice(0, 3).join(" ")}` : "");
  });
  redirect(comAviso(`/entrada/${entradaId}`, erro, msg));
}

export async function vincular(formData: FormData) {
  const entradaId = Number(formData.get("entradaId"));
  const erro = await tentar(async () => {
    const s = await exigir("ver_custo");
    const embalagemId = Number(formData.get("embalagemId"));
    if (!embalagemId) throw new ErroNegocio("Escolha o produto do cadastro.");
    const mult = Number(String(formData.get("multiplicador") ?? "1").replace(",", "."));
    await vincularItemNota(db, Number(formData.get("notaItemId")), embalagemId, mult, s.uid);
  });
  redirect(comAviso(`/entrada/${entradaId}`, erro, "Item vinculado. Nas próximas notas deste fornecedor ele será reconhecido sozinho."));
}

export async function adicionarItem(
  entradaId: number,
  dados: { embalagemId: number; quantidadeEmbalagens: number; loteNumero: string; validade: string | null; custoEmbalagem: number | null },
) {
  return resultado(async () => {
    const s = await exigir("dar_entrada");
    const custo = pode(s, "ver_custo") ? dados.custoEmbalagem : null;
    await adicionarItemEntrada(db, entradaId, { ...dados, custoEmbalagem: custo });
    revalidatePath(`/entrada/${entradaId}`);
  });
}

export async function removerItem(formData: FormData) {
  const entradaId = Number(formData.get("entradaId"));
  const erro = await tentar(async () => {
    await exigir("dar_entrada");
    const [e] = await db.select().from(entradas).where(eq(entradas.id, entradaId));
    if (e?.status !== "aberta") throw new ErroNegocio("Entrada já finalizada.");
    await db
      .delete(entradaItens)
      .where(and(eq(entradaItens.id, Number(formData.get("itemId"))), eq(entradaItens.entradaId, entradaId)));
  });
  redirect(comAviso(`/entrada/${entradaId}`, erro));
}

export async function finalizar(formData: FormData) {
  const entradaId = Number(formData.get("entradaId"));
  let itens = 0;
  const erro = await tentar(async () => {
    const s = await exigir("dar_entrada");
    itens = (
      await finalizarEntradaConferida(db, entradaId, s.uid, {
        // só gerente/dono pode aceitar divergência com a nota
        confirmarDivergencia: formData.get("confirmarDivergencia") === "on" && pode(s, "ver_custo"),
      })
    ).itens;
  });
  revalidatePath("/");
  redirect(comAviso(`/entrada/${entradaId}`, erro, `Entrada finalizada: ${itens} item(ns) lançados no estoque.`));
}
