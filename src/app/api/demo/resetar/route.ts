import { NextResponse } from "next/server";
import { Pool } from "pg";
import { MODO_DEMO } from "@/lib/demo";
import { resetarDemo } from "@/lib/demo-reset";

// Reinicia a demo online. Chamado todo dia pelo agendador da Vercel (vercel.json → crons).
// Só existe com MODO_DEMO=1 e roda no máximo uma vez por dia, então pode ficar público.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  if (!MODO_DEMO) return NextResponse.json({ erro: "Não disponível." }, { status: 404 });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  try {
    const r = await resetarDemo(pool, { somenteUmaVezPorDia: true });
    return NextResponse.json(r);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ feito: false, erro: String(e instanceof Error ? e.message : e) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
