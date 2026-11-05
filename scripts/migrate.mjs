// Aplica as migrações pendentes do banco (pasta ./drizzle). Roda sozinho ao subir o container.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
for (let tentativa = 1; ; tentativa++) {
  try {
    await pool.query("select 1");
    break;
  } catch (e) {
    if (tentativa >= 30) throw e;
    console.log(`Aguardando o banco... (${tentativa})`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
console.log("Migrações aplicadas.");
await pool.end();
