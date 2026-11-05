import { Aviso } from "@/components/Aviso";
import { Marca, Tampinha } from "@/components/Marca";
import { entrar } from "./actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const busca = await searchParams;
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-garrafa-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Tampinha tamanho={520} semLetra className="pointer-events-none absolute -bottom-40 -right-36 opacity-[0.12]" />
        <Tampinha tamanho={88} />
        <div className="relative max-w-md">
          <h1
            className="mb-4 text-6xl leading-[0.95] font-extrabold"
            style={{ fontFamily: "var(--font-titulo)", fontStretch: "80%" }}
          >
            Distribuidora
            <br />
            <span className="text-ambar-500">Sousa</span>
          </h1>
          <p className="text-lg text-garrafa-100/80">Estoque, validade e vendas do balcão num só lugar.</p>
        </div>
        <p className="relative text-sm text-garrafa-100/50">Acesso restrito à equipe da loja.</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Marca />
          </div>
          <h2 className="mb-1 text-2xl">Entrar</h2>
          <p className="mb-6 text-tinta-suave">Use o login e a senha que o dono da loja criou para você.</p>
          <Aviso busca={busca} />
          <form action={entrar} className="space-y-4">
            <div>
              <label htmlFor="login">Login</label>
              <input id="login" name="login" className="campo" autoFocus autoComplete="username" required />
            </div>
            <div>
              <label htmlFor="senha">Senha</label>
              <input id="senha" name="senha" type="password" className="campo" autoComplete="current-password" required />
            </div>
            <button className="btn-primario w-full py-2.5">Entrar</button>
          </form>
        </div>
      </section>
    </div>
  );
}
