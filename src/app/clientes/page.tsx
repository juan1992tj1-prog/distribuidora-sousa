import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { clientes, fiadoLancamentos } from "@/db/schema";
import { Aviso } from "@/components/Aviso";
import { reais } from "@/lib/formato";
import { exigir, pode } from "@/lib/sessao";
import { receber, salvarCliente } from "./actions";

export const dynamic = "force-dynamic";

export default async function Clientes({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sessao = await exigir("gerenciar_clientes");
  const busca = await searchParams;
  const podeLimite = pode(sessao, "dar_desconto");
  const lista = await db
    .select({
      c: clientes,
      devendo: sql<number>`coalesce((select sum(case when ${fiadoLancamentos.tipo}='debito' then ${fiadoLancamentos.valor} else -${fiadoLancamentos.valor} end) from ${fiadoLancamentos} where ${fiadoLancamentos.clienteId} = ${clientes.id}), 0)::int`,
    })
    .from(clientes)
    .orderBy(asc(clientes.nome));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <section>
        <h1>Clientes e fiado</h1>
        <Aviso busca={busca} />
        <div className="card overflow-x-auto">
          <table className="tabela">
            <thead><tr><th>Cliente</th><th>Telefone</th><th>Limite</th><th>Devendo</th><th>Receber</th></tr></thead>
            <tbody>
              {lista.map(({ c, devendo }) => (
                <tr key={c.id}>
                  <td>{c.nome}</td>
                  <td>{c.telefone ?? "—"}</td>
                  <td>{reais(c.limiteFiado)}</td>
                  <td className={devendo > 0 ? "font-bold text-red-700" : ""}>{reais(devendo)}</td>
                  <td>
                    {devendo > 0 && (
                      <form action={receber} className="flex gap-1">
                        <input type="hidden" name="clienteId" value={c.id} />
                        <input name="valor" placeholder="R$" className="campo mt-0 w-20 py-1" required />
                        <select name="forma" className="campo mt-0 w-24 py-1">
                          <option value="dinheiro">Dinheiro</option><option value="pix">Pix</option><option value="cartao_debito">Débito</option><option value="cartao_credito">Crédito</option>
                        </select>
                        <button className="btn-sucesso px-2 py-1">OK</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <aside>
        <form action={salvarCliente} className="card space-y-3">
          <h2>Novo cliente</h2>
          <div><label>Nome *</label><input name="nome" className="campo" required /></div>
          <div><label>Telefone</label><input name="telefone" className="campo" /></div>
          <div><label>CPF/CNPJ</label><input name="cpfCnpj" className="campo" /></div>
          {podeLimite && <div><label>Limite de fiado (R$)</label><input name="limite" className="campo" placeholder="0,00" /></div>}
          <button className="btn-primario w-full">Salvar</button>
        </form>
      </aside>
    </div>
  );
}
