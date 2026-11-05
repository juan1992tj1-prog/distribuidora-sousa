/**
 * Reinicia o banco da DEMO: apaga tudo, recria as tabelas, cria o dono + produtos de exemplo e gera os 30 dias.
 *
 * ⚠️ Apaga o banco inteiro. Travas:
 *  1. recusa se o banco tiver usuários e NÃO tiver os usuários fictícios da demo (maria, carlos, jose);
 *  2. só um reset por vez (advisory lock);
 *  3. com `somenteUmaVezPorDia`, não faz nada se os dados já foram gerados hoje.
 */
import path from "node:path";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type pg from "pg";
import { gerarDadosDemo } from "./demo-dados";
import { FUSO, hojeIso } from "./formato";

const TRAVA = 727001;

export type ResultadoReset = { feito: boolean; motivo: string; vendas?: number };

export async function resetarDemo(pool: pg.Pool, opcoes: { somenteUmaVezPorDia?: boolean } = {}): Promise<ResultadoReset> {
  const trava = await pool.connect();
  try {
    const { rows: l } = await trava.query("select pg_try_advisory_lock($1) as ok", [TRAVA]);
    if (!l[0].ok) return { feito: false, motivo: "Já existe um reset em andamento." };

    const { rows } = await pool.query("select to_regclass('public.usuarios') is not null as tem");
    if (rows[0].tem) {
      const { rows: u } = await pool.query(
        "select count(*)::int as total, count(*) filter (where login in ('maria','carlos','jose'))::int as demo from usuarios",
      );
      if (u[0].total > 0 && u[0].demo < 3) {
        throw new Error("Recusado: este banco não parece ser o da demonstração (faltam os usuários fictícios).");
      }
      if (opcoes.somenteUmaVezPorDia && (await pool.query("select to_regclass('public.caixas') is not null as tem")).rows[0].tem) {
        const { rows: c } = await pool.query(
          "select count(*)::int as n from caixas where (aberto_em at time zone $1)::date = $2::date",
          [FUSO, hojeIso()],
        );
        if (c[0].n > 0) return { feito: false, motivo: "Os dados de hoje já foram gerados." };
      }
    }

    await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await migrate(drizzle(pool), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    await semear(pool);
    const vendas = await gerarDadosDemo(pool);
    return { feito: true, motivo: "Demo reiniciada.", vendas };
  } finally {
    await trava.query("select pg_advisory_unlock($1)", [TRAVA]).catch(() => {});
    trava.release();
  }
}

/** Mesmo que scripts/seed.mjs com EXEMPLOS=1: depósito, usuário dono e 3 produtos de exemplo. */
async function semear(pool: pg.Pool) {
  await pool.query("insert into depositos (nome) values ('Loja') on conflict do nothing");
  await pool.query("insert into usuarios (nome, login, senha_hash, perfil) values ($1, $2, $3, 'dono')", [
    "Administrador",
    "admin",
    await bcrypt.hash(process.env.ADMIN_SENHA ?? "admin123", 10),
  ]);
  const exemplos: [string, string, boolean, string, number, number, string, number][] = [
    ["Cerveja Pilsen Lata 350ml", "Cerveja", true, "7890000000017", 450, 12, "17890000000014", 4800],
    ["Refrigerante Cola 2L", "Refrigerante", false, "7890000000024", 1099, 6, "17890000000021", 6200],
    ["Água Mineral 500ml", "Água", false, "7890000000031", 250, 12, "17890000000038", 2600],
  ];
  for (const [desc, cat, alcool, ean, preco, fator, dun, precoCx] of exemplos) {
    const c = await pool.query(
      "insert into categorias (nome) values ($1) on conflict (nome) do update set nome = excluded.nome returning id",
      [cat],
    );
    const p = await pool.query(
      "insert into produtos (descricao, categoria_id, alcoolico, perecivel, estoque_minimo) values ($1,$2,$3,true,24) returning id",
      [desc, c.rows[0].id, alcool],
    );
    await pool.query("insert into embalagens (produto_id, tipo, codigo_barras, fator, preco_venda) values ($1,'UN',$2,1,$3)", [p.rows[0].id, ean, preco]);
    await pool.query("insert into embalagens (produto_id, tipo, codigo_barras, fator, preco_venda) values ($1,'CX',$2,$3,$4)", [p.rows[0].id, dun, fator, precoCx]);
  }
}
