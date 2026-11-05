import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { DB } from "@/db";
import { adicionarItemEntrada, saldoVendavel } from "@/lib/estoque";
import { compararComNota, finalizarEntradaConferida, importarNfe, lerNfe, vincularItemNota } from "@/lib/nfe";
import { bancoDeTeste, criarCerveja } from "./helpers";

const XML = readFileSync("exemplos/nfe-exemplo.xml", "utf8");
let db: DB;
let usuarioId: number;
let fechar: () => Promise<void>;

beforeEach(async () => {
  ({ db, usuarioId, fechar } = await bancoDeTeste());
});
afterEach(async () => fechar());

async function criarRefri() {
  const [p] = await db.insert(schema.produtos).values({ descricao: "Refrigerante Cola 2L" }).returning();
  const [un] = await db.insert(schema.embalagens).values({ produtoId: p.id, tipo: "UN", codigoBarras: "7890000000024", fator: 1, precoVenda: 1099 }).returning();
  const [fd] = await db.insert(schema.embalagens).values({ produtoId: p.id, tipo: "FARDO", codigoBarras: null, fator: 6, precoVenda: 6000 }).returning();
  return { produto: p, un, fd };
}

/** Cerveja com os mesmos códigos do XML de exemplo (lata 7890000000017, caixa 17890000000014). */
async function criarCervejaDemo() {
  const c = await criarCerveja(db);
  await db.update(schema.embalagens).set({ codigoBarras: "7890000000017" }).where(eq(schema.embalagens.id, c.un.id));
  await db.update(schema.embalagens).set({ codigoBarras: "17890000000014" }).where(eq(schema.embalagens.id, c.cx.id));
  return c;
}

describe("leitura do XML", () => {
  it("extrai chave, emitente, itens, GTIN e rastro", () => {
    const n = lerNfe(XML);
    expect(n.chave).toHaveLength(44);
    expect(n.numero).toBe("4567");
    expect(n.emitente).toEqual({ cnpj: "12345678000195", nome: "Bebidas Exemplo Atacado LTDA" });
    expect(n.itens).toHaveLength(3);
    expect(n.itens[0]).toMatchObject({ codigo: "CERV-350-CX12", ean: "17890000000014", quantidade: 5, valorTotal: 19200, lote: "L2611A" });
    expect(n.itens[1]).toMatchObject({ ean: null, eanTrib: "7890000000024", quantidadeTrib: 12, unidade: "FD" });
  });
  it("recusa arquivo que não é NF-e", () => {
    expect(() => lerNfe("<html></html>")).toThrow(/NF-e/);
  });
});

describe("importação e conferência cega", () => {
  it("vincula por código de barras, compara com o contado e finaliza com custo da nota", async () => {
    const { produto: cerveja, cx } = await criarCervejaDemo();
    const { produto: refri, un: refriUn } = await criarRefri();
    const [e] = await db.insert(schema.entradas).values({ usuarioId }).returning();

    const r = await importarNfe(db, e.id, XML, usuarioId);
    expect(r).toMatchObject({ itens: 3, vinculados: 2, numero: "4567" });
    const [ent] = await db.select().from(schema.entradas).where(eq(schema.entradas.id, e.id));
    expect(ent.fornecedorId).not.toBeNull();

    // estoquista conta: cerveja certa, refrigerante faltando 2
    await adicionarItemEntrada(db, e.id, { embalagemId: cx.id, quantidadeEmbalagens: 5, validade: "2027-03-15" });
    await adicionarItemEntrada(db, e.id, { embalagemId: refriUn.id, quantidadeEmbalagens: 10, validade: "2027-01-19" });

    let comp = await compararComNota(db, e.id);
    expect(comp.pendentes.map((p) => p.descricao)).toEqual(["ENERGETICO TROPICAL LATA 250ML"]);
    expect(comp.linhas.find((l) => l.produtoId === cerveja.id)).toMatchObject({ naNota: 60, contado: 60, situacao: "ok" });
    expect(comp.linhas.find((l) => l.produtoId === refri.id)).toMatchObject({ naNota: 12, contado: 10, diferenca: -2, situacao: "falta" });
    expect(comp.divergencias).toBe(2);

    await expect(finalizarEntradaConferida(db, e.id, usuarioId)).rejects.toThrow(/divergência/);
    await finalizarEntradaConferida(db, e.id, usuarioId, { confirmarDivergencia: true });

    expect(await saldoVendavel(db, cerveja.id, "2026-11-05")).toBe(60);
    const [c] = await db.select().from(schema.produtos).where(eq(schema.produtos.id, cerveja.id));
    expect(c.custoMedio).toBe(320); // R$ 192,00 / 60 latas
    const log = await db.select().from(schema.logAuditoria);
    expect(log.map((l) => l.acao)).toContain("finalizar_entrada_com_divergencia");
  });

  it("vínculo manual é lembrado na próxima nota do mesmo fornecedor", async () => {
    await criarCervejaDemo();
    await criarRefri();
    const [energ] = await db.insert(schema.produtos).values({ descricao: "Energético 250ml" }).returning();
    const [energUn] = await db.insert(schema.embalagens).values({ produtoId: energ.id, tipo: "UN", codigoBarras: null, fator: 1, precoVenda: 700 }).returning();

    const [e1] = await db.insert(schema.entradas).values({ usuarioId }).returning();
    await importarNfe(db, e1.id, XML, usuarioId);
    const pend = (await compararComNota(db, e1.id)).pendentes[0];
    await vincularItemNota(db, pend.id, energUn.id, 1, usuarioId);
    expect((await compararComNota(db, e1.id)).pendentes).toHaveLength(0);

    // mesma nota não pode ser importada em outra entrada
    const [e2] = await db.insert(schema.entradas).values({ usuarioId }).returning();
    await expect(importarNfe(db, e2.id, XML, usuarioId)).rejects.toThrow(/já foi importada/);

    // outra nota do mesmo fornecedor (chave diferente) já vem vinculada
    const outra = XML.replaceAll("52261112345678000195550010000045671000045678", "52261112345678000195550010000045681000045679");
    const r = await importarNfe(db, e2.id, outra, usuarioId);
    expect(r.vinculados).toBe(3);
  });
});
