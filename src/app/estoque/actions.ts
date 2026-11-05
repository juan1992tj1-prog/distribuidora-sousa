"use server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { ajustarInventario, registrarSaidaAvulsa } from "@/lib/estoque";
import { comAviso, ErroNegocio, tentar } from "@/lib/erros";
import { exigir } from "@/lib/sessao";

const TIPOS = ["perda", "vencido", "consumo_interno", "devolucao_fornecedor"] as const;

export async function saidaAvulsa(formData: FormData) {
  const produtoId = Number(formData.get("produtoId"));
  const erro = await tentar(async () => {
    const s = await exigir("baixa_perda");
    const tipo = String(formData.get("tipo")) as (typeof TIPOS)[number];
    if (!TIPOS.includes(tipo)) throw new ErroNegocio("Tipo de saída inválido.");
    await registrarSaidaAvulsa(db, {
      tipo,
      produtoId,
      loteId: Number(formData.get("loteId")) || null,
      quantidadeBase: Number(formData.get("quantidade")),
      motivo: String(formData.get("motivo") ?? ""),
      usuarioId: s.uid,
    });
  });
  redirect(comAviso(`/estoque/${produtoId}`, erro, "Saída registrada."));
}

export async function ajuste(formData: FormData) {
  const produtoId = Number(formData.get("produtoId"));
  let diferenca = 0;
  const erro = await tentar(async () => {
    const s = await exigir("ajustar_inventario");
    const loteId = Number(formData.get("loteId"));
    if (!loteId) throw new ErroNegocio("Escolha o lote contado.");
    const r = await ajustarInventario(db, {
      produtoId,
      loteId,
      quantidadeContada: Number(formData.get("contado")),
      motivo: String(formData.get("motivo") ?? ""),
      usuarioId: s.uid,
    });
    diferenca = r.diferenca;
  });
  redirect(comAviso(`/estoque/${produtoId}`, erro, diferenca === 0 ? "Contagem confere com o sistema." : `Ajuste lançado: ${diferenca > 0 ? "+" : ""}${diferenca} un.`));
}
