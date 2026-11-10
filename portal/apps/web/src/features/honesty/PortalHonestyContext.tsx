import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { fetchPortalContext } from "../../api/context.js";
import type {
  PortalBackendCapabilities,
  PortalContext,
} from "../../api/types.js";
import {
  parseChatDelivery,
  parseVaultPlane,
  type ChatDelivery,
  type VaultPlane,
} from "./honestyCopy.js";

export type PortalHonestyContextValue = {
  /**
   * From GET /api/context. `null` while loading or if the field is absent /
   * request failed (do not invent a host outage).
   */
  brainRpcEnabled: boolean | null;
  /**
   * From GET /api/context `chat_delivery`. `null` while unknown — honesty
   * keeps guest-world relay copy.
   */
  chatDelivery?: ChatDelivery | null;
  /**
   * From GET /api/context `vault_plane`. `cp_s3` means Directory/Vault are
   * control-plane, not guest Brain RPC.
   */
  vaultPlane?: VaultPlane | null;
  /** True after the first context fetch attempt finishes (ok or error). */
  isReady: boolean;
  /**
   * Capability-derived UI state (lp-rt5.4). Null when context lacked ui or
   * fetch failed — Settings treats null as optimistic (show all sections).
   */
  ui: PortalContext["ui"] | null;
  /** Raw backend_capabilities from context when present. */
  backendCapabilities: PortalBackendCapabilities | null;
};

const PortalHonestyContext = createContext<PortalHonestyContextValue | null>(
  null,
);

export function PortalHonestyProvider({
  children,
  /**
   * Injected value for tests. When set, skips network fetch.
   */
  value: injected,
}: {
  children: ReactNode;
  value?: PortalHonestyContextValue;
}) {
  const [brainRpcEnabled, setBrainRpcEnabled] = useState<boolean | null>(
    injected?.brainRpcEnabled ?? null,
  );
  const [chatDelivery, setChatDelivery] = useState<ChatDelivery | null>(
    injected?.chatDelivery ?? null,
  );
  const [vaultPlane, setVaultPlane] = useState<VaultPlane | null>(
    injected?.vaultPlane ?? null,
  );
  const [ui, setUi] = useState<PortalContext["ui"] | null>(
    injected?.ui ?? null,
  );
  const [backendCapabilities, setBackendCapabilities] =
    useState<PortalBackendCapabilities | null>(
      injected?.backendCapabilities ?? null,
    );
  const [isReady, setIsReady] = useState(Boolean(injected));

  useEffect(() => {
    if (injected) {
      setBrainRpcEnabled(injected.brainRpcEnabled);
      setChatDelivery(injected.chatDelivery ?? null);
      setVaultPlane(injected.vaultPlane ?? null);
      setUi(injected.ui ?? null);
      setBackendCapabilities(injected.backendCapabilities ?? null);
      setIsReady(injected.isReady);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const ctx = await fetchPortalContext();
        if (!cancelled) {
          setBrainRpcEnabled(
            typeof ctx.brain_rpc_enabled === "boolean"
              ? ctx.brain_rpc_enabled
              : null,
          );
          setChatDelivery(parseChatDelivery(ctx.chat_delivery));
          setVaultPlane(parseVaultPlane(ctx.vault_plane));
          setUi(ctx.ui ?? null);
          setBackendCapabilities(ctx.backend_capabilities ?? null);
        }
      } catch {
        // Leave brainRpcEnabled / planes null — unknown; surfaces that only
        // have settings source can still show fixture honesty.
        if (!cancelled) {
          setBrainRpcEnabled(null);
          setChatDelivery(null);
          setVaultPlane(null);
          setUi(null);
          setBackendCapabilities(null);
        }
      } finally {
        if (!cancelled) {
          setIsReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [injected]);

  const value = useMemo(
    (): PortalHonestyContextValue => ({
      brainRpcEnabled,
      chatDelivery,
      vaultPlane,
      isReady,
      ui,
      backendCapabilities,
    }),
    [brainRpcEnabled, chatDelivery, vaultPlane, isReady, ui, backendCapabilities],
  );

  return (
    <PortalHonestyContext.Provider value={value}>
      {children}
    </PortalHonestyContext.Provider>
  );
}

export function usePortalHonesty(): PortalHonestyContextValue {
  const ctx = useContext(PortalHonestyContext);
  if (!ctx) {
    throw new Error(
      "usePortalHonesty must be used within PortalHonestyProvider",
    );
  }
  return ctx;
}

/** Safe outside provider (isolated unit tests / partial trees). */
export function useOptionalPortalHonesty(): PortalHonestyContextValue {
  return (
    useContext(PortalHonestyContext) ?? {
      brainRpcEnabled: null,
      chatDelivery: null,
      vaultPlane: null,
      isReady: false,
      ui: null,
      backendCapabilities: null,
    }
  );
}
