type Valores = {
  descricao?: string;
  marca?: string | null;
  categoria?: string | null;
  ncm?: string | null;
  cest?: string | null;
  perecivel?: boolean;
  alcoolico?: boolean;
  estoqueMinimo?: number;
};

export function CamposProduto({ v = {}, categorias }: { v?: Valores; categorias: string[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label>Descrição *</label>
        <input name="descricao" defaultValue={v.descricao} className="campo" required placeholder="Ex.: Cerveja Pilsen Lata 350ml" />
      </div>
      <div>
        <label>Marca</label>
        <input name="marca" defaultValue={v.marca ?? ""} className="campo" />
      </div>
      <div>
        <label>Categoria</label>
        <input name="categoria" defaultValue={v.categoria ?? ""} list="categorias" className="campo" placeholder="Cerveja, Refrigerante…" />
        <datalist id="categorias">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <div>
        <label>Estoque mínimo (unidades)</label>
        <input name="estoqueMinimo" type="number" min={0} defaultValue={v.estoqueMinimo ?? 0} className="campo" />
      </div>
      <div className="flex items-end gap-6 pb-2">
        <label className="flex items-center gap-2"><input type="checkbox" name="perecivel" defaultChecked={v.perecivel ?? true} /> Controla validade</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="alcoolico" defaultChecked={v.alcoolico ?? false} /> Alcoólico 🔞</label>
      </div>
      <details className="sm:col-span-2">
        <summary className="cursor-pointer text-sm text-tinta-suave">Dados fiscais (opcional por enquanto)</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div><label>NCM</label><input name="ncm" defaultValue={v.ncm ?? ""} className="campo" maxLength={10} /></div>
          <div><label>CEST</label><input name="cest" defaultValue={v.cest ?? ""} className="campo" maxLength={9} /></div>
        </div>
      </details>
    </div>
  );
}
