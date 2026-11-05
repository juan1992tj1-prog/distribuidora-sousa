import Link from "next/link";
import { db } from "@/db";
import { Aviso } from "@/components/Aviso";
import { Faixa } from "@/components/Faixa";
import { alertasAbertos } from "@/lib/consultas";
import { dataBr, diasAte, reais } from "@/lib/formato";
import { exigir, pode } from "@/lib/sessao";
import { FAIXAS } from "@/lib/validade";
import { recalcular, tratar } from "./actions";

export const dynamic = "force-dynamic";

const ACAO: Record<string, string> = { promocao: "Em promoção", troca_fornecedor: "Troca c/ fornecedor", descarte: "Descartado", vendido: "Vendido" };

export default async function Validade({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sessao = await exigir();
  const busca = await searchParams;
  const alertas = await alertasAbertos(db);
  const verCusto = pode(sessao, "ver_custo");
  const podeTratar = pode(sessao, "tratar_validade");
  const grupos = ["vencido", ...FAIXAS.map(String)].map((f) => ({ faixa: f, itens: alertas.filter((a) => a.faixa === f) }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mb-0">Controle de validade</h1>
        {podeTratar && (
          <form action={recalcular} className="ml-auto">
            <button className="btn-neutro">Recalcular agora</button>
          </form>
        )}
      </div>
      <p className="text-tinta-suave">
        Os alertas são recalculados automaticamente todo dia de madrugada. Faixas: {FAIXAS.join(", ")} dias.
        {verCusto && <> Valor em risco (custo): <b>{reais(alertas.reduce((s, a) => s + Number(a.valorRisco), 0))}</b>.</>}
      </p>
      <Aviso busca={busca} />
      {alertas.length === 0 && <div className="card text-tinta-suave">Nenhum lote perto do vencimento. 👍</div>}

      {grupos.filter((g) => g.itens.length > 0).map((g) => (
        <section key={g.faixa} className="card overflow-x-auto">
          <h2 className="flex items-center gap-2"><Faixa faixa={g.faixa} /> {g.itens.length} lote(s)</h2>
          <table className="tabela">
            <thead><tr><th>Produto</th><th>Lote</th><th>Validade</th><th>Qtd.</th>{verCusto && <th>Valor</th>}<th>Situação</th>{podeTratar && <th>Ação</th>}</tr></thead>
            <tbody>
              {g.itens.map((a) => {
                const dias = a.validade ? diasAte(a.validade) : 0;
                return (
                  <tr key={a.id}>
                    <td><Link className="text-garrafa-800 hover:underline" href={`/estoque/${a.produtoId}`}>{a.produto}</Link></td>
                    <td>{a.lote || "—"}</td>
                    <td>{dataBr(a.validade)}<div className="text-xs text-tinta-suave">{dias < 0 ? `venceu há ${-dias} dia(s)` : `faltam ${dias} dia(s)`}</div></td>
                    <td>{a.quantidade} un.</td>
                    {verCusto && <td>{reais(Number(a.valorRisco))}</td>}
                    <td>{a.acao ? ACAO[a.acao] : <span className="text-ambar-600">aguardando ação</span>}{a.observacao && <div className="text-xs text-tinta-suave">{a.observacao}</div>}</td>
                    {podeTratar && (
                      <td>
                        <form action={tratar} className="flex flex-wrap gap-1">
                          <input type="hidden" name="alertaId" value={a.id} />
                          <input name="observacao" placeholder="obs." className="campo mt-0 w-28 py-1 text-sm" />
                          {g.faixa !== "vencido" && <button name="acao" value="promocao" className="btn-neutro px-2 py-1 text-sm">Promoção</button>}
                          <button name="acao" value="troca_fornecedor" className="btn-neutro px-2 py-1 text-sm">Troca</button>
                          <button name="acao" value="descarte" className="btn-perigo px-2 py-1 text-sm">Descartar</button>
                        </form>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
