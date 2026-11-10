import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import { OpsUsersPage } from "./OpsUsersPage.js";

const fetchOpsTenantUsers = vi.fn();
const createOpsTenantUser = vi.fn();
const deleteOpsTenantUser = vi.fn();
const putOpsConnectorUserGrant = vi.fn();
const fetchOpsTenantConnectors = vi.fn();

vi.mock("../../api/opsTenantAdmin.js", () => ({
  fetchOpsTenantUsers: (...args: unknown[]) => fetchOpsTenantUsers(...args),
  createOpsTenantUser: (...args: unknown[]) => createOpsTenantUser(...args),
  deleteOpsTenantUser: (...args: unknown[]) => deleteOpsTenantUser(...args),
  putOpsConnectorUserGrant: (...args: unknown[]) =>
    putOpsConnectorUserGrant(...args),
}));

vi.mock("../../api/opsConnectors.js", () => ({
  fetchOpsTenantConnectors: (...args: unknown[]) =>
    fetchOpsTenantConnectors(...args),
}));

const tenant = {
  tenant_id: "t1",
  tenant_slug: "mocklab",
  display_name: "MockLab",
};

const FORBIDDEN_COPY = [
  "Who is provisioned",
  "which tools they can use",
  "Tenant admins manage",
  "Invite the first user",
];

const jack = {
  user_id: "u1",
  display_name: "Jack Rubin",
  email: "operator@example.com",
  role: "tenant_admin" as const,
  connectors: ["google", "hubspot"],
  last_active_at: "2026-08-24T10:00:00Z",
};

const sam = {
  user_id: "u2",
  display_name: "Sam Ortiz",
  email: "sam@mocklab.io",
  role: "member" as const,
  connectors: [],
  last_active_at: null,
};

const onboarded = [
  {
    connector_id: "google",
    label: "Google",
    surfaces: ["cli"],
    available_surfaces: ["cli"],
    status_counts: { connected: 1, pairing: 0, needs_reauth: 0 },
    auth_chips: ["OAuth"],
  },
  {
    connector_id: "hubspot",
    label: "HubSpot",
    surfaces: ["api", "cli"],
    available_surfaces: ["api", "cli"],
    status_counts: { connected: 1, pairing: 0, needs_reauth: 0 },
    auth_chips: ["OAuth"],
  },
];

function renderPage(
  props: { userId?: string | null } = {},
) {
  return render(
    <Providers>
      <OpsUsersPage tenant={tenant} {...props} />
    </Providers>,
  );
}

function expectNoInstructionalCopy() {
  const text = document.body.textContent ?? "";
  for (const phrase of FORBIDDEN_COPY) {
    expect(text).not.toContain(phrase);
  }
  expect(text.toLowerCase()).not.toContain("invited");
}

function fillAddUser(name: string, email: string) {
  const dialog = screen.getByTestId("ops-add-user-dialog");
  const inputs = dialog.querySelectorAll("input");
  fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: name } });
  fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: email } });
}

describe("OpsUsersPage (lp-hdzm.22)", () => {
  beforeEach(() => {
    fetchOpsTenantUsers.mockReset();
    createOpsTenantUser.mockReset();
    deleteOpsTenantUser.mockReset();
    putOpsConnectorUserGrant.mockReset();
    fetchOpsTenantConnectors.mockReset();
    fetchOpsTenantConnectors.mockResolvedValue(onboarded);
  });

  afterEach(() => {
    cleanup();
  });

  it("lists person, role, provisioned connectors, and last active", async () => {
    fetchOpsTenantUsers.mockResolvedValue([jack, sam]);

    renderPage();

    expect(await screen.findByText("Jack Rubin")).toBeTruthy();
    expect(screen.getAllByTestId("ops-user-connector-u1-google")).toHaveLength(1);
    expect(screen.getAllByTestId("ops-user-connector-u1-hubspot")).toHaveLength(1);
    expect(screen.getByTestId("ops-add-user")).toBeTruthy();
    expect(screen.queryByTestId("ops-invite-user")).toBeNull();
    expect(screen.getByTestId("ops-users-count").textContent).toContain("2 people");
    expectNoInstructionalCopy();
  });

  it("shows an empty state when the tenant has no users", async () => {
    fetchOpsTenantUsers.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("No users yet")).toBeTruthy();
    expect(screen.queryByTestId("ops-users-list")).toBeNull();
    expect(screen.queryByTestId("ops-users-error")).toBeNull();
    expect(screen.queryByTestId("ops-invite-user")).toBeNull();
    expectNoInstructionalCopy();
  });

  it("renders load failures as an alert and omits the list", async () => {
    fetchOpsTenantUsers.mockRejectedValue(
      new Error("Tenant users is not implemented yet"),
    );

    renderPage();

    const alert = await screen.findByTestId("ops-users-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Tenant users is not implemented yet");
    expect(screen.queryByTestId("ops-users-list")).toBeNull();
    expectNoInstructionalCopy();
  });

  it("opens an Add user dialog with name, email, and Admin|Member", async () => {
    fetchOpsTenantUsers.mockResolvedValue([]);

    renderPage();
    fireEvent.click(await screen.findByTestId("ops-add-user"));

    const dialog = await screen.findByTestId("ops-add-user-dialog");
    expect(dialog.textContent).toContain("Name");
    expect(dialog.textContent).toContain("Email");
    expect(dialog.textContent).toContain("Admin");
    expect(dialog.textContent).toContain("Member");
    expect(dialog.textContent).not.toContain("Invited");
    expect(screen.queryByTestId("ops-invite-user")).toBeNull();
    expectNoInstructionalCopy();
  });

  it("appends the created user as an immediate list row", async () => {
    fetchOpsTenantUsers.mockResolvedValue([jack]);
    createOpsTenantUser.mockResolvedValue({
      user_id: "u9",
      display_name: "Ada Admin",
      email: "ada@ops.test",
      role: "tenant_admin",
      connectors: [],
      last_active_at: null,
    });

    renderPage();
    fireEvent.click(await screen.findByTestId("ops-add-user"));
    fillAddUser("Ada Admin", "ada@ops.test");
    fireEvent.click(screen.getByRole("radio", { name: "Admin" }));
    fireEvent.click(screen.getByTestId("ops-add-user-submit"));

    await waitFor(() => {
      expect(createOpsTenantUser).toHaveBeenCalledWith({
        tenantId: "t1",
        displayName: "Ada Admin",
        email: "ada@ops.test",
        role: "tenant_admin",
      });
    });
    expect(await screen.findByText("Ada Admin")).toBeTruthy();
    expect(screen.getByTestId("ops-users-count").textContent).toContain("2 people");
    expect(screen.queryByTestId("ops-invite-user")).toBeNull();
  });

  it("keeps the dialog open when add user fails", async () => {
    fetchOpsTenantUsers.mockResolvedValue([]);
    createOpsTenantUser.mockRejectedValue(new Error("Email already exists"));

    renderPage();
    fireEvent.click(await screen.findByTestId("ops-add-user"));
    fillAddUser("Ada Admin", "ada@ops.test");
    fireEvent.click(screen.getByTestId("ops-add-user-submit"));

    expect(await screen.findByTestId("ops-add-user-error")).toBeTruthy();
    expect(screen.getByTestId("ops-add-user-dialog")).toBeTruthy();
    expect(screen.queryByTestId("ops-users-list")).toBeNull();
  });

  it("opens user detail with person grant Switches", async () => {
    fetchOpsTenantUsers.mockResolvedValue([jack, sam]);
    putOpsConnectorUserGrant.mockResolvedValue(undefined);

    renderPage();
    fireEvent.click(await screen.findByTestId("ops-user-row-u1"));

    expect(await screen.findByTestId("ops-user-detail")).toBeTruthy();
    expect(screen.getByTestId("ops-user-detail-name").textContent).toBe(
      "Jack Rubin",
    );
    expect(await screen.findByTestId("ops-user-grants")).toBeTruthy();
    expect(screen.getByTestId("ops-user-grant-google")).toBeTruthy();
    expect(screen.getByTestId("ops-user-grant-hubspot")).toBeTruthy();
    expect(screen.queryByTestId("ops-user-grant-slack")).toBeNull();
    expect(screen.queryByTestId("ops-member-subset")).toBeNull();

    const hubspot = screen
      .getByTestId("ops-user-grant-hubspot")
      .querySelector("input") as HTMLInputElement;
    expect(hubspot.checked).toBe(true);
    fireEvent.click(hubspot);
    await waitFor(() => {
      expect(putOpsConnectorUserGrant).toHaveBeenCalledWith({
        tenantId: "t1",
        connectorId: "hubspot",
        userId: "u1",
        granted: false,
      });
    });
    expectNoInstructionalCopy();
  });

  it("disables Remove on the last tenant admin", async () => {
    fetchOpsTenantUsers.mockResolvedValue([jack, sam]);

    renderPage();
    fireEvent.click(await screen.findByTestId("ops-user-row-u1"));

    const adminRemove = await screen.findByTestId("ops-user-remove");
    const adminButton =
      adminRemove.closest("button") ?? (adminRemove as HTMLButtonElement);
    expect(adminButton.disabled).toBe(true);

    fireEvent.click(screen.getByText("Users"));
    fireEvent.click(await screen.findByTestId("ops-user-row-u2"));

    const memberRemove = await screen.findByTestId("ops-user-remove");
    const memberButton =
      memberRemove.closest("button") ?? (memberRemove as HTMLButtonElement);
    expect(memberButton.disabled).toBe(false);

    deleteOpsTenantUser.mockResolvedValue(undefined);
    fireEvent.click(memberButton);
    await waitFor(() => {
      expect(deleteOpsTenantUser).toHaveBeenCalledWith({
        tenantId: "t1",
        userId: "u2",
      });
    });
    expect(await screen.findByText("Jack Rubin")).toBeTruthy();
    expect(screen.queryByText("Sam Ortiz")).toBeNull();
  });
});
