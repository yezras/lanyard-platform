import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import { OpsRolesPage } from "./OpsRolesPage.js";

const fetchOpsTenants = vi.fn();
const fetchOpsTenantRoles = vi.fn();

vi.mock("../../api/opsAdmin.js", () => ({
  fetchOpsTenants: (...args: unknown[]) => fetchOpsTenants(...args),
  fetchOpsTenantRoles: (...args: unknown[]) => fetchOpsTenantRoles(...args),
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

const role = {
  role_id: "r1",
  name: "admin",
  hermes_profile: "workspace",
  path_prefixes: ["/projects", "/skills"],
  created_at: "2026-08-01T00:00:00Z",
};

const FORBIDDEN_COPY = [
  "RBAC roles per tenant",
  "with their Hermes profile",
  "allowed vault path prefixes",
];

function renderPage(pageTenant = tenant) {
  return render(
    <Providers>
      <OpsRolesPage tenant={pageTenant} />
    </Providers>,
  );
}

function expectNoInstructionalCopy() {
  const body = document.body.textContent ?? "";
  for (const phrase of FORBIDDEN_COPY) {
    expect(body).not.toContain(phrase);
  }
}

function expectNoTenantPicker() {
  expect(document.querySelector("select")).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByTestId("ops-pick-roles-mocklab")).toBeNull();
  expect(screen.queryByTestId("ops-pick-roles-acme")).toBeNull();
  expect(fetchOpsTenants).not.toHaveBeenCalled();
}

describe("OpsRolesPage", () => {
  beforeEach(() => {
    fetchOpsTenants.mockReset();
    fetchOpsTenantRoles.mockReset();
    fetchOpsTenants.mockResolvedValue([tenant, acme]);
    fetchOpsTenantRoles.mockResolvedValue([role]);
  });

  afterEach(() => {
    cleanup();
  });

  it("lists roles for the injected shell tenant with no in-page picker", async () => {
    renderPage();

    await waitFor(() => {
      expect(fetchOpsTenantRoles).toHaveBeenCalledWith("t1");
    });
    expect(fetchOpsTenantRoles).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("ops-role-r1")).toBeTruthy();
    const table = screen.getByTestId("ops-roles-table");
    expect(table.textContent).toContain("workspace");
    expect(table.textContent).toContain("/projects");
    expectNoTenantPicker();
    expectNoInstructionalCopy();
  });

  it("refetches when the shell tenant changes", async () => {
    const { rerender } = renderPage();

    await waitFor(() => {
      expect(fetchOpsTenantRoles).toHaveBeenCalledWith("t1");
    });

    rerender(
      <Providers>
        <OpsRolesPage tenant={acme} />
      </Providers>,
    );

    await waitFor(() => {
      expect(fetchOpsTenantRoles).toHaveBeenCalledWith("t2");
    });
    expectNoTenantPicker();
  });

  it("has no page subtitle explainer or footer how-to", async () => {
    renderPage();

    expect(await screen.findByText("Roles")).toBeTruthy();
    expectNoTenantPicker();
    expectNoInstructionalCopy();
  });

  it("shows an empty state when the tenant has no roles", async () => {
    fetchOpsTenantRoles.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("No roles")).toBeTruthy();
    expect(screen.getByText("No RBAC roles exist for MockLab yet.")).toBeTruthy();
    expect(screen.queryByTestId("ops-roles-table")).toBeNull();
    expectNoTenantPicker();
    expectNoInstructionalCopy();
  });

  it("surfaces role load errors as alerts", async () => {
    fetchOpsTenantRoles.mockRejectedValue(new Error("Failed to load roles"));

    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("data-testid")).toBe("ops-roles-load-error");
    expect(alert.textContent).toBe("Failed to load roles");
    expect(screen.queryByTestId("ops-roles-table")).toBeNull();
    expectNoTenantPicker();
  });
});
