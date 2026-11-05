"use client";
import { useState } from "react";
import { reais } from "@/lib/formato";

const CEDULAS = [20000, 10000, 5000, 2000, 1000, 500, 200];
const MOEDAS = [100, 50, 25, 10, 5];

function rotulo(c: number) {
  return c >= 100 ? `R$ ${c / 100}` : `${c} ¢`;
}

/** Contagem da gaveta por cédula/moeda. O total vai no campo escondido "contado". */
export function ContadorDinheiro() {
  const [qtd, setQtd] = useState<Record<number, string>>({});
  const total = [...CEDULAS, ...MOEDAS].reduce((s, c) => s + c * (Number(qtd[c]) || 0), 0);

  const campo = (c: number) => (
    <label key={c} className="flex items-center gap-2 text-tinta">
      <span className="w-16 shrink-0 text-right text-sm">{rotulo(c)}</span>
      <span className="text-tinta-suave">×</span>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={qtd[c] ?? ""}
        onChange={(e) => setQtd((q) => ({ ...q, [c]: e.target.value }))}
        className="campo mt-0 w-20 py-1 text-right"
        aria-label={`Quantidade de ${rotulo(c)}`}
      />
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-tinta-suave">Cédulas</div>
          {CEDULAS.map(campo)}
        </div>
        <div className="space-y-2">
          <div className="text-xs font-semibold text-tinta-suave">Moedas</div>
          {MOEDAS.map(campo)}
        </div>
      </div>
      <div className="flex items-baseline justify-between rounded-lg bg-garrafa-50 px-3 py-2">
        <span className="text-tinta-suave">Total contado</span>
        <span className="text-2xl font-bold text-garrafa-900" style={{ fontFamily: "var(--font-titulo)" }}>{reais(total)}</span>
      </div>
      <input type="hidden" name="contado" value={(total / 100).toFixed(2)} />
    </div>
  );
}
