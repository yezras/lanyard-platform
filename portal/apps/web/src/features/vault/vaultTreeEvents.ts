/**
 * Cross-feature vault tree invalidation (lp-95v.7 / lp-95v.8).
 *
 * Project create/delete (and other host FS mutations outside VaultView) dispatch
 * this so Directory/Vault refresh immediately instead of waiting for the poll.
 */

export const VAULT_TREE_INVALIDATE_EVENT = "lanyard:vault-tree-invalidate";

export function invalidateVaultTree(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(VAULT_TREE_INVALIDATE_EVENT));
}
