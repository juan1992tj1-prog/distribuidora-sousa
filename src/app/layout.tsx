import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque/wdth.css";
import "@fontsource-variable/public-sans/wght.css";
import "./globals.css";
import { lerSessao } from "@/lib/sessao";
import { Menu } from "@/components/Menu";
import { MODO_DEMO } from "@/lib/demo";

export const metadata: Metadata = { title: "Distribuidora Sousa" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0e3b2e" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const sessao = await lerSessao();
  return (
    <html lang="pt-BR">
      <body>
        {sessao ? (
          <>
            <Menu sessao={sessao} />
            {MODO_DEMO && (
              <div className="bg-ambar-500 px-4 py-1.5 text-center text-sm font-medium text-garrafa-950 lg:ml-64 print:hidden">
                Demonstração: todos os dados são fictícios e voltam ao normal todo dia. Fique à vontade para testar.
              </div>
            )}
            <main className="px-4 py-6 lg:ml-64 lg:px-10 lg:py-8">
              <div className="mx-auto max-w-6xl">{children}</div>
            </main>
          </>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
