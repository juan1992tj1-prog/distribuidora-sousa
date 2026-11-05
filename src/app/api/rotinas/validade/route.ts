import { db } from "@/db";
import { atualizarAlertas, notificarResumo } from "@/lib/validade";

/** Chamado 1x por dia pelo serviço "rotinas" (cron). Protegido por CRON_SECRET. */
export async function POST(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) {
    return Response.json({ erro: "não autorizado" }, { status: 401 });
  }
  const itens = await atualizarAlertas(db);
  const notificacao = await notificarResumo(itens).catch((e) => ({ enviado: false, erro: String(e) }));
  return Response.json({ alertas: itens.length, notificacao });
}
