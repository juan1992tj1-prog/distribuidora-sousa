import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { DB } from "@/db";
import { adicionarItemEntrada } from "@/lib/estoque";
import {
  chaveNfeValida,
  extrairNota,
  montarRequisicao,
  validarExtracao,
  type ChamarModelo,
  type RequisicaoModelo,
} from "@/lib/ia-nota";
import { codigoPorDescricao, compararComNota, importarNotaLidaPorIa, vincularItemNota } from "@/lib/nfe";
import { bancoDeTeste, criarCerveja } from "./helpers";

// chave fictícia com dígito verificador correto (módulo 11)
const CHAVE = "52261112345678000195550010000045671000045670";

/** Simula a API: devolve o "tool_use" com a nota, como o modelo faria. Guarda a requisição. */
function modeloFalso(nota: unknown) {
  const chamadas: RequisicaoModelo[] = [];
  const chamar: ChamarModelo = async (req) => {
    chamadas.push(req);
    return { content: [{ type: "tool_use", name: "registrar_itens_da_nota", input: nota }] };
  };
  return { chamar, chamadas };
}

const RESPOSTA_DANFE = {
  chave_acesso: CHAVE,
  numero_nota: "4567",
  emitente_nome: "Bebidas Exemplo Atacado LTDA",
  emitente_cnpj: "12.345.678/0001-95",
  itens: [
    { codigo: "CERV-350-CX12", ean: "17891234567892", descricao: "CERVEJA LATA 350ML CX 12", unidade: "cx", quantidade: 5, valor_total: 192, lote: "l2611a", validade: "2027-03-15" },
    { codigo: null, ean: null, descricao: "Energético Tropical 250ml", unidade: "UN", quantidade: 24, valor_total: 120.5, lote: null, validade: "15/01/2027" },
  ],
  observacoes: [],
};

describe("validação da resposta da IA", () => {
  it("converte valores para centavos, padroniza unidade/lote e aceita data brasileira", () => {
    const n = validarExtracao(RESPOSTA_DANFE);
    expect(n.chave).toBe(CHAVE);
    expect(n.emitente).toEqual({ cnpj: "12345678000195", nome: "Bebidas Exemplo Atacado LTDA" });
    expect(n.itens[0]).toMatchObject({ unidade: "CX", valorTotal: 19200, lote: "L2611A", ean: "17891234567892" });
    expect(n.itens[1]).toMatchObject({ valorTotal: 12050, validade: "2027-01-15", codigo: null });
  });

  it("descarta o que a IA pode ter inventado ou lido errado, avisando o gerente", () => {
    const n = validarExtracao({
      chave_acesso: CHAVE.slice(0, 43) + "9", // dígito verificador errado
      itens: [
        { descricao: "Cerveja", quantidade: 2, ean: "7891234567890", validade: "2027-02-30" }, // EAN e data inválidos
        { descricao: "Linha sem quantidade", quantidade: 0 },
        { quantidade: 3 }, // sem descrição
      ],
    });
    expect(n.chave).toBeNull();
    expect(n.itens).toHaveLength(1);
    expect(n.itens[0]).toMatchObject({ ean: null, validade: null, quantidade: 2 });
    expect(n.observacoes.join(" ")).toMatch(/dígito verificador/);
    expect(n.observacoes.join(" ")).toMatch(/data inválida/);
    expect(n.observacoes.join(" ")).toMatch(/quantidade inválida/);
  });

  it("recusa resposta sem nenhum produto", () => {
    expect(() => validarExtracao({ itens: [] })).toThrow(/nenhum produto/);
    expect(() => validarExtracao({ texto: "oi" })).toThrow(/formato/);
  });

  it("confere o dígito verificador da chave de acesso", () => {
    expect(chaveNfeValida(CHAVE)).toBe(true);
    expect(chaveNfeValida(CHAVE.slice(0, 43) + "1")).toBe(false);
    expect(chaveNfeValida("123")).toBe(false);
  });
});

describe("requisição ao modelo", () => {
  it("obriga resposta estruturada (tool use) e envia PDF como documento", () => {
    const req = montarRequisicao({ tipo: "pdf", base64: "JVBERi0=" }, "modelo-teste") as {
      model: string;
      tool_choice: { type: string; name: string };
      messages: { content: { type: string }[] }[];
    };
    expect(req.model).toBe("modelo-teste");
    expect(req.tool_choice).toEqual({ type: "tool", name: "registrar_itens_da_nota" });
    expect(req.messages[0].content.map((c) => c.type)).toEqual(["document", "text"]);
  });

  it("falha com mensagem clara quando a IA não devolve a ferramenta", async () => {
    const chamar: ChamarModelo = async () => ({ content: [{ type: "text", text: "não sei" }] });
    await expect(extrairNota({ tipo: "texto", texto: "5 cx cerveja lata" }, chamar)).rejects.toThrow(/não conseguiu ler/);
  });
});

describe("importação da nota lida por IA", () => {
  let db: DB;
  let usuarioId: number;
  let fechar: () => Promise<void>;
  beforeEach(async () => {
    ({ db, usuarioId, fechar } = await bancoDeTeste());
  });
  afterEach(async () => fechar());

  it("entra na conferência cega: vincula pelo EAN e aponta o que falta", async () => {
    const { produto: cerveja, cx } = await criarCerveja(db);
    const [e] = await db.insert(schema.entradas).values({ usuarioId }).returning();
    const { chamar, chamadas } = modeloFalso(RESPOSTA_DANFE);

    const nota = await extrairNota({ tipo: "texto", texto: "DANFE colado pelo gerente..." }, chamar);
    const r = await importarNotaLidaPorIa(db, e.id, nota, usuarioId, "modelo-teste");
    expect(chamadas).toHaveLength(1);
    expect(r).toMatchObject({ itens: 2, vinculados: 1, numero: "4567" });

    const [ent] = await db.select().from(schema.entradas).where(eq(schema.entradas.id, e.id));
    expect(ent.chaveNfe).toBe(CHAVE);

    // estoquista bipa 4 caixas em vez de 5: a divergência aparece para o gerente
    await adicionarItemEntrada(db, e.id, { embalagemId: cx.id, quantidadeEmbalagens: 4, validade: "2027-03-15" });
    const comp = await compararComNota(db, e.id);
    expect(comp.linhas.find((l) => l.produtoId === cerveja.id)).toMatchObject({ naNota: 60, contado: 48, situacao: "falta" });
    expect(comp.pendentes.map((p) => p.descricao)).toEqual(["Energético Tropical 250ml"]);

    const log = await db.select().from(schema.logAuditoria);
    expect(log.find((l) => l.acao === "importar_nota_ia")?.detalhes).toMatchObject({ modelo: "modelo-teste", itens: 2 });
  });

  it("item sem código é lembrado pela descrição na próxima nota do fornecedor", async () => {
    await criarCerveja(db);
    const [energ] = await db.insert(schema.produtos).values({ descricao: "Energético 250ml" }).returning();
    const [energUn] = await db.insert(schema.embalagens).values({ produtoId: energ.id, tipo: "UN", fator: 1, precoVenda: 700 }).returning();

    const [e1] = await db.insert(schema.entradas).values({ usuarioId }).returning();
    await importarNotaLidaPorIa(db, e1.id, validarExtracao(RESPOSTA_DANFE), usuarioId, "m");
    const pend = (await compararComNota(db, e1.id)).pendentes[0];
    expect(pend.codigoFornecedor).toBe(codigoPorDescricao("Energético Tropical 250ml"));
    await vincularItemNota(db, pend.id, energUn.id, 1, usuarioId);

    // pedido seguinte (sem chave, escrito com outra acentuação) já vem todo reconhecido
    const [e2] = await db.insert(schema.entradas).values({ usuarioId }).returning();
    const pedido = validarExtracao({ ...RESPOSTA_DANFE, chave_acesso: null, itens: [{ ...RESPOSTA_DANFE.itens[1], descricao: "ENERGETICO TROPICAL 250ML" }] });
    const r = await importarNotaLidaPorIa(db, e2.id, pedido, usuarioId, "m");
    expect(r.vinculados).toBe(1);
  });

  it("não deixa importar a mesma NF-e duas vezes, mesmo lida por IA", async () => {
    const nota = validarExtracao(RESPOSTA_DANFE);
    const [e1] = await db.insert(schema.entradas).values({ usuarioId }).returning();
    const [e2] = await db.insert(schema.entradas).values({ usuarioId }).returning();
    await importarNotaLidaPorIa(db, e1.id, nota, usuarioId, "m");
    await expect(importarNotaLidaPorIa(db, e2.id, nota, usuarioId, "m")).rejects.toThrow(/já foi importada/);
  });

  it("pedido sem CNPJ usa o fornecedor escolhido na entrada", async () => {
    const [forn] = await db.insert(schema.fornecedores).values({ nome: "Distribuidora do Zé" }).returning();
    const [e] = await db.insert(schema.entradas).values({ usuarioId, fornecedorId: forn.id }).returning();
    const pedido = validarExtracao({ itens: [{ descricao: "Água mineral 500ml", quantidade: 2, unidade: "FD" }] });
    await importarNotaLidaPorIa(db, e.id, pedido, usuarioId, "m");
    const [ent] = await db.select().from(schema.entradas).where(eq(schema.entradas.id, e.id));
    expect(ent.fornecedorId).toBe(forn.id);
    expect(await db.select().from(schema.fornecedores)).toHaveLength(1);
  });
});
