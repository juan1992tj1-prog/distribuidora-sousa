import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categorias, produtos } from "@/db/schema";
import { Aviso } from "@/components/Aviso";
import { reais } from "@/lib/formato";
import { exigir, pode } from "@/lib/sessao";
import { atualizarProduto, salvarEmbalagem } from "../actions";
import { CamposProduto } from "../CamposProduto";

export const dynamic = "force-dynamic";

export default async function EditarProduto({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sessao = await exigir();
  const { id } = await params;
  const busca = await searchParams;
  const p = await db.query.produtos.findFirst({
    where: eq(produtos.id, Number(id)),
    with: { embalagens: { orderBy: (e, { asc }) => [asc(e.fator)] }, categoria: true },
  });
  if (!p) notFound();
  const cats = (await db.select({ nome: categorias.nome }).from(categorias)).map((c) => c.nome);
  const editar = pode(sessao, "cadastrar_produto");
  const podePreco = pode(sessao, "alterar_preco");

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="mb-0">{p.descricao}</h1>
        <Link href={`/estoque/${p.id}`} className="btn-neutro ml-auto">Ver estoque e movimentações</Link>
      </div>
      <Aviso busca={busca} />
      {pode(sessao, "ver_custo") && <p className="text-tinta-suave">Custo médio: <b>{reais(p.custoMedio)}</b> por unidade</p>}

      <form action={atualizarProduto} className="card space-y-4">
        <input type="hidden" name="id" value={p.id} />
        <CamposProduto v={{ ...p, categoria: p.categoria?.nome }} categorias={cats} />
        <label className="flex items-center gap-2"><input type="checkbox" name="ativo" defaultChecked={p.ativo} /> Produto ativo</label>
        {editar && <button className="btn-primario">Salvar dados</button>}
      </form>

      <section className="card">
        <h2>Embalagens</h2>
        <p className="mb-3 text-sm text-tinta-suave">Cada forma de vender/comprar tem seu código. O estoque é sempre contado em unidades.</p>
        <div className="space-y-2">
          {[...p.embalagens, null].map((e) => (
            <form key={e?.id ?? "nova"} action={salvarEmbalagem} className={`grid items-end gap-2 rounded-lg border p-2 sm:grid-cols-6 ${e && !e.ativo ? "opacity-50" : ""}`}>
              <input type="hidden" name="produtoId" value={p.id} />
              {e && <input type="hidden" name="embalagemId" value={e.id} />}
              <div>
                <label>Tipo</label>
                <select name="tipo" defaultValue={e?.tipo ?? "CX"} className="campo">
                  <option value="UN">Unidade</option><option value="PACK">Pack</option><option value="FARDO">Fardo</option><option value="CX">Caixa</option>
                </select>
              </div>
              <div><label>Unidades</label><input name="fator" type="number" min={1} defaultValue={e?.fator ?? ""} className="campo" readOnly={!!e} /></div>
              <div className="sm:col-span-2"><label>Código de barras</label><input name="codigoBarras" defaultValue={e?.codigoBarras ?? ""} className="campo font-mono" /></div>
              <div><label>Preço (R$)</label><input name="precoVenda" defaultValue={e ? (e.precoVenda / 100).toFixed(2).replace(".", ",") : ""} className="campo" disabled={!podePreco} /></div>
              <div className="flex items-center gap-2">
                {e && <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="ativo" defaultChecked={e.ativo} /> ativa</label>}
                {editar && <button className="btn-neutro">{e ? "Salvar" : "+ Adicionar"}</button>}
              </div>
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
