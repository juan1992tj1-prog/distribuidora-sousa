"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { criarSessao, encerrarSessao } from "@/lib/sessao";

export async function entrar(formData: FormData) {
  const login = String(formData.get("login") ?? "").trim().toLowerCase();
  const senha = String(formData.get("senha") ?? "");
  const [u] = await db.select().from(usuarios).where(eq(usuarios.login, login));
  if (!u || !u.ativo || !(await bcrypt.compare(senha, u.senhaHash))) {
    redirect("/login?erro=" + encodeURIComponent("Login ou senha inválidos."));
  }
  await criarSessao({ uid: u.id, nome: u.nome, perfil: u.perfil });
  redirect(u.perfil === "caixa" ? "/venda" : "/");
}

export async function sair() {
  await encerrarSessao();
  redirect("/login");
}
