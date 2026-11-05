import { db } from "@/db";
import { categorias } from "@/db/schema";
import { Aviso } from "@/components/Aviso";
import { exigir, pode } from "@/lib/sessao";
import { criarProduto } from "../actions";
import { CamposProduto } from "../CamposProduto";

export default async function NovoProduto({ searchParams }: { searchParams: Promise<{ codigo?: string; voltar?: string; erro?: string }> }) {
  const sessao = await exigir("cadastrar_produto");
  const busca = await searchParams;
  const cats = (await db.select({ nome: categorias.nome }).from(categorias)).map((c) => c.nome);
  const podePreco = pode(sessao, "alterar_preco");
  const codigo = (busca.codigo ?? "").replace(/^0+(?=\d{13}$)/, "");

  return (
    <div className="max-w-3xl">
      <h1>Novo produto</h1>
      <Aviso busca={busca} />
      <form action={criarProduto} className="card space-y-6">
        <input type="hidden" name="voltar" value={busca.voltar ?? ""} />
        <CamposProduto categorias={cats} />
        <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <legend className="px-1 font-semibold">Unidade</legend>
          <div><label>Código de barras (EAN)</label><input name="codigoUn" defaultValue={codigo} className="campo font-mono" inputMode="numeric" /></div>
          {podePreco && <div><label>Preço de venda (R$)</label><input name="precoUn" className="campo" placeholder="0,00" /></div>}
        </fieldset>
        <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-4">
          <legend className="px-1 font-semibold">Caixa / fardo (opcional)</legend>
          <div>
            <label>Tipo</label>
            <select name="tipoCx" className="campo"><option value="CX">Caixa</option><option value="FARDO">Fardo</option><option value="PACK">Pack</option></select>
          </div>
          <div><label>Unidades dentro</label><input name="fatorCx" type="number" min={2} className="campo" placeholder="12" /></div>
          <div><label>Código (DUN-14)</label><input name="codigoCx" className="campo font-mono" inputMode="numeric" /></div>
          {podePreco && <div><label>Preço (R$)</label><input name="precoCx" className="campo" placeholder="0,00" /></div>}
        </fieldset>
        <button className="btn-primario">Salvar produto</button>
      </form>
    </div>
  );
}
