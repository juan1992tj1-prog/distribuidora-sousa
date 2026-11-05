import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { DB } from "@/db";

export async function bancoDeTeste() {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  const [usuario] = await db
    .insert(schema.usuarios)
    .values({ nome: "Teste", login: "teste", senhaHash: "x", perfil: "dono" })
    .returning();
  return { db, usuarioId: usuario.id, fechar: () => client.close() };
}

/** Cria "Cerveja lata" com embalagens UN (R$ 4,00) e CX 12 (R$ 42,00). */
export async function criarCerveja(db: DB, extra: Partial<typeof schema.produtos.$inferInsert> = {}) {
  const [p] = await db
    .insert(schema.produtos)
    .values({ descricao: "Cerveja Lata 350ml", alcoolico: true, perecivel: true, ...extra })
    .returning();
  const [un] = await db
    .insert(schema.embalagens)
    .values({ produtoId: p.id, tipo: "UN", codigoBarras: "7891234567895", fator: 1, precoVenda: 400 })
    .returning();
  const [cx] = await db
    .insert(schema.embalagens)
    .values({ produtoId: p.id, tipo: "CX", codigoBarras: "17891234567892", fator: 12, precoVenda: 4200 })
    .returning();
  return { produto: p, un, cx };
}
