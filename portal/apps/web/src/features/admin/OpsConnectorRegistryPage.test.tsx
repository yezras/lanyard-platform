import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import { AuthenticatedOpsConsole } from "../../layout/AuthenticatedOpsConsole.js";
import { OpsConnectorRegistryPage } from "./OpsConnectorRegistryPage.js";

const searchOpsRegistry = vi.fn();
const fetchCanonicalConnectors = vi.fn();
const promoteRegistryDomain = vi.fn();
const createCustomConnector = vi.fn();
const deleteCanonicalConnector = vi.fn();

vi.mock("../../api/opsRegistry.js", async () => {
  const actual = await vi.importActual<typeof import("../../api/opsRegistry.js")>(
    "../../api/opsRegistry.js",
  );
  return {
    ...actual,
    searchOpsRegistry: (...args: unknown[]) => searchOpsRegistry(...args),
    fetchCanonicalConnectors: (...args: unknown[]) =>
      fetchCanonicalConnectors(...args),
    promoteRegistryDomain: (...args: unknown[]) =>
      promoteRegistryDomain(...args),
    createCustomConnector: (...args: unknown[]) =>
      createCustomConnector(...args),
    deleteCanonicalConnector: (...args: unknown[]) =>
      deleteCanonicalConnector(...args),
  };
});

const slackHit = {
  domain: "slack.com",
  name: "Slack",
  description: "",
  kinds: ["mcp", "graphql"] as const,
};

const stripeHit = {
  domain: "stripe.com",
  name: "Stripe",
  description: "",
  kinds: ["mcp", "openapi", "cli"] as const,
};

const stripeRow = {
  id: "stripe",
  domain: "stripe.com",
  label: "Stripe",
  source: "integrations.sh",
  source_entry_id: "integrations.sh:stripe.com",
  archived: false,
  onboarded_tenant_count: 2,
};

const slackRow = {
  id: "slack",
  domain: "slack.com",
  label: "Slack",
  source: "integrations.sh",
  source_entry_id: "integrations.sh:slack.com",
  archived: false,
  onboarded_tenant_count: 0,
};

function renderPage() {
  return render(
    <Providers>
      <OpsConnectorRegistryPage />
    </Providers>,
  );
}

describe("OpsConnectorRegistryPage (lp-hdzm.20)", () => {
  beforeEach(() => {
    searchOpsRegistry.mockReset();
    fetchCanonicalConnectors.mockReset();
    promoteRegistryDomain.mockReset();
    createCustomConnector.mockReset();
    deleteCanonicalConnector.mockReset();
    fetchCanonicalConnectors.mockResolvedValue([stripeRow]);
    searchOpsRegistry.mockResolvedValue([slackHit, stripeHit]);
  });

  afterEach(() => {
    cleanup();
  });

  it("searches via BFF and shows On registry instead of Promote for canonical hits", async () => {
    renderPage();

    expect(await screen.findByTestId("ops-registry-page")).toBeTruthy();
    expect(await screen.findByTestId("ops-registry-canonical")).toBeTruthy();
    expect(screen.getByText("Stripe")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "slack" },
    });

    expect(await screen.findByTestId("ops-registry-results")).toBeTruthy();
    await waitFor(() => {
      expect(searchOpsRegistry).toHaveBeenCalledWith("slack");
    });
    expect(screen.getByText("Slack")).toBeTruthy();
    expect(screen.getAllByText("MCP").length).toBeGreaterThan(0);
    expect(screen.getByText("GraphQL")).toBeTruthy();
    expect(screen.getByText("API")).toBeTruthy();
    expect(screen.getByText("CLI")).toBeTruthy();
    expect(screen.getByTestId("ops-registry-promote-slack.com")).toBeTruthy();
    expect(screen.getByTestId("ops-registry-on-registry-stripe.com").textContent).toBe(
      "On registry",
    );
    expect(screen.queryByTestId("ops-registry-promote-stripe.com")).toBeNull();
  });

  it("promotes a catalog hit and then shows On registry", async () => {
    promoteRegistryDomain.mockResolvedValue(slackRow);
    fetchCanonicalConnectors
      .mockResolvedValueOnce([stripeRow])
      .mockResolvedValueOnce([stripeRow, slackRow]);

    renderPage();
    fireEvent.change(await screen.findByLabelText("Search"), {
      target: { value: "slack" },
    });
    fireEvent.click(await screen.findByTestId("ops-registry-promote-slack.com"));

    await waitFor(() => {
      expect(promoteRegistryDomain).toHaveBeenCalledWith("slack.com");
    });
    expect(await screen.findByTestId("ops-registry-on-registry-slack.com")).toBeTruthy();
    expect(screen.queryByTestId("ops-registry-promote-slack.com")).toBeNull();
    expect(screen.getByTestId("ops-registry-row-slack")).toBeTruthy();
  });

  it("adds a custom connector from the form", async () => {
    createCustomConnector.mockResolvedValue({
      id: "linear",
      domain: null,
      label: "Linear",
      source: "custom",
      source_entry_id: null,
      archived: false,
      onboarded_tenant_count: 0,
    });
    fetchCanonicalConnectors
      .mockResolvedValueOnce([stripeRow])
      .mockResolvedValueOnce([
        stripeRow,
        {
          id: "linear",
          domain: null,
          label: "Linear",
          source: "custom",
          source_entry_id: null,
          archived: false,
          onboarded_tenant_count: 0,
        },
      ]);

    renderPage();
    fireEvent.click(await screen.findByTestId("ops-registry-add-custom"));
    expect(await screen.findByTestId("ops-registry-custom-form")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "GraphQL" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Slug"), {
      target: { value: "linear" },
    });
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Linear" },
    });
    fireEvent.change(screen.getByLabelText("Initialize URL"), {
      target: { value: "https://mcp.linear.app/mcp" },
    });
    fireEvent.click(screen.getByTestId("ops-registry-custom-submit"));

    await waitFor(() => {
      expect(createCustomConnector).toHaveBeenCalledWith({
        slug: "linear",
        label: "Linear",
        surfaces: [
          {
            kind: "mcp",
            initialize_url: "https://mcp.linear.app/mcp",
            transports: ["streamable-http"],
          },
        ],
      });
    });
    expect(await screen.findByTestId("ops-registry-row-linear")).toBeTruthy();
  });

  it("disables delete when onboarded_tenant_count > 0 and confirms otherwise", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteCanonicalConnector.mockResolvedValue({
      ...slackRow,
      archived: true,
    });
    fetchCanonicalConnectors.mockResolvedValue([stripeRow, slackRow]);

    renderPage();
    expect(await screen.findByTestId("ops-registry-delete-stripe")).toBeTruthy();
    expect(
      screen.getByTestId("ops-registry-delete-stripe").hasAttribute("disabled") ||
        screen.getByTestId("ops-registry-delete-stripe").getAttribute("aria-disabled") ===
          "true",
    ).toBe(true);
    fireEvent.click(screen.getByTestId("ops-registry-delete-stripe"));
    expect(deleteCanonicalConnector).not.toHaveBeenCalled();
    expect(screen.queryByText("Soon")).toBeNull();

    fireEvent.click(screen.getByTestId("ops-registry-delete-slack"));
    await waitFor(() => {
      expect(confirm).toHaveBeenCalled();
      expect(deleteCanonicalConnector).toHaveBeenCalledWith("slack");
    });
    confirm.mockRestore();
  });
});

function requestPath(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return new URL(raw, "http://localhost").pathname;
}

describe("OpsConnectorRegistryPage tenant cookie", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.location.hash = "";
  });

  it("does not load registry when only a tenant session cookie is present", async () => {
    window.location.hash = "#/registry";
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const path = requestPath(input);
      if (path === "/api/auth/me") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user_id: "user-1",
              email: "dev@demo.local",
              tenant_id: "tenant-1",
            }),
            { status: 200 },
          ),
        );
      }
      if (path === "/api/admin/auth/me") {
        return Promise.resolve(new Response(null, { status: 401 }));
      }
      if (path === "/api/admin/auth/google") {
        return Promise.resolve(new Response(null, { status: 503 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
      );
    });

    render(
      <Providers>
        <AuthenticatedOpsConsole />
      </Providers>,
    );

    expect(
      await screen.findByRole("heading", { name: "Platform admin" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("ops-registry-page")).toBeNull();
    expect(screen.queryByTestId("ops-registry-search")).toBeNull();
    expect(screen.queryByLabelText("Search")).toBeNull();
  });
});
