/** Ícones de traço (24×24), desenhados aqui para não depender de biblioteca. */
type P = { className?: string };
const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const Icones = {
  inicio: (p: P) => (
    <svg {...base} {...p}><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /><path d="M10 19.5v-5h4v5" /></svg>
  ),
  vender: (p: P) => (
    <svg {...base} {...p}><path d="M4 7h16l-1.5 9.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5L4 7Z" /><path d="M8.5 7V5.5a3.5 3.5 0 0 1 7 0V7" /></svg>
  ),
  vendas: (p: P) => (
    <svg {...base} {...p}><path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2v-17Z" /><path d="M9 8h6M9 11.5h6M9 15h3.5" /></svg>
  ),
  caixa: (p: P) => (
    <svg {...base} {...p}><rect x="3" y="10" width="18" height="10" rx="1.5" /><path d="M3 14.5h18" /><path d="M7 10V5.5h10V10" /><path d="M10 8h4" /><circle cx="12" cy="17.25" r=".6" /></svg>
  ),
  compras: (p: P) => (
    <svg {...base} {...p}><path d="M8 4h8M9 4v2.5M15 4v2.5" /><rect x="4.5" y="6.5" width="15" height="14" rx="1.5" /><path d="M8.5 11.5h7M8.5 15h4.5" /></svg>
  ),
  entrada: (p: P) => (
    <svg {...base} {...p}><path d="M3.5 8 12 4l8.5 4v8.5L12 20.5l-8.5-4V8Z" /><path d="m3.5 8 8.5 4 8.5-4M12 12v8.5" /></svg>
  ),
  estoque: (p: P) => (
    <svg {...base} {...p}><rect x="3.5" y="13" width="7.5" height="7" rx="1" /><rect x="13" y="13" width="7.5" height="7" rx="1" /><rect x="8.25" y="4" width="7.5" height="7" rx="1" /></svg>
  ),
  validade: (p: P) => (
    <svg {...base} {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /><path d="M12 13v3l2 1" /></svg>
  ),
  produtos: (p: P) => (
    <svg {...base} {...p}><path d="M10 3h4v3.5l1.5 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 8.5 20V9L10 6.5V3Z" /><path d="M8.5 12.5h7" /></svg>
  ),
  clientes: (p: P) => (
    <svg {...base} {...p}><circle cx="9" cy="8.5" r="3.5" /><path d="M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5" /><path d="M15.5 5.2a3.3 3.3 0 0 1 0 6.6M17.5 14.8c1.8.7 3 2.5 3.5 5.2" /></svg>
  ),
  fornecedores: (p: P) => (
    <svg {...base} {...p}><path d="M2.5 6.5h11v10h-11z" /><path d="M13.5 10h4l3 3.5v3h-7" /><circle cx="7" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></svg>
  ),
  usuarios: (p: P) => (
    <svg {...base} {...p}><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-4" /></svg>
  ),
  sair: (p: P) => (
    <svg {...base} {...p}><path d="M14 4.5h4.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H14" /><path d="M10 8.5 6.5 12l3.5 3.5M6.5 12H15" /></svg>
  ),
  menu: (p: P) => (
    <svg {...base} {...p}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
  ),
};

export type NomeIcone = keyof typeof Icones;
