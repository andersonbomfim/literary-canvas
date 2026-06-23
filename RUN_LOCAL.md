# Rodar localmente (Windows / PowerShell)

## 1) Ir para a pasta do projeto
```powershell
cd C:\CAMINHO\PARA\SEU\PROJETO
```

## 2) Criar o `.env`
```powershell
Copy-Item .env.example .env -Force
```

## 3) Rodar no modo local, sem depender do PostgreSQL
Esse agora é o fluxo mais estável para desenvolvimento.

```powershell
pnpm install
pnpm dev
```

O servidor abre em `http://localhost:3000`.

## 4) Se você quiser usar PostgreSQL mesmo assim
Primeiro suba o banco:

```powershell
docker rm -f literary-postgres 2>$null
docker run --name literary-postgres -e POSTGRES_DB=literary_canvas -e POSTGRES_USER=literary -e POSTGRES_PASSWORD=literary_secret -p 5432:5432 -d postgres:16-alpine
```

Depois, no `.env`, troque:

```env
LOCAL_DATA_ONLY=false
DATABASE_URL=postgresql://literary:literary_secret@127.0.0.1:5432/literary_canvas
```

E rode:

```powershell
pnpm install
pnpm db:push
pnpm dev
```

## 5) Criar usuário local por comando (opcional)
```powershell
node scripts/create-local-user.mjs teste@teste.com Senha123 "Usuário Teste"
```

## 6) Testar cadastro via API
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/auth/register" -Method POST -Headers @{ "Content-Type" = "application/json" } -Body '{"name":"Teste","email":"teste2@teste.com","password":"Senha123","confirmPassword":"Senha123"}'
```
