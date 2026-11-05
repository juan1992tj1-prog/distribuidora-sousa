"use server";
import { and, eq, ilike, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { embalagens, produtos } from "@/db/schema";
import { buscarPorCodigo, registrarVenda, saldoVendavel, type VendaInput } from "@/lib/estoque";
import { ErroNegocio, resultado } from "@/lib/erros";
import { lerCodigo, variacoesGtin } from "@/lib/gs1";
import { exigir, pode } from "@/lib/sessao";

export type ItemCatalogo = {
  embalagemId: number;
  produtoId: number;
  descricao: string;
  tipo: string;
  fator: number;
  precoVenda: number;
  alcoolico: boolean;
  saldo: number;
};

/** Bipou: devolve o produto/embalagem correspondente ao código. */
export async function buscarItem(codigoOuTexto: string) {
  return resultado(async (): Promise<ItemCatalogo[]> => {
    await exigir("vender");
    const leitura = lerCodigo(codigoOuTexto);
    if (leitura.gtin) {
      const r = await buscarPorCodigo(db, variacoesGtin(leitura.gtin));
      if (!r) return [];
      return [{ ...r, saldo: await saldoVendavel(db, r.produtoId) }];
    }
    // busca por nome (digitado)
    const termo = `%${codigoOuTexto.trim()}%`;
    const achados = await db
      .select({
        embalagemId: embalagens.id,
        produtoId: produtos.id,
        descricao: produtos.descricao,
        tipo: embalagens.tipo,
        fator: embalagens.fator,
        precoVenda: embalagens.precoVenda,
        alcoolico: produtos.alcoolico,
      })
      .from(embalagens)
      .innerJoin(produtos, eq(produtos.id, embalagens.produtoId))
      .where(
        and(
          eq(embalagens.ativo, true),
          eq(produtos.ativo, true),
          or(ilike(produtos.descricao, termo), ilike(produtos.marca, termo)),
        ),
      )
      .orderBy(produtos.descricao, embalagens.fator)
      .limit(15);
    return Promise.all(achados.map(async (a) => ({ ...a, saldo: await saldoVendavel(db, a.produtoId) })));
  });
}

export async function finalizarVenda(dados: Omit<VendaInput, "usuarioId" | "hoje">) {
  return resultado(async () => {
    const sessao = await exigir("vender");
    if ((dados.desconto ?? 0) > 0 && !pode(sessao, "dar_desconto")) {
      throw new ErroNegocio("Desconto só pode ser dado por gerente ou dono.");
    }
    const r = await registrarVenda(db, { ...dados, usuarioId: sessao.uid });
    revalidatePath("/");
    return r;
  });
}
