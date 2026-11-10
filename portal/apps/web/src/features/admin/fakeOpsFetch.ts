/**
 * Browser fetch adapter for FakeOps (lp-hdzm.30).
 *
 * Parse at the network edge, then dispatch to the in-memory store.
 */

import {
  handleFakeOpsRequest,
  type FakeOpsRequest,
  type FakeOpsStore,
} from "./fakeOps.js";

type ProofWindow = Window & {
  __fakeOpsStore?: FakeOpsStore;
};

let originalFetch: typeof fetch | null = null;

function proofWindow(): ProofWindow | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window as ProofWindow;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) {
    return init.method;
  }
  if (typeof input !== "string" && !(input instanceof URL)) {
    return input.method || "GET";
  }
  return "GET";
}

async function requestBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<unknown> {
  const raw =
    init?.body ??
    (typeof input !== "string" && !(input instanceof URL) ? undefined : undefined);
  if (raw == null || typeof raw === "undefined") {
    return null;
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return null;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function installFakeOpsFetch(store: FakeOpsStore): void {
  const win = proofWindow();
  if (!win) {
    return;
  }
  win.__fakeOpsStore = store;
  if (originalFetch) {
    return;
  }
  originalFetch = win.fetch.bind(win);
  win.fetch = async (input, init) => {
    const url = new URL(requestUrl(input), window.location.href);
    const req: FakeOpsRequest = {
      method: requestMethod(input, init),
      pathname: url.pathname,
      search: url.searchParams,
      body: await requestBody(input, init),
    };
    const current = proofWindow()?.__fakeOpsStore;
    if (!current) {
      return originalFetch!(input, init);
    }
    const handled = handleFakeOpsRequest(current, req);
    if (handled) {
      return jsonResponse(handled.body, handled.status);
    }
    return originalFetch!(input, init);
  };
}

export function resetFakeOpsFetch(): void {
  const win = proofWindow();
  if (win) {
    delete win.__fakeOpsStore;
    if (originalFetch) {
      win.fetch = originalFetch;
    }
  }
  originalFetch = null;
}
