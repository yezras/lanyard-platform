import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import { OpsSecretsPage } from "./OpsSecretsPage.js";

const fetchOpsSecrets = vi.fn();
const putOpsSecret = vi.fn();
const deleteOpsSecret = vi.fn();

vi.mock("../../api/opsSecrets.js", () => ({
  fetchOpsSecrets: (...args: unknown[]) => fetchOpsSecrets(...args),
  putOpsSecret: (...args: unknown[]) => putOpsSecret(...args),
  deleteOpsSecret: (...args: unknown[]) => deleteOpsSecret(...args),
}));

const tenant = {
  tenant_id: "t1",
  tenant_slug: "mocklab",
  display_name: "Mock Lab",
};

const otherTenant = {
  tenant_id: "t2",
  tenant_slug: "acme",
  display_name: "Acme",
};

const secretsRows = [
  {
    slot_id: "XAI_API_KEY",
    slot: { kind: "env_key", env_name: "XAI_API_KEY" },
    present: false,
    fingerprint: null,
    rotated_at: null,
  },
  {
    slot_id: "POOLSIDE_API_KEY",
    slot: { kind: "env_key", env_name: "POOLSIDE_API_KEY" },
    present: true,
    fingerprint: "sha256:abc123def456",
    rotated_at: "2026-08-23T00:00:00.000Z",
  },
];

function renderPage(next = tenant) {
  return render(
    <Providers>
      <OpsSecretsPage tenant={next} />
    </Providers>,
  );
}

function expectNoTenantSelect() {
  expect(document.querySelector("select")).toBeNull();
  expect(screen.queryByTestId("ops-secrets-tenant-select")).toBeNull();
  expect(screen.queryByLabelText("Tenant")).toBeNull();
}

function expectNoConnectorTokenCopy() {
  const copy = document.body.textContent ?? "";
  expect(copy).not.toMatch(/connector token/i);
  expect(copy).not.toMatch(/connector tokens/i);
}

describe("OpsSecretsPage", () => {
  beforeEach(() => {
    fetchOpsSecrets.mockReset();
    putOpsSecret.mockReset();
    deleteOpsSecret.mockReset();
    fetchOpsSecrets.mockResolvedValue(secretsRows);
    putOpsSecret.mockImplementation(async ({ slotId }) => ({
      slot_id: slotId,
      present: true,
      fingerprint: "sha256:new123",
      rotated_at: null,
    }));
    deleteOpsSecret.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("lists the shell tenant's Class B slots with no tenant dropdown", async () => {
    renderPage();

    expect(await screen.findByTestId("ops-secret-slot-XAI_API_KEY")).toBeTruthy();
    expect(screen.getByTestId("ops-secret-slot-POOLSIDE_API_KEY").textContent).toContain(
      "POOLSIDE_API_KEY",
    );
    expect(fetchOpsSecrets).toHaveBeenCalledWith("t1");
    expect(fetchOpsSecrets).not.toHaveBeenCalledWith("t2");
    expect(screen.getByText("Provider secrets")).toBeTruthy();
    expectNoTenantSelect();
    expectNoConnectorTokenCopy();
    expect(document.body.textContent).not.toContain("sk-live-value");
    const copy = document.body.textContent ?? "";
    expect(copy).not.toMatch(/never shown again/i);
    expect(copy).not.toMatch(/cold wake/i);
    expect(copy).not.toMatch(/ops-managed OAuth/i);
    expect(copy).not.toMatch(/Set model API keys/i);
  });

  it("reloads slots when the shell tenant changes", async () => {
    const { rerender } = renderPage();

    expect(await screen.findByTestId("ops-secret-slot-XAI_API_KEY")).toBeTruthy();
    expect(fetchOpsSecrets).toHaveBeenCalledWith("t1");

    fetchOpsSecrets.mockResolvedValue([
      {
        slot_id: "OPENAI_API_KEY",
        slot: { kind: "env_key", env_name: "OPENAI_API_KEY" },
        present: true,
        fingerprint: "sha256:acme",
        rotated_at: null,
      },
    ]);

    rerender(
      <Providers>
        <OpsSecretsPage tenant={otherTenant} />
      </Providers>,
    );

    expect(await screen.findByTestId("ops-secret-slot-OPENAI_API_KEY")).toBeTruthy();
    expect(screen.queryByTestId("ops-secret-slot-XAI_API_KEY")).toBeNull();
    expect(fetchOpsSecrets).toHaveBeenCalledWith("t2");
    expectNoTenantSelect();
    expectNoConnectorTokenCopy();
  });

  it("shows load failures as alerts", async () => {
    fetchOpsSecrets.mockRejectedValue(new Error("Not authenticated"));

    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("data-testid")).toBe("ops-secrets-error");
    expect(alert.textContent).toContain("Not authenticated");
    expectNoTenantSelect();
  });

  it("saves a pasted key and reloads statuses for the shell tenant", async () => {
    renderPage();

    const input = await screen.findByTestId("ops-secret-input-XAI_API_KEY");
    const field = input.querySelector("input") ?? input;
    fireEvent.change(field, { target: { value: "xai-new-key" } });

    fireEvent.click(screen.getByTestId("ops-secret-save-XAI_API_KEY"));

    await waitFor(() => {
      expect(putOpsSecret).toHaveBeenCalledWith({
        tenantId: "t1",
        slotId: "XAI_API_KEY",
        value: "xai-new-key",
      });
    });
    await waitFor(() => {
      expect(fetchOpsSecrets).toHaveBeenCalledWith("t1");
    });
  });

  it("deletes an existing slot for the shell tenant", async () => {
    renderPage();

    fireEvent.click(await screen.findByTestId("ops-secret-delete-POOLSIDE_API_KEY"));

    await waitFor(() => {
      expect(deleteOpsSecret).toHaveBeenCalledWith({
        tenantId: "t1",
        slotId: "POOLSIDE_API_KEY",
      });
    });
  });
});
