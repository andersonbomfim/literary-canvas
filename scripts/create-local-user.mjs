import 'dotenv/config';
import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import postgres from 'postgres';

const scrypt = promisify(_scrypt);
const [, , emailArg, passwordArg, nameArg = 'Usuário Teste'] = process.argv;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente no .env');
  process.exit(1);
}
if (!emailArg || !passwordArg) {
  console.error('Uso: node scripts/create-local-user.mjs email@dominio.com senha-segura [Nome]');
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
const salt = randomBytes(16).toString('hex');
const derived = await scrypt(passwordArg, salt, 64);
const passwordHash = `${salt}:${Buffer.from(derived).toString('hex')}`;
const openId = `local:${email}`;

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`
  INSERT INTO "users" ("openId", "name", "email", "loginMethod", "passwordHash", "role", "lastSignedIn")
  VALUES (${openId}, ${nameArg}, ${email}, 'local', ${passwordHash}, 'user', NOW())
  ON CONFLICT ("openId") DO UPDATE
  SET "name" = EXCLUDED."name",
      "passwordHash" = EXCLUDED."passwordHash",
      "loginMethod" = 'local'
`;
console.log(`Usuário local pronto: ${email}`);
console.log(`Senha: ${passwordArg}`);
await sql.end({ timeout: 2 });
