// Reinicia manualmente um banco de DEMONSTRAÇÃO (apaga tudo e gera os 30 dias de novo).
//
//   CONFIRMAR_RESET=apagar-tudo DATABASE_URL=... npm run demo:resetar
//
// ⚠️ Nunca aponte para o banco de uma loja de verdade (há travas, mas não confie só nelas).
import pg from "pg";
import { resetarDemo } from "../src/lib/demo-reset";

if (!process.env.DATABASE_URL) {
  console.error("Defina DATABASE_URL.");
  process.exit(1);
}
if (process.env.CONFIRMAR_RESET !== "apagar-tudo") {
  console.error("Recusado: defina CONFIRMAR_RESET=apagar-tudo para confirmar que este banco é só de demonstração.");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
resetarDemo(pool)
  .then((r) => console.log(r.motivo))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
