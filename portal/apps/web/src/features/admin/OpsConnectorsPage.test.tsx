import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import { OpsConnectorsPage } from "./OpsConnectorsPage.js";

const fetchOpsTenantConnectors = vi.fn();
const fetchOpsCanonicalConnectors = vi.fn();
const putOpsConnectorOnboard = vi.fn();

vi.mock("../../api/opsConnectors.js", () => ({
  fetchOpsTenantConnectors: (...args: unknown[]) =>
    fetchOpsTenantConnectors(...args),
  fetchOpsCanonicalConnectors: (...args: unknown[]) =>
    fetchOpsCanonicalConnectors(...args),
  putOpsConnectorOnboard: (...args: unknown[]) => putOpsConnectorOnboard(...args),
}));

const tenant = {
  tenant_id: "t1",
  tenant_slug: "mocklab",
  display_name: "MockLab",
};

const onboarded = [
  {
    connector_id: "google",
    label: "Google",
    surfaces: ["cli"],
    available_surfaces: ["cli"],
    status_counts: { connected: 3, pairing: 0, needs_reauth: 0 },
    auth_chips: ["OAuth"],
  },
  {
    connector_id: "hubspot",
    label: "HubSpot",
    surfaces: ["api", "cli"],
    available_surfaces: ["api", "cli"],
    status_counts: { connected: 1, pairing: 0, needs_reauth: 1 },
    auth_chips: ["OAuth"],
  },
];

const canonical = [
  {
    id: "google",
    domain: "google.com",
    label: "Google",
    archived: false,
    snapshot: {},
  },
  {
    id: "hubspot",
    domain: "hubspot.com",
    label: "HubSpot",
    archived: false,
    snapshot: {},
  },
  {
    id: "stripe",
    domain: "stripe.com",
    label: "Stripe",
    archived: false,
    snapshot: {
      runnability: "runnable",
      surfaces: [{ kind: "mcp", runnability: "runnable" }],
    },
  },
  {
    id: "slack",
    domain: "slack.com",
    label: "Slack",
    archived: false,
    snapshot: {
      runnability: "not_runnable",
      surfaces: [{ kind: "mcp", runnability: "not_runnable" }],
    },
  },
];

function renderPage() {
  return render(
    <Providers>
      <OpsConnectorsPage tenant={tenant} onOpenConnector={() => {}} />
    </Providers>,
  );
}

describe("OpsConnectorsPage (lp-hdzm.21)", () => {
  beforeEach(() => {
    fetchOpsTenantConnectors.mockReset();
    fetchOpsCanonicalConnectors.mockReset();
    putOpsConnectorOnboard.mockReset();
    fetchOpsTenantConnectors.mockResolvedValue(onboarded);
    fetchOpsCanonicalConnectors.mockResolvedValue(canonical);
    putOpsConnectorOnboard.mockResolvedValue({
      tenant_id: "t1",
      connector_id: "stripe",
      enabled: true,
      surfaces: ["mcp"],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders onboarded-only rows with status and user counts", async () => {
    renderPage();

    expect(await screen.findByTestId("ops-connectors-list")).toBeTruthy();
    expect(screen.getByText("Google")).toBeTruthy();
    expect(screen.getByText("HubSpot")).toBeTruthy();
    expect(screen.queryByText("Stripe")).toBeNull();
    expect(screen.queryByText("Slack")).toBeNull();
    expect(screen.getByTestId("ops-connector-users-google").textContent).toBe(
      "3 users",
    );
    expect(screen.getAllByTestId("ops-connector-status-connected")).toHaveLength(
      1,
    );
    expect(
      screen.getByTestId("ops-connector-status-reauth").textContent,
    ).toBe("Needs reauth");
  });

  it("has no Add-connector catalog picker", async () => {
    renderPage();

    await screen.findByTestId("ops-connectors-list");
    expect(screen.queryByTestId("ops-add-connector")).toBeNull();
    expect(screen.queryByTestId("ops-connector-catalog")).toBeNull();
    expect(screen.queryByLabelText("Search catalog")).toBeNull();
    expect(document.querySelectorAll("[data-testid^='ops-entitle-']")).toHaveLength(
      0,
    );
  });

  it("onboard searches canonical-not-on-tenant and skips not_runnable", async () => {
    renderPage();

    fireEvent.click(await screen.findByTestId("ops-connector-onboard"));
    const picker = await screen.findByTestId("ops-connector-onboard-picker");
    expect(picker.textContent).toContain("Stripe");
    expect(picker.textContent).not.toContain("Slack");
    expect(picker.textContent).not.toContain("Google");

    fireEvent.change(screen.getByLabelText("Search connectors"), {
      target: { value: "stripe" },
    });
    expect(picker.textContent).toContain("Stripe");
    expect(picker.textContent).not.toContain("HubSpot");
  });

  it("onboards a canonical connector and does not entitle from a seed catalog", async () => {
    renderPage();

    fireEvent.click(await screen.findByTestId("ops-connector-onboard"));
    const addButtons = await screen.findAllByRole("button", { name: "Onboard" });
    const pickerAdd = addButtons.find(
      (button) => button.getAttribute("data-testid") !== "ops-connector-onboard",
    );
    expect(pickerAdd).toBeTruthy();
    fireEvent.click(pickerAdd!);

    await waitFor(() => {
      expect(putOpsConnectorOnboard).toHaveBeenCalledWith({
        tenantId: "t1",
        connectorId: "stripe",
        surfaces: ["mcp"],
      });
    });
  });

  it("opens connector detail when a row is clicked", async () => {
    const onOpenConnector = vi.fn();
    render(
      <Providers>
        <OpsConnectorsPage tenant={tenant} onOpenConnector={onOpenConnector} />
      </Providers>,
    );

    fireEvent.click(await screen.findByText("Google"));
    expect(onOpenConnector).toHaveBeenCalledWith("google");
  });

  it("confirms list switch off then un-onboards", async () => {
    renderPage();
    await screen.findByTestId("ops-connectors-list");
    const switchInput = screen
      .getByTestId("ops-connector-switch-google")
      .querySelector("input") as HTMLInputElement;
    fireEvent.click(switchInput);
    expect(await screen.findByTestId("ops-connector-off-confirm")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => {
      expect(putOpsConnectorOnboard).toHaveBeenCalledWith({
        tenantId: "t1",
        connectorId: "google",
        surfaces: [],
      });
    });
  });

  it("has no page subtitle explainer or catalog seed copy", async () => {
    renderPage();

    await screen.findByTestId("ops-connectors-list");
    const body = (document.body.textContent ?? "").toLowerCase();
    expect(body).not.toContain("tenant admins connect");
    expect(body).not.toContain("entitled");
    fireEvent.click(screen.getByTestId("ops-connector-onboard"));
    expect(await screen.findByTestId("ops-connector-onboard-picker")).toBeTruthy();
    const picker = (
      screen.getByTestId("ops-connector-onboard-picker").textContent ?? ""
    ).toLowerCase();
    expect(picker).not.toContain("main list stays entitled");
    expect(picker).not.toContain("common integrations.sh domains");
    expect(picker).not.toContain("50 in catalog");
  });

  it("shows empty state when the tenant has no connectors", async () => {
    fetchOpsTenantConnectors.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText("No connectors yet")).toBeTruthy();
    expect(screen.queryByTestId("ops-connectors-list")).toBeNull();
    expect(screen.getByTestId("ops-connector-onboard")).toBeTruthy();
  });

  it("surfaces BFF failures as alerts", async () => {
    fetchOpsTenantConnectors.mockRejectedValue(new Error("Catalog failed"));
    renderPage();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByTestId("ops-connectors-error").textContent).toContain(
      "Catalog failed",
    );
  });
});
