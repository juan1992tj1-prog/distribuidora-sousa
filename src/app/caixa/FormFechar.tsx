import { fechar } from "./actions";
import { ContadorDinheiro } from "./ContadorDinheiro";

export function FormFechar({ caixaId, operador }: { caixaId: number; operador?: string }) {
  return (
    <form action={fechar} className="card space-y-4 self-start">
      <h2 className="mb-0">Fechar o caixa{operador ? ` de ${operador}` : ""}</h2>
      <p className="text-sm text-tinta-suave">Conte o dinheiro da gaveta, incluindo o fundo de troco. Pix e cartão o sistema já sabe.</p>
      <ContadorDinheiro />
      <div>
        <label>Observação</label>
        <textarea name="observacao" rows={2} className="campo" placeholder="Opcional. Explique se faltou ou sobrou algo." />
      </div>
      <input type="hidden" name="caixaId" value={caixaId} />
      <label className="flex items-start gap-2 text-tinta">
        <input type="checkbox" required className="mt-1 h-5 w-5" />
        <span>Contei a gaveta e o total está certo.</span>
      </label>
      <button className="btn-perigo w-full py-3">Fechar caixa</button>
    </form>
  );
}
