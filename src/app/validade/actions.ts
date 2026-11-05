"use server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { comAviso, ErroNegocio, tentar } from "@/lib/erros";
import { exigir } from "@/lib/sessao";
import { atualizarAlertas, tratarAlerta } from "@/lib/validade";

export async function tratar(formData: FormData) {
  const erro = await tentar(async () => {
    const s = await exigir("tratar_validade");
    const acao = String(formData.get("acao"));
    if (!["promocao", "troca_fornecedor", "descarte"].includes(acao)) throw new ErroNegocio("Ação inválida.");
    await tratarAlerta(db, {
      alertaId: Number(formData.get("alertaId")),
      acao: acao as "promocao" | "troca_fornecedor" | "descarte",
      observacao: String(formData.get("observacao") ?? ""),
      usuarioId: s.uid,
    });
  });
  redirect(comAviso("/validade", erro, "Ação registrada."));
}

export async function recalcular() {
  let n = 0;
  const erro = await tentar(async () => {
    await exigir("tratar_validade");
    n = (await atualizarAlertas(db)).length;
  });
  redirect(comAviso("/validade", erro, `Alertas atualizados (${n} novo(s) ou piorado(s)).`));
}
