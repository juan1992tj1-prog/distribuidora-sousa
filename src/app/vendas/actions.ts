"use server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { cancelarVenda } from "@/lib/estoque";
import { comAviso, tentar } from "@/lib/erros";
import { exigir } from "@/lib/sessao";

export async function cancelar(formData: FormData) {
  const erro = await tentar(async () => {
    const s = await exigir("cancelar_venda");
    await cancelarVenda(db, Number(formData.get("vendaId")), s.uid, String(formData.get("motivo") ?? ""));
  });
  redirect(comAviso("/vendas", erro, "Venda cancelada e estoque devolvido."));
}
