# Distribuidora Sousa — Sistema de Estoque (balcão)

Sistema web para pequena distribuidora de bebidas: entrada de mercadorias com leitor de código de barras/QR,
estoque por **lote e validade (FEFO)**, venda no balcão, alertas de vencimento, fiado e controle de acesso por perfil.

Roda num **mini-PC dentro da loja** (Docker). Caixa e celulares acessam pelo navegador, na rede local.
Backup diário criptografado, com cópia opcional na nuvem.

> Versão **gerencial**: ainda **não emite NF-e/NFC-e**. Enquanto isso, use o emissor que a loja já tem.
> Os campos NCM/CEST já existem no cadastro para quando o módulo fiscal entrar.

## Testar no seu computador (1 comando)

Precisa só do **Node.js 22 ou mais novo** (https://nodejs.org). Funciona em Windows, Mac e Linux.

```bash
npm install
npm run demo
```
Abra **http://localhost:3000** e entre com `admin` / `admin123`.
O modo demo já vem com produtos e estoque de exemplo, incluindo um lote vencido e um vencendo.
Os dados ficam salvos em `.dados-demo/`. Para começar do zero: `npm run demo -- --zerar`.

Para testar a importação de nota: em **Entrada → Começar conferência → Importar XML da NF-e**, escolha o arquivo
`exemplos/nfe-exemplo.xml` (nota fictícia). Depois bipe `17890000000014` (5×) e `7890000000024` e veja a comparação.

Códigos para digitar (ou bipar) no campo do leitor: `7890000000017` (lata), `17890000000014` (caixa com 12),
`7890000000024` (refrigerante). Para simular um QR GS1 com lote e validade, digite na Entrada:
`(01)07890000000024(17)271231(10)LOTE1`

---

## O que já faz

| Módulo | Funcionalidades |
|---|---|
| **Acesso** | Login, 4 perfis (dono, gerente, caixa, estoquista), permissões em `src/lib/sessao.ts`, log de auditoria |
| **Produtos** | Embalagens com fator (UN, pack, fardo, caixa), cada uma com seu código de barras e preço; validação do dígito do EAN; marcação de perecível e alcoólico |
| **NF-e do fornecedor** | Importa o XML da nota; reconhece os itens pelo código de barras (comercial ou tributável) ou por vínculo aprendido; **conferência cega** (o estoquista não vê as quantidades); comparação nota × contado com faltas e sobras; finalizar com divergência exige confirmação do gerente e fica na auditoria; custo e lote/validade vêm da nota |
| **Entrada** | Conferência bipando cada volume; lê **EAN, DUN-14, GS1-128, DataMatrix e QR GS1** (lote e validade vêm sozinhos); validade rápida DDMMAA; custo médio ponderado |
| **Estoque** | Saldo por produto + lote; kardex completo; perdas, vencidos, consumo interno, devolução; inventário com ajuste e motivo |
| **Caixa** | Abertura com fundo de troco (sem caixa aberto não vende); sangria e suprimento; **fechamento cego** com contagem por cédula/moeda; relatório por forma de pagamento com esperado × contado (sobra/falta); gerente confere e fecha caixa de outro operador; cancelamento de venda de caixa já fechado vira estorno no caixa atual |
| **Sugestão de compra** | Giro dos últimos 7–90 dias × estoque vendável × mínimo; quantidade arredondada na caixa/fardo; agrupada pelo último fornecedor, com custo estimado e botão "Copiar pedido" para mandar no WhatsApp |
| **Venda (PDV)** | Leitor USB ou câmera; `3*código` para multiplicar; busca por nome; **FEFO automático** (sai o lote que vence primeiro, vencido nunca é vendido); dinheiro com troco, Pix, cartão, fiado, pagamento misto; **confirmação de idade** para bebida alcoólica; cancelamento com estorno (gerente) |
| **Validade** | Faixas 15/30/60/90 dias + vencido; painel com valor em risco; ações: promoção, troca com fornecedor, descarte (baixa automática); recálculo diário e aviso por webhook |
| **Fiado** | Limite por cliente, saldo devedor, recebimento |
| **Painel** | Vendas do dia, itens abaixo do mínimo, lotes em alerta, valor do estoque, curva ABC (30 dias) |

## Como está organizado

```
src/
  db/schema.ts        ← tabelas (ponto de partida para entender o sistema)
  lib/estoque.ts      ← TODAS as regras de estoque: entrada, venda FEFO, cancelamento, perdas, inventário
  lib/caixa.ts        ← abertura, sangria/suprimento, fechamento cego e cálculo do dinheiro esperado
  lib/compras.ts      ← sugestão de compra (giro × estoque mínimo)
  lib/validade.ts     ← faixas e alertas de vencimento
  lib/gs1.ts          ← leitura de códigos (EAN, GS1, QR Digital Link)
  lib/sessao.ts       ← login e tabela de permissões por perfil
  app/                ← telas (cada pasta = uma página) e suas server actions
drizzle/              ← migrações SQL do banco (geradas a partir do schema)
infra/                ← Caddy (HTTPS) e rotinas (backup + alertas)
tests/                ← testes automáticos das regras (rodam num PostgreSQL em memória)
```

**Regra de ouro:** o saldo nunca é editado direto. Toda mudança passa por `movimentar()` em `lib/estoque.ts`,
que grava o movimento e ajusta o saldo na mesma transação (e o banco recusa saldo negativo).
Quantidades são sempre em **unidades**; dinheiro sempre em **centavos**.

---

## Instalação no mini-PC

### 1. Hardware e rede
- Mini-PC (ex.: Intel N100, 16 GB RAM, SSD 512 GB) **ligado num nobreak**, por cabo no roteador.
- No roteador, **reserve um IP fixo** para o mini-PC (ex.: `192.168.0.10`).

### 2. Sistema operacional
Instale **Ubuntu Server 24.04 LTS** e depois o Docker:
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # saia e entre de novo
```

### 3. Subir o sistema
```bash
git clone <seu-repositorio> distribuidora && cd distribuidora
cp .env.example .env
nano .env        # troque TODAS as senhas (gere com: openssl rand -base64 36)
docker compose up -d --build
docker compose logs -f app    # aguarde "Ready"
```
No `.env`, em `ENDERECO_LOJA`, coloque o IP e/ou nome do mini-PC, separados por vírgula:
`ENDERECO_LOJA=192.168.0.10, estoque.local`

Acesse **https://192.168.0.10** e entre com `ADMIN_LOGIN` / `ADMIN_SENHA`.
Depois, em **Usuários**, crie um usuário para cada pessoa e **troque a senha do admin**.

### 4. Confiar no certificado HTTPS (uma vez por aparelho)
A câmera do celular só funciona em HTTPS. O Caddy gera um certificado próprio da loja; instale a raiz dele nos aparelhos:
```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./certificado-loja.crt
```
- **Windows (PC do caixa):** clique duas vezes em `certificado-loja.crt` → Instalar → "Autoridades de Certificação Raiz Confiáveis".
- **Android:** Configurações → Segurança → Criptografia e credenciais → Instalar certificado → Certificado CA.
- **iPhone:** abra o arquivo → Ajustes → Perfil baixado → Instalar; depois Ajustes → Geral → Sobre → Confiança de certificados → ativar.

### 5. Leitor de código de barras
- Use um leitor **2D (imager)** em modo **USB-HID (teclado)** com **Enter (CR) como sufixo**. Ele lê EAN, QR e DataMatrix.
- Para códigos GS1 com lote/validade: configure o leitor para **trocar o caractere FNC1/GS por `~`**
  (opção "GS replacement" ou "FNC1 substitution" no manual). O sistema converte de volta.
- Teste em *Entrada*: bipe uma caixa; o produto deve aparecer na hora.

---

## Backup (faça isso no primeiro dia)

O serviço `rotinas` faz, **todo dia às 02:30**:
1. dump do banco **criptografado** com `BACKUP_SENHA` (AES-256);
2. teste de leitura do arquivo gerado;
3. retenção de 7 diários, 4 semanais e 12 mensais em `./backups`;
4. envio para a nuvem, se `RCLONE_DESTINO` estiver configurado.

**Configurar a nuvem** (Backblaze B2, Google Drive, etc.):
```bash
docker compose run --rm rotinas rclone config --config /config/rclone/rclone.conf
# crie um remoto (ex.: "b2") e depois no .env:  RCLONE_DESTINO=b2:minha-bucket/distribuidora
docker compose up -d rotinas
```
**Rodar um backup agora:** `docker compose exec rotinas sh -c '. /rotinas/env.sh && /rotinas/backup.sh'`

**Restaurar:**
`docker compose exec rotinas sh -c '. /rotinas/env.sh && /rotinas/restaurar.sh /backups/diario/<arquivo>.dump.gpg'`

> ⚠️ Guarde a `BACKUP_SENHA` **fora do mini-PC** (gerenciador de senhas do dono). Sem ela o backup não abre.
> Teste uma restauração por mês, num computador separado.

**Se o mini-PC quebrar:** instale Docker em outra máquina, copie o projeto e o `.env`, rode `docker compose up -d`,
e restaure o último backup. Leva cerca de uma hora.

## Alertas de validade
Todo dia às 06:00 os alertas são recalculados. Para receber no WhatsApp/Telegram/e-mail, aponte
`WEBHOOK_ALERTAS` para um serviço que receba `POST {texto, itens}` (ex.: um fluxo no n8n ou um provedor de WhatsApp).
As faixas mudam em `FAIXAS_VALIDADE` (padrão `15,30,60,90`).

## Manutenção remota
Instale o **Tailscale** no mini-PC e no seu computador (`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`).
Você acessa o mini-PC por SSH de qualquer lugar, sem abrir portas no roteador.

**Atualizar o sistema** (fora do horário de movimento):
```bash
cd distribuidora
docker compose exec rotinas sh -c '. /rotinas/env.sh && /rotinas/backup.sh'   # backup antes
git pull
docker compose up -d --build        # as migrações do banco rodam sozinhas ao subir
```

---

## Desenvolvimento

```bash
npm install
npm run demo        # sistema + banco em modo desenvolvimento (recarrega ao salvar arquivos)
npm test            # testes das regras de estoque (PostgreSQL em memória, não precisa instalar nada)
npm run typecheck   # checagem de tipos
```

**Mudou o banco?** Edite `src/db/schema.ts`, rode `npm run db:generate` (cria a migração em `drizzle/`) e faça commit.

## Próximos passos sugeridos
1. **Pix com QR dinâmico** e baixa automática (API do banco/PSP).
2. **Buscar a NF-e direto na SEFAZ** pela chave/manifestação do destinatário (exige certificado digital).
3. **Módulo fiscal** (NFC-e/NF-e), usando um serviço de emissão pronto e parametrizando a Reforma Tributária.
