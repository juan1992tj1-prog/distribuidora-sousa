/**
 * Leitura de nota com Inteligência Artificial, para quando o fornecedor NÃO manda o XML.
 *
 * Na prática, muita distribuidora pequena recebe só o PDF/foto do DANFE ou um pedido
 * digitado no WhatsApp. Antes, o gerente tinha que digitar tudo. Agora:
 *
 *  1. o gerente envia o PDF, a foto ou cola o texto;
 *  2. um modelo de linguagem (LLM, via API da Anthropic) devolve os itens em formato
 *     estruturado — usamos "tool use" com um JSON Schema, então a resposta vem como dados,
 *     não como texto livre;
 *  3. o sistema NÃO confia cegamente na IA: valida tudo (zod), descarta código de barras
 *     com dígito verificador errado, data impossível e quantidade inválida;
 *  4. os itens entram no MESMO fluxo da NF-e em XML: vínculo com o cadastro e conferência
 *     cega. O estoquista bipa o que chegou e qualquer erro da IA aparece como divergência.
 *
 * A chamada ao modelo é injetável (parâmetro `chamarModelo`), então os testes rodam sem
 * internet e sem custo, com respostas simuladas.
 */
import { z } from "zod";
import { ErroNegocio } from "./erros";
import { gtinValido } from "./gs1";

// ---------------------------------------------------------------- formato da resposta

/** Nota já validada, pronta para virar itens da entrada. Valores em centavos. */
export type NotaExtraida = {
  chave: string | null;
  numero: string | null;
  emitente: { cnpj: string; nome: string };
  itens: ItemExtraido[];
  observacoes: string[];
};

export type ItemExtraido = {
  codigo: string | null;
  ean: string | null;
  descricao: string;
  unidade: string;
  quantidade: number;
  valorTotal: number; // centavos
  lote: string | null;
  validade: string | null; // AAAA-MM-DD
};

/** JSON Schema que o modelo é obrigado a seguir (vai na definição da ferramenta). */
export const ESQUEMA_NOTA = {
  type: "object",
  properties: {
    chave_acesso: { type: ["string", "null"], description: "Chave de acesso da NF-e com 44 dígitos, se aparecer no documento." },
    numero_nota: { type: ["string", "null"], description: "Número da nota ou do pedido." },
    emitente_nome: { type: ["string", "null"], description: "Razão social ou nome do fornecedor." },
    emitente_cnpj: { type: ["string", "null"], description: "CNPJ do fornecedor, só números." },
    itens: {
      type: "array",
      description: "Um elemento por linha de produto do documento, na ordem em que aparecem.",
      items: {
        type: "object",
        properties: {
          codigo: { type: ["string", "null"], description: "Código do produto no fornecedor (coluna 'código')." },
          ean: { type: ["string", "null"], description: "Código de barras (EAN/GTIN) se aparecer. Nunca invente." },
          descricao: { type: "string" },
          unidade: { type: ["string", "null"], description: "Unidade comercial: UN, CX, FD, PCT..." },
          quantidade: { type: "number", description: "Quantidade na unidade comercial." },
          valor_total: { type: ["number", "null"], description: "Valor total do item em reais (ex.: 192.5)." },
          lote: { type: ["string", "null"] },
          validade: { type: ["string", "null"], description: "Data de validade no formato AAAA-MM-DD." },
        },
        required: ["descricao", "quantidade"],
      },
    },
    observacoes: {
      type: "array",
      items: { type: "string" },
      description: "Trechos ilegíveis ou dúvidas sobre a leitura, para o gerente conferir.",
    },
  },
  required: ["itens"],
} as const;

const textoOpcional = z
  .string()
  .nullish()
  .transform((v) => (v ?? "").trim() || null);

const ItemBruto = z.object({
  codigo: textoOpcional,
  ean: textoOpcional,
  descricao: z.string().trim().min(1),
  unidade: textoOpcional,
  quantidade: z.coerce.number(),
  valor_total: z.coerce.number().nullish(),
  lote: textoOpcional,
  validade: textoOpcional,
});

const NotaBruta = z.object({
  chave_acesso: textoOpcional,
  numero_nota: textoOpcional,
  emitente_nome: textoOpcional,
  emitente_cnpj: textoOpcional,
  itens: z.array(z.unknown()),
  observacoes: z.array(z.string()).nullish(),
});

// ---------------------------------------------------------------- validação

/** Dígito verificador da chave de acesso (módulo 11, pesos 2 a 9). */
export function chaveNfeValida(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false;
  let soma = 0;
  let peso = 2;
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return dv === Number(chave[43]);
}

function dataValida(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) ?? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (!m) return null;
  const [ano, mes, dia] = m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
  const iso = `${ano}-${mes}-${dia}`;
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * Transforma a resposta do modelo em dados confiáveis. O que não passa na validação é
 * descartado (e anotado em `observacoes`), nunca "corrigido" por chute.
 */
export function validarExtracao(bruto: unknown): NotaExtraida {
  const nota = NotaBruta.safeParse(bruto);
  if (!nota.success) throw new ErroNegocio("A IA devolveu uma resposta fora do formato esperado. Tente de novo.");
  const observacoes = [...(nota.data.observacoes ?? [])];

  const itens: ItemExtraido[] = [];
  nota.data.itens.forEach((linha, i) => {
    const r = ItemBruto.safeParse(linha);
    if (!r.success) {
      observacoes.push(`Linha ${i + 1} ignorada: dados incompletos.`);
      return;
    }
    const it = r.data;
    if (!(it.quantidade > 0) || !Number.isFinite(it.quantidade)) {
      observacoes.push(`"${it.descricao}" ignorado: quantidade inválida.`);
      return;
    }
    const ean = it.ean?.replace(/\D/g, "") ?? "";
    if (ean && !gtinValido(ean)) observacoes.push(`Código de barras de "${it.descricao}" descartado: dígito verificador não confere.`);
    const validade = dataValida(it.validade);
    if (it.validade && !validade) observacoes.push(`Validade de "${it.descricao}" descartada: data inválida (${it.validade}).`);
    itens.push({
      codigo: it.codigo?.slice(0, 60) ?? null,
      ean: ean && gtinValido(ean) ? ean : null,
      descricao: it.descricao.slice(0, 200),
      unidade: (it.unidade ?? "UN").toUpperCase().slice(0, 10),
      quantidade: it.quantidade,
      valorTotal: Math.max(0, Math.round((it.valor_total ?? 0) * 100)),
      lote: it.lote?.toUpperCase().slice(0, 40) ?? null,
      validade,
    });
  });
  if (itens.length === 0) throw new ErroNegocio("A IA não encontrou nenhum produto no documento.");
  if (itens.length > 300) throw new ErroNegocio("Documento com itens demais para uma entrada (máximo 300).");

  const chave = nota.data.chave_acesso?.replace(/\D/g, "") ?? "";
  if (chave && !chaveNfeValida(chave)) observacoes.push("Chave de acesso lida não confere com o dígito verificador; foi ignorada.");

  return {
    chave: chave && chaveNfeValida(chave) ? chave : null,
    numero: nota.data.numero_nota?.slice(0, 20) ?? null,
    emitente: {
      cnpj: (nota.data.emitente_cnpj ?? "").replace(/\D/g, "").slice(0, 14),
      nome: nota.data.emitente_nome ?? "Fornecedor (lido pela IA)",
    },
    itens,
    observacoes,
  };
}

// ---------------------------------------------------------------- chamada ao modelo

export type Documento =
  | { tipo: "texto"; texto: string }
  | { tipo: "pdf"; base64: string }
  | { tipo: "imagem"; base64: string; mime: "image/jpeg" | "image/png" | "image/webp" };

/** Corpo da requisição à API de Mensagens da Anthropic. */
export type RequisicaoModelo = Record<string, unknown>;
/** Função que envia a requisição e devolve o JSON da resposta (injetável nos testes). */
export type ChamarModelo = (requisicao: RequisicaoModelo) => Promise<unknown>;

export const MODELO_PADRAO = process.env.IA_MODELO || "claude-haiku-5-5";
const FERRAMENTA = "registrar_itens_da_nota";

const INSTRUCOES = `Você lê notas fiscais (DANFE), pedidos e romaneios de fornecedores de bebidas para uma distribuidora.
Extraia cada produto exatamente como está no documento. Regras:
- Não invente nada: se um campo não aparece, use null.
- Quantidade na unidade comercial da linha (ex.: 5 caixas = quantidade 5, unidade CX).
- Valores em reais com ponto decimal (R$ 1.234,56 vira 1234.56).
- Datas no formato AAAA-MM-DD.
- Ignore totais, impostos, frete e linhas que não são produtos.
- Anote em "observacoes" qualquer trecho ilegível ou duvidoso.`;

export function montarRequisicao(doc: Documento, modelo = MODELO_PADRAO): RequisicaoModelo {
  const conteudo: unknown[] = [];
  if (doc.tipo === "pdf") conteudo.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.base64 } });
  if (doc.tipo === "imagem") conteudo.push({ type: "image", source: { type: "base64", media_type: doc.mime, data: doc.base64 } });
  conteudo.push({
    type: "text",
    text: doc.tipo === "texto" ? `Documento do fornecedor:\n\n${doc.texto}` : "Extraia os itens deste documento do fornecedor.",
  });
  return {
    model: modelo,
    max_tokens: 8000,
    system: INSTRUCOES,
    tools: [{ name: FERRAMENTA, description: "Registra os itens lidos do documento do fornecedor.", input_schema: ESQUEMA_NOTA }],
    tool_choice: { type: "tool", name: FERRAMENTA }, // obriga a resposta estruturada
    messages: [{ role: "user", content: conteudo }],
  };
}

/** Chamada real à API (usa ANTHROPIC_API_KEY). */
export const chamarAnthropic: ChamarModelo = async (requisicao) => {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) throw new ErroNegocio("A leitura com IA não está configurada (falta ANTHROPIC_API_KEY no .env).");
  // IA_URL permite apontar para um servidor simulado em testes/demonstração local
  const resp = await fetch(process.env.IA_URL || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": chave, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(requisicao),
    signal: AbortSignal.timeout(90_000),
  });
  if (resp.status === 429) throw new ErroNegocio("Limite de uso da IA atingido. Tente de novo em alguns minutos.");
  if (!resp.ok) throw new ErroNegocio(`O serviço de IA respondeu com erro (${resp.status}). Tente de novo ou importe o XML.`);
  return resp.json();
};

/** Envia o documento ao modelo e devolve a nota validada. */
export async function extrairNota(doc: Documento, chamarModelo: ChamarModelo = chamarAnthropic): Promise<NotaExtraida> {
  if (doc.tipo === "texto" && doc.texto.trim().length < 10) throw new ErroNegocio("Cole o texto da nota ou do pedido.");
  const resposta = (await chamarModelo(montarRequisicao(doc))) as { content?: { type: string; name?: string; input?: unknown }[] };
  const uso = resposta?.content?.find((c) => c.type === "tool_use" && c.name === FERRAMENTA);
  if (!uso) throw new ErroNegocio("A IA não conseguiu ler o documento. Tente uma foto mais nítida ou importe o XML.");
  return validarExtracao(uso.input);
}
