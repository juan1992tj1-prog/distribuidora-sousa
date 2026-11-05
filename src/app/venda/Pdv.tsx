"use client";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { LeitorCodigo, type LeitorRef } from "@/components/LeitorCodigo";
import { paraCentavos, reais } from "@/lib/formato";
import { buscarItem, finalizarVenda, type ItemCatalogo } from "./actions";

type Forma = "dinheiro" | "pix" | "cartao_debito" | "cartao_credito" | "fiado";
const ROTULO: Record<Forma, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  cartao_debito: "Débito",
  cartao_credito: "Crédito",
  fiado: "Fiado",
};
const ROTULO_EMB: Record<string, string> = { UN: "Unid.", PACK: "Pack", FARDO: "Fardo", CX: "Caixa" };

type Linha = ItemCatalogo & { quantidade: number };

export function Pdv({ clientes, podeDesconto }: { clientes: { id: number; nome: string }[]; podeDesconto: boolean }) {
  const leitor = useRef<LeitorRef>(null);
  const [carrinho, setCarrinho] = useState<Linha[]>([]);
  const [opcoes, setOpcoes] = useState<ItemCatalogo[]>([]);
  const [multiplicar, setMultiplicar] = useState(1);
  const [mensagem, setMensagem] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);
  const [desconto, setDesconto] = useState("");
  const [pagamentos, setPagamentos] = useState<{ forma: Forma; valor: string }[]>([]);
  const [clienteId, setClienteId] = useState<number | "">("");
  const [idadeConferida, setIdadeConferida] = useState(false);
  const [pendente, iniciar] = useTransition();

  const adicionar = useCallback((item: ItemCatalogo, qtd: number) => {
    setCarrinho((c) => {
      const i = c.findIndex((l) => l.embalagemId === item.embalagemId);
      if (i >= 0) {
        const novo = [...c];
        novo[i] = { ...novo[i], quantidade: novo[i].quantidade + qtd };
        return novo;
      }
      return [...c, { ...item, quantidade: qtd }];
    });
    setOpcoes([]);
    setMensagem(null);
    setTimeout(() => leitor.current?.focar(), 0);
  }, []);

  const aoLer = useCallback(
    (entrada: string) => {
      // "3*789..." = 3 unidades daquele código
      let texto = entrada;
      let qtd = multiplicar;
      const m = /^(\d{1,3})\*(.+)$/.exec(entrada);
      if (m) {
        qtd = Number(m[1]);
        texto = m[2];
      }
      iniciar(async () => {
        const r = await buscarItem(texto);
        if (!r.ok) return setMensagem({ tipo: "erro", texto: r.erro });
        if (r.dados.length === 0) return setMensagem({ tipo: "erro", texto: `Produto não encontrado: ${texto}` });
        if (r.dados.length === 1) adicionar(r.dados[0], qtd);
        else setOpcoes(r.dados);
        setMultiplicar(1);
      });
    },
    [adicionar, multiplicar],
  );

  const subtotal = carrinho.reduce((s, l) => s + l.quantidade * l.precoVenda, 0);
  const valorDesconto = Math.min(paraCentavos(desconto) ?? 0, subtotal);
  const total = subtotal - valorDesconto;
  const pago = pagamentos.reduce((s, p) => s + (paraCentavos(p.valor) ?? 0), 0);
  const naoDinheiro = pagamentos.filter((p) => p.forma !== "dinheiro").reduce((s, p) => s + (paraCentavos(p.valor) ?? 0), 0);
  const troco = Math.max(0, pago - total);
  const falta = Math.max(0, total - pago);
  const temAlcool = carrinho.some((l) => l.alcoolico);
  const temFiado = pagamentos.some((p) => p.forma === "fiado");

  // avisa quando o carrinho passa do saldo (somando embalagens do mesmo produto)
  const semSaldo = useMemo(() => {
    const porProduto = new Map<number, { usado: number; saldo: number }>();
    for (const l of carrinho) {
      const atual = porProduto.get(l.produtoId) ?? { usado: 0, saldo: l.saldo };
      atual.usado += l.quantidade * l.fator;
      porProduto.set(l.produtoId, atual);
    }
    return new Set([...porProduto].filter(([, v]) => v.usado > v.saldo).map(([id]) => id));
  }, [carrinho]);

  function adicionarPagamento(forma: Forma) {
    const restante = Math.max(0, total - pago);
    setPagamentos((p) => [...p, { forma, valor: (restante / 100).toFixed(2).replace(".", ",") }]);
  }

  function limpar() {
    setCarrinho([]);
    setPagamentos([]);
    setDesconto("");
    setClienteId("");
    setIdadeConferida(false);
    setOpcoes([]);
    leitor.current?.focar();
  }

  function finalizar() {
    if (naoDinheiro > total) return setMensagem({ tipo: "erro", texto: "Cartão/Pix/fiado passam do total." });
    iniciar(async () => {
      const r = await finalizarVenda({
        itens: carrinho.map((l) => ({ embalagemId: l.embalagemId, quantidade: l.quantidade })),
        desconto: valorDesconto,
        pagamentos: pagamentos
          .map((p) => ({ forma: p.forma, valor: paraCentavos(p.valor) ?? 0 }))
          .filter((p) => p.valor > 0),
        clienteId: clienteId === "" ? null : clienteId,
        idadeConferida,
      });
      if (!r.ok) return setMensagem({ tipo: "erro", texto: r.erro });
      setMensagem({
        tipo: "ok",
        texto: `Venda nº ${r.dados.vendaId} finalizada — ${reais(r.dados.total)}${r.dados.troco > 0 ? ` · TROCO ${reais(r.dados.troco)}` : ""}`,
      });
      limpar();
    });
  }

  const podeFinalizar =
    carrinho.length > 0 && falta === 0 && (!temAlcool || idadeConferida) && (!temFiado || clienteId !== "") && !pendente;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <section className="space-y-3">
        <div className="card space-y-2">
          <div className="flex items-center gap-2">
            <label className="shrink-0">Qtd.</label>
            <input
              type="number"
              min={1}
              value={multiplicar}
              onChange={(e) => setMultiplicar(Math.max(1, Number(e.target.value) || 1))}
              className="campo mt-0 w-20"
            />
            <div className="flex-1">
              <LeitorCodigo ref={leitor} onLeitura={aoLer} placeholder="Bipe o produto, ou digite o nome e Enter (dica: 3*código)" />
            </div>
          </div>
          {mensagem && (
            <div className={`rounded-lg px-3 py-2 ${mensagem.tipo === "erro" ? "bg-red-50 text-red-800" : "bg-garrafa-50 text-lg font-semibold text-garrafa-900"}`}>
              {mensagem.texto}
            </div>
          )}
          {opcoes.length > 0 && (
            <div className="divide-y rounded-lg border">
              {opcoes.map((o) => (
                <button key={o.embalagemId} type="button" onClick={() => adicionar(o, multiplicar)} className="flex w-full justify-between px-3 py-2 text-left hover:bg-garrafa-50">
                  <span>{o.descricao} — {ROTULO_EMB[o.tipo]}{o.fator > 1 ? ` c/ ${o.fator}` : ""}</span>
                  <span className="font-semibold">{reais(o.precoVenda)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <table className="tabela">
            <thead>
              <tr><th>Produto</th><th>Emb.</th><th className="w-36">Qtd.</th><th>Preço</th><th>Total</th><th /></tr>
            </thead>
            <tbody>
              {carrinho.length === 0 && (
                <tr><td colSpan={6} className="py-10 text-center text-tinta-suave/60">Carrinho vazio — bipe um produto</td></tr>
              )}
              {carrinho.map((l, i) => (
                <tr key={l.embalagemId} className={semSaldo.has(l.produtoId) ? "bg-red-50" : ""}>
                  <td>
                    {l.descricao} {l.alcoolico && <span title="Bebida alcoólica">🔞</span>}
                    {semSaldo.has(l.produtoId) && <div className="text-xs text-red-700">Saldo disponível: {l.saldo} un.</div>}
                  </td>
                  <td>{ROTULO_EMB[l.tipo]}{l.fator > 1 ? ` ${l.fator}` : ""}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button className="btn-neutro px-2 py-0.5" onClick={() => setCarrinho((c) => c.map((x, j) => (j === i ? { ...x, quantidade: Math.max(1, x.quantidade - 1) } : x)))}>−</button>
                      <span className="w-8 text-center">{l.quantidade}</span>
                      <button className="btn-neutro px-2 py-0.5" onClick={() => setCarrinho((c) => c.map((x, j) => (j === i ? { ...x, quantidade: x.quantidade + 1 } : x)))}>+</button>
                    </div>
                  </td>
                  <td>{reais(l.precoVenda)}</td>
                  <td className="font-semibold">{reais(l.quantidade * l.precoVenda)}</td>
                  <td><button className="text-red-600 hover:underline" onClick={() => setCarrinho((c) => c.filter((_, j) => j !== i))}>remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="card space-y-4 self-start">
        <div className="space-y-1 text-right">
          <div className="text-tinta-suave">Subtotal {reais(subtotal)}</div>
          {podeDesconto && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-tinta-suave">Desconto R$</span>
              <input value={desconto} onChange={(e) => setDesconto(e.target.value)} className="campo mt-0 w-28 text-right" placeholder="0,00" />
            </div>
          )}
          <div className="text-5xl font-bold tracking-tight text-garrafa-900" style={{ fontFamily: "var(--font-titulo)" }}>{reais(total)}</div>
        </div>

        <div>
          <div className="mb-2 grid grid-cols-3 gap-2">
            {(Object.keys(ROTULO) as Forma[]).map((f) => (
              <button key={f} type="button" className="btn-neutro px-2" onClick={() => adicionarPagamento(f)} disabled={carrinho.length === 0}>
                {ROTULO[f]}
              </button>
            ))}
          </div>
          {pagamentos.map((p, i) => (
            <div key={i} className="mb-2 flex items-center gap-2">
              <span className="w-20 text-sm">{ROTULO[p.forma]}</span>
              <input
                value={p.valor}
                onChange={(e) => setPagamentos((ps) => ps.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))}
                className="campo mt-0 text-right"
              />
              <button className="text-red-600" onClick={() => setPagamentos((ps) => ps.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          {falta > 0 && pagamentos.length > 0 && <div className="text-right text-red-700">Falta {reais(falta)}</div>}
          {troco > 0 && <div className="text-right text-2xl font-bold text-garrafa-700">Troco {reais(troco)}</div>}
        </div>

        {temFiado && (
          <div>
            <label>Cliente (fiado)</label>
            <select className="campo" value={clienteId} onChange={(e) => setClienteId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Selecione…</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
        )}

        {temAlcool && (
          <label className="flex items-start gap-2 rounded-lg border border-ambar-300 bg-ambar-100/50 p-3">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={idadeConferida} onChange={(e) => setIdadeConferida(e.target.checked)} />
            <span>🔞 Bebida alcoólica: <b>conferi que o cliente tem 18 anos ou mais</b> (pedir documento se aparentar menos de 25).</span>
          </label>
        )}

        <button className="btn-sucesso w-full py-3 text-lg" disabled={!podeFinalizar} onClick={finalizar}>
          {pendente ? "Processando…" : "Finalizar venda"}
        </button>
        <button className="btn-neutro w-full" onClick={limpar} disabled={pendente}>
          Cancelar / limpar
        </button>
      </aside>
    </div>
  );
}
