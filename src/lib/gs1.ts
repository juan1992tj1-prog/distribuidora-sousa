/**
 * Interpreta o que o leitor (USB ou câmera) entregou.
 *
 * Aceita:
 *  - EAN-8 / UPC-A / EAN-13 / GTIN-14 "puros"          → 7891234567895
 *  - GS1-128 / DataMatrix com separador FNC1 (GS, \x1d) → 0107891234567895172712311 0L123
 *  - Formato legível com parênteses                    → (01)07891234567895(17)271231(10)L123
 *  - GS1 Digital Link (QR code com URL)                 → https://x.com/01/07891234567895/10/L123?17=271231
 *
 * Retorna GTIN, lote e validade quando presentes.
 */

export type LeituraGs1 = {
  bruto: string;
  gtin?: string;
  lote?: string;
  validade?: string; // AAAA-MM-DD
  quantidade?: number;
  /** true quando o código veio no padrão GS1 com dados além do GTIN */
  estruturado: boolean;
};

const GS = "\x1d";

/** Tamanho fixo dos AIs mais comuns. AIs ausentes daqui são de tamanho variável (terminam no GS). */
const AI_FIXO: Record<string, number> = {
  "00": 18,
  "01": 14,
  "02": 14,
  "11": 6,
  "12": 6,
  "13": 6,
  "15": 6,
  "16": 6,
  "17": 6,
  "20": 2,
};

/** AIs de 4 dígitos com 6 dígitos de valor (pesos e medidas: 310n…369n). */
function ehAiMedida(prefixo: string) {
  const n = Number(prefixo.slice(0, 2));
  return n >= 31 && n <= 36;
}

/** Converte AAMMDD do GS1 para AAAA-MM-DD. Dia "00" significa último dia do mês. */
export function dataGs1ParaIso(aammdd: string): string | undefined {
  if (!/^\d{6}$/.test(aammdd)) return undefined;
  const ano = 2000 + Number(aammdd.slice(0, 2));
  const mes = Number(aammdd.slice(2, 4));
  let dia = Number(aammdd.slice(4, 6));
  if (mes < 1 || mes > 12) return undefined;
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (dia === 0) dia = ultimoDia;
  if (dia > ultimoDia) return undefined;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Valida o dígito verificador de um GTIN (8, 12, 13 ou 14 dígitos). */
export function gtinValido(codigo: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(codigo)) return false;
  const digitos = codigo.split("").map(Number);
  const dv = digitos.pop()!;
  const soma = digitos
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === dv;
}

/**
 * Formas equivalentes de um mesmo GTIN para buscar no cadastro.
 * Ex.: o QR traz "07891234567895" (14 dígitos) e o cadastro tem "7891234567895" (EAN-13).
 */
export function variacoesGtin(codigo: string): string[] {
  const limpo = codigo.replace(/\D/g, "");
  const semZeros = limpo.replace(/^0+/, "");
  const set = new Set<string>([limpo]);
  for (const tam of [8, 12, 13, 14]) {
    if (semZeros.length <= tam) set.add(semZeros.padStart(tam, "0"));
  }
  return [...set];
}

function aplicarAi(res: LeituraGs1, ai: string, valor: string) {
  if (ai === "01" || ai === "02") res.gtin = valor;
  else if (ai === "10") res.lote = valor;
  else if (ai === "17" || (ai === "15" && !res.validade)) res.validade = dataGs1ParaIso(valor);
  else if (ai === "37") res.quantidade = Number(valor);
}

function lerElementString(dados: string, res: LeituraGs1) {
  let i = 0;
  while (i < dados.length) {
    if (dados[i] === GS) {
      i++;
      continue;
    }
    const ai2 = dados.slice(i, i + 2);
    let ai: string;
    let tamanho: number | undefined;
    if (AI_FIXO[ai2] !== undefined) {
      ai = ai2;
      tamanho = AI_FIXO[ai2];
    } else if (ehAiMedida(ai2)) {
      ai = dados.slice(i, i + 4);
      tamanho = 6;
    } else if (["10", "21", "22", "37", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99"].includes(ai2)) {
      ai = ai2;
    } else {
      // AI de 3 ou 4 dígitos variável (ex.: 240, 400…): tenta 3, termina no GS
      ai = dados.slice(i, i + 3);
    }
    i += ai.length;
    let valor: string;
    if (tamanho !== undefined) {
      valor = dados.slice(i, i + tamanho);
      i += tamanho;
    } else {
      const fim = dados.indexOf(GS, i);
      valor = fim === -1 ? dados.slice(i) : dados.slice(i, fim);
      i = fim === -1 ? dados.length : fim + 1;
    }
    aplicarAi(res, ai, valor);
  }
}

export function lerCodigo(entrada: string): LeituraGs1 {
  // Remove identificadores de simbologia (]C1, ]d2, ]Q3, ]e0) e espaços das pontas.
  let bruto = entrada.trim().replace(/^\][A-Za-z]\d/, "");
  const res: LeituraGs1 = { bruto, estruturado: false };

  // 1) GS1 Digital Link (QR code com URL)
  if (/^https?:\/\//i.test(bruto)) {
    try {
      const url = new URL(bruto);
      const partes = url.pathname.split("/").filter(Boolean);
      for (let k = 0; k < partes.length - 1; k++) {
        if (/^\d{2,4}$/.test(partes[k])) aplicarAi(res, partes[k], decodeURIComponent(partes[k + 1]));
      }
      url.searchParams.forEach((valor, chave) => {
        if (/^\d{2,4}$/.test(chave)) aplicarAi(res, chave, valor);
      });
      res.estruturado = Boolean(res.gtin);
      return res;
    } catch {
      return res;
    }
  }

  // 2) Formato legível com parênteses
  if (bruto.startsWith("(")) {
    const re = /\((\d{2,4})\)([^(]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(bruto))) aplicarAi(res, m[1], m[2]);
    res.estruturado = Boolean(res.gtin);
    return res;
  }

  // 3) Código só com números do tamanho de um GTIN → EAN/UPC comum
  if (/^\d+$/.test(bruto) && [8, 12, 13, 14].includes(bruto.length) && !bruto.includes(GS)) {
    // Um "01" + 14 dígitos teria 16 caracteres, então aqui é GTIN puro.
    res.gtin = bruto;
    return res;
  }

  // 4) Element string GS1 (começa com AI, ex.: 01…, 00…)
  if (/^\d{2}/.test(bruto)) {
    lerElementString(bruto, res);
    res.estruturado = Boolean(res.gtin || res.lote || res.validade);
    return res;
  }

  return res;
}
