/**
 * Modo demonstração pública (MODO_DEMO=1): usado na demo online do portfólio.
 * - a tela de login mostra os acessos de teste e entra com um clique;
 * - uma faixa avisa que os dados são fictícios e reiniciados todo dia;
 * - não deixa criar usuários nem trocar senhas (para um visitante não trancar os outros fora).
 */
export const MODO_DEMO = process.env.MODO_DEMO === "1";

export const ACESSOS_DEMO = [
  { login: "admin", senha: process.env.ADMIN_SENHA ?? "admin123", perfil: "Dono", descricao: "vê tudo: custos, caixas, usuários" },
  { login: "maria", senha: "demo123", perfil: "Caixa", descricao: "caixa aberto, pronta para vender" },
  { login: "carlos", senha: "demo123", perfil: "Gerente", descricao: "confere caixas e cancela vendas" },
  { login: "jose", senha: "demo123", perfil: "Estoquista", descricao: "entrada de mercadoria e validade" },
] as const;
