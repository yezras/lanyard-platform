import { useEffect, useState } from "react";

import { withApiBase } from "../api/tenantBase.js";
import { resolveAuthSignInOptions } from "./authSignInOptions.js";

export type AuthSignInOptions = {
  status: "loading" | "ready";
  googleSignIn: boolean;
  googleDevStub: boolean;
  tenantSlug: string | null;
};

type PortalContext = {
  tenant_slug?: string;
};

export function useAuthOptions(): AuthSignInOptions {
  const [options, setOptions] = useState<AuthSignInOptions>({
    status: "loading",
    googleSignIn: false,
    googleDevStub: false,
    tenantSlug: null,
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let tenantSlug: string | null = null;
      let googleStatus = 503;

      try {
        const contextRes = await fetch(withApiBase("/api/context"), {
          credentials: "include",
        });
        if (contextRes.ok) {
          const context = (await contextRes.json()) as PortalContext;
          tenantSlug = context.tenant_slug ?? null;
        }
      } catch {
        // offline BFF — fall back to hostname-only local dev detection
      }

      let googleResponseType: string | undefined;
      try {
        const googleRes = await fetch(withApiBase("/api/auth/google"), {
          redirect: "manual",
          credentials: "include",
        });
        googleStatus = googleRes.status;
        googleResponseType = googleRes.type;
      } catch {
        googleStatus = 503;
      }

      const resolved = resolveAuthSignInOptions({
        hostname: window.location.hostname,
        tenantSlug,
        googleStatus,
        googleResponseType,
      });

      if (!cancelled) {
        setOptions({
          status: "ready",
          ...resolved,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return options;
}