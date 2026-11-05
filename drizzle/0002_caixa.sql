CREATE TABLE "caixa_movimentos" (
	"id" serial PRIMARY KEY NOT NULL,
	"caixa_id" integer NOT NULL,
	"tipo" varchar(12) NOT NULL,
	"valor" integer NOT NULL,
	"motivo" text,
	"venda_id" integer,
	"usuario_id" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "caixa_movimentos_valor_positivo" CHECK ("caixa_movimentos"."valor" > 0)
);
--> statement-breakpoint
CREATE TABLE "caixas" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_id" integer NOT NULL,
	"status" varchar(10) DEFAULT 'aberto' NOT NULL,
	"valor_abertura" integer DEFAULT 0 NOT NULL,
	"aberto_em" timestamp with time zone DEFAULT now() NOT NULL,
	"fechado_em" timestamp with time zone,
	"fechado_por" integer,
	"dinheiro_esperado" integer,
	"dinheiro_contado" integer,
	"diferenca" integer,
	"observacao" text,
	CONSTRAINT "caixas_abertura_nao_negativa" CHECK ("caixas"."valor_abertura" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fiado_lancamentos" ADD COLUMN "caixa_id" integer;--> statement-breakpoint
ALTER TABLE "vendas" ADD COLUMN "caixa_id" integer;--> statement-breakpoint
ALTER TABLE "caixa_movimentos" ADD CONSTRAINT "caixa_movimentos_caixa_id_caixas_id_fk" FOREIGN KEY ("caixa_id") REFERENCES "public"."caixas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caixa_movimentos" ADD CONSTRAINT "caixa_movimentos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_fechado_por_usuarios_id_fk" FOREIGN KEY ("fechado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "caixa_movimentos_caixa_idx" ON "caixa_movimentos" USING btree ("caixa_id");--> statement-breakpoint
CREATE UNIQUE INDEX "caixas_um_aberto_por_usuario_uk" ON "caixas" USING btree ("usuario_id") WHERE "caixas"."status" = 'aberto';--> statement-breakpoint
ALTER TABLE "fiado_lancamentos" ADD CONSTRAINT "fiado_lancamentos_caixa_id_caixas_id_fk" FOREIGN KEY ("caixa_id") REFERENCES "public"."caixas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_caixa_id_caixas_id_fk" FOREIGN KEY ("caixa_id") REFERENCES "public"."caixas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendas_caixa_idx" ON "vendas" USING btree ("caixa_id");