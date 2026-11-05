// Modo demonstração: sobe tudo com UM comando, sem instalar PostgreSQL nem Docker.
//
//   npm run demo            → inicia (os dados ficam salvos em ./.dados-demo)
//   npm run demo -- --zerar → apaga os dados e começa do zero
//
// Usa o PGlite (PostgreSQL rodando dentro do Node). Serve para testar e apresentar;
// para a loja de verdade, use o docker-compose (ver README).
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const require = createRequire(import.meta.url);
const PASTA = path.resolve(".dados-demo");
const PORTA_BANCO = 54329;
const PORTA_APP = process.env.PORT ?? "3000";

if (process.argv.includes("--zerar") && existsSync(PASTA)) {
  rmSync(PASTA, { recursive: true, force: true });
  console.log("Dados de demonstração apagados.");
}

const banco = await PGlite.create(PASTA);
const servidor = new PGLiteSocketServer({ db: banco, port: PORTA_BANCO, host: "127.0.0.1", maxConnections: 10 });
await servidor.start();

const env = {
  ...process.env,
  DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${PORTA_BANCO}/postgres?sslmode=disable`,
  SESSION_SECRET: process.env.SESSION_SECRET ?? "segredo-somente-para-demonstracao-local-0000",
  COOKIE_SECURE: "false",
  CRON_SECRET: "demo",
  ADMIN_LOGIN: "admin",
  ADMIN_SENHA: "admin123",
  EXEMPLOS: "1",
  MODO_DEMO: "1",
  NEXT_TELEMETRY_DISABLED: "1",
};

// Precisa ser assíncrono: o banco roda neste mesmo processo e tem de continuar respondendo.
const rodar = (...args) =>
  new Promise((ok) => spawn(process.execPath, args, { env, stdio: "inherit" }).on("exit", ok));
for (const script of ["scripts/migrate.mjs", "scripts/seed.mjs"]) {
  const status = await rodar(script);
  if (status !== 0) process.exit(status ?? 1);
}
// 30 dias de movimento fictício (só na primeira vez, com o banco vazio)
const statusDados = await rodar(require.resolve("tsx/cli"), "scripts/dados-demo.ts");
if (statusDados !== 0) process.exit(statusDados ?? 1);

console.log(`
  ┌──────────────────────────────────────────────┐
  │  Distribuidora Sousa — modo demonstração     │
  │  Abra:   http://localhost:${PORTA_APP.padEnd(19)}│
  │  Login:  admin   Senha: admin123             │
  │  Códigos para testar no campo do leitor:     │
  │    7890000000017  cerveja (lata)             │
  │    17890000000014 cerveja (caixa c/ 12)      │
  │    7890000000024  refrigerante 2L            │
  │  Parar: Ctrl + C                             │
  └──────────────────────────────────────────────┘
`);

const next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "-p", PORTA_APP], {
  env,
  stdio: "inherit",
});

const encerrar = async () => {
  next.kill();
  await servidor.stop().catch(() => {});
  await banco.close().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
next.on("exit", encerrar);
