"use server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { categorias, embalagens, produtos } from "@/db/schema";
import { auditar } from "@/lib/estoque";
import { comAviso, ErroNegocio, tentar } from "@/lib/erros";
import { paraCentavos } from "@/lib/formato";
import { gtinValido } from "@/lib/gs1";
import { exigir, pode } from "@/lib/sessao";

const TIPOS = ["UN", "PACK", "FARDO", "CX"] as const;
type Tipo = (typeof TIPOS)[number];

function texto(f: FormData, nome: string) {
  return String(f.get(nome) ?? "").trim();
}

function codigo(f: FormData, nome: string): string | null {
  const c = texto(f, nome).replace(/\D/g, "");
  if (!c) return null;
  if (!gtinValido(c)) throw new ErroNegocio(`Código de barras ${c} inválido (dígito verificador não confere).`);
  return c;
}

async function categoriaId(nome: string): Promise<number | null> {
  if (!nome) return null;
  const [c] = await db.insert(categorias).values({ nome }).onConflictDoNothing().returning({ id: categorias.id });
  if (c) return c.id;
  const [e] = await db.select({ id: categorias.id }).from(categorias).where(eq(categorias.nome, nome));
  return e.id;
}

function dadosProduto(f: FormData) {
  const descricao = texto(f, "descricao");
  if (!descricao) throw new ErroNegocio("Informe a descrição.");
  return {
    descricao,
    marca: texto(f, "marca") || null,
    ncm: texto(f, "ncm").replace(/\D/g, "") || null,
    cest: texto(f, "cest").replace(/\D/g, "") || null,
    perecivel: f.get("perecivel") === "on",
    alcoolico: f.get("alcoolico") === "on",
    estoqueMinimo: Math.max(0, Number(f.get("estoqueMinimo")) || 0),
  };
}

export async function criarProduto(formData: FormData) {
  const voltar = texto(formData, "voltar");
  let id = 0;
  const erro = await tentar(async () => {
    const s = await exigir("cadastrar_produto");
    const podePreco = pode(s, "alterar_preco");
    await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(produtos)
        .values({ ...dadosProduto(formData), categoriaId: await categoriaId(texto(formData, "categoria")) })
        .returning({ id: produtos.id });
      id = p.id;
      await tx.insert(embalagens).values({
        produtoId: p.id,
        tipo: "UN",
        fator: 1,
        codigoBarras: codigo(formData, "codigoUn"),
        precoVenda: podePreco ? paraCentavos(texto(formData, "precoUn")) ?? 0 : 0,
      });
      const fator = Number(formData.get("fatorCx")) || 0;
      if (fator > 1) {
        await tx.insert(embalagens).values({
          produtoId: p.id,
          tipo: (texto(formData, "tipoCx") as Tipo) || "CX",
          fator,
          codigoBarras: codigo(formData, "codigoCx"),
          precoVenda: podePreco ? paraCentavos(texto(formData, "precoCx")) ?? 0 : 0,
        });
      }
    });
  });
  if (erro) redirect(comAviso(`/produtos/novo?voltar=${encodeURIComponent(voltar)}`, erro));
  redirect(voltar ? comAviso(voltar, null, "Produto cadastrado. Bipe de novo para conferir.") : `/produtos/${id}?ok=Produto+cadastrado`);
}

export async function atualizarProduto(formData: FormData) {
  const id = Number(formData.get("id"));
  const erro = await tentar(async () => {
    const s = await exigir("cadastrar_produto");
    await db
      .update(produtos)
      .set({
        ...dadosProduto(formData),
        categoriaId: await categoriaId(texto(formData, "categoria")),
        ativo: formData.get("ativo") === "on",
      })
      .where(eq(produtos.id, id));
    await auditar(db, s.uid, "editar_produto", "produto", id);
  });
  redirect(comAviso(`/produtos/${id}`, erro, "Produto salvo."));
}

export async function salvarEmbalagem(formData: FormData) {
  const produtoId = Number(formData.get("produtoId"));
  const embalagemId = Number(formData.get("embalagemId")) || null;
  const erro = await tentar(async () => {
    const s = await exigir("cadastrar_produto");
    const tipo = texto(formData, "tipo") as Tipo;
    if (!TIPOS.includes(tipo)) throw new ErroNegocio("Tipo de embalagem inválido.");
    const fator = tipo === "UN" ? 1 : Number(formData.get("fator"));
    if (!Number.isInteger(fator) || fator < 1) throw new ErroNegocio("Fator inválido.");
    const valores: Partial<typeof embalagens.$inferInsert> = {
      tipo,
      fator,
      codigoBarras: codigo(formData, "codigoBarras"),
      // embalagem existente: checkbox "ativa" desmarcado = desativar; nova: sempre ativa
      ativo: embalagemId ? formData.get("ativo") === "on" : true,
    };
    const preco = paraCentavos(texto(formData, "precoVenda"));
    if (pode(s, "alterar_preco") && preco != null) valores.precoVenda = preco;

    if (embalagemId) {
      const [antes] = await db.select().from(embalagens).where(eq(embalagens.id, embalagemId));
      if (antes.fator !== fator) {
        // mudar o fator depois de usado bagunçaria o histórico; cria-se outra embalagem
        throw new ErroNegocio("Não é possível mudar o fator de uma embalagem existente. Desative-a e crie outra.");
      }
      await db.update(embalagens).set(valores).where(eq(embalagens.id, embalagemId));
      if (valores.precoVenda != null && valores.precoVenda !== antes.precoVenda) {
        await auditar(db, s.uid, "alterar_preco", "embalagem", embalagemId, { de: antes.precoVenda, para: valores.precoVenda });
      }
    } else {
      await db.insert(embalagens).values({ ...valores, produtoId } as typeof embalagens.$inferInsert);
    }
  });
  redirect(comAviso(`/produtos/${produtoId}`, erro, "Embalagem salva."));
}
