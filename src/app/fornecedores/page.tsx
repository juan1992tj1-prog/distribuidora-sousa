import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { fornecedores } from "@/db/schema";
import { Aviso } from "@/components/Aviso";
import { comAviso, ErroNegocio, tentar } from "@/lib/erros";
import { exigir } from "@/lib/sessao";

export const dynamic = "force-dynamic";

async function salvar(formData: FormData) {
  "use server";
  const erro = await tentar(async () => {
    await exigir("dar_entrada");
    const nome = String(formData.get("nome") ?? "").trim();
    if (!nome) throw new ErroNegocio("Informe o nome.");
    await db.insert(fornecedores).values({
      nome,
      cnpj: String(formData.get("cnpj") ?? "").replace(/\D/g, "") || null,
      telefone: String(formData.get("telefone") ?? "").trim() || null,
    });
  });
  redirect(comAviso("/fornecedores", erro, "Fornecedor salvo."));
}

export default async function Fornecedores({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  await exigir("dar_entrada");
  const busca = await searchParams;
  const lista = await db.select().from(fornecedores).orderBy(asc(fornecedores.nome));
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <section>
        <h1>Fornecedores</h1>
        <Aviso busca={busca} />
        <div className="card">
          <table className="tabela">
            <thead><tr><th>Nome</th><th>CNPJ</th><th>Telefone</th></tr></thead>
            <tbody>{lista.map((f) => <tr key={f.id}><td>{f.nome}</td><td>{f.cnpj ?? "—"}</td><td>{f.telefone ?? "—"}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <form action={salvar} className="card space-y-3 self-start">
        <h2>Novo fornecedor</h2>
        <div><label>Nome *</label><input name="nome" className="campo" required /></div>
        <div><label>CNPJ</label><input name="cnpj" className="campo" /></div>
        <div><label>Telefone</label><input name="telefone" className="campo" /></div>
        <button className="btn-primario w-full">Salvar</button>
      </form>
    </div>
  );
}
