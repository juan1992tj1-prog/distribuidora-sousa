import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { ErroNegocio } from "./erros";

export type Perfil = "dono" | "gerente" | "caixa" | "estoquista";
export type Sessao = { uid: number; nome: string; perfil: Perfil };

const COOKIE = "sessao";
const DURACAO_HORAS = 12;

function chave() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("Defina SESSION_SECRET (mínimo 32 caracteres) no .env");
  return new TextEncoder().encode(s);
}

export async function criarSessao(s: Sessao) {
  const token = await new SignJWT(s)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DURACAO_HORAS}h`)
    .sign(chave());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== "false",
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_HORAS * 3600,
  });
}

export async function encerrarSessao() {
  (await cookies()).delete(COOKIE);
}

export async function lerSessao(): Promise<Sessao | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, chave());
    return { uid: payload.uid as number, nome: payload.nome as string, perfil: payload.perfil as Perfil };
  } catch {
    return null;
  }
}

/** O que cada perfil pode fazer. Mexa aqui para mudar permissões. */
export const PERMISSOES = {
  vender: ["dono", "gerente", "caixa"],
  dar_desconto: ["dono", "gerente"],
  cancelar_venda: ["dono", "gerente"],
  /** ver o esperado e as diferenças de todos os caixas; fechar o caixa de outro operador */
  conferir_caixa: ["dono", "gerente"],
  dar_entrada: ["dono", "gerente", "estoquista"],
  ver_custo: ["dono", "gerente"],
  cadastrar_produto: ["dono", "gerente", "estoquista"],
  alterar_preco: ["dono", "gerente"],
  baixa_perda: ["dono", "gerente", "estoquista"],
  ajustar_inventario: ["dono", "gerente"],
  tratar_validade: ["dono", "gerente", "estoquista"],
  gerenciar_clientes: ["dono", "gerente", "caixa"],
  gerenciar_usuarios: ["dono"],
} as const satisfies Record<string, readonly Perfil[]>;

export type Permissao = keyof typeof PERMISSOES;

export function pode(sessao: Sessao | null, permissao: Permissao) {
  return !!sessao && (PERMISSOES[permissao] as readonly Perfil[]).includes(sessao.perfil);
}

/** Use no topo de páginas e server actions. Redireciona para o login se não houver sessão. */
export async function exigir(permissao?: Permissao): Promise<Sessao> {
  const s = await lerSessao();
  if (!s) redirect("/login");
  if (permissao && !pode(s, permissao)) throw new ErroNegocio("Seu perfil não tem permissão para esta ação.");
  return s;
}
