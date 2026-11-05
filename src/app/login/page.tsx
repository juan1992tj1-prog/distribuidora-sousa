import { Aviso } from "@/components/Aviso";
import { Marca, Tampinha } from "@/components/Marca";
import { ACESSOS_DEMO, MODO_DEMO } from "@/lib/demo";
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
          {MODO_DEMO && (
            <div className="mb-6 rounded-xl border border-ambar-300 bg-ambar-100/60 p-4">
              <p className="mb-3 text-sm text-tinta">
                <b>Demonstração com dados fictícios.</b> Entre com um clique em qualquer perfil:
              </p>
              <div className="grid gap-2">
                {ACESSOS_DEMO.map((a) => (
                  <form key={a.login} action={entrar}>
                    <input type="hidden" name="login" value={a.login} />
                    <input type="hidden" name="senha" value={a.senha} />
                    <button className="btn-neutro w-full justify-between px-3 py-2 text-left">
                      <span>
                        <span className="block">{a.perfil}</span>
                        <span className="block text-xs font-normal text-tinta-suave">{a.descricao}</span>
                      </span>
                      <span className="text-xs font-normal text-tinta-suave">{a.login}</span>
                    </button>
                  </form>
                ))}
              </div>
            </div>
          )}
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
