import { useCallback, useEffect, useState } from "react";

import { withApiBase } from "../api/tenantBase.js";
import type { AuthUser } from "../api/types.js";

export type SessionState =
  | { status: "loading" }
  | { status: "authenticated"; user: AuthUser }
  | { status: "unauthenticated" };

export type UseSessionResult = {
  state: SessionState;
  setAuthenticated: (user: AuthUser) => void;
  refresh: () => void;
};

export function useSession(): UseSessionResult {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  const setAuthenticated = useCallback((user: AuthUser) => {
    setState({ status: "authenticated", user });
  }, []);

  const refresh = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    void (async () => {
      try {
        const res = await fetch(withApiBase("/api/auth/me"), {
          credentials: "include",
        });
        if (cancelled) return;

        if (res.ok) {
          const user = (await res.json()) as AuthUser;
          setState({ status: "authenticated", user });
          return;
        }

        setState({ status: "unauthenticated" });
      } catch {
        if (!cancelled) {
          setState({ status: "unauthenticated" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [version]);

  return { state, setAuthenticated, refresh };
}