import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { Aviso } from "@/components/Aviso";
import { auditar } from "@/lib/estoque";
import { comAviso, ErroNegocio, tentar } from "@/lib/erros";
import { exigir, type Perfil } from "@/lib/sessao";
import { MODO_DEMO } from "@/lib/demo";

export const dynamic = "force-dynamic";
const PERFIS: Perfil[] = ["dono", "gerente", "caixa", "estoquista"];

async function criar(formData: FormData) {
  "use server";
  const erro = await tentar(async () => {
    const s = await exigir("gerenciar_usuarios");
    if (MODO_DEMO) throw new ErroNegocio("Na demonstração não é possível criar usuários.");
    const perfil = String(formData.get("perfil")) as Perfil;
    const senha = String(formData.get("senha") ?? "");
    if (!PERFIS.includes(perfil)) throw new ErroNegocio("Perfil inválido.");
    if (senha.length < 6) throw new ErroNegocio("A senha precisa de pelo menos 6 caracteres.");
    const [u] = await db
      .insert(usuarios)
      .values({
        nome: String(formData.get("nome")).trim(),
        login: String(formData.get("login")).trim().toLowerCase(),
        perfil,
        senhaHash: await bcrypt.hash(senha, 10),
      })
      .returning({ id: usuarios.id });
    await auditar(db, s.uid, "criar_usuario", "usuario", u.id, { perfil });
  });
  redirect(comAviso("/usuarios", erro, "Usuário criado."));
}

async function alterar(formData: FormData) {
  "use server";
  const erro = await tentar(async () => {
    const s = await exigir("gerenciar_usuarios");
    if (MODO_DEMO) throw new ErroNegocio("Na demonstração não é possível trocar senhas nem desativar usuários.");
    const id = Number(formData.get("id"));
    if (id === s.uid && formData.get("ativo") !== "on") throw new ErroNegocio("Você não pode desativar a si mesmo.");
    const valores: Partial<typeof usuarios.$inferInsert> = { ativo: formData.get("ativo") === "on" };
    const senha = String(formData.get("senha") ?? "");
    if (senha) {
      if (senha.length < 6) throw new ErroNegocio("A senha precisa de pelo menos 6 caracteres.");
      valores.senhaHash = await bcrypt.hash(senha, 10);
    }
    await db.update(usuarios).set(valores).where(eq(usuarios.id, id));
    await auditar(db, s.uid, "alterar_usuario", "usuario", id, { ativo: valores.ativo, trocouSenha: !!senha });
  });
  redirect(comAviso("/usuarios", erro, "Usuário atualizado."));
}

export default async function Usuarios({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  await exigir("gerenciar_usuarios");
  const busca = await searchParams;
  const lista = await db.select().from(usuarios).orderBy(asc(usuarios.nome));
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <section>
        <h1>Usuários</h1>
        <Aviso busca={busca} />
        <div className="card overflow-x-auto">
          <table className="tabela">
            <thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Ativo / nova senha</th></tr></thead>
            <tbody>
              {lista.map((u) => (
                <tr key={u.id}>
                  <td>{u.nome}</td><td>{u.login}</td><td>{u.perfil}</td>
                  <td>
                    <form action={alterar} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={u.id} />
                      <input type="checkbox" name="ativo" defaultChecked={u.ativo} />
                      <input name="senha" type="password" placeholder="nova senha" className="campo mt-0 w-32 py-1" />
                      <button className="btn-neutro px-2 py-1">Salvar</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <form action={criar} className="card space-y-3 self-start">
        <h2>Novo usuário</h2>
        <div><label>Nome</label><input name="nome" className="campo" required /></div>
        <div><label>Login</label><input name="login" className="campo" required /></div>
        <div><label>Senha</label><input name="senha" type="password" className="campo" required minLength={6} /></div>
        <div>
          <label>Perfil</label>
          <select name="perfil" className="campo">{PERFIS.map((p) => <option key={p}>{p}</option>)}</select>
        </div>
        <button className="btn-primario w-full">Criar</button>
      </form>
    </div>
  );
}
