const CORES: Record<string, string> = {
  vencido: "bg-red-700 text-white",
  "15": "bg-red-100 text-red-800",
  "30": "bg-orange-100 text-orange-800",
  "60": "bg-ambar-100 text-ambar-600",
  "90": "bg-garrafa-50 text-garrafa-800",
};

export function Faixa({ faixa }: { faixa: string }) {
  return (
    <span className={`etiqueta ${CORES[faixa] ?? "bg-concreto text-tinta-suave"}`}>
      {faixa === "vencido" ? "Vencido" : `até ${faixa} dias`}
    </span>
  );
}
