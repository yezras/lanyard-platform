import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import { OpsAuditPage } from "./OpsAuditPage.js";

const fetchOpsTenantAudit = vi.fn();

vi.mock("../../api/opsAdmin.js", () => ({
  fetchOpsTenantAudit: (...args: unknown[]) => fetchOpsTenantAudit(...args),
}));

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

const entry = {
  audit_id: "a1",
  action: "instance.provisioned",
  actor: "ops@lanyard.example",
  result: "success",
  created_at: "2026-08-02T03:04:05Z",
  instance_id: "inst-1",
};

const FORBIDDEN_PHRASES = [
  "Durable control-plane mutations",
  "Metadata only",
  "no secrets or vault bodies",
  "No control-plane mutations recorded",
] as const;

function renderPage(pageTenant = tenant) {
  return render(
    <Providers>
      <OpsAuditPage tenant={pageTenant} />
    </Providers>,
  );
}

function assertNoInstructionalCopy() {
  const collapsed = (document.body.textContent ?? "").replace(/\s+/g, " ");
  for (const phrase of FORBIDDEN_PHRASES) {
    expect(collapsed).not.toContain(phrase);
  }
}

function assertNoInPageTenantPicker() {
  expect(screen.queryByTestId("ops-pick-audit-mocklab")).toBeNull();
  expect(screen.queryByTestId("ops-pick-audit-acme")).toBeNull();
  expect(screen.queryByTestId("admin-tenant-switcher")).toBeNull();
  expect(screen.queryByLabelText("Selected tenant")).toBeNull();
}

describe("OpsAuditPage", () => {
  beforeEach(() => {
    fetchOpsTenantAudit.mockReset();
    fetchOpsTenantAudit.mockResolvedValue([entry]);
  });

  afterEach(() => {
    cleanup();
  });

  it("lists audit entries for the injected shell tenant with no in-page picker", async () => {
    renderPage();

    await waitFor(() => {
      expect(fetchOpsTenantAudit).toHaveBeenCalledWith("t1");
    });
    expect(await screen.findByTestId("ops-audit-a1")).toBeTruthy();
    const table = screen.getByTestId("ops-audit-table");
    expect(table.textContent).toContain("ops@lanyard.example");
    expect(table.textContent).toContain("success");
    assertNoInPageTenantPicker();
    assertNoInstructionalCopy();
  });

  it("reloads audit when the shell tenant changes", async () => {
    const { rerender } = renderPage();

    await waitFor(() => {
      expect(fetchOpsTenantAudit).toHaveBeenCalledWith("t1");
    });

    fetchOpsTenantAudit.mockResolvedValue([
      { ...entry, audit_id: "a2", action: "tenant.switched" },
    ]);
    rerender(
      <Providers>
        <OpsAuditPage tenant={acme} />
      </Providers>,
    );

    await waitFor(() => {
      expect(fetchOpsTenantAudit).toHaveBeenCalledWith("t2");
    });
    expect(await screen.findByTestId("ops-audit-a2")).toBeTruthy();
    expect(screen.queryByTestId("ops-audit-a1")).toBeNull();
    assertNoInPageTenantPicker();
  });

  it("shows an empty state when the tenant has no audit entries", async () => {
    fetchOpsTenantAudit.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByTestId("ops-audit-empty")).toBeTruthy();
    expect(screen.getByText("No audit entries")).toBeTruthy();
    expect(screen.queryByTestId("ops-audit-table")).toBeNull();
    expect(screen.queryByTestId("ops-audit-error")).toBeNull();
    expect(
      screen.queryByText("No control-plane mutations recorded"),
    ).toBeNull();
    assertNoInPageTenantPicker();
    assertNoInstructionalCopy();
  });

  it("renders audit load failures as an alert and omits the table", async () => {
    fetchOpsTenantAudit.mockRejectedValue(new Error("Failed to load audit"));

    renderPage();

    const alert = await screen.findByTestId("ops-audit-load-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Failed to load audit");
    expect(screen.queryByTestId("ops-audit-table")).toBeNull();
    assertNoInPageTenantPicker();
    assertNoInstructionalCopy();
  });
});
