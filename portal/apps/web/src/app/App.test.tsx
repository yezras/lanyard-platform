import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";
import { Providers } from "./providers.js";
import { renderWithPortalRouter } from "../test/MemoryPortalRouter.js";

class MockEventSource {
  close(): void {}
  addEventListener(): void {}
}

function requestPath(input: RequestInfo | URL): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, "http://localhost").pathname;
}

function mockFetch(handlers: Record<string, () => Response | Promise<Response>>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const path = requestPath(input);
    if (path === "/api/auth/csrf") {
      return Promise.resolve(
        new Response(JSON.stringify({ csrf_token: "csrf-test" }), { status: 200 }),
      );
    }
    if (path === "/api/chat/threads" && (!init?.method || init.method === "GET")) {
      return Promise.resolve(
        new Response(JSON.stringify({ threads: [] }), { status: 200 }),
      );
    }
    if (path === "/api/chat/threads" && init?.method === "POST") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            thread_id: "thread-1",
            title: "New chat",
            project_id: null,
            project_vault_path: null,
            created_at: "2026-07-01T12:00:00.000Z",
          }),
          { status: 201 },
        ),
      );
    }
    const handler = handlers[path];
    if (!handler) {
      return Promise.resolve(new Response(JSON.stringify({ error: "not found" }), { status: 404 }));
    }
    return Promise.resolve(handler());
  });
}

function renderApp() {
  return render(
    <Providers>
      <App />
    </Providers>,
  );
}

async function renderAuthenticatedApp() {
  return renderWithPortalRouter(
    <Providers>
      <App />
    </Providers>,
  );
}

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a loading spinner while session is resolving", () => {
    mockFetch({
      "/api/auth/me": () => new Promise(() => {}),
    });

    renderApp();

    expect(screen.getByLabelText("Loading session…")).toBeTruthy();
  });

  it("renders the auth gate when unauthenticated", async () => {
    mockFetch({
      "/api/auth/me": () => new Response(null, { status: 401 }),
      "/api/context": () =>
        new Response(JSON.stringify({ tenant_slug: "demo" }), { status: 200 }),
      "/api/auth/google": () => new Response(null, { status: 503 }),
    });

    renderApp();

    expect(await screen.findByText("Sign in")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });

  it("renders the portal shell when authenticated", async () => {
    mockFetch({
      "/api/auth/me": () =>
        new Response(
          JSON.stringify({
            user_id: "user-1",
            email: "dev@demo.local",
            tenant_id: "tenant-1",
          }),
          { status: 200 },
        ),
      "/api/agent/projects": () =>
        new Response(JSON.stringify({ projects: [] }), { status: 200 }),
    });

    await renderAuthenticatedApp();

    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: "Lanyard Portal" })).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: "Agents" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Vault" })).toBeTruthy();
    const topNav = screen.getByRole("navigation", { name: "Lanyard Portal" });
    expect(within(topNav).queryByRole("button", { name: "Connectors" })).toBeNull();
    const account = screen.getByRole("button", { name: "Account menu" });
    fireEvent.focus(account);
    fireEvent.mouseEnter(account);
    expect(await screen.findByRole("button", { name: "Settings" })).toBeTruthy();
    // Account chip + profile HoverCard content both show the email.
    expect(screen.getAllByText("dev@demo.local").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();
    // Unified + create menu (lp-fn5.2.1 / lp-7st.2) — icon-only "New Agent" in Agents side nav.
    expect(screen.getByRole("button", { name: "New Agent" })).toBeTruthy();
  });

  it("returns to the auth gate after logout from the profile menu", async () => {
    let meCalls = 0;
    mockFetch({
      "/api/auth/me": () => {
        meCalls += 1;
        if (meCalls === 1) {
          return new Response(
            JSON.stringify({
              user_id: "user-1",
              email: "dev@demo.local",
              tenant_id: "tenant-1",
            }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 401 });
      },
      "/api/agent/projects": () =>
        new Response(JSON.stringify({ projects: [] }), { status: 200 }),
      "/api/auth/logout": () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      "/api/context": () =>
        new Response(JSON.stringify({ tenant_slug: "demo" }), { status: 200 }),
      "/api/auth/google": () => new Response(null, { status: 503 }),
    });

    await renderAuthenticatedApp();

    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: "Lanyard Portal" })).toBeTruthy();
    });

    const account = screen.getByRole("button", { name: "Account menu" });
    fireEvent.focus(account);
    fireEvent.mouseEnter(account);

    fireEvent.click(await screen.findByRole("button", { name: "Logout" }));

    expect(await screen.findByText("Sign in")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(
      fetchMock.mock.calls.some(([url, init]) => {
        const path =
          typeof url === "string"
            ? new URL(url, "http://localhost").pathname
            : url instanceof URL
              ? url.pathname
              : new URL(url.url, "http://localhost").pathname;
        return path === "/api/auth/logout" && init?.method === "POST";
      }),
    ).toBe(true);
  });
});