import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";

/** Tipo comum ao banco real (node-postgres) e ao banco de testes (PGlite). */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalParaDb = globalThis as unknown as { pool?: Pool };

const pool =
  globalParaDb.pool ??
  new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== "production") globalParaDb.pool = pool;

export const db: DB = drizzle(pool, { schema }) as unknown as DB;
export { schema };
