/** Utilitários de dinheiro e datas. Tudo pensado para o fuso de Brasília. */

export const FUSO = process.env.TZ_LOJA ?? "America/Sao_Paulo";

/** 1234 → "R$ 12,34" */
export function reais(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "12,34" | "12.34" | "1.234,56" → 1234 (centavos). Retorna null se inválido. */
export function paraCentavos(texto: string | null | undefined): number | null {
  if (texto == null) return null;
  const limpo = String(texto).trim().replace(/[R$\s]/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normalizado);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Data de hoje (AAAA-MM-DD) no fuso da loja. */
export function hojeIso(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(agora);
}

/** Dias entre hoje e a data (negativo = já passou). */
export function diasAte(dataIso: string, hoje = hojeIso()): number {
  const a = Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1, +hoje.slice(8, 10));
  const b = Date.UTC(+dataIso.slice(0, 4), +dataIso.slice(5, 7) - 1, +dataIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function somarDias(dataIso: string, dias: number): string {
  const d = new Date(`${dataIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** "2026-12-31" → "31/12/2026" */
export function dataBr(dataIso: string | null | undefined): string {
  if (!dataIso) return "—";
  const [a, m, d] = dataIso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** "311226" ou "31/12/26" ou "31/12/2026" → "2026-12-31" (digitação rápida de validade). */
export function validadeDigitada(texto: string): string | null {
  const so = texto.replace(/\D/g, "");
  let d: string, m: string, a: string;
  if (so.length === 6) [d, m, a] = [so.slice(0, 2), so.slice(2, 4), "20" + so.slice(4, 6)];
  else if (so.length === 8) [d, m, a] = [so.slice(0, 2), so.slice(2, 4), so.slice(4, 8)];
  else return null;
  const iso = `${a}-${m}-${d}`;
  const dt = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

export function dataHoraBr(d: Date | string): string {
  return new Date(d).toLocaleString("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" });
}
