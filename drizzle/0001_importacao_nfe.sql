CREATE TABLE "entrada_nota_itens" (
	"id" serial PRIMARY KEY NOT NULL,
	"entrada_id" integer NOT NULL,
	"numero_item" integer NOT NULL,
	"codigo_fornecedor" varchar(60) NOT NULL,
	"gtin" varchar(14),
	"descricao" varchar(200) NOT NULL,
	"unidade" varchar(10),
	"quantidade" double precision NOT NULL,
	"valor_total" integer NOT NULL,
	"lote" varchar(40),
	"validade" date,
	"embalagem_id" integer,
	"quantidade_base" integer
);
--> statement-breakpoint
CREATE TABLE "produto_fornecedor" (
	"id" serial PRIMARY KEY NOT NULL,
	"fornecedor_id" integer NOT NULL,
	"codigo_fornecedor" varchar(60) NOT NULL,
	"embalagem_id" integer NOT NULL,
	"multiplicador" double precision DEFAULT 1 NOT NULL,
	CONSTRAINT "produto_fornecedor_uk" UNIQUE("fornecedor_id","codigo_fornecedor")
);
--> statement-breakpoint
ALTER TABLE "entradas" ADD COLUMN "chave_nfe" varchar(44);--> statement-breakpoint
ALTER TABLE "entrada_nota_itens" ADD CONSTRAINT "entrada_nota_itens_entrada_id_entradas_id_fk" FOREIGN KEY ("entrada_id") REFERENCES "public"."entradas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entrada_nota_itens" ADD CONSTRAINT "entrada_nota_itens_embalagem_id_embalagens_id_fk" FOREIGN KEY ("embalagem_id") REFERENCES "public"."embalagens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produto_fornecedor" ADD CONSTRAINT "produto_fornecedor_fornecedor_id_fornecedores_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produto_fornecedor" ADD CONSTRAINT "produto_fornecedor_embalagem_id_embalagens_id_fk" FOREIGN KEY ("embalagem_id") REFERENCES "public"."embalagens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entradas" ADD CONSTRAINT "entradas_chave_nfe_unique" UNIQUE("chave_nfe");