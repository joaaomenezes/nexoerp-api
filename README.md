# NexoERP — API (Backend)

Backend do sistema NexoERP: API em **Node.js + Express + Prisma + PostgreSQL**, com login via JWT e separação por empresa (multi-tenant).

O **frontend** (telas HTML) fica em outro repositório: [`sistemy`](https://github.com/joaaomenezes/sistemy). Ele conversa com esta API em `http://localhost:3333/api`.

O **banco de dados** fica hospedado na nuvem (Neon — PostgreSQL). Não é necessário instalar PostgreSQL na sua máquina.

---

## ✅ O que você precisa ter instalado

1. **Node.js** (versão 18 ou superior) — https://nodejs.org
2. **Git** — https://git-scm.com

> Para conferir se já tem, abra o terminal e digite `node -v` e `git --version`.

---

## 🚀 Como rodar pela primeira vez (passo a passo)

### 1. Clonar o projeto
```bash
git clone https://github.com/joaaomenezes/nexoerp-api.git
cd nexoerp-api
```

### 2. Instalar as dependências
Isso recria a pasta `node_modules` (que não vem no clone):
```bash
npm install
```

### 3. Criar o arquivo `.env`
Copie o arquivo de exemplo:
```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# Mac/Linux
cp .env.example .env
```
Abra o `.env` e preencha as três variáveis:

```env
DATABASE_URL="<connection string do Neon — peça ao dono do projeto>"
JWT_SECRET="<frase secreta — peça ao dono do projeto>"
PORT=3333
```

> O `.env` guarda segredos (senha do banco, chave do JWT). Ele **nunca** é enviado pro GitHub — por isso você precisa criá-lo em cada máquina. Peça os valores ao João.

### 4. Criar as tabelas no banco
Isso aplica as migrations no banco Neon (já hospedado na nuvem):
```bash
npx prisma migrate deploy
npx prisma generate
```

### 5. Subir a API
```bash
npm run dev
```
Se aparecer **"NexoERP API rodando em http://localhost:3333"**, está funcionando! 🎉
Deixe esse terminal aberto enquanto estiver usando o sistema.

### 6. Abrir o sistema
Abra os arquivos `.html` do repositório `sistemy` no navegador e faça login com as credenciais de dev abaixo.

---

## 🔑 Credenciais de desenvolvimento

| Campo | Valor |
|---|---|
| **E-mail** | `admin@loja.com` |
| **Senha** | `123456` |
| **Empresa** | NexoERP Dev |

> Essas credenciais funcionam no banco de nuvem compartilhado. Não use para produção.

---

## 📅 Uso do dia a dia (após primeira configuração)

```bash
git pull              # pega as últimas alterações
npm install           # só se o package.json mudou
npm run dev           # sobe a API
```

---

## 📂 Estrutura do projeto

```
nexoerp-api/
├── server.js              # ponto de entrada (sobe o servidor)
├── prisma/
│   ├── schema.prisma      # definição de todas as tabelas
│   └── migrations/        # histórico que recria o banco do zero
├── src/
│   ├── app.js             # configuração do Express
│   ├── middleware/        # autenticação (JWT) e tratamento de erros
│   └── routes/            # uma rota por módulo (produtos, vendas, etc.)
├── .env                   # seus segredos (NÃO sobe pro GitHub)
└── .env.example           # modelo do .env
```

---

## 🔧 Comandos úteis (já configurados no `package.json`)

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe a API e reinicia sozinho ao salvar arquivos |
| `npm start` | Soba a API em modo normal |
| `npm run db:studio` | Abre o Prisma Studio (ver/editar o banco no navegador) |
| `npm run db:migrate` | Cria uma nova migration ao mudar o `schema.prisma` |

---

## ❓ Problemas comuns

- **"Can't reach database server"** → a `DATABASE_URL` no `.env` está errada ou faltando. Confirme com o dono do projeto.
- **Frontend não carrega dados** → confira se a API está rodando (passo 5) e se a porta é a `3333`.
- **`prisma migrate deploy` falhou** → verifique se a `DATABASE_URL` está correta e se há conexão com a internet.
- **Porta 3333 em uso** → outro processo está rodando. No PowerShell: `Get-NetTCPConnection -LocalPort 3333 | Select-Object OwningProcess` para achar o PID e encerrá-lo.
