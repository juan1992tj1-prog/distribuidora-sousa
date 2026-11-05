import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { embalagens, entradas, produtos } from "@/db/schema";
import { compararComNota } from "@/lib/nfe";
import { Aviso } from "@/components/Aviso";
import { dataBr, reais } from "@/lib/formato";
import { exigir, pode } from "@/lib/sessao";
import { finalizar, importarXml, removerItem, vincular } from "../actions";
import { Conferencia } from "./Conferencia";

export const dynamic = "force-dynamic";

export default async function EntradaDetalhe({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const sessao = await exigir("dar_entrada");
  const { id } = await params;
  const busca = await searchParams;
  const entrada = await db.query.entradas.findFirst({
    where: eq(entradas.id, Number(id)),
    with: {
      fornecedor: true,
      itens: { with: { produto: { columns: { descricao: true } }, embalagem: { columns: { tipo: true, fator: true } } } },
    },
  });
  if (!entrada) notFound();
  const aberta = entrada.status === "aberta";
  const verCusto = pode(sessao, "ver_custo");
  const totalUnidades = entrada.itens.reduce((s, i) => s + i.quantidadeBase, 0);
  const comp = await compararComNota(db, entrada.id);
  const opcoesEmbalagem =
    verCusto && comp.pendentes.length > 0
      ? await db
          .select({ id: embalagens.id, tipo: embalagens.tipo, fator: embalagens.fator, descricao: produtos.descricao })
          .from(embalagens)
          .innerJoin(produtos, eq(produtos.id, embalagens.produtoId))
          .where(and(eq(embalagens.ativo, true), eq(produtos.ativo, true)))
          .orderBy(asc(produtos.descricao), asc(embalagens.fator))
      : [];
  const precisaConfirmar = comp.temNota && comp.divergencias > 0;

  return (
    <div className="space-y-4">
      <h1>
        Entrada nº {entrada.id} {entrada.fornecedor && `— ${entrada.fornecedor.nome}`} {entrada.numeroNota && `· NF ${entrada.numeroNota}`}
      </h1>
      <Aviso busca={busca} />
      {aberta && verCusto && !entrada.chaveNfe && (
        <form action={importarXml} className="card flex flex-wrap items-end gap-3">
          <input type="hidden" name="entradaId" value={entrada.id} />
          <div className="min-w-64 flex-1">
            <h2 className="mb-1">Importar XML da NF-e (opcional)</h2>
            <p className="text-sm text-tinta-suave">
              O sistema lê os itens da nota e compara com o que for bipado. O estoquista não vê as quantidades da nota.
            </p>
            <input type="file" name="xml" accept=".xml,text/xml,application/xml" required className="campo" />
          </div>
          <button className="btn-primario">Importar nota</button>
        </form>
      )}

      {comp.temNota && !verCusto && aberta && (
        <div className="card border-garrafa-100 bg-garrafa-50 text-garrafa-950">
          📄 Nota fiscal importada. Bipe e conte normalmente o que chegou — a comparação com a nota aparece para o gerente.
        </div>
      )}

      {comp.temNota && verCusto && (
        <section className="card space-y-3 overflow-x-auto">
          <h2>
            Nota × conferido{" "}
            {comp.divergencias === 0 ? (
              <span className="etiqueta bg-garrafa-100 text-garrafa-900">tudo confere</span>
            ) : (
              <span className="etiqueta bg-red-100 text-red-800">{comp.divergencias} divergência(s)</span>
            )}
          </h2>
          {entrada.chaveNfe && <p className="font-mono text-xs text-tinta-suave">Chave {entrada.chaveNfe}</p>}

          {!aberta && comp.pendentes.length > 0 && (
            <p className="text-sm text-tinta-suave">
              Itens da nota que não foram lançados (sem produto no cadastro): {comp.pendentes.map((p) => p.descricao).join(", ")}.
            </p>
          )}
          {aberta && comp.pendentes.length > 0 && (
            <div className="space-y-2 rounded-lg border border-ambar-300 bg-ambar-100/50 p-3">
              <p className="font-semibold text-tinta">
                Itens da nota que o sistema não reconheceu — diga qual produto do cadastro é cada um (o sistema lembra nas próximas notas):
              </p>
              {comp.pendentes.map((p) => (
                <form key={p.id} action={vincular} className="grid items-end gap-2 sm:grid-cols-[2fr_2fr_1fr_auto]">
                  <input type="hidden" name="entradaId" value={entrada.id} />
                  <input type="hidden" name="notaItemId" value={p.id} />
                  <div className="text-sm">
                    <b>{p.descricao}</b>
                    <div className="text-tinta-suave">
                      {p.quantidade} {p.unidade} · cód. {p.codigoFornecedor}
                      {p.gtin && ` · EAN ${p.gtin}`}
                    </div>
                    {(
                      <Link
                        className="text-garrafa-800 underline"
                        href={`/produtos/novo?${p.gtin ? `codigo=${p.gtin}&` : ""}voltar=/entrada/${entrada.id}`}
                      >
                        não existe no cadastro? cadastrar
                      </Link>
                    )}
                  </div>
                  <div>
                    <label>É o produto</label>
                    <select name="embalagemId" className="campo" required>
                      <option value="">Escolha…</option>
                      {opcoesEmbalagem.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.descricao} — {o.tipo}{o.fator > 1 ? ` ${o.fator}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label title="Quantas dessas embalagens vêm em 1 unidade da nota">Qtd. por {p.unidade || "un."}</label>
                    <input name="multiplicador" defaultValue="1" className="campo" />
                  </div>
                  <button className="btn-neutro">Vincular</button>
                </form>
              ))}
            </div>
          )}

          <table className="tabela">
            <thead><tr><th>Produto</th><th>Na nota</th><th>Contado</th><th>Diferença</th><th>Situação</th></tr></thead>
            <tbody>
              {comp.linhas.map((l) => (
                <tr key={l.produtoId} className={l.situacao === "ok" ? "" : "bg-red-50"}>
                  <td>{l.descricao}</td>
                  <td>{l.naNota} un.</td>
                  <td>{l.contado} un.</td>
                  <td className={l.diferenca === 0 ? "" : "font-bold text-red-700"}>{l.diferenca > 0 ? `+${l.diferenca}` : l.diferenca}</td>
                  <td>
                    {{ ok: "✔ confere", falta: "Faltou", sobra: "Sobrou", fora_da_nota: "Não está na nota" }[l.situacao]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {aberta && <Conferencia entradaId={entrada.id} verCusto={verCusto} />}

      <section className="card overflow-x-auto">
        <h2>Itens conferidos ({entrada.itens.length}) · {totalUnidades} unidades</h2>
        <table className="tabela">
          <thead>
            <tr><th>Produto</th><th>Qtd.</th><th>Unidades</th><th>Lote</th><th>Validade</th>{verCusto && <th>Custo/un.</th>}<th /></tr>
          </thead>
          <tbody>
            {entrada.itens.map((i) => (
              <tr key={i.id}>
                <td>{i.produto.descricao}</td>
                <td>{i.quantidadeEmbalagens} {i.embalagem.tipo}{i.embalagem.fator > 1 ? ` ${i.embalagem.fator}` : ""}</td>
                <td>{i.quantidadeBase}</td>
                <td>{i.loteNumero || "—"}</td>
                <td>{dataBr(i.validade)}</td>
                {verCusto && <td>{i.custoUnitario != null ? reais(i.custoUnitario) : "—"}</td>}
                <td>
                  {aberta && (
                    <form action={removerItem}>
                      <input type="hidden" name="entradaId" value={entrada.id} />
                      <input type="hidden" name="itemId" value={i.id} />
                      <button className="text-red-600 hover:underline">remover</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {aberta && entrada.itens.length > 0 && (
          <form action={finalizar} className="mt-4 flex flex-wrap items-center justify-end gap-3">
            <input type="hidden" name="entradaId" value={entrada.id} />
            {precisaConfirmar && verCusto && (
              <label className="flex items-center gap-2 text-sm text-red-800">
                <input type="checkbox" name="confirmarDivergencia" required className="h-4 w-4" />
                Finalizar mesmo com {comp.divergencias} divergência(s) com a nota (fica registrado)
              </label>
            )}
            {precisaConfirmar && !verCusto ? (
              <span className="text-sm text-tinta-suave">Contagem registrada. O gerente confere com a nota e finaliza.</span>
            ) : (
              <button className="btn-sucesso">Finalizar e lançar no estoque</button>
            )}
          </form>
        )}
        {!aberta && <p className="mt-3 text-garrafa-700">✔ Entrada finalizada e lançada no estoque.</p>}
      </section>
    </div>
  );
}
