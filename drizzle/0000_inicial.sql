CREATE TYPE "public"."acao_alerta" AS ENUM('promocao', 'troca_fornecedor', 'descarte', 'vendido');--> statement-breakpoint
CREATE TYPE "public"."forma_pagamento" AS ENUM('dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'fiado');--> statement-breakpoint
CREATE TYPE "public"."perfil" AS ENUM('dono', 'gerente', 'caixa', 'estoquista');--> statement-breakpoint
CREATE TYPE "public"."status_alerta" AS ENUM('aberto', 'em_acao', 'resolvido');--> statement-breakpoint
CREATE TYPE "public"."tipo_embalagem" AS ENUM('UN', 'PACK', 'FARDO', 'CX');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimento" AS ENUM('entrada_compra', 'saida_venda', 'cancelamento_venda', 'perda', 'vencido', 'consumo_interno', 'devolucao_fornecedor', 'ajuste_inventario');--> statement-breakpoint
CREATE TABLE "alertas_validade" (
	"id" serial PRIMARY KEY NOT NULL,
	"lote_id" integer NOT NULL,
	"faixa" varchar(10) NOT NULL,
	"status" "status_alerta" DEFAULT 'aberto' NOT NULL,
	"acao" "acao_alerta",
	"observacao" text,
	"responsavel_id" integer,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alertas_validade_lote_id_unique" UNIQUE("lote_id")
);
--> statement-breakpoint
CREATE TABLE "categorias" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" varchar(80) NOT NULL,
	CONSTRAINT "categorias_nome_unique" UNIQUE("nome")
);
--> statement-breakpoint
CREATE TABLE "clientes" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" varchar(160) NOT NULL,
	"cpf_cnpj" varchar(14),
	"telefone" varchar(20),
	"limite_fiado" integer DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "depositos" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" varchar(80) NOT NULL,
	CONSTRAINT "depositos_nome_unique" UNIQUE("nome")
);
--> statement-breakpoint
CREATE TABLE "embalagens" (
	"id" serial PRIMARY KEY NOT NULL,
	"produto_id" integer NOT NULL,
	"tipo" "tipo_embalagem" NOT NULL,
	"codigo_barras" varchar(14),
	"fator" integer DEFAULT 1 NOT NULL,
	"preco_venda" integer DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "embalagens_fator_positivo" CHECK ("embalagens"."fator" > 0)
);
--> statement-breakpoint
CREATE TABLE "entrada_itens" (
	"id" serial PRIMARY KEY NOT NULL,
	"entrada_id" integer NOT NULL,
	"produto_id" integer NOT NULL,
	"embalagem_id" integer NOT NULL,
	"quantidade_embalagens" integer NOT NULL,
	"quantidade_base" integer NOT NULL,
	"lote_numero" varchar(40) DEFAULT '' NOT NULL,
	"validade" date,
	"custo_unitario" integer
);
--> statement-breakpoint
CREATE TABLE "entradas" (
	"id" serial PRIMARY KEY NOT NULL,
	"fornecedor_id" integer,
	"numero_nota" varchar(20),
	"status" varchar(12) DEFAULT 'aberta' NOT NULL,
	"observacao" text,
	"usuario_id" integer NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"finalizada_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fiado_lancamentos" (
	"id" serial PRIMARY KEY NOT NULL,
	"cliente_id" integer NOT NULL,
	"venda_id" integer,
	"tipo" varchar(10) NOT NULL,
	"valor" integer NOT NULL,
	"forma" "forma_pagamento",
	"usuario_id" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fornecedores" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" varchar(160) NOT NULL,
	"cnpj" varchar(14),
	"telefone" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "log_auditoria" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_id" integer,
	"acao" varchar(60) NOT NULL,
	"entidade" varchar(60) NOT NULL,
	"entidade_id" integer,
	"detalhes" jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"produto_id" integer NOT NULL,
	"numero" varchar(40) DEFAULT '' NOT NULL,
	"validade" date,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lotes_produto_numero_validade_uk" UNIQUE NULLS NOT DISTINCT("produto_id","numero","validade")
);
--> statement-breakpoint
CREATE TABLE "movimentos" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo" "tipo_movimento" NOT NULL,
	"produto_id" integer NOT NULL,
	"lote_id" integer NOT NULL,
	"deposito_id" integer NOT NULL,
	"quantidade" integer NOT NULL,
	"custo_unitario" integer DEFAULT 0 NOT NULL,
	"documento_tipo" varchar(20),
	"documento_id" integer,
	"motivo" text,
	"usuario_id" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movimentos_quantidade_nao_zero" CHECK ("movimentos"."quantidade" <> 0)
);
--> statement-breakpoint
CREATE TABLE "pagamentos" (
	"id" serial PRIMARY KEY NOT NULL,
	"venda_id" integer NOT NULL,
	"forma" "forma_pagamento" NOT NULL,
	"valor" integer NOT NULL,
	"valor_recebido" integer,
	"troco" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "produtos" (
	"id" serial PRIMARY KEY NOT NULL,
	"descricao" varchar(160) NOT NULL,
	"marca" varchar(80),
	"categoria_id" integer,
	"ncm" varchar(8),
	"cest" varchar(7),
	"perecivel" boolean DEFAULT true NOT NULL,
	"alcoolico" boolean DEFAULT false NOT NULL,
	"estoque_minimo" integer DEFAULT 0 NOT NULL,
	"custo_medio" integer DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saldos" (
	"produto_id" integer NOT NULL,
	"lote_id" integer NOT NULL,
	"deposito_id" integer NOT NULL,
	"quantidade" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "saldos_produto_id_lote_id_deposito_id_pk" PRIMARY KEY("produto_id","lote_id","deposito_id"),
	CONSTRAINT "saldos_nao_negativo" CHECK ("saldos"."quantidade" >= 0)
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" varchar(120) NOT NULL,
	"login" varchar(60) NOT NULL,
	"senha_hash" text NOT NULL,
	"perfil" "perfil" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_login_unique" UNIQUE("login")
);
--> statement-breakpoint
CREATE TABLE "venda_itens" (
	"id" serial PRIMARY KEY NOT NULL,
	"venda_id" integer NOT NULL,
	"produto_id" integer NOT NULL,
	"embalagem_id" integer NOT NULL,
	"quantidade" integer NOT NULL,
	"quantidade_base" integer NOT NULL,
	"preco_unitario" integer NOT NULL,
	"total" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendas" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_id" integer NOT NULL,
	"cliente_id" integer,
	"status" varchar(12) DEFAULT 'finalizada' NOT NULL,
	"subtotal" integer NOT NULL,
	"desconto" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"idade_conferida" boolean,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelada_em" timestamp with time zone,
	"cancelada_por" integer,
	"motivo_cancelamento" text
);
--> statement-breakpoint
ALTER TABLE "alertas_validade" ADD CONSTRAINT "alertas_validade_lote_id_lotes_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alertas_validade" ADD CONSTRAINT "alertas_validade_responsavel_id_usuarios_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embalagens" ADD CONSTRAINT "embalagens_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entrada_itens" ADD CONSTRAINT "entrada_itens_entrada_id_entradas_id_fk" FOREIGN KEY ("entrada_id") REFERENCES "public"."entradas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entrada_itens" ADD CONSTRAINT "entrada_itens_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entrada_itens" ADD CONSTRAINT "entrada_itens_embalagem_id_embalagens_id_fk" FOREIGN KEY ("embalagem_id") REFERENCES "public"."embalagens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entradas" ADD CONSTRAINT "entradas_fornecedor_id_fornecedores_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entradas" ADD CONSTRAINT "entradas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiado_lancamentos" ADD CONSTRAINT "fiado_lancamentos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiado_lancamentos" ADD CONSTRAINT "fiado_lancamentos_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiado_lancamentos" ADD CONSTRAINT "fiado_lancamentos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_auditoria" ADD CONSTRAINT "log_auditoria_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentos" ADD CONSTRAINT "movimentos_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentos" ADD CONSTRAINT "movimentos_lote_id_lotes_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentos" ADD CONSTRAINT "movimentos_deposito_id_depositos_id_fk" FOREIGN KEY ("deposito_id") REFERENCES "public"."depositos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentos" ADD CONSTRAINT "movimentos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_categoria_id_categorias_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldos" ADD CONSTRAINT "saldos_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldos" ADD CONSTRAINT "saldos_lote_id_lotes_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldos" ADD CONSTRAINT "saldos_deposito_id_depositos_id_fk" FOREIGN KEY ("deposito_id") REFERENCES "public"."depositos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_embalagem_id_embalagens_id_fk" FOREIGN KEY ("embalagem_id") REFERENCES "public"."embalagens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_cancelada_por_usuarios_id_fk" FOREIGN KEY ("cancelada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "embalagens_codigo_barras_uk" ON "embalagens" USING btree ("codigo_barras");--> statement-breakpoint
CREATE INDEX "log_auditoria_entidade_idx" ON "log_auditoria" USING btree ("entidade","entidade_id");--> statement-breakpoint
CREATE INDEX "lotes_validade_idx" ON "lotes" USING btree ("validade");--> statement-breakpoint
CREATE INDEX "movimentos_produto_idx" ON "movimentos" USING btree ("produto_id","criado_em");--> statement-breakpoint
CREATE INDEX "movimentos_documento_idx" ON "movimentos" USING btree ("documento_tipo","documento_id");--> statement-breakpoint
CREATE INDEX "vendas_criado_em_idx" ON "vendas" USING btree ("criado_em");