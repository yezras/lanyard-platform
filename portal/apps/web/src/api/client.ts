import { withApiBase } from "./tenantBase.js";

let csrfToken = "";

async function loadCsrfToken(): Promise<string> {
  const csrfRes = await fetch(withApiBase("/api/auth/csrf"), {
    credentials: "include",
  });
  const csrfBody = (await csrfRes.json()) as { csrf_token?: string };
  csrfToken = csrfBody.csrf_token ?? "";
  return csrfToken;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = withApiBase(path);
  const headers = new Headers(init.headers);
  const isMutation = Boolean(init.method && init.method !== "GET");

  if (isMutation) {
    if (!csrfToken) {
      await loadCsrfToken();
    }
    headers.set("X-CSRF-Token", csrfToken);
  }
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

  let response = await fetch(url, { ...init, headers, credentials: "include" });

  if (isMutation && response.status === 403) {
    const body = (await response.clone().json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    const msg = body.error ?? body.message ?? "";
    if (msg.toLowerCase().includes("csrf")) {
      await loadCsrfToken();
      const retryHeaders = new Headers(init.headers);
      retryHeaders.set("X-CSRF-Token", csrfToken);
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

/** Reset cached CSRF token (e.g. after logout). */
export function resetCsrfToken(): void {
  csrfToken = "";
}
