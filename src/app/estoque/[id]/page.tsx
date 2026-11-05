import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { lotes, movimentos, produtos, usuarios } from "@/db/schema";
import { Aviso } from "@/components/Aviso";
import { Faixa } from "@/components/Faixa";
import { lotesDoProduto } from "@/lib/consultas";
import { dataBr, dataHoraBr } from "@/lib/formato";
import { exigir, pode } from "@/lib/sessao";
import { classificar } from "@/lib/validade";
import { ajuste, saidaAvulsa } from "../actions";

export const dynamic = "force-dynamic";

const ROTULO: Record<string, string> = {
  entrada_compra: "Entrada (compra)",
  saida_venda: "Venda",
  cancelamento_venda: "Cancelamento de venda",
  perda: "Perda / avaria",
  vencido: "Baixa de vencido",
  consumo_interno: "Consumo interno",
  devolucao_fornecedor: "Devolução ao fornecedor",
  ajuste_inventario: "Ajuste de inventário",
};

export default async function EstoqueProduto({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sessao = await exigir();
  const id = Number((await params).id);
  const busca = await searchParams;
  const [p] = await db.select().from(produtos).where(eq(produtos.id, id));
  if (!p) notFound();
  const [lts, kardex] = await Promise.all([
    lotesDoProduto(db, id),
    db
      .select({ m: movimentos, lote: lotes.numero, validade: lotes.validade, usuario: usuarios.nome })
      .from(movimentos)
      .innerJoin(lotes, eq(lotes.id, movimentos.loteId))
      .leftJoin(usuarios, eq(usuarios.id, movimentos.usuarioId))
      .where(eq(movimentos.produtoId, id))
      .orderBy(desc(movimentos.criadoEm), desc(movimentos.id))
      .limit(200),
  ]);
  const total = lts.reduce((s, l) => s + l.quantidade, 0);
  const opcoesLote = lts.map((l) => (
    <option key={l.loteId} value={l.loteId}>
      {l.numero || "s/ lote"} · val. {dataBr(l.validade)} · {l.quantidade} un.
    </option>
  ));

  return (
    <div className="space-y-4">
      <h1>{p.descricao} — {total} un. em estoque</h1>
      <Aviso busca={busca} />
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-1">
          <h2>Lotes com saldo</h2>
          <table className="tabela">
            <thead><tr><th>Lote</th><th>Validade</th><th>Qtd.</th></tr></thead>
            <tbody>
              {lts.map((l) => {
                const f = l.validade ? classificar(l.validade) : null;
                return (
                  <tr key={l.loteId}>
                    <td>{l.numero || "—"}</td>
                    <td>{dataBr(l.validade)} {f && <Faixa faixa={f} />}</td>
                    <td>{l.quantidade}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {pode(sessao, "baixa_perda") && (
          <form action={saidaAvulsa} className="card space-y-2">
            <h2>Registrar saída (sem venda)</h2>
            <input type="hidden" name="produtoId" value={id} />
            <select name="tipo" className="campo">
              <option value="perda">Perda / avaria / quebra</option>
              <option value="vencido">Vencido (descarte)</option>
              <option value="consumo_interno">Consumo interno</option>
              <option value="devolucao_fornecedor">Devolução ao fornecedor</option>
            </select>
            <select name="loteId" className="campo">
              <option value="">Lote automático (o que vence primeiro)</option>
              {opcoesLote}
            </select>
            <input name="quantidade" type="number" min={1} placeholder="Quantidade (unidades)" className="campo" required />
            <input name="motivo" placeholder="Motivo (obrigatório)" className="campo" required />
            <button className="btn-perigo w-full">Dar baixa</button>
          </form>
        )}

        {pode(sessao, "ajustar_inventario") && (
          <form action={ajuste} className="card space-y-2">
            <h2>Inventário (contagem)</h2>
            <p className="text-sm text-tinta-suave">Informe quanto foi contado no lote; o sistema lança a diferença.</p>
            <input type="hidden" name="produtoId" value={id} />
            <select name="loteId" className="campo" required>
              <option value="">Escolha o lote…</option>
              {opcoesLote}
            </select>
            <input name="contado" type="number" min={0} placeholder="Quantidade contada" className="campo" required />
            <input name="motivo" placeholder="Motivo (ex.: contagem mensal)" className="campo" required />
            <button className="btn-primario w-full">Lançar contagem</button>
          </form>
        )}
      </div>

      <section className="card overflow-x-auto">
        <h2>Movimentações (kardex)</h2>
        <table className="tabela">
          <thead><tr><th>Quando</th><th>Tipo</th><th>Qtd.</th><th>Lote</th><th>Doc.</th><th>Motivo</th><th>Usuário</th></tr></thead>
          <tbody>
            {kardex.map(({ m, lote, validade, usuario }) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap">{dataHoraBr(m.criadoEm)}</td>
                <td>{ROTULO[m.tipo]}</td>
                <td className={m.quantidade > 0 ? "font-semibold text-garrafa-700" : "font-semibold text-red-700"}>{m.quantidade > 0 ? "+" : ""}{m.quantidade}</td>
                <td>{lote || "—"} <span className="text-xs text-tinta-suave">{dataBr(validade)}</span></td>
                <td>{m.documentoTipo ? `${m.documentoTipo} ${m.documentoId}` : "—"}</td>
                <td>{m.motivo ?? ""}</td>
                <td>{usuario ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
