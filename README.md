# NexoERP — API (Backend)

Backend do sistema NexoERP: API em **Node.js + Express + Prisma + PostgreSQL**, com login via JWT e separação por empresa (multi-tenant).

O **frontend** (telas HTML) fica em outro repositório: [`sistemy`](https://github.com/joaaomenezes/sistemy). Ele conversa com esta API em `http://localhost:3333/api`.

---

## ✅ O que você precisa ter instalado

1. **Node.js** (versão 18 ou superior) — https://nodejs.org
2. **PostgreSQL** (o banco de dados) — https://www.postgresql.org/download/
3. **Git** — https://git-scm.com

> Para conferir se já tem, abra o terminal e digite `node -v` e `psql --version`.

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
Copie o arquivo de exemplo e depois preencha com os seus dados:
```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# Mac/Linux
cp .env.example .env
```
Abra o `.env` e ajuste, principalmente, a **senha do PostgreSQL** dentro de `DATABASE_URL`.

> O `.env` guarda segredos (senha do banco, chave do JWT). Ele **nunca** é enviado pro GitHub — por isso você precisa criá-lo em cada máquina.

### 4. Criar o banco de dados
Crie um banco vazio chamado `nexoerp` no PostgreSQL (pelo pgAdmin ou pelo terminal):
```bash
createdb nexoerp
```

### 5. Criar as tabelas (migrations)
Isso monta toda a estrutura do banco automaticamente:
```bash
npx prisma migrate deploy
npx prisma generate
```

### 6. Subir a API
```bash
npm run dev
```
Se aparecer algo como **"Server running on port 3333"**, está funcionando! 🎉
Deixe esse terminal aberto enquanto estiver usando o sistema.

### 7. Abrir o sistema
Abra os arquivos `.html` do repositório `sistemy` no navegador.
Como o banco começa **vazio**, use a tela de **Cadastro** para criar a sua empresa e o primeiro usuário.

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
| `npm start` | Sobe a API em modo normal |
| `npm run db:studio` | Abre o Prisma Studio (ver/editar o banco no navegador) |
| `npm run db:migrate` | Cria uma nova migration ao mudar o `schema.prisma` |

---

## ❓ Problemas comuns

- **"Can't reach database server"** → o PostgreSQL não está rodando, ou a `DATABASE_URL` no `.env` está com senha/porta errada.
- **Frontend não carrega dados** → confira se a API está rodando (passo 6) e se a porta é a `3333`.
- **`prisma migrate deploy` falhou** → confirme que o banco `nexoerp` foi criado (passo 4).
