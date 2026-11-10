import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch, resetCsrfToken } from "./client.js";

function requestPath(input: RequestInfo | URL): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, "http://localhost").pathname;
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (input instanceof Request) {
    input.headers.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return headers;
}

describe("apiFetch", () => {
  afterEach(() => {
    resetCsrfToken();
    vi.restoreAllMocks();
  });

  it("passes through GET requests without fetching CSRF", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/projects");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestPath(fetchMock.mock.calls[0]![0] as string)).toBe("/api/projects");
    expect(fetchMock.mock.calls.some(([url]) => requestPath(url as string) === "/api/auth/csrf")).toBe(
      false,
    );
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "include" });
  });

  it("fetches and caches CSRF for mutating requests", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(input);
      if (path === "/api/auth/csrf") {
        return Promise.resolve(
          new Response(JSON.stringify({ csrf_token: "token-1" }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({}) });
    await apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({}) });

    expect(fetchMock.mock.calls.filter(([url]) => requestPath(url as string) === "/api/auth/csrf")).toHaveLength(
      1,
    );

    const [, firstInit] = fetchMock.mock.calls.find(
      ([url]) => requestPath(url as string) === "/api/auth/login",
    )!;
    expect(requestHeaders("/api/auth/login", firstInit).get("X-CSRF-Token")).toBe("token-1");
  });

  it("sets JSON content-type for non-FormData bodies", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (requestPath(input) === "/api/auth/csrf") {
        return Promise.resolve(
          new Response(JSON.stringify({ csrf_token: "token-1" }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/staging/upload", {
      method: "POST",
      body: JSON.stringify({ path: "/tmp/file" }),
    });

    const [, init] = fetchMock.mock.calls.find(
      ([url]) => requestPath(url as string) === "/api/staging/upload",
    )!;
    expect(requestHeaders("/api/staging/upload", init).get("content-type")).toBe("application/json");
  });

  it("does not set JSON content-type for FormData uploads", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (requestPath(input) === "/api/auth/csrf") {
        return Promise.resolve(
          new Response(JSON.stringify({ csrf_token: "token-1" }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const body = new FormData();
    body.append("file", new Blob(["hello"]), "hello.txt");

    await apiFetch("/api/staging/upload", { method: "POST", body });

    const [, init] = fetchMock.mock.calls.find(
      ([url]) => requestPath(url as string) === "/api/staging/upload",
    )!;
    expect(requestHeaders("/api/staging/upload", init).get("content-type")).toBeNull();
  });

  it("refetches CSRF after resetCsrfToken", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(input);
      if (path === "/api/auth/csrf") {
        return Promise.resolve(
          new Response(JSON.stringify({ csrf_token: "token-2" }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/settings/health-check", {
      method: "POST",
      body: JSON.stringify({}),
    });
    resetCsrfToken();
    await apiFetch("/api/settings/health-check", {
      method: "POST",
      body: JSON.stringify({}),
    });

    expect(fetchMock.mock.calls.filter(([url]) => requestPath(url as string) === "/api/auth/csrf")).toHaveLength(
      2,
    );
  });

  it("returns non-OK responses without throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await apiFetch("/api/auth/me");

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
  });
});