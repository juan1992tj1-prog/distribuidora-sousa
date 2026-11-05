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
import pg from "pg";

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
  NEXT_TELEMETRY_DISABLED: "1",
};

// Precisa ser assíncrono: o banco roda neste mesmo processo e tem de continuar respondendo.
const rodar = (script) =>
  new Promise((ok) => spawn(process.execPath, [script], { env, stdio: "inherit" }).on("exit", ok));
for (const script of ["scripts/migrate.mjs", "scripts/seed.mjs"]) {
  const status = await rodar(script);
  if (status !== 0) process.exit(status ?? 1);
}
await popularEstoqueDeExemplo(env.DATABASE_URL);

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

/** Na primeira vez, cria estoque com lotes de validades variadas para o painel não ficar vazio. */
async function popularEstoqueDeExemplo(url) {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const { rows } = await pool.query("select count(*)::int as n from movimentos");
  if (rows[0].n > 0) return pool.end();

  const hoje = new Date();
  const dia = (d) => new Date(hoje.getTime() + d * 86_400_000).toISOString().slice(0, 10);
  const { rows: usuario } = await pool.query("select id from usuarios order by id limit 1");
  const { rows: deposito } = await pool.query("select id from depositos order by id limit 1");
  const { rows: prods } = await pool.query("select id, descricao from produtos order by id");

  // [lote, dias até vencer, quantidade, custo em centavos]
  const lotes = {
    Cerveja: [["C-ANTIGO", 12, 30, 300], ["C-NOVO", 150, 96, 310]],
    Refrigerante: [["R-0925", -3, 4, 720], ["R-1025", 40, 18, 730]],
    Água: [["A-01", 200, 10, 120]],
  };
  const { rows: ent } = await pool.query(
    "insert into entradas (usuario_id, status, numero_nota, observacao, finalizada_em) values ($1,'finalizada','DEMO','Estoque inicial de demonstração', now()) returning id",
    [usuario[0].id],
  );
  for (const p of prods) {
    const chave = Object.keys(lotes).find((k) => p.descricao.startsWith(k));
    let soma = 0, valor = 0;
    for (const [numero, dias, qtd, custo] of lotes[chave] ?? []) {
      const { rows: l } = await pool.query(
        "insert into lotes (produto_id, numero, validade) values ($1,$2,$3) returning id",
        [p.id, numero, dia(dias)],
      );
      await pool.query("insert into saldos (produto_id, lote_id, deposito_id, quantidade) values ($1,$2,$3,$4)", [p.id, l[0].id, deposito[0].id, qtd]);
      await pool.query(
        "insert into movimentos (tipo, produto_id, lote_id, deposito_id, quantidade, custo_unitario, documento_tipo, documento_id, usuario_id) values ('entrada_compra',$1,$2,$3,$4,$5,'entrada',$6,$7)",
        [p.id, l[0].id, deposito[0].id, qtd, custo, ent[0].id, usuario[0].id],
      );
      soma += qtd;
      valor += qtd * custo;
    }
    if (soma) await pool.query("update produtos set custo_medio = $1 where id = $2", [Math.round(valor / soma), p.id]);
  }
  console.log("Estoque de exemplo criado (inclui um lote vencido e um vencendo, para ver os alertas).");
  await pool.end();
}
