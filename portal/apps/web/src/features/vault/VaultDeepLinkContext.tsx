import { createContext, useContext, type ReactNode } from "react";

export type VaultDeepLinkContextValue = {
  /** Current deep-link path for the vault reader (null when none). */
  deepLinkPath: string | null;
  /**
   * Open a vault path in the reader and switch the portal tab to Vault.
   * Intended for chat citations (Slice B) and other deep-links.
   */
  openVaultPath: (path: string) => void;
};

const VaultDeepLinkContext = createContext<VaultDeepLinkContextValue | null>(
  null,
);

export function VaultDeepLinkProvider({
  value,
  children,
}: {
  value: VaultDeepLinkContextValue;
  children: ReactNode;
}) {
  return (
    <VaultDeepLinkContext.Provider value={value}>
      {children}
    </VaultDeepLinkContext.Provider>
  );
}

export function useVaultDeepLink(): VaultDeepLinkContextValue {
  const ctx = useContext(VaultDeepLinkContext);
  if (!ctx) {
    throw new Error("useVaultDeepLink must be used within VaultDeepLinkProvider");
  }
  return ctx;
}

/** Optional hook — returns null outside provider (e.g. unit tests of VaultView alone). */
export function useOptionalVaultDeepLink(): VaultDeepLinkContextValue | null {
  return useContext(VaultDeepLinkContext);
}
