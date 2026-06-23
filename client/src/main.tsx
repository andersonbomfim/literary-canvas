import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import { getActiveWorkIdFromStorage } from "./_core/hooks/useActiveWork";
import { initializeFallbackAmbientColor } from "@/lib/ambientColor";
import "./index.css";

function sanitizeStorageValue(value: string | null) {
  if (value == null) return null;
  const normalized = value.trim();
  if (!normalized || normalized === "undefined" || normalized === "null")
    return null;
  return normalized;
}

function clearLegacyInvalidJsonStorage() {
  if (typeof window === "undefined") return;
  const clean = (store: Storage | undefined) => {
    if (!store) return;
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key) keys.push(key);
    }
    for (const key of keys) {
      try {
        const normalized = sanitizeStorageValue(store.getItem(key));
        if (!normalized) {
          store.removeItem(key);
          continue;
        }
        if (key === "manus-runtime-user-info") JSON.parse(normalized);
      } catch {
        store.removeItem(key);
      }
    }
    store.removeItem("manus-runtime-user-info");
  };
  clean(window.localStorage);
  clean(window.sessionStorage);
}

clearLegacyInvalidJsonStorage();
initializeFallbackAmbientColor();

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;
  if (error.message !== UNAUTHED_ERR_MSG) return;
  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    redirectToLoginIfUnauthorized(event.query.state.error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    redirectToLoginIfUnauthorized(event.mutation.state.error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      async fetch(input, init) {
        const headers = new Headers(init?.headers || {});
        const activeWorkId = getActiveWorkIdFromStorage();
        if (activeWorkId) headers.set("x-active-work-id", String(activeWorkId));
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
          headers,
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
