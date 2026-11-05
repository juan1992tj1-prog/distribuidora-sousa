import { db } from "@/db";
import { Aviso } from "@/components/Aviso";
import { vendasRecentes } from "@/lib/consultas";
import { dataHoraBr, reais } from "@/lib/formato";
import { exigir, pode } from "@/lib/sessao";
import { cancelar } from "./actions";

export const dynamic = "force-dynamic";

const FORMA: Record<string, string> = { dinheiro: "Dinheiro", pix: "Pix", cartao_debito: "Débito", cartao_credito: "Crédito", fiado: "Fiado" };

export default async function Vendas({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sessao = await exigir("vender");
  const busca = await searchParams;
  const lista = await vendasRecentes(db, 100);
  const podeCancelar = pode(sessao, "cancelar_venda");

  return (
    <div>
      <h1>Últimas vendas</h1>
      <Aviso busca={busca} />
      <div className="card overflow-x-auto">
        <table className="tabela">
          <thead><tr><th>Nº</th><th>Quando</th><th>Itens</th><th>Pagamento</th><th>Total</th><th>Operador</th><th /></tr></thead>
          <tbody>
            {lista.map((v) => (
              <tr key={v.id} className={v.status === "cancelada" ? "text-tinta-suave/60 line-through" : ""}>
                <td>{v.id}</td>
                <td className="whitespace-nowrap">{dataHoraBr(v.criadoEm)}</td>
                <td>
                  {v.itens.map((i) => (
                    <div key={i.id}>{i.quantidade}× {i.produto.descricao}{i.embalagem.fator > 1 ? ` (${i.embalagem.tipo} ${i.embalagem.fator})` : ""}</div>
                  ))}
                  {v.cliente && <div className="text-xs text-tinta-suave">Cliente: {v.cliente.nome}</div>}
                </td>
                <td>{v.pagamentos.map((p) => <div key={p.id}>{FORMA[p.forma]} {reais(p.valor)}</div>)}</td>
                <td className="font-semibold">{reais(v.total)}{v.desconto > 0 && <div className="text-xs text-tinta-suave">desc. {reais(v.desconto)}</div>}</td>
                <td>{v.usuario.nome}</td>
                <td className="no-underline">
                  {v.status === "cancelada" ? (
                    <span className="etiqueta bg-concreto text-tinta-suave no-underline">cancelada</span>
                  ) : podeCancelar ? (
                    <details>
                      <summary className="cursor-pointer text-red-600">cancelar</summary>
                      <form action={cancelar} className="mt-2 flex gap-2">
                        <input type="hidden" name="vendaId" value={v.id} />
                        <input name="motivo" placeholder="Motivo" required className="campo mt-0 w-40" />
                        <button className="btn-perigo px-2 py-1">OK</button>
                      </form>
                    </details>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
