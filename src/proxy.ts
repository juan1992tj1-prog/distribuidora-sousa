import { NextResponse, type NextRequest } from "next/server";

/** Checagem rápida: sem cookie de sessão, manda para o login. A validação real é feita em cada página/ação. */
export function proxy(req: NextRequest) {
  if (!req.cookies.get("sessao")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api/rotinas|api/saude|_next/static|_next/image|favicon.ico).*)"],
};
