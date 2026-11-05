// Reinicia o banco da DEMO ONLINE: apaga tudo, recria as tabelas e gera de novo os 30 dias fictícios.
// Roda todo dia pelo GitHub Actions (.github/workflows/resetar-demo.yml).
//
//   CONFIRMAR_RESET=apagar-tudo DATABASE_URL=... npm run demo:resetar
//
// ⚠️ APAGA O BANCO INTEIRO. Nunca aponte para o banco de uma loja de verdade.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import pg from "pg";

const require = createRequire(import.meta.url);

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL não definida: nada a fazer.");
  process.exit(0);
}
if (process.env.CONFIRMAR_RESET !== "apagar-tudo") {
  console.error("Recusado: defina CONFIRMAR_RESET=apagar-tudo para confirmar que este banco é só de demonstração.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
// segunda trava: só apaga se o banco já for da demo (tem os usuários fictícios) ou estiver vazio
const { rows } = await pool.query(`
  select
    (select count(*) from information_schema.tables where table_schema = 'public')::int as tabelas,
    (select to_regclass('public.usuarios') is not null) as tem_usuarios`);
if (rows[0].tabelas > 0 && rows[0].tem_usuarios) {
  const { rows: u } = await pool.query("select count(*)::int as n from usuarios where login in ('maria','carlos','jose')");
  if (u[0].n < 3) {
    console.error("Recusado: este banco não parece ser o da demonstração (faltam os usuários fictícios).");
    process.exit(1);
  }
}
await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
await pool.end();
console.log("Banco da demo apagado.");

const env = { ...process.env, EXEMPLOS: "1", ADMIN_LOGIN: "admin", ADMIN_SENHA: process.env.ADMIN_SENHA ?? "admin123" };
for (const args of [["scripts/migrate.mjs"], ["scripts/seed.mjs"], [require.resolve("tsx/cli"), "scripts/dados-demo.ts"]]) {
  const r = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log("Demo reiniciada.");
