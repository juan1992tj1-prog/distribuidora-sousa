import Link from "next/link";
import { db } from "@/db";
import { posicaoEstoque } from "@/lib/consultas";
import { dataBr, reais } from "@/lib/formato";
import { exigir, pode } from "@/lib/sessao";

export const dynamic = "force-dynamic";

export default async function Estoque({ searchParams }: { searchParams: Promise<{ filtro?: string; q?: string }> }) {
  const sessao = await exigir();
  const { filtro, q } = await searchParams;
  const verCusto = pode(sessao, "ver_custo");
  let lista = (await posicaoEstoque(db)).filter((p) => p.ativo);
  if (filtro === "minimo") lista = lista.filter((p) => p.estoqueMinimo > 0 && p.total - p.vencido < p.estoqueMinimo);
  if (q) lista = lista.filter((p) => p.descricao.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mb-0">Estoque</h1>
        <form className="ml-auto flex gap-2">
          <input name="q" defaultValue={q} placeholder="Buscar produto" className="campo mt-0 w-56" />
          <button className="btn-neutro">Buscar</button>
        </form>
        <Link href="/estoque" className={filtro ? "btn-neutro" : "btn-primario"}>Todos</Link>
        <Link href="/estoque?filtro=minimo" className={filtro === "minimo" ? "btn-primario" : "btn-neutro"}>Abaixo do mínimo</Link>
      </div>
      <div className="card overflow-x-auto">
        <table className="tabela">
          <thead>
            <tr><th>Produto</th><th>Disponível</th><th>Vencido</th><th>Mínimo</th><th title="Validade do próximo lote que ainda pode ser vendido">Próx. validade (lotes bons)</th>{verCusto && <th>Valor (custo)</th>}</tr>
          </thead>
          <tbody>
            {lista.map((p) => {
              const disponivel = p.total - p.vencido;
              const baixo = p.estoqueMinimo > 0 && disponivel < p.estoqueMinimo;
              return (
                <tr key={p.produtoId} className={baixo ? "bg-ambar-100/50" : ""}>
                  <td><Link href={`/estoque/${p.produtoId}`} className="font-medium text-garrafa-800 hover:underline">{p.descricao}</Link></td>
                  <td className={baixo ? "font-bold text-ambar-600" : ""}>{disponivel} un.</td>
                  <td>
                    {p.vencido ? (
                      <Link href={`/estoque/${p.produtoId}`} className="font-bold text-red-700 hover:underline" title="Clique para ver o lote e dar baixa">
                        {p.vencido} un. <span className="font-normal">(venceu {dataBr(p.vencidoDesde).slice(0, 5)})</span>
                      </Link>
                    ) : (
                      <span className="text-tinta-suave/60">—</span>
                    )}
                  </td>
                  <td>{p.estoqueMinimo || "—"}</td>
                  <td>{dataBr(p.proximaValidade)}</td>
                  {verCusto && <td>{reais(p.total * p.custoMedio)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
