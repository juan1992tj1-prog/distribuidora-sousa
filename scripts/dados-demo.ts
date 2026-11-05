// Gera os 30 dias fictícios no banco do `npm run demo` (só se ainda não houver movimento).
import pg from "pg";
import { gerarDadosDemo } from "../src/lib/demo-dados";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
gerarDadosDemo(pool)
  .catch((e) => {
    console.error("Falha ao gerar dados de demonstração:", e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
