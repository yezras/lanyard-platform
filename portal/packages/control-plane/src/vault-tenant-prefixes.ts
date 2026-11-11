/**
 * lp-2qs.7 — vault tenant prefix listing for /admin union.
 *
 * CP is the only S3 caller (no @aws-sdk in BFF). Lists the vault bucket
 * with prefix `tenants/` + delimiter `/`, parses `common_prefixes`
 * (`tenants/{id}/`) through `assertValidTenantIdForVaultPrefix`. Ignores
 * non-tenant keys. Helper lives next to vault-http / vault-prefix.
 */

import {
  assertValidTenantIdForVaultPrefix,
  type VaultObjectStore,
} from "./vault-prefix.js";

export const VAULT_TENANT_PREFIXES_ROUTE =
  "/internal/vault/tenant-prefixes" as const;

export const VAULT_TENANT_PREFIXES_API_PATH = VAULT_TENANT_PREFIXES_ROUTE;

const TENANTS_PREFIX = "tenants/";
const TENANTS_PREFIX_LEN = TENANTS_PREFIX.length;

/**
 * Extract tenant id from a single S3 common prefix like `tenants/{id}/`.
 * Returns null when the prefix is not a well-formed single-segment tenant id.
 */
export function tenantIdFromVaultCommonPrefix(
  commonPrefix: string,
): string | null {
  if (!commonPrefix.startsWith(TENANTS_PREFIX)) {
    return null;
  }
  if (!commonPrefix.endsWith("/")) {
    return null;
  }
  const inner = commonPrefix.slice(TENANTS_PREFIX_LEN, -1);
  if (!inner || inner.includes("/")) {
    return null;
  }
  try {
    return assertValidTenantIdForVaultPrefix(inner);
  } catch {
    return null;
  }
}

/**
 * List distinct vault tenant ids by scanning S3 common prefixes under
 * `tenants/` with delimiter `/`. Handles paginated `listPrefix` results.
 * Ignores prefixes that fail `assertValidTenantIdForVaultPrefix`.
 */
export async function listVaultTenantIds(input: {
  bucket: string;
  store: VaultObjectStore;
}): Promise<string[]> {
  const { bucket, store } = input;
  const seen = new Set<string>();
  let cursor: string | undefined;

  do {
    const page = await store.listPrefix({
      bucket,
      prefix: TENANTS_PREFIX,
      delimiter: "/",
      cursor,
    });

    for (const common of page.common_prefixes ?? []) {
      const tid = tenantIdFromVaultCommonPrefix(common);
      if (tid) {
        seen.add(tid);
      }
    }

    cursor = page.truncated ? page.next_cursor : undefined;
  } while (cursor);

  return [...seen].sort((a, b) => a.localeCompare(b));
}
