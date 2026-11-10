import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers.js";
import { OpsConsole } from "./OpsConsole.js";

const fetchOpsTenants = vi.fn();
const fetchOpsAdminContext = vi.fn();
const fetchOpsTenantConnectors = vi.fn();
const fetchOpsCanonicalConnectors = vi.fn();
const logoutOps = vi.fn();

vi.mock("../api/opsAdmin.js", () => ({
  fetchOpsTenants: (...args: unknown[]) => fetchOpsTenants(...args),
}));

vi.mock("../api/opsAdminContext.js", () => ({
  fetchOpsAdminContext: (...args: unknown[]) => fetchOpsAdminContext(...args),
}));

vi.mock("../api/opsConnectors.js", () => ({
  fetchOpsTenantConnectors: (...args: unknown[]) =>
    fetchOpsTenantConnectors(...args),
  fetchOpsCanonicalConnectors: (...args: unknown[]) =>
    fetchOpsCanonicalConnectors(...args),
  putOpsConnectorOnboard: vi.fn(),
}));

vi.mock("../api/opsRegistry.js", () => ({
  searchOpsRegistry: vi.fn().mockResolvedValue([]),
  fetchCanonicalConnectors: vi.fn().mockResolvedValue([]),
  promoteRegistryDomain: vi.fn(),
  createCustomConnector: vi.fn(),
  deleteCanonicalConnector: vi.fn(),
}));

vi.mock("../api/opsAuth.js", () => ({
  logoutOps: (...args: unknown[]) => logoutOps(...args),
}));

vi.mock("../api/opsTenantAdmin.js", () => ({
  fetchOpsTenantUsers: vi.fn().mockResolvedValue([]),
  fetchOpsConnectorUsers: vi.fn().mockResolvedValue([]),
  putOpsConnectorUserGrant: vi.fn(),
  createOpsTenantUser: vi.fn(),
  deleteOpsTenantUser: vi.fn(),
}));

const operator = {
  operator_id: "ops@lanyard.local",
  email: "ops@lanyard.local",
  plane: "ops" as const,
};

const mocklab = {
  tenant_id: "t1",
  tenant_slug: "mocklab",
  display_name: "MockLab",
};

const acme = {
  tenant_id: "t2",
  tenant_slug: "acme",
  display_name: "Acme",
};

const mocklabConnectors = [
  {
    connector_id: "google",
    label: "Google",
    surfaces: ["cli"],
    available_surfaces: ["cli"],
    status_counts: { connected: 1, pairing: 0, needs_reauth: 0 },
    auth_chips: ["OAuth"],
  },
];

function renderConsole() {
  return render(
    <Providers>
      <OpsConsole operator={operator} />
    </Providers>,
  );
}

describe("OpsConsole IA trunk (lp-hdzm.3)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    window.location.hash = "";
    fetchOpsTenants.mockReset();
    fetchOpsAdminContext.mockReset();
    fetchOpsTenantConnectors.mockReset();
    fetchOpsCanonicalConnectors.mockReset();
    logoutOps.mockReset();
    fetchOpsAdminContext.mockResolvedValue({ role: "superadmin" });
    fetchOpsTenants.mockResolvedValue([mocklab, acme]);
    fetchOpsTenantConnectors.mockResolvedValue(mocklabConnectors);
    fetchOpsCanonicalConnectors.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
  });

  it("shows Tenants and Registry only until a tenant is selected", async () => {
    renderConsole();

    expect(await screen.findByTestId("admin-nav-tenants")).toBeTruthy();
    expect(screen.getByTestId("admin-nav-registry")).toBeTruthy();
    expect(screen.queryByTestId("admin-nav-connectors")).toBeNull();
    expect(screen.queryByTestId("admin-nav-users")).toBeNull();
    expect(screen.queryByTestId("admin-nav-instances")).toBeNull();
    expect(screen.queryByTestId("admin-nav-home")).toBeNull();
    expect(screen.queryByTestId("admin-tenant-chip")).toBeNull();
    expect(await screen.findByTestId("ops-tenants-table")).toBeTruthy();
  });

  it("lands on connectors when a tenant row is clicked", async () => {
    renderConsole();

    fireEvent.click(await screen.findByTestId("ops-tenant-row-mocklab"));

    expect(await screen.findByTestId("ops-connectors-list")).toBeTruthy();
    expect(screen.getByTestId("admin-nav-connectors")).toBeTruthy();
    expect(screen.getByTestId("admin-nav-users")).toBeTruthy();
    expect(screen.getByTestId("admin-nav-instances")).toBeTruthy();
    expect(screen.getByTestId("admin-nav-roles").textContent).toContain(
      "Hermes roles",
    );
    expect(screen.queryByTestId("admin-nav-home")).toBeNull();
    expect(screen.getByTestId("admin-tenant-chip").textContent).toContain(
      "MockLab",
    );
    expect(window.location.hash).toBe("#/mocklab/connectors");
  });

  it("clears the selected tenant when Tenants is clicked", async () => {
    renderConsole();

    fireEvent.click(await screen.findByTestId("ops-tenant-row-mocklab"));
    expect(await screen.findByTestId("ops-connectors-list")).toBeTruthy();

    fireEvent.click(screen.getByTestId("admin-nav-tenants"));

    expect(await screen.findByTestId("ops-tenants-table")).toBeTruthy();
    expect(screen.queryByTestId("admin-tenant-chip")).toBeNull();
    expect(screen.queryByTestId("admin-nav-connectors")).toBeNull();
    expect(screen.queryByTestId("ops-connectors-list")).toBeNull();
    expect(window.location.hash).toBe("#/tenants");
  });

  it("opens Registry without a tenant slug and hides the chip", async () => {
    renderConsole();

    fireEvent.click(await screen.findByTestId("ops-tenant-row-mocklab"));
    expect(await screen.findByTestId("admin-tenant-chip")).toBeTruthy();

    fireEvent.click(screen.getByTestId("admin-nav-registry"));

    expect(await screen.findByTestId("ops-registry-page")).toBeTruthy();
    expect(window.location.hash).toBe("#/registry");
    expect(screen.queryByTestId("admin-tenant-chip")).toBeNull();
    expect(screen.getByTestId("admin-nav-connectors")).toBeTruthy();
  });

  it("switches tenant from the chip and keeps the current page", async () => {
    renderConsole();

    fireEvent.click(await screen.findByTestId("ops-tenant-row-mocklab"));
    expect(await screen.findByTestId("ops-connectors-list")).toBeTruthy();
    fireEvent.click(screen.getByTestId("admin-nav-users"));

    const switcher = await screen.findByTestId("admin-tenant-switcher");
    fireEvent.change(switcher, { target: { value: "acme" } });

    await waitFor(() => {
      expect(window.location.hash).toBe("#/acme/users");
    });
    expect(screen.getByTestId("admin-tenant-chip").textContent).toContain("Acme");
  });

  it("applies hashchange to restore a tenant workspace", async () => {
    renderConsole();

    fireEvent.click(await screen.findByTestId("ops-tenant-row-mocklab"));
    expect(await screen.findByTestId("ops-connectors-list")).toBeTruthy();
    fireEvent.click(screen.getByTestId("admin-nav-tenants"));
    expect(await screen.findByTestId("ops-tenants-table")).toBeTruthy();

    window.location.hash = "#/mocklab/connectors";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(await screen.findByTestId("ops-connectors-list")).toBeTruthy();
    expect(screen.getByTestId("admin-tenant-chip").textContent).toContain(
      "MockLab",
    );
  });
});
