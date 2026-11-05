"use client";

export function Imprimir() {
  return (
    <button type="button" className="btn-neutro" onClick={() => window.print()}>
      Imprimir
    </button>
  );
}
