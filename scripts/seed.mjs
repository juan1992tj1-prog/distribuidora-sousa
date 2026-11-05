// Cria o usuário "dono" inicial e o depósito padrão, se ainda não existirem.
// Uso: ADMIN_LOGIN=admin ADMIN_SENHA=troque123 node scripts/seed.mjs
// Com EXEMPLOS=1 cria também alguns produtos de exemplo.
import bcrypt from "bcryptjs";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const login = (process.env.ADMIN_LOGIN ?? "admin").toLowerCase();
const senha = process.env.ADMIN_SENHA;

await pool.query(`insert into depositos (nome) values ('Loja') on conflict do nothing`);

const { rows } = await pool.query("select count(*)::int as n from usuarios");
if (rows[0].n === 0) {
  if (!senha || senha.length < 6) {
    console.error("Defina ADMIN_SENHA (mínimo 6 caracteres) para criar o primeiro usuário.");
    process.exit(1);
  }
  await pool.query(
    "insert into usuarios (nome, login, senha_hash, perfil) values ($1, $2, $3, 'dono')",
    ["Administrador", login, await bcrypt.hash(senha, 10)],
  );
  console.log(`Usuário "${login}" criado com perfil dono.`);
} else {
  console.log("Já existem usuários; nada a criar.");
}

if (process.env.EXEMPLOS === "1") {
  const exemplos = [
    ["Cerveja Pilsen Lata 350ml", "Cerveja", true, "7890000000017", 450, 12, "17890000000014", 4800],
    ["Refrigerante Cola 2L", "Refrigerante", false, "7890000000024", 1099, 6, "17890000000021", 6200],
    ["Água Mineral 500ml", "Água", false, "7890000000031", 250, 12, "17890000000038", 2600],
  ];
  for (const [desc, cat, alcool, ean, preco, fator, dun, precoCx] of exemplos) {
    const existe = await pool.query("select 1 from embalagens where codigo_barras = $1", [ean]);
    if (existe.rowCount) continue;
    const c = await pool.query(
      "insert into categorias (nome) values ($1) on conflict (nome) do update set nome = excluded.nome returning id",
      [cat],
    );
    const p = await pool.query(
      "insert into produtos (descricao, categoria_id, alcoolico, perecivel, estoque_minimo) values ($1,$2,$3,true,24) returning id",
      [desc, c.rows[0].id, alcool],
    );
    await pool.query("insert into embalagens (produto_id, tipo, codigo_barras, fator, preco_venda) values ($1,'UN',$2,1,$3)", [p.rows[0].id, ean, preco]);
    await pool.query("insert into embalagens (produto_id, tipo, codigo_barras, fator, preco_venda) values ($1,'CX',$2,$3,$4)", [p.rows[0].id, dun, fator, precoCx]);
  }
  console.log("Produtos de exemplo criados (códigos fictícios 789000000000x).");
}
await pool.end();
