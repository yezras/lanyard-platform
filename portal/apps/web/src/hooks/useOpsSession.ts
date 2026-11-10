import { useCallback, useEffect, useState } from "react";

import { fetchOpsMe, type OpsOperator } from "../api/opsAuth.js";

export type OpsSessionState =
  | { status: "loading" }
  | { status: "authenticated"; operator: OpsOperator }
  | { status: "unauthenticated" };

export type UseOpsSessionResult = {
  state: OpsSessionState;
  setAuthenticated: (operator: OpsOperator) => void;
  refresh: () => void;
};

export function useOpsSession(): UseOpsSessionResult {
  const [state, setState] = useState<OpsSessionState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  const setAuthenticated = useCallback((operator: OpsOperator) => {
    setState({ status: "authenticated", operator });
  }, []);

  const refresh = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    void (async () => {
      try {
        const operator = await fetchOpsMe();
        if (cancelled) return;
        if (operator) {
          setState({ status: "authenticated", operator });
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
