/**
 * Marca da Distribuidora Sousa: uma tampinha de garrafa (crown cork) em âmbar com o "S".
 * SVG puro, sem imagem externa.
 */
export function Tampinha({ tamanho = 40, className = "", semLetra = false }: { tamanho?: number; className?: string; semLetra?: boolean }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 100 100" className={className} aria-hidden="true">
      <polygon points="50.00,2.00 56.48,6.99 64.15,4.13 68.87,10.81 77.04,10.34 79.59,18.11 87.53,20.07 87.67,28.25 94.68,32.46 92.41,40.32 97.87,46.41 93.38,53.25 96.80,60.68 90.49,65.89 91.57,74.00 84.01,77.12 82.65,85.19 74.50,85.94 70.83,93.25 62.82,91.57 57.15,97.46 50.00,93.50 42.85,97.46 37.18,91.57 29.17,93.25 25.50,85.94 17.35,85.19 15.99,77.12 8.43,74.00 9.51,65.89 3.20,60.68 6.62,53.25 2.13,46.41 7.59,40.32 5.32,32.46 12.33,28.25 12.47,20.07 20.41,18.11 22.96,10.34 31.13,10.81 35.85,4.13 43.52,6.99" fill="var(--color-ambar-500)" />
      <circle cx="50" cy="50" r="36" fill="var(--color-ambar-300)" />
      <circle cx="50" cy="50" r="31" fill="none" stroke="var(--color-ambar-600)" strokeWidth="1.5" strokeDasharray="2 3" />
      {!semLetra && <text
        x="50"
        y="51"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="var(--font-titulo)"
        fontWeight="800"
        fontSize="44"
        fill="var(--color-garrafa-950)"
      >
        S
      </text>}
    </svg>
  );
}

export function Marca({ clara = false }: { clara?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Tampinha tamanho={34} className="shrink-0" />
      <span className="leading-none" style={{ fontFamily: "var(--font-titulo)" }}>
        <span className={`block text-[0.7rem] font-medium ${clara ? "text-garrafa-100/80" : "text-tinta-suave"}`}>Distribuidora</span>
        <span className={`block text-xl font-extrabold tracking-tight ${clara ? "text-white" : "text-garrafa-900"}`}>Sousa</span>
      </span>
    </span>
  );
}
