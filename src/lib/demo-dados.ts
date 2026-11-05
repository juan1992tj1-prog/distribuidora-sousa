/**
 * Dados de demonstração: 30 dias de movimento de uma distribuidora fictícia.
 *
 * Usa as MESMAS regras do sistema (registrarVenda, abrirCaixa, finalizarEntrada...) para que tudo fique
 * consistente (saldos, FEFO, custo médio, fiado, caixa). Depois de cada operação, ajusta a data para o
 * dia simulado. Os números são sorteados com semente fixa: toda instalação do demo fica igual.
 *
 * Usado pelo `npm run demo` (scripts/dados-demo.ts) e pelo reset diário da demo online (lib/demo-reset.ts).
 * Todos os nomes, códigos de barras e empresas são fictícios.
 */
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import * as schema from "@/db/schema";
import type { DB } from "@/db";
import { abrirCaixa, fecharCaixa, movimentarCaixa, resumoCaixa } from "./caixa";
import {
  adicionarItemEntrada,
  cancelarVenda,
  finalizarEntrada,
  receberFiado,
  registrarSaidaAvulsa,
  registrarVenda,
  saldoFiado,
} from "./estoque";
import { FUSO, hojeIso, somarDias } from "./formato";
import { atualizarAlertas, tratarAlerta } from "./validade";

const DIAS = 30;
let pool: pg.Pool;
let db: DB;

// ---------------------------------------------------------------- sorteio com semente fixa
let semente = 20261105;
function aleatorio() {
  semente = (semente + 0x6d2b79f5) | 0;
  let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const entre = (min: number, max: number) => min + Math.floor(aleatorio() * (max - min + 1));
const chance = (p: number) => aleatorio() < p;
function embaralhar<T>(lista: T[]) {
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}

// ---------------------------------------------------------------- datas
let HOJE = hojeIso();
let agora = new Date();
const dia = (d: number) => somarDias(HOJE, d);
/** Horário (fuso de Brasília) no dia simulado; nunca no futuro. */
function quando(d: number, hora: number, minuto = 0): Date {
  const t = new Date(`${dia(d)}T${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}:00-03:00`);
  return t > agora ? new Date(agora.getTime() - 60_000) : t;
}
const q = (texto: string, valores: unknown[]) => pool.query(texto, valores);

// ---------------------------------------------------------------- códigos de barras fictícios
function digitoGs1(base: string) {
  let soma = 0;
  for (let i = 0; i < base.length; i++) soma += Number(base[base.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return String((10 - (soma % 10)) % 10);
}
const ean = (n: number) => {
  const base = `7890000000${String(n).padStart(2, "0")}`;
  return base + digitoGs1(base);
};
const dun = (n: number) => {
  const base = `1${ean(n).slice(0, 12)}`;
  return base + digitoGs1(base);
};

// ---------------------------------------------------------------- cadastro
type Tipo = "UN" | "PACK" | "FARDO" | "CX";
type Produto = {
  descricao: string;
  categoria: string;
  alcoolico?: boolean;
  perecivel?: boolean;
  minimo: number;
  precoUn: number;
  caixa?: { tipo: Tipo; fator: number; preco: number };
  /** custo por embalagem de compra (caixa, ou unidade se não houver caixa) */
  custo: number;
  fornecedor: number;
  /** unidades vendidas por dia, em média */
  giro: number;
  /** [dia da entrada, quantas embalagens de compra, validade em dias a partir de hoje (null = não perecível), lote] */
  entradas: [number, number, number | null, string][];
  /** já criado pelo seed.mjs (EXEMPLOS=1) */
  existente?: boolean;
};

const FORNECEDORES = [
  { nome: "Rio Claro Bebidas Ltda", telefone: "(11) 4000-1001" },
  { nome: "Refrescos Vale Verde Ltda", telefone: "(11) 4000-2002" },
  { nome: "Águas Serra Azul Ltda", telefone: "(11) 4000-3003" },
  { nome: "Atacado Conveniência Silva", telefone: "(11) 4000-4004" },
];

const PRODUTOS: Produto[] = [
  { descricao: "Cerveja Pilsen Lata 350ml", categoria: "Cerveja", alcoolico: true, minimo: 24, precoUn: 450, caixa: { tipo: "CX", fator: 12, preco: 4800 }, custo: 3600, fornecedor: 0, giro: 40, existente: true,
    entradas: [[-30, 60, 45, "CP2611A"], [-15, 50, 150, "CP2612B"]] },
  { descricao: "Cerveja Lata 473ml", categoria: "Cerveja", alcoolico: true, minimo: 24, precoUn: 599, caixa: { tipo: "FARDO", fator: 12, preco: 6600 }, custo: 4800, fornecedor: 0, giro: 18,
    entradas: [[-30, 30, 60, "CL0473"], [-15, 20, 160, "CL0474"]] },
  { descricao: "Cerveja Puro Malte Long Neck 355ml", categoria: "Cerveja", alcoolico: true, minimo: 24, precoUn: 799, caixa: { tipo: "CX", fator: 24, preco: 17900 }, custo: 13200, fornecedor: 0, giro: 10,
    entradas: [[-30, 10, 90, "LN3551"], [-15, 3, 200, "LN3552"]] },
  { descricao: "Vodka 1L", categoria: "Destilados", alcoolico: true, perecivel: false, minimo: 6, precoUn: 3990, caixa: { tipo: "CX", fator: 12, preco: 45000 }, custo: 30000, fornecedor: 0, giro: 0.8,
    entradas: [[-30, 2, null, ""]] },
  { descricao: "Refrigerante Cola 2L", categoria: "Refrigerante", minimo: 24, precoUn: 1099, caixa: { tipo: "CX", fator: 6, preco: 6200 }, custo: 4320, fornecedor: 1, giro: 8, existente: true,
    entradas: [[-30, 25, 50, "RC2L01"], [-15, 15, 80, "RC2L02"]] },
  { descricao: "Refrigerante Guaraná 2L", categoria: "Refrigerante", minimo: 12, precoUn: 999, caixa: { tipo: "CX", fator: 6, preco: 5600 }, custo: 4200, fornecedor: 1, giro: 6,
    entradas: [[-30, 30, 70, "RG2L01"]] },
  { descricao: "Refrigerante Cola Lata 350ml", categoria: "Refrigerante", minimo: 24, precoUn: 450, caixa: { tipo: "FARDO", fator: 12, preco: 4900 }, custo: 3300, fornecedor: 1, giro: 10,
    entradas: [[-30, 20, 100, "RCL350"], [-15, 10, 150, "RCL351"]] },
  { descricao: "Energético Lata 250ml", categoria: "Energético", minimo: 12, precoUn: 999, caixa: { tipo: "CX", fator: 6, preco: 5700 }, custo: 3600, fornecedor: 1, giro: 5,
    entradas: [[-30, 30, 8, "EN2501"]] },
  { descricao: "Suco de Uva Integral 1L", categoria: "Suco", minimo: 6, precoUn: 1499, caixa: { tipo: "CX", fator: 6, preco: 8400 }, custo: 5400, fornecedor: 1, giro: 2,
    entradas: [[-30, 12, -2, "SU1A"], [-30, 4, 12, "SU1B"]] },
  { descricao: "Água Mineral 500ml", categoria: "Água", minimo: 24, precoUn: 250, caixa: { tipo: "CX", fator: 12, preco: 2600 }, custo: 1440, fornecedor: 2, giro: 15, existente: true,
    entradas: [[-30, 30, 200, "AM5001"], [-15, 5, 210, "AM5002"]] },
  { descricao: "Água com Gás 500ml", categoria: "Água", minimo: 12, precoUn: 350, caixa: { tipo: "CX", fator: 12, preco: 3800 }, custo: 1800, fornecedor: 2, giro: 4,
    entradas: [[-30, 20, 25, "AG5001"]] },
  { descricao: "Gelo em Cubos 5kg", categoria: "Conveniência", perecivel: false, minimo: 10, precoUn: 1200, custo: 500, fornecedor: 3, giro: 6,
    entradas: [[-30, 120, null, ""], [-6, 60, null, ""]] },
  { descricao: "Carvão Vegetal 3kg", categoria: "Conveniência", perecivel: false, minimo: 5, precoUn: 1800, custo: 900, fornecedor: 3, giro: 2,
    entradas: [[-30, 50, null, ""]] },
];

type Embalagens = { produtoId: number; un: number; caixa?: { id: number; fator: number } };

async function idCategoria(nome: string) {
  const { rows } = await q("insert into categorias (nome) values ($1) on conflict (nome) do update set nome = excluded.nome returning id", [nome]);
  return rows[0].id as number;
}

async function cadastrarProdutos(): Promise<Map<string, Embalagens>> {
  const mapa = new Map<string, Embalagens>();
  let seq = 4; // 01–03 já usados pelo seed
  for (const p of PRODUTOS) {
    if (p.existente) {
      const { rows } = await q(
        `select pr.id as produto, e.id, e.tipo, e.fator from produtos pr join embalagens e on e.produto_id = pr.id where pr.descricao = $1 order by e.fator`,
        [p.descricao],
      );
      if (rows.length === 0) throw new Error(`Produto de exemplo não encontrado: ${p.descricao}`);
      await q("update produtos set estoque_minimo = $1 where id = $2", [p.minimo, rows[0].produto]);
      mapa.set(p.descricao, {
        produtoId: rows[0].produto,
        un: rows[0].id,
        caixa: rows[1] ? { id: rows[1].id, fator: rows[1].fator } : undefined,
      });
      continue;
    }
    const categoria = await idCategoria(p.categoria);
    const { rows } = await q(
      "insert into produtos (descricao, categoria_id, alcoolico, perecivel, estoque_minimo) values ($1,$2,$3,$4,$5) returning id",
      [p.descricao, categoria, p.alcoolico ?? false, p.perecivel ?? true, p.minimo],
    );
    const produtoId = rows[0].id as number;
    const n = seq++;
    const un = await q("insert into embalagens (produto_id, tipo, codigo_barras, fator, preco_venda) values ($1,'UN',$2,1,$3) returning id", [produtoId, ean(n), p.precoUn]);
    let caixa: Embalagens["caixa"];
    if (p.caixa) {
      const cx = await q("insert into embalagens (produto_id, tipo, codigo_barras, fator, preco_venda) values ($1,$2,$3,$4,$5) returning id", [produtoId, p.caixa.tipo, dun(n), p.caixa.fator, p.caixa.preco]);
      caixa = { id: cx.rows[0].id, fator: p.caixa.fator };
    }
    mapa.set(p.descricao, { produtoId, un: un.rows[0].id, caixa });
  }
  return mapa;
}

async function usuario(nome: string, login: string, perfil: string) {
  const existe = await q("select id from usuarios where login = $1", [login]);
  if (existe.rowCount) return existe.rows[0].id as number;
  const { rows } = await q("insert into usuarios (nome, login, senha_hash, perfil) values ($1,$2,$3,$4) returning id", [nome, login, await bcrypt.hash("demo123", 10), perfil]);
  return rows[0].id as number;
}

// ---------------------------------------------------------------- simulação
/**
 * Gera os 30 dias fictícios. Precisa das tabelas criadas, do usuário dono e dos 3 produtos de exemplo do seed.
 * Não faz nada se o banco já tiver movimento. Devolve quantas vendas foram geradas (0 = já havia dados).
 */
export async function gerarDadosDemo(conexao: pg.Pool): Promise<number> {
  pool = conexao;
  db = drizzle(conexao, { schema }) as unknown as DB;
  semente = 20261105;
  HOJE = hojeIso();
  agora = new Date();

  const { rows: mov } = await q("select count(*)::int as n from movimentos", []);
  if (mov[0].n > 0) {
    console.log("Banco já tem movimento; dados de demonstração não foram gerados.");
    return 0;
  }
  console.log(`Gerando ${DIAS} dias de movimento de demonstração (leva alguns segundos)...`);

  const maria = await usuario("Maria Souza", "maria", "caixa");
  const carlos = await usuario("Carlos Lima", "carlos", "gerente");
  const jose = await usuario("José Santos", "jose", "estoquista");

  const fornecedores: number[] = [];
  for (const f of FORNECEDORES) {
    const { rows } = await q("insert into fornecedores (nome, telefone) values ($1,$2) returning id", [f.nome, f.telefone]);
    fornecedores.push(rows[0].id);
  }
  const clientes: number[] = [];
  for (const [nome, telefone, limite] of [
    ["Bar do Zé", "(11) 98888-1001", 60000],
    ["Mercearia Dona Ana", "(11) 98888-2002", 80000],
    ["Lanchonete Central", "(11) 98888-3003", 30000],
    ["João Pereira", "(11) 98888-4004", 0],
  ] as const) {
    const { rows } = await q("insert into clientes (nome, telefone, limite_fiado) values ($1,$2,$3) returning id", [nome, telefone, limite]);
    clientes.push(rows[0].id);
  }
  const comFiado = clientes.slice(0, 3);
  const emb = await cadastrarProdutos();

  // entradas agrupadas por dia + fornecedor (uma nota para cada)
  const notas = new Map<string, { d: number; fornecedor: number; itens: { p: Produto; qtd: number; validade: number | null; lote: string }[] }>();
  for (const p of PRODUTOS) {
    for (const [d, qtd, validade, lote] of p.entradas) {
      const chave = `${d}|${p.fornecedor}`;
      const nota = notas.get(chave) ?? { d, fornecedor: p.fornecedor, itens: [] };
      nota.itens.push({ p, qtd, validade, lote });
      notas.set(chave, nota);
    }
  }
  let numeroNota = 4180;
  async function darEntradas(d: number) {
    for (const nota of [...notas.values()].filter((n) => n.d === d)) {
      const { rows } = await q("insert into entradas (usuario_id, fornecedor_id, numero_nota) values ($1,$2,$3) returning id", [jose, fornecedores[nota.fornecedor], String(numeroNota++)]);
      const entradaId = rows[0].id as number;
      for (const i of nota.itens) {
        const e = emb.get(i.p.descricao)!;
        await adicionarItemEntrada(db, entradaId, {
          embalagemId: e.caixa?.id ?? e.un,
          quantidadeEmbalagens: i.qtd,
          loteNumero: i.lote,
          validade: i.validade == null ? null : dia(i.validade),
          custoEmbalagem: i.p.custo,
        });
      }
      await finalizarEntrada(db, entradaId, jose);
      const t = quando(d, 7, entre(0, 50));
      await q("update entradas set criado_em = $1, finalizada_em = $1 where id = $2", [t, entradaId]);
      await q("update movimentos set criado_em = $1 where documento_tipo = 'entrada' and documento_id = $2", [t, entradaId]);
    }
  }

  const precoDe = new Map<number, number>();
  for (const p of PRODUTOS) {
    const e = emb.get(p.descricao)!;
    precoDe.set(e.un, p.precoUn);
    if (e.caixa && p.caixa) precoDe.set(e.caixa.id, p.caixa.preco);
  }

  let vendasOk = 0;
  for (let d = -DIAS + 1; d <= 0; d++) {
    const hoje = dia(d);
    const semana = new Date(`${hoje}T12:00:00Z`).getUTCDay(); // 0 = domingo
    const fimDeSemana = semana === 0 || semana === 5 || semana === 6;
    const operador = semana === 0 || semana === 1 ? carlos : maria;
    const ehHoje = d === 0;

    if (d === -DIAS + 1) await darEntradas(-DIAS);
    await darEntradas(d);

    const caixa = await abrirCaixa(db, operador, chance(0.5) ? 10000 : 15000);
    await q("update caixas set aberto_em = $1 where id = $2", [quando(d, 8, 30), caixa.id]);

    // demanda do dia → linhas de venda
    const fator = (fimDeSemana ? 1.35 : 0.85) * (ehHoje ? 0.45 : 1);
    const linhas: { embalagemId: number; quantidade: number }[] = [];
    for (const p of PRODUTOS) {
      const e = emb.get(p.descricao)!;
      let restante = Math.round(p.giro * fator * (0.6 + aleatorio() * 0.8));
      if (p.giro < 1) restante = chance(p.giro * fator) ? 1 : 0;
      while (restante > 0) {
        if (e.caixa && restante >= e.caixa.fator && chance(0.35)) {
          linhas.push({ embalagemId: e.caixa.id, quantidade: 1 });
          restante -= e.caixa.fator;
        } else {
          const n = Math.min(restante, p.categoria === "Cerveja" ? entre(1, 12) : entre(1, 3));
          linhas.push({ embalagemId: e.un, quantidade: n });
          restante -= n;
        }
      }
    }
    embaralhar(linhas);
    const vendas: (typeof linhas)[] = [];
    while (linhas.length) vendas.push(linhas.splice(0, entre(1, 3)));

    // hora atual em Brasília (o GitHub Actions roda em UTC)
    const horaAgora = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "numeric", hour12: false }).format(agora));
    const horaFim = ehHoje ? Math.min(21, horaAgora - 1) : 21;
    const idsDoDia: number[] = [];
    for (let i = 0; i < vendas.length; i++) {
      const hora = 9 + Math.floor((i / vendas.length) * Math.max(1, horaFim - 9));
      if (ehHoje && hora > horaFim) break;
      const itens = vendas[i];
      const total = itens.reduce((s, l) => s + l.quantidade * (precoDe.get(l.embalagemId) ?? 0), 0);
      const r = aleatorio();
      let pagamentos: { forma: "dinheiro" | "pix" | "cartao_debito" | "cartao_credito" | "fiado"; valor: number }[];
      let clienteId: number | null = null;
      if (r < 0.33) {
        const notas = [500, 1000, 2000, 5000, 10000].filter((n) => n >= total);
        const nota = notas.length ? notas[Math.min(notas.length - 1, entre(0, 1))] : Math.ceil(total / 1000) * 1000;
        pagamentos = [{ forma: "dinheiro", valor: chance(0.3) ? total : nota }];
      } else if (r < 0.7) pagamentos = [{ forma: "pix", valor: total }];
      else if (r < 0.85) pagamentos = [{ forma: "cartao_debito", valor: total }];
      else if (r < 0.95) pagamentos = [{ forma: "cartao_credito", valor: total }];
      else {
        clienteId = comFiado[entre(0, comFiado.length - 1)];
        pagamentos = [{ forma: "fiado", valor: total }];
      }
      const tentar = async () => registrarVenda(db, { usuarioId: operador, clienteId, itens, pagamentos, idadeConferida: true, hoje });
      let venda: Awaited<ReturnType<typeof registrarVenda>> | null = null;
      try {
        venda = await tentar();
      } catch (e) {
        if (String(e).includes("Limite")) {
          clienteId = null;
          pagamentos = [{ forma: "pix", valor: total }];
          venda = await tentar().catch(() => null);
        } // estoque insuficiente: o cliente vai embora sem comprar
      }
      if (!venda) continue;
      const t = quando(d, hora, entre(0, 59));
      await q("update vendas set criado_em = $1 where id = $2", [t, venda.vendaId]);
      await q("update movimentos set criado_em = $1 where documento_tipo = 'venda' and documento_id = $2", [t, venda.vendaId]);
      await q("update fiado_lancamentos set criado_em = $1 where venda_id = $2", [t, venda.vendaId]);
      idsDoDia.push(venda.vendaId);
      vendasOk++;

      // à tarde, se a gaveta encheu, sangria para o cofre
      if (hora >= 16 && i % 5 === 0) {
        const { dinheiroEsperado } = await resumoCaixa(db, caixa.id);
        if (dinheiroEsperado > 40000) {
          const valor = Math.floor((dinheiroEsperado - 15000) / 1000) * 1000;
          const m = await movimentarCaixa(db, { usuarioId: operador, tipo: "sangria", valor, motivo: "Cofre" });
          await q("update caixa_movimentos set criado_em = $1 where id = $2", [quando(d, hora, 30), m.id]);
        }
      }
    }

    // um cancelamento de vez em quando (gerente)
    if (!ehHoje && d % 4 === 0 && idsDoDia.length > 5) {
      const vendaId = idsDoDia[entre(0, idsDoDia.length - 1)];
      await cancelarVenda(db, vendaId, carlos, chance(0.5) ? "Cliente desistiu da compra" : "Produto registrado errado");
      const { rows } = await q("select criado_em from vendas where id = $1", [vendaId]);
      const t = new Date(new Date(rows[0].criado_em).getTime() + 5 * 60_000);
      await q("update vendas set cancelada_em = $1 where id = $2", [t, vendaId]);
      await q("update movimentos set criado_em = $1 where documento_tipo = 'venda' and documento_id = $2 and tipo = 'cancelamento_venda'", [t, vendaId]);
      await q("update fiado_lancamentos set criado_em = $1 where venda_id = $2 and tipo = 'credito'", [t, vendaId]);
    }

    // clientes pagando o fiado
    if (d === -20 || d === -10 || d === -3) {
      for (const c of comFiado) {
        const deve = await saldoFiado(db, c);
        if (deve <= 0) continue;
        const valor = Math.max(100, Math.round(deve * 0.6));
        await receberFiado(db, c, valor, chance(0.5) ? "dinheiro" : "pix", operador);
        await q("update fiado_lancamentos set criado_em = $1 where id = (select max(id) from fiado_lancamentos)", [quando(d, 17, entre(0, 59))]);
      }
    }

    // perdas
    if (d === -18 || d === -7) {
      const p = PRODUTOS[d === -18 ? 0 : 4];
      await registrarSaidaAvulsa(db, {
        tipo: "perda",
        produtoId: emb.get(p.descricao)!.produtoId,
        quantidadeBase: d === -18 ? 2 : 1,
        motivo: d === -18 ? "Lata amassada na descarga" : "Garrafa quebrou na prateleira",
        usuarioId: jose,
        hoje,
      });
      await q("update movimentos set criado_em = $1 where id = (select max(id) from movimentos)", [quando(d, 11, 15)]);
    }

    // fechamento (hoje o caixa fica aberto)
    if (!ehHoje) {
      const { dinheiroEsperado } = await resumoCaixa(db, caixa.id);
      const r = aleatorio();
      const diferenca = r < 0.8 ? 0 : r < 0.9 ? -entre(1, 40) * 5 : entre(1, 10) * 5;
      await fecharCaixa(db, {
        caixaId: caixa.id,
        usuarioId: operador,
        dinheiroContado: Math.max(0, dinheiroEsperado + diferenca),
        observacao: diferenca < 0 ? "Possível troco dado a mais" : diferenca > 0 ? "Sobraram moedas" : "",
      });
      await q("update caixas set fechado_em = $1 where id = $2", [quando(d, 22, entre(0, 30)), caixa.id]);
    }
  }

  // alertas de validade e uma ação já tomada
  await atualizarAlertas(db, HOJE);
  const { rows: alerta } = await q(
    `select a.id from alertas_validade a join lotes l on l.id = a.lote_id where l.numero = 'EN2501'`,
    [],
  );
  if (alerta[0]) {
    await tratarAlerta(db, { alertaId: alerta[0].id, acao: "promocao", observacao: "Leve 2 por R$ 18,00 no balcão", usuarioId: carlos });
  }
  // o log de auditoria fica com a data real de geração; o resto já está datado no dia simulado
  console.log(`Pronto: ${vendasOk} vendas em ${DIAS} dias, ${PRODUTOS.length} produtos, ${clientes.length} clientes.`);
  console.log("Logins extras (senha demo123): maria (caixa), carlos (gerente), jose (estoquista).");
  return vendasOk;
}
