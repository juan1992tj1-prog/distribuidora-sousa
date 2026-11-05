"use client";
import { useState } from "react";

/** Copia o pedido em texto simples, pronto para colar no WhatsApp do vendedor. */
export function CopiarPedido({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      // sem HTTPS o navegador bloqueia a área de transferência: usa o jeito antigo
      const area = document.createElement("textarea");
      area.value = texto;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  }
  return (
    <button type="button" className="btn-neutro py-1.5" onClick={copiar}>
      {copiado ? "Copiado ✓" : "Copiar pedido"}
    </button>
  );
}
