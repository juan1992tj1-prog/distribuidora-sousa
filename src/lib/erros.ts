/** Erro esperado (regra de negócio): a mensagem pode ser mostrada ao usuário. */
export class ErroNegocio extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroNegocio";
  }
}

export function mensagemDeErro(e: unknown): string {
  if (e instanceof ErroNegocio) return e.message;
  // violação de restrição única do Postgres (ex.: código de barras repetido)
  const pg = e as { code?: string; cause?: { code?: string } };
  const code = pg?.code ?? pg?.cause?.code;
  if (code === "23505") return "Já existe um registro com esse valor (código de barras, login ou nome repetido).";
  if (code === "23514") return "Operação deixaria o estoque negativo.";
  console.error(e);
  return "Erro inesperado. Tente de novo; se continuar, chame o suporte.";
}

/** Executa e devolve a mensagem de erro (ou null). Útil antes de um redirect(). */
export async function tentar(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return mensagemDeErro(e);
  }
}

export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string };

export async function resultado<T>(fn: () => Promise<T>): Promise<Resultado<T>> {
  try {
    return { ok: true, dados: await fn() };
  } catch (e) {
    return { ok: false, erro: mensagemDeErro(e) };
  }
}

/** Monta a URL de volta com mensagem para o banner da página. */
export function comAviso(caminho: string, erro: string | null, ok?: string) {
  const sep = caminho.includes("?") ? "&" : "?";
  if (erro) return `${caminho}${sep}erro=${encodeURIComponent(erro)}`;
  if (ok) return `${caminho}${sep}ok=${encodeURIComponent(ok)}`;
  return caminho;
}
