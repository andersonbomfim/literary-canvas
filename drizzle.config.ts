import { defineConfig } from "drizzle-kit";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  // PostgreSQL gets a fresh baseline. The historical MySQL migrations remain
  // in ./drizzle for reference and must never run against Supabase.
  out: "./drizzle/postgres",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
