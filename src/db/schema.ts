/**
 * Modelo de dados do núcleo de estoque.
 *
 * Convenções:
 * - Quantidades de estoque são SEMPRE inteiros na unidade base do produto (ex.: 1 lata).
 *   Caixas, fardos e packs são "embalagens" com um fator de conversão.
 * - Valores em dinheiro são inteiros em CENTAVOS (evita erro de arredondamento).
 * - Datas de validade são strings 'AAAA-MM-DD' (sem fuso horário).
 * - O saldo nunca é editado à mão: toda alteração passa por `movimentos`.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------- enums

export const perfilEnum = pgEnum("perfil", ["dono", "gerente", "caixa", "estoquista"]);

export const tipoEmbalagemEnum = pgEnum("tipo_embalagem", ["UN", "PACK", "FARDO", "CX"]);

export const tipoMovimentoEnum = pgEnum("tipo_movimento", [
  "entrada_compra",
  "saida_venda",
  "cancelamento_venda",
  "perda",
  "vencido",
  "consumo_interno",
  "devolucao_fornecedor",
  "ajuste_inventario",
]);

export const formaPagamentoEnum = pgEnum("forma_pagamento", [
  "dinheiro",
  "pix",
  "cartao_debito",
  "cartao_credito",
  "fiado",
]);

export const statusAlertaEnum = pgEnum("status_alerta", ["aberto", "em_acao", "resolvido"]);

export const acaoAlertaEnum = pgEnum("acao_alerta", [
  "promocao",
  "troca_fornecedor",
  "descarte",
  "vendido",
]);

// ---------------------------------------------------------------- acesso

export const usuarios = pgTable("usuarios", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 120 }).notNull(),
  login: varchar("login", { length: 60 }).notNull().unique(),
  senhaHash: text("senha_hash").notNull(),
  perfil: perfilEnum("perfil").notNull(),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});

/** Registro imutável de ações sensíveis (ajustes, cancelamentos, alterações de preço...). */
export const logAuditoria = pgTable(
  "log_auditoria",
  {
    id: serial("id").primaryKey(),
    usuarioId: integer("usuario_id").references(() => usuarios.id),
    acao: varchar("acao", { length: 60 }).notNull(),
    entidade: varchar("entidade", { length: 60 }).notNull(),
    entidadeId: integer("entidade_id"),
    detalhes: jsonb("detalhes"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("log_auditoria_entidade_idx").on(t.entidade, t.entidadeId)],
);

// ---------------------------------------------------------------- cadastros

export const categorias = pgTable("categorias", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 80 }).notNull().unique(),
});

export const produtos = pgTable("produtos", {
  id: serial("id").primaryKey(),
  descricao: varchar("descricao", { length: 160 }).notNull(),
  marca: varchar("marca", { length: 80 }),
  categoriaId: integer("categoria_id").references(() => categorias.id),
  // Campos fiscais opcionais agora; serão exigidos quando a emissão de nota entrar.
  ncm: varchar("ncm", { length: 8 }),
  cest: varchar("cest", { length: 7 }),
  perecivel: boolean("perecivel").notNull().default(true),
  alcoolico: boolean("alcoolico").notNull().default(false),
  estoqueMinimo: integer("estoque_minimo").notNull().default(0), // em unidades base
  custoMedio: integer("custo_medio").notNull().default(0), // centavos por unidade base
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});

/** Formas de venda/compra do produto: unidade, pack, fardo, caixa. Cada uma com seu código de barras. */
export const embalagens = pgTable(
  "embalagens",
  {
    id: serial("id").primaryKey(),
    produtoId: integer("produto_id")
      .notNull()
      .references(() => produtos.id, { onDelete: "cascade" }),
    tipo: tipoEmbalagemEnum("tipo").notNull(),
    codigoBarras: varchar("codigo_barras", { length: 14 }),
    fator: integer("fator").notNull().default(1), // quantas unidades base contém
    precoVenda: integer("preco_venda").notNull().default(0), // centavos por embalagem
    ativo: boolean("ativo").notNull().default(true),
  },
  (t) => [
    uniqueIndex("embalagens_codigo_barras_uk").on(t.codigoBarras),
    check("embalagens_fator_positivo", sql`${t.fator} > 0`),
  ],
);

export const fornecedores = pgTable("fornecedores", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 160 }).notNull(),
  cnpj: varchar("cnpj", { length: 14 }),
  telefone: varchar("telefone", { length: 20 }),
});

export const clientes = pgTable("clientes", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 160 }).notNull(),
  cpfCnpj: varchar("cpf_cnpj", { length: 14 }),
  telefone: varchar("telefone", { length: 20 }),
  limiteFiado: integer("limite_fiado").notNull().default(0), // centavos
  ativo: boolean("ativo").notNull().default(true),
});

// ---------------------------------------------------------------- estoque

export const depositos = pgTable("depositos", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 80 }).notNull().unique(),
});

export const lotes = pgTable(
  "lotes",
  {
    id: serial("id").primaryKey(),
    produtoId: integer("produto_id")
      .notNull()
      .references(() => produtos.id),
    numero: varchar("numero", { length: 40 }).notNull().default(""),
    validade: date("validade", { mode: "string" }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("lotes_produto_numero_validade_uk")
      .on(t.produtoId, t.numero, t.validade)
      .nullsNotDistinct(),
    index("lotes_validade_idx").on(t.validade),
  ],
);

/** Saldo atual por produto + lote + depósito. Mantido pelas funções de src/lib/estoque.ts. */
export const saldos = pgTable(
  "saldos",
  {
    produtoId: integer("produto_id")
      .notNull()
      .references(() => produtos.id),
    loteId: integer("lote_id")
      .notNull()
      .references(() => lotes.id),
    depositoId: integer("deposito_id")
      .notNull()
      .references(() => depositos.id),
    quantidade: integer("quantidade").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.produtoId, t.loteId, t.depositoId] }),
    check("saldos_nao_negativo", sql`${t.quantidade} >= 0`),
  ],
);

/** Kardex: cada linha é uma movimentação. Quantidade positiva = entrou, negativa = saiu. */
export const movimentos = pgTable(
  "movimentos",
  {
    id: serial("id").primaryKey(),
    tipo: tipoMovimentoEnum("tipo").notNull(),
    produtoId: integer("produto_id")
      .notNull()
      .references(() => produtos.id),
    loteId: integer("lote_id")
      .notNull()
      .references(() => lotes.id),
    depositoId: integer("deposito_id")
      .notNull()
      .references(() => depositos.id),
    quantidade: integer("quantidade").notNull(),
    custoUnitario: integer("custo_unitario").notNull().default(0),
    documentoTipo: varchar("documento_tipo", { length: 20 }), // 'entrada' | 'venda' | null
    documentoId: integer("documento_id"),
    motivo: text("motivo"),
    usuarioId: integer("usuario_id").references(() => usuarios.id),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("movimentos_produto_idx").on(t.produtoId, t.criadoEm),
    index("movimentos_documento_idx").on(t.documentoTipo, t.documentoId),
    check("movimentos_quantidade_nao_zero", sql`${t.quantidade} <> 0`),
  ],
);

// ---------------------------------------------------------------- entrada de mercadorias

export const entradas = pgTable("entradas", {
  id: serial("id").primaryKey(),
  fornecedorId: integer("fornecedor_id").references(() => fornecedores.id),
  numeroNota: varchar("numero_nota", { length: 20 }),
  /** chave de 44 dígitos da NF-e importada (impede importar a mesma nota duas vezes) */
  chaveNfe: varchar("chave_nfe", { length: 44 }).unique(),
  status: varchar("status", { length: 12 }).notNull().default("aberta"), // aberta | finalizada
  observacao: text("observacao"),
  usuarioId: integer("usuario_id")
    .notNull()
    .references(() => usuarios.id),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  finalizadaEm: timestamp("finalizada_em", { withTimezone: true }),
});

export const entradaItens = pgTable("entrada_itens", {
  id: serial("id").primaryKey(),
  entradaId: integer("entrada_id")
    .notNull()
    .references(() => entradas.id, { onDelete: "cascade" }),
  produtoId: integer("produto_id")
    .notNull()
    .references(() => produtos.id),
  embalagemId: integer("embalagem_id")
    .notNull()
    .references(() => embalagens.id),
  quantidadeEmbalagens: integer("quantidade_embalagens").notNull(),
  quantidadeBase: integer("quantidade_base").notNull(),
  loteNumero: varchar("lote_numero", { length: 40 }).notNull().default(""),
  validade: date("validade", { mode: "string" }),
  custoUnitario: integer("custo_unitario"), // centavos por unidade base; null = não informado
});

/** Itens como vieram no XML da NF-e do fornecedor (o "esperado" da conferência cega). */
export const entradaNotaItens = pgTable("entrada_nota_itens", {
  id: serial("id").primaryKey(),
  entradaId: integer("entrada_id")
    .notNull()
    .references(() => entradas.id, { onDelete: "cascade" }),
  numeroItem: integer("numero_item").notNull(),
  codigoFornecedor: varchar("codigo_fornecedor", { length: 60 }).notNull(),
  gtin: varchar("gtin", { length: 14 }),
  descricao: varchar("descricao", { length: 200 }).notNull(),
  unidade: varchar("unidade", { length: 10 }),
  quantidade: doublePrecision("quantidade").notNull(), // na unidade da nota
  valorTotal: integer("valor_total").notNull(), // centavos
  lote: varchar("lote", { length: 40 }),
  validade: date("validade", { mode: "string" }),
  /** embalagem do nosso cadastro que corresponde a este item (null = ainda não vinculado) */
  embalagemId: integer("embalagem_id").references(() => embalagens.id),
  quantidadeBase: integer("quantidade_base"), // em unidades, depois de vinculado
});

/** De-para: código do produto no fornecedor → nossa embalagem. Aprendido na 1ª nota, usado nas próximas. */
export const produtoFornecedor = pgTable(
  "produto_fornecedor",
  {
    id: serial("id").primaryKey(),
    fornecedorId: integer("fornecedor_id")
      .notNull()
      .references(() => fornecedores.id),
    codigoFornecedor: varchar("codigo_fornecedor", { length: 60 }).notNull(),
    embalagemId: integer("embalagem_id")
      .notNull()
      .references(() => embalagens.id),
    /** quantas embalagens nossas vêm em 1 unidade da nota (ex.: nota em fardo de 2 caixas → 2) */
    multiplicador: doublePrecision("multiplicador").notNull().default(1),
  },
  (t) => [unique("produto_fornecedor_uk").on(t.fornecedorId, t.codigoFornecedor)],
);

// ---------------------------------------------------------------- caixa (abertura, sangria, fechamento)

/**
 * Turno de caixa de um operador. Cada operador tem no máximo um caixa aberto.
 * O fechamento é "cego": o operador informa quanto contou na gaveta sem ver o esperado.
 */
export const caixas = pgTable(
  "caixas",
  {
    id: serial("id").primaryKey(),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    status: varchar("status", { length: 10 }).notNull().default("aberto"), // aberto | fechado
    valorAbertura: integer("valor_abertura").notNull().default(0), // fundo de troco, centavos
    abertoEm: timestamp("aberto_em", { withTimezone: true }).notNull().defaultNow(),
    fechadoEm: timestamp("fechado_em", { withTimezone: true }),
    fechadoPor: integer("fechado_por").references(() => usuarios.id),
    /** dinheiro que deveria estar na gaveta, calculado no fechamento */
    dinheiroEsperado: integer("dinheiro_esperado"),
    /** dinheiro contado pelo operador no fechamento */
    dinheiroContado: integer("dinheiro_contado"),
    /** contado − esperado (positivo = sobra, negativo = falta) */
    diferenca: integer("diferenca"),
    observacao: text("observacao"),
  },
  (t) => [
    uniqueIndex("caixas_um_aberto_por_usuario_uk").on(t.usuarioId).where(sql`${t.status} = 'aberto'`),
    check("caixas_abertura_nao_negativa", sql`${t.valorAbertura} >= 0`),
  ],
);

/** Sangria (dinheiro sai da gaveta para o cofre), suprimento (entra troco) e estorno (devolução ao cliente). */
export const caixaMovimentos = pgTable(
  "caixa_movimentos",
  {
    id: serial("id").primaryKey(),
    caixaId: integer("caixa_id")
      .notNull()
      .references(() => caixas.id),
    tipo: varchar("tipo", { length: 12 }).notNull(), // sangria | suprimento | estorno
    valor: integer("valor").notNull(), // centavos, sempre positivo
    motivo: text("motivo"),
    vendaId: integer("venda_id"), // nos estornos
    usuarioId: integer("usuario_id").references(() => usuarios.id),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("caixa_movimentos_valor_positivo", sql`${t.valor} > 0`), index("caixa_movimentos_caixa_idx").on(t.caixaId)],
);

// ---------------------------------------------------------------- vendas

export const vendas = pgTable(
  "vendas",
  {
    id: serial("id").primaryKey(),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    caixaId: integer("caixa_id").references(() => caixas.id),
    clienteId: integer("cliente_id").references(() => clientes.id),
    status: varchar("status", { length: 12 }).notNull().default("finalizada"), // finalizada | cancelada
    subtotal: integer("subtotal").notNull(),
    desconto: integer("desconto").notNull().default(0),
    total: integer("total").notNull(),
    idadeConferida: boolean("idade_conferida"), // null = venda sem item alcoólico
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    canceladaEm: timestamp("cancelada_em", { withTimezone: true }),
    canceladaPor: integer("cancelada_por").references(() => usuarios.id),
    motivoCancelamento: text("motivo_cancelamento"),
  },
  (t) => [index("vendas_criado_em_idx").on(t.criadoEm), index("vendas_caixa_idx").on(t.caixaId)],
);

export const vendaItens = pgTable("venda_itens", {
  id: serial("id").primaryKey(),
  vendaId: integer("venda_id")
    .notNull()
    .references(() => vendas.id, { onDelete: "cascade" }),
  produtoId: integer("produto_id")
    .notNull()
    .references(() => produtos.id),
  embalagemId: integer("embalagem_id")
    .notNull()
    .references(() => embalagens.id),
  quantidade: integer("quantidade").notNull(), // em embalagens
  quantidadeBase: integer("quantidade_base").notNull(),
  precoUnitario: integer("preco_unitario").notNull(), // centavos por embalagem
  total: integer("total").notNull(),
});

export const pagamentos = pgTable("pagamentos", {
  id: serial("id").primaryKey(),
  vendaId: integer("venda_id")
    .notNull()
    .references(() => vendas.id, { onDelete: "cascade" }),
  forma: formaPagamentoEnum("forma").notNull(),
  valor: integer("valor").notNull(), // valor que abate da venda (sem o troco)
  valorRecebido: integer("valor_recebido"), // só para dinheiro
  troco: integer("troco").notNull().default(0),
});

/** Conta corrente do fiado: débito quando compra, crédito quando paga. */
export const fiadoLancamentos = pgTable("fiado_lancamentos", {
  id: serial("id").primaryKey(),
  clienteId: integer("cliente_id")
    .notNull()
    .references(() => clientes.id),
  vendaId: integer("venda_id").references(() => vendas.id),
  tipo: varchar("tipo", { length: 10 }).notNull(), // debito | credito
  valor: integer("valor").notNull(),
  forma: formaPagamentoEnum("forma"), // como o cliente pagou (nos créditos)
  /** caixa em que o pagamento do fiado foi recebido (dinheiro entra na gaveta) */
  caixaId: integer("caixa_id").references(() => caixas.id),
  usuarioId: integer("usuario_id").references(() => usuarios.id),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- validade

export const alertasValidade = pgTable("alertas_validade", {
  id: serial("id").primaryKey(),
  loteId: integer("lote_id")
    .notNull()
    .unique()
    .references(() => lotes.id),
  faixa: varchar("faixa", { length: 10 }).notNull(), // 'vencido' | '15' | '30' | '60' | '90'
  status: statusAlertaEnum("status").notNull().default("aberto"),
  acao: acaoAlertaEnum("acao"),
  observacao: text("observacao"),
  responsavelId: integer("responsavel_id").references(() => usuarios.id),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- relações (para consultas com `with`)

export const produtosRelations = relations(produtos, ({ many, one }) => ({
  embalagens: many(embalagens),
  lotes: many(lotes),
  categoria: one(categorias, { fields: [produtos.categoriaId], references: [categorias.id] }),
}));

export const embalagensRelations = relations(embalagens, ({ one }) => ({
  produto: one(produtos, { fields: [embalagens.produtoId], references: [produtos.id] }),
}));

export const lotesRelations = relations(lotes, ({ one }) => ({
  produto: one(produtos, { fields: [lotes.produtoId], references: [produtos.id] }),
}));

export const entradasRelations = relations(entradas, ({ many, one }) => ({
  itens: many(entradaItens),
  itensNota: many(entradaNotaItens),
  fornecedor: one(fornecedores, { fields: [entradas.fornecedorId], references: [fornecedores.id] }),
}));

export const entradaItensRelations = relations(entradaItens, ({ one }) => ({
  entrada: one(entradas, { fields: [entradaItens.entradaId], references: [entradas.id] }),
  produto: one(produtos, { fields: [entradaItens.produtoId], references: [produtos.id] }),
  embalagem: one(embalagens, { fields: [entradaItens.embalagemId], references: [embalagens.id] }),
}));

export const vendasRelations = relations(vendas, ({ many, one }) => ({
  itens: many(vendaItens),
  pagamentos: many(pagamentos),
  cliente: one(clientes, { fields: [vendas.clienteId], references: [clientes.id] }),
  usuario: one(usuarios, { fields: [vendas.usuarioId], references: [usuarios.id] }),
  caixa: one(caixas, { fields: [vendas.caixaId], references: [caixas.id] }),
}));

export const vendaItensRelations = relations(vendaItens, ({ one }) => ({
  venda: one(vendas, { fields: [vendaItens.vendaId], references: [vendas.id] }),
  produto: one(produtos, { fields: [vendaItens.produtoId], references: [produtos.id] }),
  embalagem: one(embalagens, { fields: [vendaItens.embalagemId], references: [embalagens.id] }),
}));

export const caixasRelations = relations(caixas, ({ many, one }) => ({
  movimentos: many(caixaMovimentos),
  vendas: many(vendas),
  usuario: one(usuarios, { fields: [caixas.usuarioId], references: [usuarios.id] }),
}));

export const caixaMovimentosRelations = relations(caixaMovimentos, ({ one }) => ({
  caixa: one(caixas, { fields: [caixaMovimentos.caixaId], references: [caixas.id] }),
}));

export const pagamentosRelations = relations(pagamentos, ({ one }) => ({
  venda: one(vendas, { fields: [pagamentos.vendaId], references: [vendas.id] }),
}));

export const entradaNotaItensRelations = relations(entradaNotaItens, ({ one }) => ({
  entrada: one(entradas, { fields: [entradaNotaItens.entradaId], references: [entradas.id] }),
  embalagem: one(embalagens, { fields: [entradaNotaItens.embalagemId], references: [embalagens.id] }),
}));
