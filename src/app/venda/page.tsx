import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientes } from "@/db/schema";
import { caixaAbertoDe } from "@/lib/caixa";
import { exigir, pode } from "@/lib/sessao";
import { Pdv } from "./Pdv";

export const dynamic = "force-dynamic";

export default async function Venda() {
  const sessao = await exigir("vender");
  const caixa = await caixaAbertoDe(db, sessao.uid);
  if (!caixa) {
    return (
      <div className="card mx-auto mt-10 max-w-md space-y-4 text-center">
        <h1 className="mb-0">O caixa está fechado</h1>
        <p className="text-tinta-suave">Para vender, abra o caixa informando o troco que está na gaveta.</p>
        <Link href="/caixa?depois=venda" className="btn-sucesso w-full py-3 text-lg">Abrir o caixa</Link>
      </div>
    );
  }
  const listaClientes = await db
    .select({ id: clientes.id, nome: clientes.nome })
    .from(clientes)
    .where(eq(clientes.ativo, true))
    .orderBy(asc(clientes.nome));
  return <Pdv clientes={listaClientes} podeDesconto={pode(sessao, "dar_desconto")} />;
}
