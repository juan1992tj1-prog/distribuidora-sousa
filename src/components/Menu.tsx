import { pode, type Sessao } from "@/lib/sessao";
import { sair } from "@/app/login/actions";
import { Icones, type NomeIcone } from "./Icones";
import { LinkMenu } from "./LinkMenu";
import { Marca } from "./Marca";

type Item = { href: string; rotulo: string; icone: NomeIcone; ver: boolean };

const PERFIL: Record<string, string> = { dono: "Dono", gerente: "Gerente", caixa: "Caixa", estoquista: "Estoquista" };

function grupos(s: Sessao): { titulo: string; itens: Item[] }[] {
  const todos: { titulo: string; itens: Item[] }[] = [
    {
      titulo: "Operação",
      itens: [
        { href: "/", rotulo: "Início", icone: "inicio", ver: true },
        { href: "/venda", rotulo: "Vender", icone: "vender", ver: pode(s, "vender") },
        { href: "/caixa", rotulo: "Caixa", icone: "caixa", ver: pode(s, "vender") },
        { href: "/vendas", rotulo: "Vendas", icone: "vendas", ver: pode(s, "vender") },
        { href: "/entrada", rotulo: "Entrada", icone: "entrada", ver: pode(s, "dar_entrada") },
        { href: "/compras", rotulo: "Sugestão de compra", icone: "compras", ver: pode(s, "dar_entrada") },
      ],
    },
    {
      titulo: "Estoque",
      itens: [
        { href: "/estoque", rotulo: "Estoque", icone: "estoque", ver: true },
        { href: "/validade", rotulo: "Validade", icone: "validade", ver: true },
        { href: "/produtos", rotulo: "Produtos", icone: "produtos", ver: true },
      ],
    },
    {
      titulo: "Cadastros",
      itens: [
        { href: "/clientes", rotulo: "Clientes e fiado", icone: "clientes", ver: pode(s, "gerenciar_clientes") },
        { href: "/fornecedores", rotulo: "Fornecedores", icone: "fornecedores", ver: pode(s, "dar_entrada") },
        { href: "/usuarios", rotulo: "Usuários", icone: "usuarios", ver: pode(s, "gerenciar_usuarios") },
      ],
    },
  ];
  return todos
    .map((g) => ({ ...g, itens: g.itens.filter((i) => i.ver) }))
    .filter((g) => g.itens.length > 0);
}

function Navegacao({ sessao }: { sessao: Sessao }) {
  return (
    <nav className="space-y-5" aria-label="Menu principal">
      {grupos(sessao).map((g) => (
        <div key={g.titulo}>
          <div className="mb-1.5 px-3 text-xs font-medium text-garrafa-100/45">{g.titulo}</div>
          <div className="space-y-0.5">
            {g.itens.map((i) => (
              <LinkMenu key={i.href} href={i.href} rotulo={i.rotulo} icone={i.icone} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Usuario({ sessao }: { sessao: Sessao }) {
  const iniciais = sessao.nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <div className="flex items-center gap-3 rounded-lg bg-garrafa-950/50 p-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ambar-500 text-sm font-bold text-garrafa-950">
        {iniciais}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm font-semibold text-white">{sessao.nome}</span>
        <span className="block text-xs text-garrafa-100/60">{PERFIL[sessao.perfil]}</span>
      </span>
      <form action={sair}>
        <button className="rounded-md p-1.5 text-garrafa-100/70 hover:bg-garrafa-800 hover:text-white" title="Sair">
          <Icones.sair />
          <span className="sr-only">Sair</span>
        </button>
      </form>
    </div>
  );
}

/** Menu lateral fixo no computador; no celular vira uma barra com menu que abre e fecha. */
export function Menu({ sessao }: { sessao: Sessao }) {
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-garrafa-900 px-3 py-5 lg:flex">
        <div className="mb-7 px-3">
          <Marca clara />
        </div>
        <div className="flex-1 overflow-y-auto">
          <Navegacao sessao={sessao} />
        </div>
        <Usuario sessao={sessao} />
      </aside>

      <header className="sticky top-0 z-30 bg-garrafa-900 lg:hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
            <Marca clara />
            <span className="rounded-md p-2 text-white group-open:bg-garrafa-800">
              <Icones.menu />
              <span className="sr-only">Abrir menu</span>
            </span>
          </summary>
          <div className="space-y-4 border-t border-garrafa-800 px-3 pb-4 pt-3">
            <Navegacao sessao={sessao} />
            <Usuario sessao={sessao} />
          </div>
        </details>
      </header>
    </>
  );
}
