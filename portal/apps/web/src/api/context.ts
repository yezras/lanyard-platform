import { withApiBase } from "./tenantBase.js";
import type { PortalContext } from "./types.js";

type ApiErrorBody = { error?: string };

async function parseError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  return body.error ?? fallback;
}

/**
 * GET /api/context — session bootstrap fields including brain_rpc_enabled.
 * Does not require CSRF (GET). Never logs or returns secrets.
 */
export async function fetchPortalContext(): Promise<PortalContext> {
  const res = await fetch(withApiBase("/api/context"), {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(await parseError(res, `Portal context failed (${res.status})`));
  }
  return (await res.json()) as PortalContext;
}
