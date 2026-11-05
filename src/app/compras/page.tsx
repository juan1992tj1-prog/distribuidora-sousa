import Link from "next/link";
import { db } from "@/db";
import { sugestaoDeCompra, type LinhaCompra } from "@/lib/compras";
import { dataBr, hojeIso, reais } from "@/lib/formato";
import { exigir, pode } from "@/lib/sessao";
import { CopiarPedido } from "./CopiarPedido";

export const dynamic = "force-dynamic";

const EMB: Record<string, string> = { UN: "un.", PACK: "pack", FARDO: "fardo", CX: "cx" };
const PERIODOS = [7, 15, 30, 60, 90];
const COBERTURAS = [7, 10, 15, 20, 30];

function opcao(valor: string | undefined, permitidos: number[], padrao: number) {
  const n = Number(valor);
  return permitidos.includes(n) ? n : padrao;
}

function qtdCompra(l: LinhaCompra) {
  if (l.fatorCompra === 1) return `${l.unidades} un.`;
  return `${l.embalagens} ${EMB[l.embalagemTipo] ?? l.embalagemTipo} c/ ${l.fatorCompra}`;
}

export default async function Compras({ searchParams }: { searchParams: Promise<{ dias?: string; cobertura?: string; ver?: string }> }) {
  const sessao = await exigir("dar_entrada");
  const busca = await searchParams;
  const verCusto = pode(sessao, "ver_custo");
  const dias = opcao(busca.dias, PERIODOS, 30);
  const cobertura = opcao(busca.cobertura, COBERTURAS, 15);
  const todos = busca.ver === "todos";

  const linhas = await sugestaoDeCompra(db, { diasPeriodo: dias, diasCobertura: cobertura });
  const visiveis = todos ? linhas : linhas.filter((l) => l.embalagens > 0);

  // agrupa por último fornecedor (quem não tem compra registrada vai para "Sem fornecedor")
  const grupos = new Map<string, LinhaCompra[]>();
  for (const l of visiveis) {
    const chave = l.fornecedor ?? "Sem fornecedor registrado";
    grupos.set(chave, [...(grupos.get(chave) ?? []), l]);
  }
  const totalGeral = visiveis.reduce((s, l) => s + l.unidades * l.custoUnitario, 0);
  const url = (mudar: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ dias: String(dias), cobertura: String(cobertura), ...(todos ? { ver: "todos" } : {}) });
    for (const [k, v] of Object.entries(mudar)) (v == null ? p.delete(k) : p.set(k, v));
    return `/compras?${p}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="mb-1">Sugestão de compra</h1>
        <p className="text-tinta-suave">
          Calculada pelo que vendeu nos últimos <b>{dias} dias</b>, para o estoque durar <b>{cobertura} dias</b> além do mínimo cadastrado.
          Arredonda para a maior embalagem do produto.
        </p>
      </div>

      <form className="card flex flex-wrap items-end gap-4">
        <div>
          <label>Olhar vendas dos últimos</label>
          <select name="dias" defaultValue={dias} className="campo w-36">
            {PERIODOS.map((d) => <option key={d} value={d}>{d} dias</option>)}
          </select>
        </div>
        <div>
          <label>Estoque para durar</label>
          <select name="cobertura" defaultValue={cobertura} className="campo w-36">
            {COBERTURAS.map((d) => <option key={d} value={d}>{d} dias</option>)}
          </select>
        </div>
        {todos && <input type="hidden" name="ver" value="todos" />}
        <button className="btn-primario">Recalcular</button>
        <div className="ml-auto flex gap-2">
          <Link href={url({ ver: undefined })} className={todos ? "btn-neutro" : "btn-primario"}>Só o que comprar</Link>
          <Link href={url({ ver: "todos" })} className={todos ? "btn-primario" : "btn-neutro"}>Todos os produtos</Link>
        </div>
      </form>

      {visiveis.length === 0 ? (
        <div className="card py-10 text-center text-tinta-suave">Nada para comprar agora: o estoque cobre o período escolhido.</div>
      ) : (
        <>
          {verCusto && !todos && (
            <p className="text-right text-tinta-suave">
              Total estimado do pedido: <b className="text-tinta">{reais(totalGeral)}</b>
            </p>
          )}
          {[...grupos].map(([fornecedor, itens]) => {
            const comprar = itens.filter((l) => l.embalagens > 0);
            const texto = [
              `Pedido Distribuidora Sousa (${dataBr(hojeIso())})`,
              ...comprar.map((l) => `- ${qtdCompra(l)} ${l.descricao}`),
            ].join("\n");
            return (
              <section key={fornecedor} className="card overflow-x-auto">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="mb-0">{fornecedor}</h2>
                  <div className="flex items-center gap-3">
                    {verCusto && comprar.length > 0 && (
                      <span className="text-sm text-tinta-suave">
                        estimado {reais(comprar.reduce((s, l) => s + l.unidades * l.custoUnitario, 0))}
                      </span>
                    )}
                    {comprar.length > 0 && <CopiarPedido texto={texto} />}
                  </div>
                </div>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th className="text-right">Vendeu</th>
                      <th className="text-right">Média/dia</th>
                      <th className="text-right">Estoque</th>
                      <th className="text-right" title="Quantos dias o estoque atual dura no ritmo de venda">Dura</th>
                      <th className="text-right">Mínimo</th>
                      <th className="text-right">Comprar</th>
                      {verCusto && <th className="text-right">Custo est.</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((l) => {
                      const critico = l.coberturaDias != null && l.coberturaDias < 3;
                      return (
                        <tr key={l.produtoId} className={l.embalagens > 0 ? "" : "text-tinta-suave"}>
                          <td><Link href={`/estoque/${l.produtoId}`}>{l.descricao}</Link></td>
                          <td className="text-right">{l.vendido} un.</td>
                          <td className="text-right">{l.mediaDiaria.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</td>
                          <td className="text-right">{l.estoque} un.</td>
                          <td className={`whitespace-nowrap text-right ${critico ? "font-bold text-red-700" : ""}`}>
                            {l.coberturaDias == null ? "—" : l.coberturaDias >= 999 ? "999+ d" : `${Math.floor(l.coberturaDias)} d`}
                          </td>
                          <td className="text-right">{l.estoqueMinimo || "—"}</td>
                          <td className="whitespace-nowrap text-right font-semibold">
                            {l.embalagens > 0 ? (
                              <>
                                {qtdCompra(l)}
                                {l.fatorCompra > 1 && <div className="text-xs font-normal text-tinta-suave">{l.unidades} un.</div>}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          {verCusto && <td className="text-right">{l.embalagens > 0 ? reais(l.unidades * l.custoUnitario) : "—"}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            );
          })}
          <p className="text-sm text-tinta-suave">
            Atenção: se o produto ficou em falta no período, as vendas aparecem menores do que a procura real.
            Para perecíveis, confira se o volume sugerido vende antes de vencer.
          </p>
        </>
      )}
    </div>
  );
}
