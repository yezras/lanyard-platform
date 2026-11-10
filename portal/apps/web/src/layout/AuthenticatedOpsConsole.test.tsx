import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers.js";
import { AuthenticatedOpsConsole } from "./AuthenticatedOpsConsole.js";

function requestPath(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return new URL(raw, "http://localhost").pathname;
}

function mockFetch(handlers: Record<string, () => Response | Promise<Response>>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const path = requestPath(input);
    const handler = handlers[path];
    if (!handler) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
      );
    }
    return Promise.resolve(handler());
  });
}

function renderOps() {
  return render(
    <Providers>
      <AuthenticatedOpsConsole />
    </Providers>,
  );
}

const opsMe = () =>
  new Response(
    JSON.stringify({
      operator_id: "ops@lanyard.local",
      email: "ops@lanyard.local",
      plane: "ops",
    }),
    { status: 200 },
  );

const emptyCatalog = () =>
  new Response(JSON.stringify({ tenants: [], totals: {} }), { status: 200 });

const emptyOnboarded = () =>
  new Response(JSON.stringify({ tenant_id: "t1", connectors: [] }), {
    status: 200,
  });

const emptyCanonical = () =>
  new Response(JSON.stringify({ connectors: [] }), { status: 200 });

const tenantsList = () =>
  new Response(
    JSON.stringify({
      tenants: [
        {
          tenant_id: "t1",
          tenant_slug: "mocklab",
          display_name: "MockLab",
        },
      ],
    }),
    { status: 200 },
  );

describe("AuthenticatedOpsConsole", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows a loading spinner while the ops session resolves", () => {
    mockFetch({
      "/api/admin/auth/me": () => new Promise(() => {}),
    });

    renderOps();
    expect(screen.getByLabelText("Loading operator session…")).toBeTruthy();
  });

  it("shows a spinner while the admin context resolves", async () => {
    mockFetch({
      "/api/admin/auth/me": opsMe,
      "/api/admin/context": () => new Promise(() => {}),
    });

    renderOps();
    expect(
      await screen.findByLabelText("Loading admin context…"),
    ).toBeTruthy();
  });

  it("does not treat a tenant session as ops auth", async () => {
    const fetchMock = mockFetch({
      "/api/auth/me": () =>
        new Response(
          JSON.stringify({
            user_id: "user-1",
            email: "dev@demo.local",
            tenant_id: "tenant-1",
          }),
          { status: 200 },
        ),
      "/api/admin/auth/me": () => new Response(null, { status: 401 }),
      "/api/admin/auth/google": () => new Response(null, { status: 503 }),
    });

    renderOps();

    expect(await screen.findByRole("heading", { name: "Platform admin" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Lanyard Portal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Agents" })).toBeNull();
    const paths = fetchMock.mock.calls.map(([url]) =>
      requestPath(url as RequestInfo),
    );
    expect(paths).toContain("/api/admin/auth/me");
    expect(paths).not.toContain("/api/auth/me");
  });

  it("renders the sidenav shell for a superadmin with no tenant selected", async () => {
    mockFetch({
      "/api/admin/auth/me": opsMe,
      "/api/admin/context": () =>
        new Response(JSON.stringify({ role: "superadmin" }), { status: 200 }),
      "/api/admin/tenants": tenantsList,
      "/api/admin/connectors": emptyCatalog,
      "/api/admin/tenants/t1/connectors": emptyOnboarded,
      "/api/admin/registry/connectors": emptyCanonical,
    });

    renderOps();

    await waitFor(() => {
      expect(screen.getByText("ops@lanyard.local")).toBeTruthy();
    });
    // Sidenav, not a top tab bar.
    expect(screen.queryByRole("tablist")).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Lanyard Admin sections" });
    expect(nav).toBeTruthy();
    expect(screen.getByTestId("admin-nav-tenants")).toBeTruthy();
    expect(screen.getByTestId("admin-nav-registry")).toBeTruthy();
    expect(screen.queryByTestId("admin-nav-instances")).toBeNull();
    expect(screen.queryByTestId("admin-nav-roles")).toBeNull();
    expect(screen.queryByTestId("admin-nav-audit")).toBeNull();
    expect(screen.queryByTestId("admin-nav-secrets")).toBeNull();
    expect(screen.queryByTestId("admin-nav-home")).toBeNull();
    expect(screen.queryByTestId("admin-nav-connectors")).toBeNull();
    expect(screen.queryByTestId("admin-nav-users")).toBeNull();
    expect(screen.queryByTestId("admin-tenant-chip")).toBeNull();
    expect(await screen.findByTestId("ops-tenants-table")).toBeTruthy();
  });

  it("selecting a tenant row lands on Connectors with a selected-tenant chip", async () => {
    mockFetch({
      "/api/admin/auth/me": opsMe,
      "/api/admin/context": () =>
        new Response(JSON.stringify({ role: "superadmin" }), { status: 200 }),
      "/api/admin/tenants": tenantsList,
      "/api/admin/connectors": emptyCatalog,
      "/api/admin/tenants/t1/connectors": emptyOnboarded,
      "/api/admin/registry/connectors": emptyCanonical,
    });

    renderOps();

    fireEvent.click(await screen.findByTestId("ops-tenant-row-mocklab"));

    expect(await screen.findByTestId("admin-tenant-chip")).toBeTruthy();
    expect(screen.getByTestId("admin-tenant-chip").textContent).toContain(
      "MockLab",
    );
    expect(screen.getByTestId("admin-tenant-chip").textContent).toContain(
      "selected tenant",
    );
    expect(screen.queryByTestId("admin-nav-home")).toBeNull();
    expect(screen.getByTestId("admin-nav-connectors")).toBeTruthy();
    expect(screen.getByTestId("admin-nav-users")).toBeTruthy();
    expect(screen.getByTestId("admin-nav-registry")).toBeTruthy();
    expect(await screen.findByTestId("ops-connector-onboard")).toBeTruthy();
    expect(window.location.hash).toBe("#/mocklab/connectors");
  });

  it("renders the tenant-admin shell: Connectors/Users only", async () => {
    mockFetch({
      "/api/admin/auth/me": opsMe,
      "/api/admin/context": () =>
        new Response(
          JSON.stringify({
            role: "tenant_admin",
            tenant: {
              tenant_id: "t1",
              tenant_slug: "mocklab",
              display_name: "MockLab",
            },
          }),
          { status: 200 },
        ),
      "/api/admin/connectors": emptyCatalog,
      "/api/admin/tenants/t1/connectors": emptyOnboarded,
      "/api/admin/registry/connectors": emptyCanonical,
    });

    renderOps();

    await waitFor(() => {
      expect(screen.getByTestId("admin-tenant-chip")).toBeTruthy();
    });
    expect(screen.getByTestId("admin-tenant-chip").textContent).toContain(
      "your tenant",
    );
    expect(screen.queryByTestId("admin-nav-home")).toBeNull();
    expect(screen.getByTestId("admin-nav-connectors")).toBeTruthy();
    expect(screen.getByTestId("admin-nav-users")).toBeTruthy();
    expect(screen.queryByTestId("admin-nav-tenants")).toBeNull();
    expect(screen.queryByTestId("admin-nav-registry")).toBeNull();
    expect(screen.queryByTestId("admin-nav-instances")).toBeNull();
    expect(screen.queryByTestId("admin-nav-roles")).toBeNull();
    expect(screen.queryByTestId("admin-nav-audit")).toBeNull();
    expect(screen.queryByTestId("admin-nav-secrets")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(await screen.findByTestId("ops-connector-onboard")).toBeTruthy();
  });

  it("deep-links a superadmin straight into a tenant's connectors", async () => {
    window.location.hash = "mocklab/connectors";
    mockFetch({
      "/api/admin/auth/me": opsMe,
      "/api/admin/context": () =>
        new Response(JSON.stringify({ role: "superadmin" }), { status: 200 }),
      "/api/admin/tenants": tenantsList,
      "/api/admin/connectors": emptyCatalog,
      "/api/admin/registry/connectors": emptyCanonical,
      "/api/admin/tenants/t1/connectors": () =>
        new Response(
          JSON.stringify({
            tenant_id: "t1",
            connectors: [
              {
                connector_id: "google",
                label: "Google",
                surfaces: ["cli"],
                available_surfaces: ["cli"],
                status_counts: {
                  connected: 2,
                  pairing: 0,
                  needs_reauth: 0,
                },
                auth_chips: ["OAuth"],
              },
            ],
          }),
          { status: 200 },
        ),
    });

    renderOps();

    expect(await screen.findByTestId("admin-tenant-chip")).toBeTruthy();
    expect(screen.getByTestId("admin-tenant-chip").textContent).toContain(
      "MockLab",
    );
    expect(await screen.findByTestId("ops-connectors-list")).toBeTruthy();
    expect(window.location.hash).toBe("#/mocklab/connectors");
    window.location.hash = "";
  });

  it("keeps the ops shell off tenant Chat", async () => {
    mockFetch({
      "/api/admin/auth/me": opsMe,
      "/api/admin/context": () =>
        new Response(JSON.stringify({ role: "superadmin" }), { status: 200 }),
      "/api/admin/tenants": tenantsList,
      "/api/admin/connectors": emptyCatalog,
      "/api/admin/tenants/t1/connectors": emptyOnboarded,
      "/api/admin/registry/connectors": emptyCanonical,
    });

    renderOps();

    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: "Lanyard Admin sections" })).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Lanyard Portal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Agents" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Vault" })).toBeNull();
  });

  it("fails closed when the context endpoint claims a malformed tenant scope", async () => {
    mockFetch({
      "/api/admin/auth/me": opsMe,
      "/api/admin/context": () =>
        new Response(JSON.stringify({ role: "tenant_admin" }), { status: 200 }),
    });

    renderOps();

    expect(
      await screen.findByTestId("admin-context-error"),
    ).toBeTruthy();
    expect(screen.queryByTestId("admin-nav-connectors")).toBeNull();
  });
});
