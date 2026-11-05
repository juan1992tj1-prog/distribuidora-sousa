/** Banner de sucesso/erro lido da URL (?ok=… ou ?erro=…). */
export function Aviso({ busca }: { busca: { ok?: string; erro?: string } }) {
  if (busca.erro)
    return (
      <div role="alert" className="mb-5 rounded-lg border-l-4 border-red-700 bg-red-50 px-4 py-3 text-red-900">
        {busca.erro}
      </div>
    );
  if (busca.ok)
    return (
      <div role="status" className="mb-5 rounded-lg border-l-4 border-garrafa-700 bg-garrafa-50 px-4 py-3 text-garrafa-950">
        {busca.ok}
      </div>
    );
  return null;
}
