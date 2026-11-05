"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icones, type NomeIcone } from "./Icones";

/** Item do menu lateral; destaca a página atual com a barra âmbar. */
export function LinkMenu({ href, rotulo, icone }: { href: string; rotulo: string; icone: NomeIcone }) {
  const caminho = usePathname();
  const ativo = href === "/" ? caminho === "/" : caminho === href || caminho.startsWith(href + "/");
  const Icone = Icones[icone];
  return (
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-[0.95rem] transition-colors ${
        ativo
          ? "bg-garrafa-800 font-semibold text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-full before:bg-ambar-500"
          : "text-garrafa-100/85 hover:bg-garrafa-800/60 hover:text-white"
      }`}
    >
      <Icone className={ativo ? "text-ambar-500" : "text-garrafa-100/60"} />
      {rotulo}
    </Link>
  );
}
