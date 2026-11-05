import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { DB } from "@/db";
import { adicionarItemEntrada, cancelarVenda, finalizarEntrada, receberFiado, registrarVenda } from "@/lib/estoque";
import { abrirCaixa, fecharCaixa, movimentarCaixa, resumoCaixa } from "@/lib/caixa";
import { bancoDeTeste, criarCerveja } from "./helpers";

const HOJE = "2026-11-05";
let db: DB;
let usuarioId: number;
let fechar: () => Promise<void>;
let un: typeof schema.embalagens.$inferSelect;

beforeEach(async () => {
  ({ db, usuarioId, fechar } = await bancoDeTeste());
  ({ un } = await criarCerveja(db));
  const [e] = await db.insert(schema.entradas).values({ usuarioId }).returning();
  await adicionarItemEntrada(db, e.id, { embalagemId: un.id, quantidadeEmbalagens: 50, validade: "2027-01-01" });
  await finalizarEntrada(db, e.id, usuarioId);
});
afterEach(async () => fechar());

const vender = (qtd: number, pagamentos: { forma: "dinheiro" | "pix" | "cartao_debito" | "cartao_credito" | "fiado"; valor: number }[], clienteId?: number) =>
  registrarVenda(db, { usuarioId, clienteId, itens: [{ embalagemId: un.id, quantidade: qtd }], pagamentos, idadeConferida: true, hoje: HOJE });

describe("caixa", () => {
  it("não deixa vender nem abrir dois caixas sem fechar", async () => {
    await expect(vender(1, [{ forma: "pix", valor: 400 }])).rejects.toThrow(/Abra o caixa/);
    await abrirCaixa(db, usuarioId, 10000);
    await expect(abrirCaixa(db, usuarioId, 0)).rejects.toThrow(/já tem um caixa aberto/);
    await vender(1, [{ forma: "pix", valor: 400 }]);
    expect((await db.select().from(schema.vendas))[0].caixaId).not.toBeNull();
  });

  it("calcula o dinheiro esperado: fundo + vendas (sem troco) + fiado − sangria + suprimento", async () => {
    const c = await abrirCaixa(db, usuarioId, 10000); // R$ 100 de troco
    await vender(3, [{ forma: "dinheiro", valor: 2000 }]); // R$ 12, cliente deu 20 → entram 12
    await vender(2, [{ forma: "pix", valor: 300 }, { forma: "dinheiro", valor: 500 }]); // R$ 8: 3 pix + 5 dinheiro
    await vender(1, [{ forma: "cartao_debito", valor: 400 }]);
    const [cli] = await db.insert(schema.clientes).values({ nome: "Bar do Zé", limiteFiado: 5000 }).returning();
    await vender(5, [{ forma: "fiado", valor: 2000 }], cli.id);
    await receberFiado(db, cli.id, 1500, "dinheiro", usuarioId);
    await movimentarCaixa(db, { usuarioId, tipo: "sangria", valor: 5000, motivo: "cofre" });
    await movimentarCaixa(db, { usuarioId, tipo: "suprimento", valor: 2000 });

    const r = await resumoCaixa(db, c.id);
    expect(r.porForma).toEqual({ dinheiro: 1700, pix: 300, cartao_debito: 400, cartao_credito: 0, fiado: 2000 });
    expect(r.vendasQtd).toBe(4);
    expect(r.vendasTotal).toBe(4400);
    // 100 + 12 + 5 + 15 (fiado) − 50 + 20 = 102
    expect(r.dinheiroEsperado).toBe(10200);

    await expect(movimentarCaixa(db, { usuarioId, tipo: "sangria", valor: 999999, motivo: "x" })).rejects.toThrow(/maior/);
    await expect(movimentarCaixa(db, { usuarioId, tipo: "sangria", valor: 100 })).rejects.toThrow(/motivo/);

    const f = await fecharCaixa(db, { caixaId: c.id, usuarioId, dinheiroContado: 10150, observacao: "faltou moeda" });
    expect(f.diferenca).toBe(-50);
    await expect(fecharCaixa(db, { caixaId: c.id, usuarioId, dinheiroContado: 0 })).rejects.toThrow(/já foi fechado/);
    await expect(vender(1, [{ forma: "pix", valor: 400 }])).rejects.toThrow(/Abra o caixa/);
  });

  it("cancelamento com caixa aberto só tira a venda; com caixa fechado faz estorno no caixa atual", async () => {
    const c1 = await abrirCaixa(db, usuarioId, 0);
    const v1 = await vender(2, [{ forma: "dinheiro", valor: 800 }]);
    const v2 = await vender(1, [{ forma: "dinheiro", valor: 400 }]);
    await cancelarVenda(db, v1.vendaId, usuarioId, "desistiu");
    expect((await resumoCaixa(db, c1.id)).dinheiroEsperado).toBe(400);
    await fecharCaixa(db, { caixaId: c1.id, usuarioId, dinheiroContado: 400 });

    // caixa de ontem já fechado: precisa de caixa aberto para devolver o dinheiro
    await expect(cancelarVenda(db, v2.vendaId, usuarioId, "produto quente")).rejects.toThrow(/abra o seu caixa/);
    const c2 = await abrirCaixa(db, usuarioId, 5000);
    await cancelarVenda(db, v2.vendaId, usuarioId, "produto quente");
    const r2 = await resumoCaixa(db, c2.id);
    expect(r2.estornos).toBe(400);
    expect(r2.dinheiroEsperado).toBe(4600);
    // o caixa fechado não muda
    expect((await resumoCaixa(db, c1.id)).dinheiroEsperado).toBe(400);
  });

  it("receber fiado em dinheiro exige caixa aberto", async () => {
    const [cli] = await db.insert(schema.clientes).values({ nome: "Ana", limiteFiado: 5000 }).returning();
    await db.insert(schema.fiadoLancamentos).values({ clienteId: cli.id, tipo: "debito", valor: 1000 });
    await expect(receberFiado(db, cli.id, 500, "dinheiro", usuarioId)).rejects.toThrow(/abra o caixa/);
    await receberFiado(db, cli.id, 500, "pix", usuarioId); // Pix pode sem caixa
  });
});
