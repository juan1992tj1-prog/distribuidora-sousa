import { reais } from "@/lib/formato";

/** Sobra (verde), falta (vermelho) ou "bateu". */
export function Diferenca({ valor }: { valor: number }) {
  if (valor === 0) return <span className="etiqueta bg-garrafa-100 text-garrafa-900">bateu</span>;
  if (valor > 0) return <span className="font-semibold text-garrafa-700">sobra {reais(valor)}</span>;
  return <span className="font-semibold text-red-700">falta {reais(-valor)}</span>;
}
