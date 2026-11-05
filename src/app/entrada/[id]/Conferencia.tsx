"use client";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LeitorCodigo, type LeitorRef } from "@/components/LeitorCodigo";
import { paraCentavos, validadeDigitada } from "@/lib/formato";
import { adicionarItem, identificar } from "../actions";

type Identificado = NonNullable<Extract<Awaited<ReturnType<typeof identificar>>, { ok: true }>["dados"]>;

export function Conferencia({ entradaId, verCusto }: { entradaId: number; verCusto: boolean }) {
  const router = useRouter();
  const leitor = useRef<LeitorRef>(null);
  const qtdRef = useRef<HTMLInputElement>(null);
  const validadeRef = useRef<HTMLInputElement>(null);
  const [atual, setAtual] = useState<Identificado | null>(null);
  const [naoCadastrado, setNaoCadastrado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [qtd, setQtd] = useState("1");
  const [lote, setLote] = useState("");
  const [validade, setValidade] = useState("");
  const [custo, setCusto] = useState("");
  const [pendente, iniciar] = useTransition();

  function aoLer(codigo: string) {
    setErro(null);
    setNaoCadastrado(null);
    iniciar(async () => {
      const r = await identificar(codigo, entradaId);
      if (!r.ok) return setErro(r.erro);
      if (!r.dados.item) {
        setAtual(null);
        return setNaoCadastrado(r.dados.leitura.gtin ?? codigo);
      }
      setAtual(r.dados);
      setQtd(String(r.dados.leitura.quantidade ?? 1));
      setLote(r.dados.leitura.lote ?? r.dados.sugestao?.lote ?? "");
      const v = r.dados.leitura.validade ?? r.dados.sugestao?.validade; // AAAA-MM-DD → DDMMAA
      setValidade(v ? `${v.slice(8, 10)}${v.slice(5, 7)}${v.slice(2, 4)}` : "");
      setTimeout(() => {
        // se o código já trouxe a validade, pula direto para a quantidade
        (r.dados.item!.perecivel && !v ? validadeRef : qtdRef).current?.select();
      }, 0);
    });
  }

  function adicionar(e: React.FormEvent) {
    e.preventDefault();
    if (!atual?.item) return;
    const quantidade = Number(qtd);
    const validadeIso = validade ? validadeDigitada(validade) : null;
    if (atual.item.perecivel && !validadeIso) return setErro("Validade inválida. Digite DDMMAA, ex.: 311226.");
    iniciar(async () => {
      const r = await adicionarItem(entradaId, {
        embalagemId: atual.item!.embalagemId,
        quantidadeEmbalagens: quantidade,
        loteNumero: lote,
        validade: validadeIso,
        custoEmbalagem: verCusto ? paraCentavos(custo) : null,
      });
      if (!r.ok) return setErro(r.erro);
      setAtual(null);
      setCusto("");
      router.refresh();
      leitor.current?.focar();
    });
  }

  return (
    <section className="card space-y-3">
      <h2>Conferência — bipe cada produto recebido</h2>
      <p className="text-sm text-tinta-suave">
        Conte fisicamente o que chegou. Se o código tiver lote/validade (QR/DataMatrix GS1), o sistema preenche sozinho.
      </p>
      <LeitorCodigo ref={leitor} onLeitura={aoLer} desabilitado={pendente} />
      {erro && <div className="rounded-lg bg-red-50 px-3 py-2 text-red-800">{erro}</div>}
      {naoCadastrado && (
        <div className="rounded-lg bg-ambar-100/50 px-3 py-2 text-tinta">
          Código <b>{naoCadastrado}</b> não está cadastrado.{" "}
          <Link className="font-semibold text-garrafa-800 underline" href={`/produtos/novo?codigo=${naoCadastrado}&voltar=/entrada/${entradaId}`}>
            Cadastrar agora
          </Link>
        </div>
      )}
      {atual?.item && (
        <form onSubmit={adicionar} className="grid items-end gap-3 rounded-lg border border-garrafa-100 bg-garrafa-50 p-3 sm:grid-cols-6">
          {atual.sugestao && !atual.leitura.validade && (
            <div className="text-sm text-garrafa-900 sm:col-span-6">Lote e validade sugeridos pela NF-e — confira na embalagem.</div>
          )}
          <div className="sm:col-span-6 font-semibold">
            {atual.item.descricao} — {atual.item.tipo}
            {atual.item.fator > 1 && ` com ${atual.item.fator} un.`}
          </div>
          <div>
            <label>Quantidade ({atual.item.tipo})</label>
            <input ref={qtdRef} value={qtd} onChange={(e) => setQtd(e.target.value)} type="number" min={1} className="campo" required />
          </div>
          <div>
            <label>Lote</label>
            <input value={lote} onChange={(e) => setLote(e.target.value)} className="campo" />
          </div>
          {atual.item.perecivel && (
            <div>
              <label>Validade (DDMMAA)</label>
              <input ref={validadeRef} value={validade} onChange={(e) => setValidade(e.target.value)} inputMode="numeric" className="campo" placeholder="311226" required />
            </div>
          )}
          {verCusto && (
            <div>
              <label>Custo por {atual.item.tipo} (R$)</label>
              <input value={custo} onChange={(e) => setCusto(e.target.value)} className="campo" placeholder="opcional" />
            </div>
          )}
          <div className="text-sm text-tinta-suave">= {(Number(qtd) || 0) * atual.item.fator} unidades</div>
          <button className="btn-primario" disabled={pendente}>Adicionar</button>
        </form>
      )}
    </section>
  );
}
