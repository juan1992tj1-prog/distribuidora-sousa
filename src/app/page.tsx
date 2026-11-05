import Link from "next/link";
import { db } from "@/db";
import { exigir, pode } from "@/lib/sessao";
import { alertasAbertos, curvaAbc, posicaoEstoque, vendasDoDia } from "@/lib/consultas";
import { caixaAbertoDe } from "@/lib/caixa";
import { dataBr, FUSO, reais } from "@/lib/formato";
import { Faixa } from "@/components/Faixa";

export const dynamic = "force-dynamic";

function saudacao() {
  const hora = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "numeric", hour12: false }).format(new Date()));
  return hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
}

export default async function Inicio() {
  const sessao = await exigir();
  const verCusto = pode(sessao, "ver_custo");
  const [hoje, estoque, alertas, abc, meuCaixa] = await Promise.all([
    vendasDoDia(db),
    posicaoEstoque(db),
    alertasAbertos(db),
    curvaAbc(db, 30),
    caixaAbertoDe(db, sessao.uid),
  ]);
  const abaixoMinimo = estoque.filter((p) => p.ativo && p.estoqueMinimo > 0 && p.total - p.vencido < p.estoqueMinimo);
  const valorRisco = alertas.reduce((s, a) => s + Number(a.valorRisco), 0);
  const valorEstoque = estoque.reduce((s, p) => s + p.total * p.custoMedio, 0);
  const dataHoje = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-tinta-suave first-letter:uppercase">{dataHoje}</p>
          <h1 className="mb-0">
            {saudacao()}, {sessao.nome.split(" ")[0]}
          </h1>
        </div>
        {pode(sessao, "vender") &&
          (meuCaixa ? (
            <Link href="/venda" className="btn-sucesso px-5 py-2.5">
              Vender
            </Link>
          ) : (
            <Link href="/caixa?depois=venda" className="btn-sucesso px-5 py-2.5">
              Abrir o caixa
            </Link>
          ))}
      </div>

      <section className="grid overflow-hidden rounded-xl border border-linha bg-white sm:grid-cols-2 lg:grid-cols-4">
        <Indicador href="/vendas" titulo="Vendido hoje" valor={reais(hoje.total)} detalhe={`${hoje.quantidade} venda(s)`} destaque />
        <Indicador
          href="/estoque?filtro=minimo"
          titulo="Para repor"
          valor={String(abaixoMinimo.length)}
          detalhe={abaixoMinimo.length ? "produtos abaixo do mínimo" : "nenhum abaixo do mínimo"}
          alerta={abaixoMinimo.length > 0}
        />
        <Indicador
          href="/validade"
          titulo="Validade próxima"
          valor={String(alertas.length)}
          detalhe={alertas.length === 0 ? "nenhum lote em alerta" : verCusto ? `${reais(valorRisco)} em risco` : "lotes pedindo ação"}
          alerta={alertas.length > 0}
        />
        {verCusto ? (
          <Indicador href="/estoque" titulo="Estoque a preço de custo" valor={reais(valorEstoque)} detalhe={`${estoque.filter((p) => p.total > 0).length} produto(s) com saldo`} />
        ) : (
          <Indicador href="/estoque" titulo="Produtos com saldo" valor={String(estoque.filter((p) => p.total > 0).length)} detalhe="ver estoque" />
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="card lg:col-span-3">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="mb-0">Vencendo primeiro</h2>
            <Link href="/validade" className="text-sm font-semibold text-garrafa-800 hover:underline">
              Ver todos
            </Link>
          </div>
          {alertas.length === 0 ? (
            <p className="py-6 text-tinta-suave">Nenhum lote perto do vencimento.</p>
          ) : (
            <table className="tabela">
              <thead>
                <tr><th>Produto</th><th>Lote</th><th>Validade</th><th className="text-right">Qtd.</th><th /></tr>
              </thead>
              <tbody>
                {alertas.slice(0, 7).map((a) => (
                  <tr key={a.id}>
                    <td><Link href={`/estoque/${a.produtoId}`}>{a.produto}</Link></td>
                    <td className="text-tinta-suave">{a.lote || "—"}</td>
                    <td>{dataBr(a.validade)}</td>
                    <td className="text-right">{a.quantidade}</td>
                    <td className="text-right"><Faixa faixa={a.faixa} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card lg:col-span-2">
          <h2>Mais vendidos em 30 dias</h2>
          {abc.length === 0 ? (
            <p className="py-6 text-tinta-suave">As vendas do balcão aparecem aqui.</p>
          ) : (
            <ol className="space-y-3">
              {abc.slice(0, 6).map((r) => {
                const max = abc[0].faturamento || 1;
                return (
                  <li key={r.produto_id}>
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="truncate font-medium">{r.descricao}</span>
                      <span className="shrink-0 text-tinta-suave">{reais(r.faturamento)}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-concreto">
                      <div className="h-2 rounded-full bg-garrafa-700" style={{ width: `${Math.max(4, (r.faturamento / max) * 100)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function Indicador({
  titulo, valor, detalhe, href, alerta, destaque,
}: { titulo: string; valor: string; detalhe: string; href: string; alerta?: boolean; destaque?: boolean }) {
  return (
    <Link
      href={href}
      className={`block border-linha p-5 transition-colors hover:bg-garrafa-50 max-sm:border-b sm:[&:not(:last-child)]:border-r ${
        alerta ? "bg-ambar-100/60 hover:bg-ambar-100" : ""
      }`}
    >
      <div className="text-sm text-tinta-suave">{titulo}</div>
      <div
        className={`mt-1 text-3xl font-bold tracking-tight ${destaque ? "text-garrafa-900" : alerta ? "text-ambar-600" : ""}`}
        style={{ fontFamily: "var(--font-titulo)" }}
      >
        {valor}
      </div>
      <div className="mt-0.5 text-sm text-tinta-suave">{detalhe}</div>
    </Link>
  );
}
