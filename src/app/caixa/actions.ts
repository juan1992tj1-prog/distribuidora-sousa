"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { caixas } from "@/db/schema";
import { abrirCaixa, fecharCaixa, movimentarCaixa } from "@/lib/caixa";
import { comAviso, ErroNegocio, tentar } from "@/lib/erros";
import { paraCentavos } from "@/lib/formato";
import { exigir, pode } from "@/lib/sessao";

export async function abrir(formData: FormData) {
  const erro = await tentar(async () => {
    const s = await exigir("vender");
    const valor = paraCentavos(String(formData.get("valor") ?? "")) ?? 0;
    await abrirCaixa(db, s.uid, valor);
  });
  revalidatePath("/");
  const destino = String(formData.get("depois") ?? "") === "venda" && !erro ? "/venda" : "/caixa";
  redirect(comAviso(destino, erro, destino === "/caixa" ? "Caixa aberto. Boas vendas!" : undefined));
}

export async function movimentar(formData: FormData) {
  const tipo = String(formData.get("tipo")) === "suprimento" ? "suprimento" : "sangria";
  const erro = await tentar(async () => {
    const s = await exigir("vender");
    const valor = paraCentavos(String(formData.get("valor") ?? ""));
    if (!valor) throw new ErroNegocio("Informe o valor.");
    await movimentarCaixa(db, { usuarioId: s.uid, tipo, valor, motivo: String(formData.get("motivo") ?? "") });
  });
  redirect(comAviso("/caixa", erro, tipo === "sangria" ? "Sangria registrada." : "Suprimento registrado."));
}

export async function fechar(formData: FormData) {
  const caixaId = Number(formData.get("caixaId"));
  const erro = await tentar(async () => {
    const s = await exigir("vender");
    const [c] = await db.select({ usuarioId: caixas.usuarioId }).from(caixas).where(eq(caixas.id, caixaId));
    if (!c) throw new ErroNegocio("Caixa não encontrado.");
    if (c.usuarioId !== s.uid && !pode(s, "conferir_caixa")) throw new ErroNegocio("Só o gerente pode fechar o caixa de outra pessoa.");
    const contado = paraCentavos(String(formData.get("contado") ?? ""));
    if (contado == null) throw new ErroNegocio("Informe quanto dinheiro tem na gaveta (0 se estiver vazia).");
    await fecharCaixa(db, { caixaId, usuarioId: s.uid, dinheiroContado: contado, observacao: String(formData.get("observacao") ?? "") });
  });
  revalidatePath("/");
  redirect(erro ? comAviso("/caixa", erro) : `/caixa/${caixaId}?ok=${encodeURIComponent("Caixa fechado.")}`);
}
