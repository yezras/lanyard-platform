import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import { OpsConnectorDetailPage } from "./OpsConnectorDetailPage.js";

const fetchOpsTenantConnectors = vi.fn();
const putOpsConnectorOnboard = vi.fn();
const fetchOpsConnectorUsers = vi.fn();
const putOpsConnectorUserGrant = vi.fn();
const fetchOpsMemberSubset = vi.fn();
const putOpsMemberSubset = vi.fn();
const fetchOpsClassCSecrets = vi.fn();
const putOpsClassCSecret = vi.fn();
const deleteOpsClassCSecret = vi.fn();

vi.mock("../../api/opsConnectors.js", () => ({
  fetchOpsTenantConnectors: (...args: unknown[]) =>
    fetchOpsTenantConnectors(...args),
  putOpsConnectorOnboard: (...args: unknown[]) => putOpsConnectorOnboard(...args),
}));

vi.mock("../../api/opsClassCSecrets.js", () => ({
  fetchOpsClassCSecrets: (...args: unknown[]) => fetchOpsClassCSecrets(...args),
  putOpsClassCSecret: (...args: unknown[]) => putOpsClassCSecret(...args),
  deleteOpsClassCSecret: (...args: unknown[]) => deleteOpsClassCSecret(...args),
}));

vi.mock("../../api/opsTenantAdmin.js", () => ({
  fetchOpsConnectorUsers: (...args: unknown[]) => fetchOpsConnectorUsers(...args),
  putOpsConnectorUserGrant: (...args: unknown[]) =>
    putOpsConnectorUserGrant(...args),
  fetchOpsMemberSubset: (...args: unknown[]) => fetchOpsMemberSubset(...args),
  putOpsMemberSubset: (...args: unknown[]) => putOpsMemberSubset(...args),
}));

const tenant = {
  tenant_id: "t1",
  tenant_slug: "mocklab",
  display_name: "MockLab",
};

const hubspot = {
  connector_id: "hubspot",
  label: "HubSpot",
  surfaces: ["api", "cli"],
  available_surfaces: ["api", "cli"],
  status_counts: { connected: 1, pairing: 0, needs_reauth: 1 },
  auth_chips: ["OAuth"],
};

const google = {
  connector_id: "google",
  label: "Google",
  surfaces: ["cli"],
  available_surfaces: ["cli"],
  status_counts: { connected: 2, pairing: 0, needs_reauth: 0 },
  auth_chips: ["OAuth"],
};

describe("OpsConnectorDetailPage (lp-hdzm.21)", () => {
  beforeEach(() => {
    fetchOpsTenantConnectors.mockReset();
    putOpsConnectorOnboard.mockReset();
    fetchOpsConnectorUsers.mockReset();
    putOpsConnectorUserGrant.mockReset();
    fetchOpsMemberSubset.mockReset();
    putOpsMemberSubset.mockReset();
    fetchOpsClassCSecrets.mockReset();
    putOpsClassCSecret.mockReset();
    deleteOpsClassCSecret.mockReset();
    fetchOpsTenantConnectors.mockResolvedValue([hubspot]);
    fetchOpsConnectorUsers.mockResolvedValue([]);
    fetchOpsMemberSubset.mockResolvedValue({
      tenant_id: "t1",
      connector_id: "hubspot",
      kind: "grant_only",
      tools: [],
      allowed_tools: [],
    });
    fetchOpsClassCSecrets.mockResolvedValue({
      tenant_id: "t1",
      connector_id: "stripe",
      surfaces: [
        {
          tenant_id: "t1",
          connector_id: "stripe",
          surface_id: "mcp",
          present: false,
          fingerprint: null,
          rotated_at: null,
        },
        {
          tenant_id: "t1",
          connector_id: "stripe",
          surface_id: "api",
          present: false,
          fingerprint: null,
          rotated_at: null,
        },
        {
          tenant_id: "t1",
          connector_id: "stripe",
          surface_id: "cli",
          present: false,
          fingerprint: null,
          rotated_at: null,
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
  });

  function renderPage(connectorId = "hubspot") {
    return render(
      <Providers>
        <OpsConnectorDetailPage
          tenant={tenant}
          connectorId={connectorId}
          onBack={() => {}}
        />
      </Providers>,
    );
  }

  it("shows breadcrumb, auth card, and per-connector status counts", async () => {
    renderPage();

    expect(
      await screen.findByTestId("ops-connector-detail-name"),
    ).toBeTruthy();
    expect(screen.getByTestId("ops-connector-detail-name").textContent).toBe(
      "HubSpot",
    );
    expect(screen.getByRole("navigation", { name: "Connector breadcrumb" })).toBeTruthy();
    expect(
      screen.getByTestId("ops-connector-detail-connected").textContent,
    ).toBe("1");
    expect(
      screen.getByTestId("ops-connector-detail-reauth").textContent,
    ).toBe("1");
    expect(screen.getByRole("button", { name: "Reauthorize" })).toBeTruthy();
    expect(screen.queryByTestId("ops-class-c-paste")).toBeNull();
    expect(fetchOpsClassCSecrets).not.toHaveBeenCalled();
  });

  it("shows a surface group when more than one surface is available", async () => {
    renderPage();
    expect(await screen.findByTestId("ops-surface-group")).toBeTruthy();
    expect(screen.getByTestId("ops-surface-api")).toBeTruthy();
    expect(screen.getByTestId("ops-surface-cli")).toBeTruthy();
    expect(screen.queryByTestId("ops-surface-mcp")).toBeNull();
  });

  it("does not render a checkbox group for a single surface", async () => {
    fetchOpsTenantConnectors.mockResolvedValue([google]);
    renderPage("google");
    expect(await screen.findByTestId("ops-surface-single")).toBeTruthy();
    expect(screen.queryByTestId("ops-surface-group")).toBeNull();
    expect(screen.getByTestId("ops-surface-single").textContent).toBe("CLI");
  });

  it("confirms last-off then un-onboards that surface slot", async () => {
    const onBack = vi.fn();
    putOpsConnectorOnboard.mockResolvedValue({
      tenant_id: "t1",
      connector_id: "hubspot",
      enabled: false,
      surfaces: [],
    });
    fetchOpsTenantConnectors.mockResolvedValue([
      { ...hubspot, surfaces: ["api"], available_surfaces: ["api", "cli"] },
    ]);
    render(
      <Providers>
        <OpsConnectorDetailPage
          tenant={tenant}
          connectorId="hubspot"
          onBack={onBack}
        />
      </Providers>,
    );
    await screen.findByTestId("ops-surface-group");
    const apiSwitch = screen
      .getByTestId("ops-surface-api")
      .querySelector("input") as HTMLInputElement;
    expect(apiSwitch.checked).toBe(true);
    fireEvent.click(apiSwitch);
    expect(await screen.findByTestId("ops-surface-off-confirm")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => {
      expect(putOpsConnectorOnboard).toHaveBeenCalledWith({
        tenantId: "t1",
        connectorId: "hubspot",
        surfaces: [],
      });
    });
    expect(onBack).toHaveBeenCalled();
  });

  it("lists users with grants and fails closed when the grant PUT is a stub", async () => {
    fetchOpsConnectorUsers.mockResolvedValue([
      {
        user_id: "u1",
        display_name: "Jack Rubin",
        email: "operator@example.com",
        role_label: "Tenant admin",
        granted: true,
      },
      {
        user_id: "u2",
        display_name: "Maya Chen",
        email: "maya@mocklab.io",
        role_label: "Member",
        granted: false,
      },
    ]);
    putOpsConnectorUserGrant.mockRejectedValue(
      new Error("Connector user grants is not implemented yet"),
    );

    renderPage();

    expect(await screen.findByText("Jack Rubin")).toBeTruthy();
    expect(screen.getByText("Maya Chen")).toBeTruthy();
    const grants = screen.getByTestId("ops-connector-grant-u2");
    const switchInput = grants.querySelector("input") as HTMLInputElement;
    expect(switchInput.checked).toBe(false);

    fireEvent.click(switchInput);
    await waitFor(() => {
      expect(putOpsConnectorUserGrant).toHaveBeenCalledWith({
        tenantId: "t1",
        connectorId: "hubspot",
        userId: "u2",
        granted: true,
      });
    });
    expect(await screen.findByTestId("ops-connector-grant-error")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Connector user grants is not implemented yet",
    );
    await waitFor(() => {
      expect(
        (screen.getByTestId("ops-connector-grant-u2").querySelector("input") as HTMLInputElement)
          .checked,
      ).toBe(false);
    });
  });

  it("fails closed on the users stub without inventing rows", async () => {
    fetchOpsConnectorUsers.mockRejectedValue(
      new Error("Connector user grants is not implemented yet"),
    );

    renderPage();

    expect(
      await screen.findByTestId("ops-connector-users-error"),
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Connector user grants is not implemented yet",
    );
    expect(screen.queryByTestId("ops-connector-users-list")).toBeNull();
  });

  it("renders catalog errors as alerts, not secondary captions", async () => {
    fetchOpsTenantConnectors.mockRejectedValue(new Error("Catalog failed"));
    fetchOpsConnectorUsers.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByTestId("ops-connector-detail-error")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Catalog failed");
  });

  it("keeps an empty state when there are no users", async () => {
    fetchOpsConnectorUsers.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("No users yet")).toBeTruthy();
    expect(screen.queryByTestId("ops-connector-users-list")).toBeNull();
    expect(
      screen.queryByText(/Provision users for this tenant/i),
    ).toBeNull();
  });

  it("hides member subset on first-class connectors", async () => {
    renderPage();
    expect(await screen.findByTestId("ops-connector-detail-name")).toBeTruthy();
    expect(screen.queryByTestId("ops-member-subset")).toBeNull();
  });

  it("lists classified tools on connector detail and PUTs the allowlist", async () => {
    const stripe = {
      connector_id: "stripe",
      label: "Stripe",
      surfaces: ["api"],
      available_surfaces: ["api"],
      status_counts: { connected: 0, pairing: 0, needs_reauth: 0 },
      auth_chips: ["API key"],
    };
    fetchOpsTenantConnectors.mockResolvedValue([stripe]);
    fetchOpsMemberSubset.mockResolvedValue({
      tenant_id: "t1",
      connector_id: "stripe",
      kind: "allowlist",
      tools: [
        { name: "GetCustomers", group: "read" },
        { name: "CreateCustomer", group: "write" },
      ],
      allowed_tools: [],
    });
    putOpsMemberSubset.mockResolvedValue({
      tenant_id: "t1",
      connector_id: "stripe",
      kind: "allowlist",
      tools: [
        { name: "GetCustomers", group: "read" },
        { name: "CreateCustomer", group: "write" },
      ],
      allowed_tools: ["GetCustomers"],
    });

    renderPage("stripe");
    expect(await screen.findByTestId("ops-member-subset")).toBeTruthy();
    expect(screen.getByTestId("ops-member-subset-read")).toBeTruthy();
    expect(screen.getByTestId("ops-member-subset-write")).toBeTruthy();
    const readSwitch = screen
      .getByTestId("ops-member-subset-tool-GetCustomers")
      .querySelector("input") as HTMLInputElement;
    fireEvent.click(readSwitch);
    await waitFor(() => {
      expect(putOpsMemberSubset).toHaveBeenCalledWith({
        tenantId: "t1",
        connectorId: "stripe",
        allowedTools: ["GetCustomers"],
      });
    });
  });

  it("PUTs person grants from connector detail", async () => {
    fetchOpsConnectorUsers.mockResolvedValue([
      {
        user_id: "u2",
        display_name: "Maya Chen",
        email: "maya@mocklab.io",
        role_label: "Member",
        granted: false,
      },
    ]);
    putOpsConnectorUserGrant.mockResolvedValue({
      tenant_id: "t1",
      user_id: "u2",
      connector_id: "hubspot",
      granted: true,
    });

    renderPage();
    const grants = await screen.findByTestId("ops-connector-grant-u2");
    fireEvent.click(grants.querySelector("input") as HTMLInputElement);
    await waitFor(() => {
      expect(putOpsConnectorUserGrant).toHaveBeenCalledWith({
        tenantId: "t1",
        connectorId: "hubspot",
        userId: "u2",
        granted: true,
      });
    });
    await waitFor(() => {
      expect(
        (screen.getByTestId("ops-connector-grant-u2").querySelector("input") as HTMLInputElement)
          .checked,
      ).toBe(true);
    });
  });

  it("has no page subtitle explainer or footer how-to", async () => {
    fetchOpsConnectorUsers.mockResolvedValue([]);

    renderPage();

    expect(
      await screen.findByTestId("ops-connector-detail-name"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reauthorize" }));

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/Tenant admins finish/i);
    expect(body).not.toMatch(/ops does not/i);
    expect(body).not.toMatch(/Counts for /i);
    expect(screen.queryByTestId("ops-connector-reauth-note")).toBeNull();
  });

  it("pastes a Stripe Class C key on the single onboarded surface", async () => {
    const secret = "sk_test_do_not_echo";
    const stripe = {
      connector_id: "stripe",
      label: "Stripe",
      surfaces: ["mcp"],
      available_surfaces: ["mcp"],
      status_counts: { connected: 0, pairing: 0, needs_reauth: 0 },
      auth_chips: ["MCP"],
    };
    fetchOpsTenantConnectors.mockResolvedValue([stripe]);
    fetchOpsMemberSubset.mockResolvedValue({
      tenant_id: "t1",
      connector_id: "stripe",
      kind: "grant_only",
      tools: [],
      allowed_tools: [],
    });
    putOpsClassCSecret.mockResolvedValue({
      tenant_id: "t1",
      connector_id: "stripe",
      surface_id: "mcp",
      present: true,
      fingerprint: "sha256:deadbeefcafe",
      rotated_at: "2026-08-27T00:00:00.000Z",
    });

    renderPage("stripe");

    expect(await screen.findByTestId("ops-class-c-paste")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reauthorize" })).toBeNull();
    expect(screen.getByTestId("ops-class-c-status-mcp").textContent).toBe(
      "not set",
    );
    expect(fetchOpsClassCSecrets).toHaveBeenCalledWith({
      tenantId: "t1",
      connectorId: "stripe",
    });

    const input = screen.getByTestId("ops-class-c-input-mcp");
    const field = input.querySelector("input") ?? input;
    fireEvent.change(field, { target: { value: secret } });
    fireEvent.click(screen.getByTestId("ops-class-c-save-mcp"));

    await waitFor(() => {
      expect(putOpsClassCSecret).toHaveBeenCalledWith({
        tenantId: "t1",
        connectorId: "stripe",
        surfaceId: "mcp",
        value: secret,
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("ops-class-c-status-mcp").textContent).toContain(
        "sha256:deadbeefcafe",
      );
    });
    const after = screen.getByTestId("ops-class-c-input-mcp");
    const afterField = (after.querySelector("input") ?? after) as HTMLInputElement;
    expect(afterField.value).toBe("");
    expect(document.body.textContent ?? "").not.toContain(secret);
  });
});
