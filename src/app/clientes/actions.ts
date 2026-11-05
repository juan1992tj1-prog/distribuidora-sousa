"use server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { clientes } from "@/db/schema";
import { auditar, receberFiado } from "@/lib/estoque";
import { comAviso, ErroNegocio, tentar } from "@/lib/erros";
import { paraCentavos } from "@/lib/formato";
import { exigir, pode } from "@/lib/sessao";

export async function salvarCliente(formData: FormData) {
  const erro = await tentar(async () => {
    const s = await exigir("gerenciar_clientes");
    const id = Number(formData.get("id")) || null;
    const nome = String(formData.get("nome") ?? "").trim();
    if (!nome) throw new ErroNegocio("Informe o nome.");
    const valores: Partial<typeof clientes.$inferInsert> = {
      nome,
      telefone: String(formData.get("telefone") ?? "").trim() || null,
      cpfCnpj: String(formData.get("cpfCnpj") ?? "").replace(/\D/g, "") || null,
    };
    // limite de fiado só gerente/dono define
    const limite = paraCentavos(String(formData.get("limite") ?? ""));
    if (limite != null && pode(s, "dar_desconto")) valores.limiteFiado = limite;
    if (id) {
      await db.update(clientes).set(valores).where(eq(clientes.id, id));
      if (valores.limiteFiado != null) await auditar(db, s.uid, "alterar_limite_fiado", "cliente", id, { limite: valores.limiteFiado });
    } else await db.insert(clientes).values(valores as typeof clientes.$inferInsert);
  });
  redirect(comAviso("/clientes", erro, "Cliente salvo."));
}

export async function receber(formData: FormData) {
  const erro = await tentar(async () => {
    const s = await exigir("gerenciar_clientes");
    const valor = paraCentavos(String(formData.get("valor") ?? ""));
    const forma = String(formData.get("forma")) as "dinheiro" | "pix" | "cartao_debito" | "cartao_credito";
    if (!valor) throw new ErroNegocio("Informe o valor recebido.");
    await receberFiado(db, Number(formData.get("clienteId")), valor, forma, s.uid);
  });
  redirect(comAviso("/clientes", erro, "Pagamento de fiado registrado."));
}
