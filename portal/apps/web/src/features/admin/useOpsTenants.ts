import { useEffect, useState } from "react";

import {
  fetchOpsTenants,
  type OpsTenantSummary,
} from "../../api/opsAdmin.js";

/** Tenant list shared by the instances/roles/audit pickers. */
export function useOpsTenants() {
  const [tenants, setTenants] = useState<OpsTenantSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchOpsTenants();
        if (!cancelled) {
          setTenants(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load tenants",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { tenants, error, isLoading };
}
