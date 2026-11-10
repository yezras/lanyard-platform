import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectorsPage, type ConnectorsPageProps } from "./ConnectorsPage.js";
import {
  buildConnectorsPageModel,
  type ConnectorsPageModel,
  type SaasConnectorRow,
} from "./connectorsCatalog.js";
import type { ConnectorsTeamResponse } from "./connectorsTeam.js";

afterEach(() => {
  cleanup();
});

function pageProps(
  overrides: Partial<ConnectorsPageProps> & { model: ConnectorsPageModel },
): ConnectorsPageProps {
  return {
    loadError: null,
    connectingId: null,
    busyId: null,
    togglingSkillId: null,
    togglingMcpName: null,
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onRefresh: vi.fn(),
    onReconnect: vi.fn(),
    clearingStickyKey: null,
    onToggleSkill: vi.fn(),
    onToggleMcp: vi.fn(),
    onClearSticky: vi.fn(),
    onOpenDetail: vi.fn(),
    team: null,
    togglingGrantKey: null,
    pinBusy: false,
    teamError: null,
    onToggleGrant: vi.fn(),
    onClearHubSpotPin: vi.fn(),
    ...overrides,
  };
}

function saasRow(
  overrides: Partial<SaasConnectorRow> & Pick<SaasConnectorRow, "connector_id" | "label">,
): SaasConnectorRow {
  return {
    kind: "saas",
    runtimes: [],
    status: "not_connected",
    account_label: null,
    sticky: {},
    bound_tools: [],
    ...overrides,
  };
}

describe("ConnectorsPage sticky clear", () => {
  it("clears one Always class and still offers Disconnect on a connected row", () => {
    const onClearSticky = vi.fn();
    render(
      <ConnectorsPage
        {...pageProps({
          onClearSticky,
          model: {
            saas: [
              saasRow({
                connector_id: "google",
                label: "Google",
                runtimes: ["cli", "skill"],
                status: "connected",
                account_label: "alice@gmail.com",
                sticky: { "gmail.draft": true },
              }),
            ],
            on_this_brain: [],
          },
        })}
      />,
    );
    expect(screen.getByText("Always: gmail.draft")).toBeTruthy();
    expect(screen.getByTestId("connector-disconnect-google")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClearSticky).toHaveBeenCalledWith("google", "gmail.draft");
  });
});

describe("ConnectorsPage granted registry connectors (lp-hdzm.28)", () => {
  it("renders a granted registry id and does not search integrations.sh", () => {
    render(
      <ConnectorsPage
        {...pageProps({
          model: {
            saas: [
              saasRow({
                connector_id: "slack",
                label: "Slack",
                runtimes: ["mcp"],
              }),
            ],
            on_this_brain: [],
          },
        })}
      />,
    );
    const row = screen.getByTestId("connector-row-slack");
    expect(row.getAttribute("data-connector-kind")).toBe("saas");
    expect(screen.getByText("Slack")).toBeTruthy();
    expect(screen.queryByTestId("connector-row-google")).toBeNull();
    expect(screen.queryByTestId("connector-row-stripe")).toBeNull();
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/integrations\.sh/i);
  });

  it("hides ungranted connectors by omitting them from the model", () => {
    render(
      <ConnectorsPage
        {...pageProps({
          model: { saas: [], on_this_brain: [] },
        })}
      />,
    );
    expect(screen.getByText("No connectors granted.")).toBeTruthy();
    expect(screen.getByText("Apps")).toBeTruthy();
    expect(screen.getByText("Skills")).toBeTruthy();
    expect(screen.queryByTestId("connector-row-slack")).toBeNull();
    expect(screen.queryByText("On this brain")).toBeNull();
  });
});

describe("ConnectorsPage Apps and Skills", () => {
  it("puts SaaS, MCP, and CLI in Apps and skill rows in Skills", () => {
    render(
      <ConnectorsPage
        {...pageProps({
          model: buildConnectorsPageModel({
            connectors: [
              {
                connector_id: "google",
                status: "connected",
                account_label: "alice@gmail.com",
                sticky: {},
                entitled: true,
                role_granted: true,
                hubspot_portal_id: null,
              },
            ],
            skills: [
              {
                id: "post-meeting-triage",
                name: "Post-meeting triage",
                path: "skills/crm/post-meeting-triage",
                enabled: true,
              },
            ],
            mcp_servers: [{ name: "linear", transport: "stdio", enabled: true }],
            integrations: [{ id: "slack", name: "Slack", type: "connector" }],
          }),
        })}
      />,
    );

    const apps = screen.getByTestId("connectors-apps");
    const skills = screen.getByTestId("connectors-skills");
    expect(within(apps).getByText("Apps")).toBeTruthy();
    expect(within(skills).getByText("Skills")).toBeTruthy();
    expect(within(apps).getByTestId("connector-row-google")).toBeTruthy();
    expect(within(apps).getByTestId("mcp-table")).toBeTruthy();
    expect(within(apps).getByText("linear")).toBeTruthy();
    expect(within(apps).getByTestId("apps-cli-slack")).toBeTruthy();
    expect(within(skills).getByTestId("skills-table")).toBeTruthy();
    expect(within(skills).getByText("Post-meeting triage")).toBeTruthy();
    expect(within(skills).queryByText("linear")).toBeNull();
    expect(within(skills).queryByText("Slack")).toBeNull();
    expect(screen.queryByText("On this brain")).toBeNull();
    expect(screen.queryByRole("button", { name: "Catalog" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Team" })).toBeNull();
    expect(screen.queryByTestId("settings-admin")).toBeNull();
    expect(
      apps.compareDocumentPosition(skills) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps connect and disconnect on app rows", () => {
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    render(
      <ConnectorsPage
        {...pageProps({
          onConnect,
          onDisconnect,
          model: {
            saas: [
              saasRow({
                connector_id: "google",
                label: "Google",
                status: "not_connected",
              }),
              saasRow({
                connector_id: "hubspot",
                label: "HubSpot",
                status: "connected",
              }),
            ],
            on_this_brain: [],
          },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect Google" }));
    expect(onConnect).toHaveBeenCalledWith("google");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect HubSpot" }));
    expect(onDisconnect).toHaveBeenCalledWith("hubspot");
  });

  it("shows Admin under Apps and Skills when the team payload is present", () => {
    const team: ConnectorsTeamResponse = {
      hubspot_portal_id: "123",
      grants: [
        {
          role_id: "role-member",
          role_name: "member",
          connector_id: "google",
          enabled: true,
        },
      ],
      members: [],
    };
    render(
      <ConnectorsPage
        {...pageProps({
          team,
          model: {
            saas: [
              saasRow({
                connector_id: "google",
                label: "Google",
                status: "connected",
              }),
            ],
            on_this_brain: [],
          },
        })}
      />,
    );

    const apps = screen.getByTestId("connectors-apps");
    const skills = screen.getByTestId("connectors-skills");
    const admin = screen.getByTestId("settings-admin");
    expect(within(admin).getByText("Admin")).toBeTruthy();
    expect(within(admin).getByTestId("connectors-team-panel")).toBeTruthy();
    expect(screen.getByTestId("connector-disconnect-google")).toBeTruthy();
    expect(screen.queryByTestId("connectors-team-nav")).toBeNull();
    expect(screen.queryByRole("button", { name: "Catalog" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Team" })).toBeNull();
    expect(
      apps.compareDocumentPosition(skills) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      skills.compareDocumentPosition(admin) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
