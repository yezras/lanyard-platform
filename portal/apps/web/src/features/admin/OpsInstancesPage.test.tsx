import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import { OpsInstancesPage } from "./OpsInstancesPage.js";

const fetchOpsTenants = vi.fn();
const fetchOpsTenantInstances = vi.fn();

vi.mock("../../api/opsAdmin.js", () => ({
  fetchOpsTenants: (...args: unknown[]) => fetchOpsTenants(...args),
  fetchOpsTenantInstances: (...args: unknown[]) =>
    fetchOpsTenantInstances(...args),
}));

const FORBIDDEN_PHRASES = [
  "Active gateway registrations per tenant",
  "Public metadata only",
  "no instance secrets are listed here",
] as const;

function assertNoInstructionalCopy() {
  const text = document.body.textContent ?? "";
  const collapsed = text.replace(/\s+/g, " ");
  for (const phrase of FORBIDDEN_PHRASES) {
    expect(collapsed).not.toContain(phrase);
  }
}

function assertNoTenantPicker() {
  expect(screen.queryByTestId("ops-pick-instances-mocklab")).toBeNull();
  expect(screen.queryByTestId("ops-pick-instances-acme")).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(document.querySelector("select")).toBeNull();
  expect(fetchOpsTenants).not.toHaveBeenCalled();
}

const instance = {
  instance_id: "inst-1",
  created_at: "2026-08-01T00:00:00Z",
  label: null,
  health_status: "healthy",
  runtime_kind: "daytona",
  presence: "online",
  sandbox_id: "sbx-1",
  revoked_at: null,
  last_activity_at: "2026-08-02T03:04:05Z",
};

const tenant = {
  tenant_id: "t1",
  tenant_slug: "mocklab",
  display_name: "MockLab",
};

const acme = {
  tenant_id: "t2",
  tenant_slug: "acme",
  display_name: "Acme",
};

function renderPage(pageTenant = tenant) {
  return render(
    <Providers>
      <OpsInstancesPage tenant={pageTenant} />
    </Providers>,
  );
}

describe("OpsInstancesPage (lp-hdzm.15)", () => {
  beforeEach(() => {
    fetchOpsTenants.mockReset();
    fetchOpsTenantInstances.mockReset();
    fetchOpsTenantInstances.mockResolvedValue([instance]);
  });

  afterEach(() => {
    cleanup();
  });

  it("lists instances for the injected shell tenant without a picker", async () => {
    renderPage();

    await waitFor(() => {
      expect(fetchOpsTenantInstances).toHaveBeenCalledWith("t1");
    });
    expect(await screen.findByTestId("ops-instance-inst-1")).toBeTruthy();
    expect(screen.getByTestId("ops-instances-table").textContent).toContain(
      "daytona",
    );
    expect(screen.getByTestId("ops-instances-table").textContent).toContain(
      "online",
    );
    assertNoTenantPicker();
    assertNoInstructionalCopy();
  });

  it("has no page subtitle explainer, footer how-to, or tenant picker", async () => {
    renderPage();

    expect(await screen.findByText("Gateway instances")).toBeTruthy();
    assertNoTenantPicker();
    assertNoInstructionalCopy();
  });

  it("shows an empty state when the tenant has no instances", async () => {
    fetchOpsTenantInstances.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByTestId("ops-instances-empty")).toBeTruthy();
    expect(screen.getByText("No instances")).toBeTruthy();
    expect(screen.getByText(/MockLab/)).toBeTruthy();
    expect(screen.queryByTestId("ops-instances-table")).toBeNull();
    assertNoTenantPicker();
    assertNoInstructionalCopy();
  });

  it("surfaces instance load failures as alerts", async () => {
    fetchOpsTenantInstances.mockRejectedValue(
      new Error("Failed to load instances"),
    );

    renderPage();

    const alert = await screen.findByTestId("ops-instances-fetch-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Failed to load instances");
    expect(screen.queryByTestId("ops-instances-table")).toBeNull();
    assertNoTenantPicker();
    assertNoInstructionalCopy();
  });

  it("refetches when the injected shell tenant changes", async () => {
    const { rerender } = renderPage();

    await waitFor(() => {
      expect(fetchOpsTenantInstances).toHaveBeenCalledWith("t1");
    });
    expect(await screen.findByTestId("ops-instance-inst-1")).toBeTruthy();

    fetchOpsTenantInstances.mockResolvedValue([]);
    rerender(
      <Providers>
        <OpsInstancesPage tenant={acme} />
      </Providers>,
    );

    await waitFor(() => {
      expect(fetchOpsTenantInstances).toHaveBeenCalledWith("t2");
    });
    expect(await screen.findByTestId("ops-instances-empty")).toBeTruthy();
    expect(screen.getByText(/Acme/)).toBeTruthy();
    expect(screen.queryByTestId("ops-instances-table")).toBeNull();
    assertNoTenantPicker();
  });
});
