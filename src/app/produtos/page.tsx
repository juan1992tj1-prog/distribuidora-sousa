import Link from "next/link";
import { db } from "@/db";
import { Aviso } from "@/components/Aviso";
import { posicaoEstoque } from "@/lib/consultas";
import { reais } from "@/lib/formato";
import { exigir, pode } from "@/lib/sessao";

export const dynamic = "force-dynamic";

export default async function Produtos({ searchParams }: { searchParams: Promise<{ q?: string; ok?: string; erro?: string }> }) {
  const sessao = await exigir();
  const busca = await searchParams;
  const q = (busca.q ?? "").toLowerCase();
  const [estoque, embs] = await Promise.all([
    posicaoEstoque(db),
    db.query.embalagens.findMany({ orderBy: (e, { asc }) => [asc(e.fator)] }),
  ]);
  const lista = estoque.filter((p) => !q || p.descricao.toLowerCase().includes(q) || (p.marca ?? "").toLowerCase().includes(q) || embs.some((e) => e.produtoId === p.produtoId && e.codigoBarras?.includes(q)));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mb-0">Produtos</h1>
        <form className="ml-auto flex gap-2">
          <input name="q" defaultValue={busca.q} placeholder="Buscar nome, marca ou código" className="campo mt-0 w-64" />
          <button className="btn-neutro">Buscar</button>
        </form>
        {pode(sessao, "cadastrar_produto") && <Link href="/produtos/novo" className="btn-primario">+ Novo produto</Link>}
      </div>
      <Aviso busca={busca} />
      <div className="card overflow-x-auto">
        <table className="tabela">
          <thead><tr><th>Produto</th><th>Categoria</th><th>Embalagens (código · preço)</th><th>Saldo</th></tr></thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.produtoId} className={p.ativo ? "" : "opacity-50"}>
                <td><Link href={`/produtos/${p.produtoId}`} className="font-medium text-garrafa-800 hover:underline">{p.descricao}</Link>{p.marca && <div className="text-xs text-tinta-suave">{p.marca}</div>}</td>
                <td>{p.categoria ?? "—"}</td>
                <td>
                  {embs.filter((e) => e.produtoId === p.produtoId && e.ativo).map((e) => (
                    <div key={e.id} className="whitespace-nowrap">
                      {e.tipo}{e.fator > 1 ? ` ${e.fator}` : ""} · <span className="font-mono text-xs">{e.codigoBarras ?? "sem código"}</span> · {reais(e.precoVenda)}
                    </div>
                  ))}
                </td>
                <td>{p.total} un.</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
