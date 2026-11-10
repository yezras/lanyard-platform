import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logout } from "./auth.js";
import { resetCsrfToken } from "./client.js";

function requestPath(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return new URL(raw, "http://localhost").pathname;
}

describe("logout", () => {
  beforeEach(() => {
    resetCsrfToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetCsrfToken();
  });

  it("POSTs /api/auth/logout with CSRF and resets the cached token", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(input);
      if (path === "/api/auth/csrf") {
        return new Response(JSON.stringify({ csrf_token: "csrf-1" }), {
          status: 200,
        });
      }
      if (path === "/api/auth/logout") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await logout();

    const logoutCall = fetchMock.mock.calls.find(
      ([url]) => requestPath(url as RequestInfo | URL) === "/api/auth/logout",
    );
    expect(logoutCall).toBeTruthy();
    const init = logoutCall?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("X-CSRF-Token")).toBe("csrf-1");
  });

  it("throws when logout fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path === "/api/auth/csrf") {
          return new Response(JSON.stringify({ csrf_token: "csrf-1" }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ error: "nope" }), { status: 500 });
      }),
    );

    await expect(logout()).rejects.toThrow(/Logout failed \(500\)/);
  });
});
