# Rodar localmente (Windows / PowerShell)

## 1) Ir para a pasta do projeto
```powershell
cd C:\CAMINHO\PARA\SEU\PROJETO
```

## 2) Criar o `.env`
```powershell
Copy-Item .env.example .env -Force
```

## 3) Rodar no modo local, sem depender do MySQL
Esse agora é o fluxo mais estável para desenvolvimento.

```powershell
pnpm install
pnpm dev
```

O servidor abre em `http://localhost:3000`.

## 4) Se você quiser usar MySQL mesmo assim
Primeiro suba o banco:

```powershell
docker rm -f literary-mysql 2>$null
docker run --name literary-mysql -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=literary_canvas -p 3307:3306 -d mysql:8.0
```

Depois, no `.env`, troque:

```env
LOCAL_DATA_ONLY=false
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
