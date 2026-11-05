import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { caixaMovimentos, caixas, usuarios } from "@/db/schema";
import { Aviso } from "@/components/Aviso";
import { resumoCaixa } from "@/lib/caixa";
import { dataHoraBr, reais } from "@/lib/formato";
import { exigir, pode } from "@/lib/sessao";
import { Diferenca } from "../Diferenca";
import { FormFechar } from "../FormFechar";
import { Imprimir } from "./Imprimir";

export const dynamic = "force-dynamic";

const TIPO_MOV: Record<string, string> = { sangria: "Sangria", suprimento: "Suprimento", estorno: "Estorno" };

export default async function RelatorioCaixa({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const sessao = await exigir("vender");
  const { id } = await params;
  const busca = await searchParams;
  const caixaId = Number(id);
  if (!Number.isInteger(caixaId)) notFound();

  const [c] = await db
    .select({ caixa: caixas, operador: usuarios.nome })
    .from(caixas)
    .innerJoin(usuarios, eq(usuarios.id, caixas.usuarioId))
    .where(eq(caixas.id, caixaId));
  if (!c) notFound();
  const gerente = pode(sessao, "conferir_caixa");
  const proprio = c.caixa.usuarioId === sessao.uid;
  if (!proprio && !gerente) redirect("/caixa");
  // o operador não vê o esperado do próprio caixa enquanto está aberto (fechamento cego)
  if (c.caixa.status === "aberto" && proprio && !gerente) redirect("/caixa");

  const [r, movimentos] = await Promise.all([
    resumoCaixa(db, caixaId),
    db.select().from(caixaMovimentos).where(eq(caixaMovimentos.caixaId, caixaId)).orderBy(asc(caixaMovimentos.criadoEm)),
  ]);
  const fechado = c.caixa.status === "fechado";
  const [fechadoPor] = c.caixa.fechadoPor
    ? await db.select({ nome: usuarios.nome }).from(usuarios).where(eq(usuarios.id, c.caixa.fechadoPor))
    : [];
  const esperado = c.caixa.dinheiroEsperado ?? r.dinheiroEsperado;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <Link href="/caixa" className="text-sm font-semibold text-garrafa-800 hover:underline">← Caixa</Link>
        {fechado && <Imprimir />}
      </div>
      <Aviso busca={busca} />

      <div className={`grid gap-6 ${fechado ? "" : "xl:grid-cols-[1fr_400px]"}`}>
        <section className="card space-y-5">
          <div>
            <h1 className="mb-1">Caixa nº {caixaId} — {c.operador}</h1>
            <p className="text-tinta-suave">
              Aberto em {dataHoraBr(c.caixa.abertoEm)}
              {c.caixa.fechadoEm && <> · fechado em {dataHoraBr(c.caixa.fechadoEm)}{fechadoPor && fechadoPor.nome !== c.operador ? ` por ${fechadoPor.nome}` : ""}</>}
            </p>
          </div>

          {fechado && c.caixa.diferenca != null && (
            <div className={`rounded-xl p-4 ${c.caixa.diferenca === 0 ? "bg-garrafa-50" : c.caixa.diferenca > 0 ? "bg-ambar-100" : "bg-red-50"}`}>
              <div className="grid grid-cols-3 gap-4">
                <Valor titulo="Esperado na gaveta" valor={reais(esperado)} />
                <Valor titulo="Contado" valor={reais(c.caixa.dinheiroContado ?? 0)} />
                <div>
                  <div className="text-sm text-tinta-suave">Resultado</div>
                  <div className="mt-1 text-xl"><Diferenca valor={c.caixa.diferenca} /></div>
                </div>
              </div>
              {c.caixa.observacao && <p className="mt-3 text-sm"><b>Observação:</b> {c.caixa.observacao}</p>}
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h2>Vendas por forma de pagamento</h2>
              <table className="tabela">
                <tbody>
                  <Linha rotulo="Dinheiro (já sem o troco)" valor={r.porForma.dinheiro} />
                  <Linha rotulo="Pix" valor={r.porForma.pix} />
                  <Linha rotulo="Cartão de débito" valor={r.porForma.cartao_debito} />
                  <Linha rotulo="Cartão de crédito" valor={r.porForma.cartao_credito} />
                  <Linha rotulo="Fiado" valor={r.porForma.fiado} />
                  <tr className="font-bold"><td>Total ({r.vendasQtd} venda{r.vendasQtd === 1 ? "" : "s"})</td><td className="text-right">{reais(r.vendasTotal)}</td></tr>
                </tbody>
              </table>
              {r.canceladasQtd > 0 && <p className="mt-2 text-sm text-tinta-suave">{r.canceladasQtd} venda(s) cancelada(s) não entram na conta.</p>}
            </div>
            <div>
              <h2>Dinheiro na gaveta</h2>
              <table className="tabela">
                <tbody>
                  <Linha rotulo="Fundo de troco" valor={r.abertura} />
                  <Linha rotulo="+ Vendas em dinheiro" valor={r.porForma.dinheiro} />
                  <Linha rotulo="+ Fiado recebido em dinheiro" valor={r.fiadoRecebidoDinheiro} />
                  <Linha rotulo="+ Suprimentos" valor={r.suprimentos} />
                  <Linha rotulo="− Sangrias" valor={r.sangrias} />
                  <Linha rotulo="− Estornos" valor={r.estornos} />
                  <tr className="font-bold"><td>= Esperado</td><td className="text-right">{reais(esperado)}</td></tr>
                </tbody>
              </table>
              {r.fiadoRecebidoOutros > 0 && <p className="mt-2 text-sm text-tinta-suave">Fiado recebido em Pix/cartão: {reais(r.fiadoRecebidoOutros)}</p>}
            </div>
          </div>

          {movimentos.length > 0 && (
            <div>
              <h2>Sangrias, suprimentos e estornos</h2>
              <table className="tabela">
                <thead><tr><th>Quando</th><th>Tipo</th><th>Motivo</th><th className="text-right">Valor</th></tr></thead>
                <tbody>
                  {movimentos.map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap">{dataHoraBr(m.criadoEm)}</td>
                      <td>{TIPO_MOV[m.tipo] ?? m.tipo}</td>
                      <td className="text-tinta-suave">{m.motivo ?? "—"}</td>
                      <td className="text-right">{reais(m.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {!fechado && gerente && <FormFechar caixaId={caixaId} operador={c.operador} />}
      </div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <tr>
      <td>{rotulo}</td>
      <td className="text-right">{reais(valor)}</td>
    </tr>
  );
}

function Valor({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <div className="text-sm text-tinta-suave">{titulo}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight" style={{ fontFamily: "var(--font-titulo)" }}>{valor}</div>
    </div>
  );
}
