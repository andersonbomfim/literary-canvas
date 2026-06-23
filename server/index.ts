/**
 * This file is intentionally a re-export.
 * The actual server entry point lives at server/_core/index.ts
 * which is invoked by `pnpm dev` (tsx watch server/_core/index.ts).
 *
 * This file exists only so that imports from "server/index" don't break.
 */
export { appRouter, type AppRouter } from "./routers";
