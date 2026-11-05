import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { DB } from "@/db";
import { adicionarItemEntrada, cancelarVenda, finalizarEntrada, registrarVenda } from "@/lib/estoque";
import { abrirCaixa } from "@/lib/caixa";
import { calcularSugestao, sugestaoDeCompra } from "@/lib/compras";
import { bancoDeTeste, criarCerveja } from "./helpers";

describe("calcularSugestao", () => {
  it("pede o que falta para cobrir o período, arredondando na caixa", () => {
    // vendeu 60 em 30 dias = 2/dia; 15 dias de cobertura = 30; + mínimo 12 = alvo 42; tem 10 → faltam 32 → 3 cx de 12
    const s = calcularSugestao({ vendidoNoPeriodo: 60, diasPeriodo: 30, estoque: 10, estoqueMinimo: 12, diasCobertura: 15, fatorCompra: 12 });
    expect(s.mediaDiaria).toBe(2);
    expect(s.coberturaDias).toBe(5);
    expect(s.alvo).toBe(42);
    expect(s.embalagens).toBe(3);
    expect(s.unidades).toBe(36);
  });

  it("não sugere nada quando o estoque já cobre", () => {
    const s = calcularSugestao({ vendidoNoPeriodo: 30, diasPeriodo: 30, estoque: 100, estoqueMinimo: 10, diasCobertura: 15, fatorCompra: 6 });
    expect(s.embalagens).toBe(0);
  });

  it("sem vendas, repõe só até o mínimo", () => {
    const s = calcularSugestao({ vendidoNoPeriodo: 0, diasPeriodo: 30, estoque: 2, estoqueMinimo: 6, diasCobertura: 15, fatorCompra: 1 });
    expect(s.coberturaDias).toBeNull();
    expect(s.unidades).toBe(4);
  });
});

describe("sugestaoDeCompra (banco)", () => {
  let db: DB;
  let usuarioId: number;
  let fechar: () => Promise<void>;
  beforeEach(async () => {
    ({ db, usuarioId, fechar } = await bancoDeTeste());
  });
  afterEach(async () => fechar());

  it("usa vendas líquidas, ignora vencido e traz o último fornecedor e custo", async () => {
    const { produto, un, cx } = await criarCerveja(db, { estoqueMinimo: 12 });
    const [forn] = await db.insert(schema.fornecedores).values({ nome: "Ambev Distribuição" }).returning();
    const [e] = await db.insert(schema.entradas).values({ usuarioId, fornecedorId: forn.id }).returning();
    await adicionarItemEntrada(db, e.id, { embalagemId: cx.id, quantidadeEmbalagens: 3, validade: "2099-01-01", custoEmbalagem: 3600 });
    await adicionarItemEntrada(db, e.id, { embalagemId: un.id, quantidadeEmbalagens: 5, loteNumero: "VELHO", validade: "2020-01-01" });
    await finalizarEntrada(db, e.id, usuarioId);

    await abrirCaixa(db, usuarioId, 0);
    const venda = (qtd: number) =>
      registrarVenda(db, { usuarioId, itens: [{ embalagemId: un.id, quantidade: qtd }], pagamentos: [{ forma: "pix", valor: qtd * 400 }], idadeConferida: true });
    await venda(20);
    const cancelada = await venda(4);
    await cancelarVenda(db, cancelada.vendaId, usuarioId, "teste");

    const [linha] = await sugestaoDeCompra(db, { diasPeriodo: 10, diasCobertura: 10 });
    expect(linha.produtoId).toBe(produto.id);
    expect(linha.vendido).toBe(20);
    expect(linha.estoque).toBe(16); // 36 − 20; as 5 vencidas não contam
    expect(linha.fornecedor).toBe("Ambev Distribuição");
    expect(linha.custoUnitario).toBe(300);
    expect(linha.embalagemTipo).toBe("CX");
    // 2/dia × 10 dias + mínimo 12 = 32; tem 16 → faltam 16 → 2 cx
    expect(linha.embalagens).toBe(2);

    await db.update(schema.produtos).set({ ativo: false }).where(eq(schema.produtos.id, produto.id));
    expect(await sugestaoDeCompra(db)).toHaveLength(0);
  });
});
