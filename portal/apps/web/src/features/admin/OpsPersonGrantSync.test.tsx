/**
 * lp-hdzm.23 — one person-grant table, two views.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import { OpsConnectorDetailPage } from "./OpsConnectorDetailPage.js";
import { OpsUsersPage } from "./OpsUsersPage.js";

const fetchOpsTenantConnectors = vi.fn();
const putOpsConnectorOnboard = vi.fn();
const fetchOpsConnectorUsers = vi.fn();
const putOpsConnectorUserGrant = vi.fn();
const fetchOpsMemberSubset = vi.fn();
const putOpsMemberSubset = vi.fn();
const fetchOpsTenantUsers = vi.fn();
const createOpsTenantUser = vi.fn();
const deleteOpsTenantUser = vi.fn();

vi.mock("../../api/opsConnectors.js", () => ({
  fetchOpsTenantConnectors: (...args: unknown[]) =>
    fetchOpsTenantConnectors(...args),
  putOpsConnectorOnboard: (...args: unknown[]) => putOpsConnectorOnboard(...args),
}));

vi.mock("../../api/opsTenantAdmin.js", () => ({
  fetchOpsConnectorUsers: (...args: unknown[]) => fetchOpsConnectorUsers(...args),
  putOpsConnectorUserGrant: (...args: unknown[]) =>
    putOpsConnectorUserGrant(...args),
  fetchOpsMemberSubset: (...args: unknown[]) => fetchOpsMemberSubset(...args),
  putOpsMemberSubset: (...args: unknown[]) => putOpsMemberSubset(...args),
  fetchOpsTenantUsers: (...args: unknown[]) => fetchOpsTenantUsers(...args),
  createOpsTenantUser: (...args: unknown[]) => createOpsTenantUser(...args),
  deleteOpsTenantUser: (...args: unknown[]) => deleteOpsTenantUser(...args),
}));

const tenant = {
  tenant_id: "t1",
  tenant_slug: "mocklab",
  display_name: "MockLab",
};

const onboarded = [
  {
    connector_id: "hubspot",
    label: "HubSpot",
    surfaces: ["api", "cli"],
    available_surfaces: ["api", "cli"],
    status_counts: { connected: 1, pairing: 0, needs_reauth: 0 },
    auth_chips: ["OAuth"],
  },
];

describe("person grant sync (lp-hdzm.23)", () => {
  const grants = new Map<string, boolean>();

  beforeEach(() => {
    grants.clear();
    grants.set("u1:hubspot", true);
    fetchOpsTenantConnectors.mockReset();
    putOpsConnectorOnboard.mockReset();
    fetchOpsConnectorUsers.mockReset();
    putOpsConnectorUserGrant.mockReset();
    fetchOpsMemberSubset.mockReset();
    putOpsMemberSubset.mockReset();
    fetchOpsTenantUsers.mockReset();
    fetchOpsTenantConnectors.mockResolvedValue(onboarded);
    fetchOpsMemberSubset.mockResolvedValue({
      tenant_id: "t1",
      connector_id: "hubspot",
      kind: "grant_only",
      tools: [],
      allowed_tools: [],
    });
    fetchOpsTenantUsers.mockImplementation(async () => [
      {
        user_id: "u1",
        display_name: "Jack Rubin",
        email: "operator@example.com",
        role: "tenant_admin",
        connectors: [...grants.entries()]
          .filter(([key, granted]) => granted && key.startsWith("u1:"))
          .map(([key]) => key.slice("u1:".length)),
        last_active_at: null,
      },
    ]);
    fetchOpsConnectorUsers.mockImplementation(async () => [
      {
        user_id: "u1",
        display_name: "Jack Rubin",
        email: "operator@example.com",
        role_label: "Tenant admin",
        granted: grants.get("u1:hubspot") === true,
      },
    ]);
    putOpsConnectorUserGrant.mockImplementation(
      async (input: {
        userId: string;
        connectorId: string;
        granted: boolean;
      }) => {
        grants.set(`${input.userId}:${input.connectorId}`, input.granted);
      },
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the same grant after a user-detail PUT on connector detail", async () => {
    const first = render(
      <Providers>
        <OpsUsersPage tenant={tenant} userId="u1" />
      </Providers>,
    );
    const userSwitch = await screen.findByTestId("ops-user-grant-hubspot");
    expect((userSwitch.querySelector("input") as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.click(userSwitch.querySelector("input") as HTMLInputElement);
    await waitFor(() => {
      expect(putOpsConnectorUserGrant).toHaveBeenCalledWith({
        tenantId: "t1",
        connectorId: "hubspot",
        userId: "u1",
        granted: false,
      });
    });
    expect(grants.get("u1:hubspot")).toBe(false);
    first.unmount();

    render(
      <Providers>
        <OpsConnectorDetailPage
          tenant={tenant}
          connectorId="hubspot"
          onBack={() => {}}
        />
      </Providers>,
    );
    const connectorSwitch = await screen.findByTestId("ops-connector-grant-u1");
    expect(
      (connectorSwitch.querySelector("input") as HTMLInputElement).checked,
    ).toBe(false);
    expect(screen.queryByTestId("ops-member-subset")).toBeNull();
  });
});
