import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { DB } from "@/db";
import {
  adicionarItemEntrada,
  ajustarInventario,
  cancelarVenda,
  finalizarEntrada,
  receberFiado,
  registrarSaidaAvulsa,
  registrarVenda,
  saldoFiado,
  saldoVendavel,
} from "@/lib/estoque";
import { atualizarAlertas, tratarAlerta } from "@/lib/validade";
import { abrirCaixa } from "@/lib/caixa";
import { bancoDeTeste, criarCerveja } from "./helpers";

const HOJE = "2026-11-05";
let db: DB;
let usuarioId: number;
let fechar: () => Promise<void>;

beforeEach(async () => {
  ({ db, usuarioId, fechar } = await bancoDeTeste());
});
afterEach(async () => fechar());

async function entradaCom(itens: Parameters<typeof adicionarItemEntrada>[2][]) {
  const [e] = await db.insert(schema.entradas).values({ usuarioId }).returning();
  for (const i of itens) await adicionarItemEntrada(db, e.id, i);
  await finalizarEntrada(db, e.id, usuarioId);
  return e.id;
}

describe("entrada", () => {
  it("converte caixas em unidades e calcula custo médio", async () => {
    const { produto, cx } = await criarCerveja(db);
    await entradaCom([{ embalagemId: cx.id, quantidadeEmbalagens: 2, loteNumero: "a", validade: "2027-01-10", custoEmbalagem: 3000 }]);
    await entradaCom([{ embalagemId: cx.id, quantidadeEmbalagens: 2, loteNumero: "B", validade: "2027-03-10", custoEmbalagem: 3600 }]);
    expect(await saldoVendavel(db, produto.id, HOJE)).toBe(48);
    const [p] = await db.select().from(schema.produtos).where(eq(schema.produtos.id, produto.id));
    expect(p.custoMedio).toBe(275); // (24×250 + 24×300)/48
    const lotes = await db.select().from(schema.lotes);
    expect(lotes.map((l) => l.numero).sort()).toEqual(["A", "B"]);
  });

  it("exige validade para perecível e não deixa finalizar duas vezes", async () => {
    const { cx } = await criarCerveja(db);
    const [e] = await db.insert(schema.entradas).values({ usuarioId }).returning();
    await expect(adicionarItemEntrada(db, e.id, { embalagemId: cx.id, quantidadeEmbalagens: 1 })).rejects.toThrow(/validade/);
    await adicionarItemEntrada(db, e.id, { embalagemId: cx.id, quantidadeEmbalagens: 1, validade: "2027-01-01" });
    await finalizarEntrada(db, e.id, usuarioId);
    await expect(finalizarEntrada(db, e.id, usuarioId)).rejects.toThrow(/finalizada/);
  });
});

describe("venda", () => {
  beforeEach(async () => {
    await abrirCaixa(db, usuarioId, 0);
  });

  it("baixa pelo FEFO, ignora lote vencido e calcula troco", async () => {
    const { produto, un, cx } = await criarCerveja(db);
    await entradaCom([
      { embalagemId: cx.id, quantidadeEmbalagens: 1, loteNumero: "TARDE", validade: "2027-06-01" },
      { embalagemId: un.id, quantidadeEmbalagens: 5, loteNumero: "CEDO", validade: "2026-12-01" },
      { embalagemId: un.id, quantidadeEmbalagens: 3, loteNumero: "VENCIDO", validade: "2026-10-01" },
    ]);
    expect(await saldoVendavel(db, produto.id, HOJE)).toBe(17);

    const r = await registrarVenda(db, {
      usuarioId,
      itens: [{ embalagemId: un.id, quantidade: 7 }],
      pagamentos: [{ forma: "dinheiro", valor: 3000 }],
      idadeConferida: true,
      hoje: HOJE,
    });
    expect(r.total).toBe(2800);
    expect(r.troco).toBe(200);

    const saldos = await db
      .select({ numero: schema.lotes.numero, q: schema.saldos.quantidade })
      .from(schema.saldos)
      .innerJoin(schema.lotes, eq(schema.lotes.id, schema.saldos.loteId));
    const porLote = Object.fromEntries(saldos.map((s) => [s.numero, s.q]));
    expect(porLote).toEqual({ CEDO: 0, TARDE: 10, VENCIDO: 3 });
  });

  it("bloqueia venda sem estoque suficiente e não grava nada", async () => {
    const { un } = await criarCerveja(db);
    await entradaCom([{ embalagemId: un.id, quantidadeEmbalagens: 2, validade: "2027-01-01" }]);
    await expect(
      registrarVenda(db, { usuarioId, itens: [{ embalagemId: un.id, quantidade: 3 }], pagamentos: [{ forma: "pix", valor: 1200 }], idadeConferida: true, hoje: HOJE }),
    ).rejects.toThrow(/insuficiente/);
    expect(await db.select().from(schema.vendas)).toHaveLength(0);
  });

  it("exige conferência de idade para bebida alcoólica", async () => {
    const { un } = await criarCerveja(db);
    await entradaCom([{ embalagemId: un.id, quantidadeEmbalagens: 2, validade: "2027-01-01" }]);
    await expect(
      registrarVenda(db, { usuarioId, itens: [{ embalagemId: un.id, quantidade: 1 }], pagamentos: [{ forma: "pix", valor: 400 }], hoje: HOJE }),
    ).rejects.toThrow(/idade/);
  });

  it("fiado respeita limite; cancelamento devolve estoque e estorna", async () => {
    const { produto, un } = await criarCerveja(db);
    await entradaCom([{ embalagemId: un.id, quantidadeEmbalagens: 10, validade: "2027-01-01" }]);
    const [cli] = await db.insert(schema.clientes).values({ nome: "Bar do Zé", limiteFiado: 2000 }).returning();

    const v = await registrarVenda(db, {
      usuarioId, clienteId: cli.id, itens: [{ embalagemId: un.id, quantidade: 4 }],
      pagamentos: [{ forma: "fiado", valor: 1600 }], idadeConferida: true, hoje: HOJE,
    });
    expect(await saldoFiado(db, cli.id)).toBe(1600);
    await expect(
      registrarVenda(db, { usuarioId, clienteId: cli.id, itens: [{ embalagemId: un.id, quantidade: 2 }], pagamentos: [{ forma: "fiado", valor: 800 }], idadeConferida: true, hoje: HOJE }),
    ).rejects.toThrow(/Limite/);

    await cancelarVenda(db, v.vendaId, usuarioId, "cliente desistiu");
    expect(await saldoFiado(db, cli.id)).toBe(0);
    expect(await saldoVendavel(db, produto.id, HOJE)).toBe(10);
    await expect(cancelarVenda(db, v.vendaId, usuarioId, "de novo")).rejects.toThrow(/já cancelada/);

    await registrarVenda(db, { usuarioId, clienteId: cli.id, itens: [{ embalagemId: un.id, quantidade: 2 }], pagamentos: [{ forma: "fiado", valor: 800 }], idadeConferida: true, hoje: HOJE });
    await receberFiado(db, cli.id, 500, "pix", usuarioId);
    expect(await saldoFiado(db, cli.id)).toBe(300);
  });
});

describe("perdas, inventário e validade", () => {
  it("perda usa FEFO; inventário lança diferença com auditoria", async () => {
    const { produto, un } = await criarCerveja(db);
    await entradaCom([{ embalagemId: un.id, quantidadeEmbalagens: 10, loteNumero: "X", validade: "2027-01-01" }]);
    await registrarSaidaAvulsa(db, { tipo: "perda", produtoId: produto.id, quantidadeBase: 2, motivo: "lata amassada", usuarioId, hoje: HOJE });
    const [lote] = await db.select().from(schema.lotes);
    const r = await ajustarInventario(db, { produtoId: produto.id, loteId: lote.id, quantidadeContada: 7, motivo: "contagem mensal", usuarioId });
    expect(r.diferenca).toBe(-1);
    expect(await saldoVendavel(db, produto.id, HOJE)).toBe(7);
    const log = await db.select().from(schema.logAuditoria);
    expect(log.map((l) => l.acao)).toEqual(["saida_perda", "ajuste_inventario"]);
  });

  it("gera alertas por faixa, piora de faixa e descarte baixa o estoque", async () => {
    const { produto, un } = await criarCerveja(db);
    await entradaCom([
      { embalagemId: un.id, quantidadeEmbalagens: 4, loteNumero: "V10", validade: "2026-11-15" },
      { embalagemId: un.id, quantidadeEmbalagens: 4, loteNumero: "V45", validade: "2026-12-20" },
      { embalagemId: un.id, quantidadeEmbalagens: 4, loteNumero: "LONGE", validade: "2027-08-01" },
    ]);
    const novos = await atualizarAlertas(db, HOJE);
    expect(novos.map((n) => [n.lote, n.faixa]).sort()).toEqual([["V10", "15"], ["V45", "60"]]);
    expect(await atualizarAlertas(db, HOJE)).toHaveLength(0); // não repete

    const pioraram = await atualizarAlertas(db, "2026-11-16");
    expect(pioraram.map((n) => [n.lote, n.faixa])).toEqual([["V10", "vencido"]]);

    const [alerta] = await db
      .select({ id: schema.alertasValidade.id })
      .from(schema.alertasValidade)
      .innerJoin(schema.lotes, eq(schema.lotes.id, schema.alertasValidade.loteId))
      .where(and(eq(schema.lotes.numero, "V10")));
    await tratarAlerta(db, { alertaId: alerta.id, acao: "descarte", usuarioId, hoje: "2026-11-16" });
    const mov = await db.select().from(schema.movimentos).where(eq(schema.movimentos.tipo, "vencido"));
    expect(mov[0].quantidade).toBe(-4);
    expect(await saldoVendavel(db, produto.id, "2026-11-16")).toBe(8);
  });
});
