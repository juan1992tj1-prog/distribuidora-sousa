import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { entradaItens, entradas, fornecedores, usuarios } from "@/db/schema";
import { dataHoraBr } from "@/lib/formato";
import { exigir } from "@/lib/sessao";
import { criarEntrada } from "./actions";

export const dynamic = "force-dynamic";

export default async function Entradas() {
  await exigir("dar_entrada");
  const [lista, forn] = await Promise.all([
    db
      .select({
        id: entradas.id,
        numeroNota: entradas.numeroNota,
        status: entradas.status,
        criadoEm: entradas.criadoEm,
        fornecedor: fornecedores.nome,
        usuario: usuarios.nome,
        itens: sql<number>`(select count(*)::int from ${entradaItens} where ${entradaItens.entradaId} = ${entradas.id})`,
      })
      .from(entradas)
      .leftJoin(fornecedores, eq(fornecedores.id, entradas.fornecedorId))
      .innerJoin(usuarios, eq(usuarios.id, entradas.usuarioId))
      .orderBy(desc(entradas.criadoEm))
      .limit(50),
    db.select().from(fornecedores).orderBy(asc(fornecedores.nome)),
  ]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <section>
        <h1>Entrada de mercadorias</h1>
        <div className="card overflow-x-auto">
          <table className="tabela">
            <thead><tr><th>Nº</th><th>Data</th><th>Fornecedor</th><th>Nota</th><th>Itens</th><th>Status</th></tr></thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id}>
                  <td><Link className="text-garrafa-800 hover:underline" href={`/entrada/${e.id}`}>{e.id}</Link></td>
                  <td>{dataHoraBr(e.criadoEm)}</td>
                  <td>{e.fornecedor ?? "—"}</td>
                  <td>{e.numeroNota ?? "—"}</td>
                  <td>{e.itens}</td>
                  <td>
                    <span className={`etiqueta ${e.status === "aberta" ? "bg-ambar-100 text-ambar-600" : "bg-garrafa-100 text-garrafa-900"}`}>{e.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <aside>
        <form action={criarEntrada} className="card space-y-3">
          <h2>Nova entrada</h2>
          <div>
            <label>Fornecedor</label>
            <select name="fornecedorId" className="campo">
              <option value="">(não informado)</option>
              {forn.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div>
            <label>Nº da nota</label>
            <input name="numeroNota" className="campo" />
          </div>
          <div>
            <label>Observação</label>
            <input name="observacao" className="campo" />
          </div>
          <button className="btn-primario w-full">Começar conferência</button>
        </form>
      </aside>
    </div>
  );
}
