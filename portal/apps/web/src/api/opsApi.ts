import { withApiBase } from "./tenantBase.js";

type ApiErrorBody = { error?: string; message?: string };

let opsCsrfToken = "";

async function loadOpsCsrfToken(): Promise<string> {
  const csrfRes = await fetch(withApiBase("/api/admin/auth/csrf"), {
    credentials: "include",
  });
  const csrfBody = (await csrfRes.json()) as { csrf_token?: string };
  opsCsrfToken = csrfBody.csrf_token ?? "";
  return opsCsrfToken;
}

export function resetOpsCsrfToken(): void {
  opsCsrfToken = "";
}

/**
 * Shared ops-plane fetch: `/api/admin/*` + double-submit CSRF with one
 * transparent retry after refreshing the token. Used by every admin feature
 * module so CSRF handling stays in one place.
 */
export async function opsApiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = withApiBase(path);
  const headers = new Headers(init.headers);
  const isMutation = Boolean(init.method && init.method !== "GET");

  if (isMutation) {
    if (!opsCsrfToken) {
      await loadOpsCsrfToken();
    }
    headers.set("X-CSRF-Token", opsCsrfToken);
  }
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

  let response = await fetch(url, { ...init, headers, credentials: "include" });

  if (isMutation && response.status === 403) {
    const body = (await response.clone().json().catch(() => ({}))) as ApiErrorBody;
    const msg = body.error ?? body.message ?? "";
    if (msg.toLowerCase().includes("csrf")) {
      await loadOpsCsrfToken();
      const retryHeaders = new Headers(init.headers);
      retryHeaders.set("X-CSRF-Token", opsCsrfToken);
      if (init.body && !(init.body instanceof FormData)) {
        retryHeaders.set("content-type", "application/json");
      }
      response = await fetch(url, {
        ...init,
        headers: retryHeaders,
        credentials: "include",
      });
    }
  }

  return response;
}

export function apiErrorMessage(
  body: ApiErrorBody,
  fallback: string,
  status: number,
): string {
  return body.error ?? body.message ?? `${fallback} (${status})`;
}
