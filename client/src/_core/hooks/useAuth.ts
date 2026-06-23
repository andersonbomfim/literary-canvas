import { getLoginUrl } from "@/const";
import { readJsonSafely, toFriendlyErrorMessage } from "@/lib/authClient";
import { useCallback, useEffect, useState } from "react";

type AuthUser = {
  id: number;
  openId: string;
  name: string;
  email: string | null;
  loginMethod: string | null;
  role: "user" | "admin";
  createdAt: string | Date;
  updatedAt: string | Date;
  lastSignedIn: string | Date | null;
};

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
};

type MeResponse = {
  success: boolean;
  user: AuthUser | null;
  error: string;
};

// A13: previously we mirrored the entire authenticated user object (id,
// openId, email, role, ...) into BOTH localStorage AND sessionStorage on every
// refresh. Anything an XSS could read became PII exfiltration. We now only
// scrub the legacy keys; user info lives in the httpOnly session cookie + this
// hook's React state, where it belongs.
function clearLegacyRuntimeUserInfo() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("manus-runtime-user-info");
    window.sessionStorage.removeItem("manus-runtime-user-info");
  } catch {
    /* ignore — quota or disabled storage */
  }
}

export function useAuth(options: UseAuthOptions = {}) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
    isAuthenticated: false,
  });

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
      });

      const data = await readJsonSafely<MeResponse>(response);

      if (!response.ok) {
        throw new Error(data.error || "Não foi possível validar sua sessão.");
      }

      const user = data.user ?? null;
      clearLegacyRuntimeUserInfo();
      const nextState: AuthState = {
        user,
        loading: false,
        error: null,
        isAuthenticated: Boolean(user),
      };
      setState(nextState);
      return nextState;
    } catch (error) {
      clearLegacyRuntimeUserInfo();
      const nextState: AuthState = {
        user: null,
        loading: false,
        error: toFriendlyErrorMessage(error),
        isAuthenticated: false,
      };
      setState(nextState);
      return nextState;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const result = await refresh();
      if (cancelled) return;
      setState(result);
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!options.redirectOnUnauthenticated) return;
    if (state.loading || state.isAuthenticated) return;

    const redirectTo = options.redirectPath || getLoginUrl();
    if (
      typeof window !== "undefined" &&
      window.location.pathname !== redirectTo
    ) {
      window.location.href = redirectTo;
    }
  }, [
    options.redirectOnUnauthenticated,
    options.redirectPath,
    state.isAuthenticated,
    state.loading,
  ]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
      });
    } catch {
      // no-op
    }

    clearLegacyRuntimeUserInfo();
    setState({
      user: null,
      loading: false,
      error: null,
      isAuthenticated: false,
    });
  }, []);

  return {
    ...state,
    refresh,
    logout,
  };
}
