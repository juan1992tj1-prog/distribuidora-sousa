import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { caixaMovimentos } from "@/db/schema";
import { Aviso } from "@/components/Aviso";
import { caixaAbertoDe, caixasRecentes, resumoCaixa } from "@/lib/caixa";
import { dataHoraBr, hojeIso, reais } from "@/lib/formato";
import { exigir, pode } from "@/lib/sessao";
import { abrir, movimentar } from "./actions";
import { Diferenca } from "./Diferenca";
import { FormFechar } from "./FormFechar";

export const dynamic = "force-dynamic";

const TIPO_MOV: Record<string, string> = { sangria: "Sangria", suprimento: "Suprimento", estorno: "Estorno (devolução)" };

export default async function Caixa({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string; depois?: string }> }) {
  const sessao = await exigir("vender");
  const busca = await searchParams;
  const gerente = pode(sessao, "conferir_caixa");
  const meu = await caixaAbertoDe(db, sessao.uid);

  const historico = (await caixasRecentes(db, gerente ? 40 : 15)).filter((c) => gerente || c.usuarioId === sessao.uid);
  const outrosAbertos = gerente ? historico.filter((c) => c.status === "aberto" && c.usuarioId !== sessao.uid) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="mb-0">Caixa</h1>
        {meu && (
          <Link href="/venda" className="btn-sucesso px-5 py-2.5">
            Ir para a venda
          </Link>
        )}
      </div>
      <Aviso busca={busca} />

      {meu ? <CaixaAberto caixaId={meu.id} abertoEm={meu.abertoEm} gerente={gerente} /> : <Abrir depois={busca.depois} />}

      {outrosAbertos.length > 0 && (
        <section className="card border-ambar-300">
          <h2>Caixas abertos de outros operadores</h2>
          <ul className="divide-y divide-linha">
            {outrosAbertos.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span>
                  <b>{c.usuario.nome}</b> — aberto em {dataHoraBr(c.abertoEm)}
                  {hojeIso(new Date(c.abertoEm)) < hojeIso() && (
                    <span className="etiqueta ml-2 bg-ambar-100 text-ambar-600">aberto desde outro dia</span>
                  )}
                </span>
                <Link href={`/caixa/${c.id}`} className="btn-neutro py-1">Conferir / fechar</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card overflow-x-auto">
        <h2>{gerente ? "Últimos caixas" : "Meus últimos caixas"}</h2>
        {historico.length === 0 ? (
          <p className="py-4 text-tinta-suave">Nenhum caixa ainda.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr><th>Nº</th><th>Operador</th><th>Abertura</th><th>Fechamento</th><th className="text-right">Esperado</th><th className="text-right">Contado</th><th className="text-right">Diferença</th></tr>
            </thead>
            <tbody>
              {historico.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/caixa/${c.id}`}>{c.id}</Link></td>
                  <td>{c.usuario.nome}</td>
                  <td className="whitespace-nowrap">{dataHoraBr(c.abertoEm)}</td>
                  <td className="whitespace-nowrap">{c.fechadoEm ? dataHoraBr(c.fechadoEm) : <span className="etiqueta bg-garrafa-100 text-garrafa-900">aberto</span>}</td>
                  <td className="text-right">{c.dinheiroEsperado != null ? reais(c.dinheiroEsperado) : "—"}</td>
                  <td className="text-right">{c.dinheiroContado != null ? reais(c.dinheiroContado) : "—"}</td>
                  <td className="text-right">{c.diferenca != null ? <Diferenca valor={c.diferenca} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Abrir({ depois }: { depois?: string }) {
  return (
    <form action={abrir} className="card max-w-md space-y-4">
      <h2 className="mb-0">Abrir o caixa</h2>
      <p className="text-tinta-suave">Conte o troco que está na gaveta antes de começar a vender.</p>
      <div>
        <label>Fundo de troco (R$)</label>
        <input name="valor" className="campo text-right text-lg" placeholder="0,00" inputMode="decimal" autoFocus />
      </div>
      <input type="hidden" name="depois" value={depois ?? ""} />
      <button className="btn-sucesso w-full py-3 text-lg">Abrir caixa</button>
    </form>
  );
}

async function CaixaAberto({ caixaId, abertoEm, gerente }: { caixaId: number; abertoEm: Date; gerente: boolean }) {
  const [resumo, movimentos] = await Promise.all([
    resumoCaixa(db, caixaId),
    db.select().from(caixaMovimentos).where(eq(caixaMovimentos.caixaId, caixaId)).orderBy(desc(caixaMovimentos.criadoEm)),
  ]);
  const deOutroDia = hojeIso(new Date(abertoEm)) < hojeIso();

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
      <div className="space-y-6">
        <section className="card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="mb-0">Caixa nº {caixaId} aberto</h2>
            <span className="text-tinta-suave">desde {dataHoraBr(abertoEm)}</span>
          </div>
          {deOutroDia && (
            <p className="mt-3 rounded-lg bg-ambar-100 px-3 py-2 text-ambar-600">
              Este caixa foi aberto em outro dia. O certo é fechar no fim de cada expediente.
            </p>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Dado titulo="Vendas" valor={String(resumo.vendasQtd)} />
            <Dado titulo="Fundo de troco" valor={reais(resumo.abertura)} />
            {gerente && <Dado titulo="Total vendido" valor={reais(resumo.vendasTotal)} />}
            {gerente && <Dado titulo="Dinheiro esperado" valor={reais(resumo.dinheiroEsperado)} destaque />}
          </dl>
          {!gerente && (
            <p className="mt-4 text-sm text-tinta-suave">
              O fechamento é às cegas: conte a gaveta e informe o valor. A conferência aparece depois de fechar.
            </p>
          )}
        </section>

        <section className="card">
          <h2>Sangria e suprimento</h2>
          <form action={movimentar} className="grid gap-3 sm:grid-cols-2 md:grid-cols-[170px_130px_1fr_auto] md:items-end">
            <div>
              <label>Tipo</label>
              <select name="tipo" className="campo">
                <option value="sangria">Sangria (tirar)</option>
                <option value="suprimento">Suprimento (pôr troco)</option>
              </select>
            </div>
            <div>
              <label>Valor (R$)</label>
              <input name="valor" className="campo text-right" placeholder="0,00" inputMode="decimal" required />
            </div>
            <div>
              <label>Motivo</label>
              <input name="motivo" className="campo" placeholder="ex.: cofre, pagar entregador" />
            </div>
            <button className="btn-primario">Registrar</button>
          </form>
          {movimentos.length > 0 && (
            <table className="tabela mt-4">
              <thead><tr><th>Quando</th><th>Tipo</th><th>Motivo</th><th className="text-right">Valor</th></tr></thead>
              <tbody>
                {movimentos.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap">{dataHoraBr(m.criadoEm)}</td>
                    <td>{TIPO_MOV[m.tipo] ?? m.tipo}</td>
                    <td className="text-tinta-suave">{m.motivo ?? "—"}</td>
                    <td className={`text-right font-semibold ${m.tipo === "suprimento" ? "text-garrafa-700" : "text-red-700"}`}>
                      {m.tipo === "suprimento" ? "+" : "−"} {reais(m.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <FormFechar caixaId={caixaId} />
    </div>
  );
}

function Dado({ titulo, valor, destaque }: { titulo: string; valor: string; destaque?: boolean }) {
  return (
    <div>
      <dt className="text-sm text-tinta-suave">{titulo}</dt>
      <dd className={`text-2xl font-bold tracking-tight ${destaque ? "text-garrafa-900" : ""}`} style={{ fontFamily: "var(--font-titulo)" }}>{valor}</dd>
    </div>
  );
}
