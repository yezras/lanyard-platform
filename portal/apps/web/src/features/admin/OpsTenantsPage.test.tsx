import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import { OpsTenantsPage } from "./OpsTenantsPage.js";

const fetchOpsTenants = vi.fn();
const fetchOpsConnectorCatalog = vi.fn();

vi.mock("../../api/opsAdmin.js", () => ({
  fetchOpsTenants: (...args: unknown[]) => fetchOpsTenants(...args),
}));

vi.mock("../../api/opsConnectors.js", () => ({
  fetchOpsConnectorCatalog: (...args: unknown[]) =>
    fetchOpsConnectorCatalog(...args),
}));

const FORBIDDEN_PHRASES = [
  "Every tenant on the control plane",
  "Select a tenant to",
  "administer it",
  "Create a tenant on the control plane",
] as const;

function assertNoInstructionalCopy() {
  const text = document.body.textContent ?? "";
  const collapsed = text.replace(/\s+/g, " ");
  for (const phrase of FORBIDDEN_PHRASES) {
    expect(collapsed).not.toContain(phrase);
  }
}

const catalog = {
  tenants: [
    {
      tenant_id: "t1",
      tenant_slug: "mocklab",
      display_name: "MockLab",
      connectors: [
        {
          connector_id: "google",
          enabled: true,
          status_counts: { connected: 3, pairing: 0, needs_reauth: 0 },
        },
        {
          connector_id: "hubspot",
          enabled: true,
          status_counts: { connected: 1, pairing: 0, needs_reauth: 0 },
        },
        {
          connector_id: "whatsapp",
          enabled: false,
          status_counts: { connected: 0, pairing: 0, needs_reauth: 0 },
        },
      ],
    },
  ],
  totals: {
    google: { connected: 3, pairing: 0, needs_reauth: 0, entitled_tenants: 1 },
    hubspot: { connected: 1, pairing: 0, needs_reauth: 0, entitled_tenants: 1 },
    whatsapp: { connected: 0, pairing: 0, needs_reauth: 0, entitled_tenants: 0 },
  },
};

describe("OpsTenantsPage", () => {
  beforeEach(() => {
    fetchOpsTenants.mockReset();
    fetchOpsConnectorCatalog.mockReset();
    fetchOpsConnectorCatalog.mockResolvedValue(catalog);
  });

  afterEach(() => {
    cleanup();
  });

  it("lists tenants with slug, id, connected counts, and status", async () => {
    fetchOpsTenants.mockResolvedValue([
      {
        tenant_id: "t1",
        tenant_slug: "mocklab",
        display_name: "MockLab",
      },
    ]);

    render(
      <Providers>
        <OpsTenantsPage />
      </Providers>,
    );

    expect(await screen.findByText("MockLab")).toBeTruthy();
    expect(screen.getByTestId("ops-tenant-id-mocklab").textContent).toBe("t1");
    expect(
      screen.getByTestId("ops-tenant-connected-mocklab").textContent,
    ).toBe("4 connected");
    expect(screen.getByTestId("ops-tenants-count").textContent).toContain("1");
    assertNoInstructionalCopy();
  });

  it("shows an empty state when there are no tenants", async () => {
    fetchOpsTenants.mockResolvedValue([]);

    render(
      <Providers>
        <OpsTenantsPage />
      </Providers>,
    );

    expect(await screen.findByTestId("ops-tenants-empty")).toBeTruthy();
    expect(screen.getByText("No tenants")).toBeTruthy();
    expect(screen.queryByTestId("ops-tenants-table")).toBeNull();
    expect(screen.queryByText("Create a tenant on the control plane")).toBeNull();
    assertNoInstructionalCopy();
  });

  it("selecting a row hands the tenant to the shell", async () => {
    fetchOpsTenants.mockResolvedValue([
      {
        tenant_id: "t1",
        tenant_slug: "mocklab",
        display_name: "MockLab",
      },
    ]);
    const onSelectTenant = vi.fn();

    render(
      <Providers>
        <OpsTenantsPage onSelectTenant={onSelectTenant} />
      </Providers>,
    );

    fireEvent.click(await screen.findByTestId("ops-tenant-row-mocklab"));
    expect(onSelectTenant).toHaveBeenCalledWith({
      tenant_id: "t1",
      tenant_slug: "mocklab",
      display_name: "MockLab",
    });
  });

  it("shows an error message when the BFF call fails", async () => {
    fetchOpsTenants.mockRejectedValue(new Error("Not authenticated"));

    render(
      <Providers>
        <OpsTenantsPage />
      </Providers>,
    );

    const alert = await screen.findByTestId("ops-tenants-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Not authenticated");
    expect(screen.queryByTestId("ops-tenants-table")).toBeNull();
    assertNoInstructionalCopy();
  });
});
