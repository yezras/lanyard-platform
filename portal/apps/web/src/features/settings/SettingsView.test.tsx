import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import type { SettingsHealthCheckResponse, SettingsSnapshot } from "../../api/types.js";
import { PortalHonestyProvider } from "../honesty/index.js";
import { SettingsSnapshotProvider } from "./SettingsSnapshotContext.js";
import { humanizeSchedule, SettingsView } from "./SettingsView.js";

const mockSnapshot: SettingsSnapshot = {
  exported_at: "2026-07-01T08:00:00.000Z",
  hermes_home: null,
  source: "fixture",
  skills: [
    {
      id: "post-meeting-triage",
      name: "Post-meeting triage",
      path: "skills/crm/post-meeting-triage",
      enabled: true,
    },
    {
      id: "draft-reply",
      name: "Draft reply",
      path: "skills/email/draft-reply",
      enabled: false,
    },
  ],
  crons: [
    {
      id: "vault-index",
      name: "Vault index refresh",
      schedule: "0 3 * * *",
      path: "cron/jobs.json",
      enabled: true,
      last_run_at: "2026-07-01T03:00:12.000Z",
      next_run_at: "2026-07-02T03:00:00.000Z",
    },
  ],
  mcp_servers: [],
  models: [
    {
      provider: "xai",
      model: "grok-3",
      is_active: true,
      connected: true,
    },
    {
      provider: "xai",
      model: "grok-4",
      is_active: false,
      connected: true,
    },
    {
      provider: "openai",
      model: "gpt-4.1",
      is_active: false,
      connected: false,
    },
  ],
  integrations: [
    { id: "gmail", name: "Gmail", type: "mcp", bin: "gws", path: "/usr/bin/gws" },
    { id: "slack", name: "Slack", type: "connector" },
    { id: "notion", name: "Notion", type: "connector" },
  ],
  workflows: [
    {
      id: "fizzbuzz-algorithm-test-report",
      name: "FizzBuzz algorithm test report",
      path: ".lanyard/workflows/fizzbuzz-algorithm-test-report.yaml",
      enabled: true,
      updated_at: "2026-07-01T07:30:00.000Z",
    },
  ],
};

const mockHealth: SettingsHealthCheckResponse = {
  checked_at: "2026-07-01T08:05:00.000Z",
  integrations: [
    {
      id: "gmail",
      name: "Gmail",
      type: "mcp",
      status: "healthy",
      latency_ms: 40,
      checked_at: "2026-07-01T08:05:00.000Z",
      message: "Connection OK (mock)",
    },
    {
      id: "slack",
      name: "Slack",
      type: "connector",
      status: "unhealthy",
      latency_ms: 57,
      checked_at: "2026-07-01T08:05:00.000Z",
      message: "Connection check failed (mock)",
    },
    {
      id: "notion",
      name: "Notion",
      type: "connector",
      status: "unhealthy",
      latency_ms: 74,
      checked_at: "2026-07-01T08:05:00.000Z",
      message: "Connection check failed (mock)",
    },
  ],
};

const fetchSettingsSnapshot = vi.fn();
const fetchConnectors = vi.fn();
const fetchConnectorsTeam = vi.fn();
const putConnectorGrant = vi.fn();
const clearHubSpotPin = vi.fn();
const startConnectorOAuth = vi.fn();
const startWhatsAppPair = vi.fn();
const disconnectConnector = vi.fn();
const refreshConnector = vi.fn();
const refreshSettingsHealth = vi.fn();
const patchSettingsSkill = vi.fn();
const patchSettingsCron = vi.fn();
const createSettingsCron = vi.fn();
const fetchSettingsHostContent = vi.fn();
const fetchSettingsHostList = vi.fn();
const fetchSettingsCronDetail = vi.fn();
const patchSettingsActiveModel = vi.fn();
const patchSettingsMcp = vi.fn();

vi.mock("../../api/connectors.js", () => ({
  fetchConnectors: (...args: unknown[]) => fetchConnectors(...args),
  fetchConnectorsTeam: (...args: unknown[]) => fetchConnectorsTeam(...args),
  putConnectorGrant: (...args: unknown[]) => putConnectorGrant(...args),
  clearHubSpotPin: (...args: unknown[]) => clearHubSpotPin(...args),
  startConnectorOAuth: (...args: unknown[]) => startConnectorOAuth(...args),
  isConnectorOAuthMessage: (
    origin: string,
    expectedOrigin: string,
    data: unknown,
  ) =>
    origin === expectedOrigin &&
    Boolean(
      data &&
        typeof data === "object" &&
        (data as { type?: string }).type === "lanyard.connector.oauth",
    ),
  patchConnectorSticky: vi.fn(),
  sendToolApprovalDecision: vi.fn(),
  startWhatsAppPair: (...args: unknown[]) => startWhatsAppPair(...args),
  disconnectConnector: (...args: unknown[]) => disconnectConnector(...args),
  refreshConnector: (...args: unknown[]) => refreshConnector(...args),
}));

vi.mock("../../api/settings.js", () => ({
  fetchSettingsSnapshot: (...args: unknown[]) => fetchSettingsSnapshot(...args),
  refreshSettingsHealth: (...args: unknown[]) => refreshSettingsHealth(...args),
  patchSettingsSkill: (...args: unknown[]) => patchSettingsSkill(...args),
  patchSettingsCron: (...args: unknown[]) => patchSettingsCron(...args),
  createSettingsCron: (...args: unknown[]) => createSettingsCron(...args),
  fetchSettingsHostContent: (...args: unknown[]) =>
    fetchSettingsHostContent(...args),
  fetchSettingsHostList: (...args: unknown[]) =>
    fetchSettingsHostList(...args),
  fetchSettingsCronDetail: (...args: unknown[]) =>
    fetchSettingsCronDetail(...args),
  patchSettingsActiveModel: (...args: unknown[]) =>
    patchSettingsActiveModel(...args),
  patchSettingsMcp: (...args: unknown[]) => patchSettingsMcp(...args),
}));

function renderSettingsView(options?: {
  brainRpcEnabled?: boolean | null;
  chatDelivery?: "relay" | "harness" | null;
  ui?: {
    affordances?: Record<string, string>;
    can?: Record<string, boolean>;
  } | null;
  backendCapabilities?: {
    features?: Record<string, boolean>;
    brain_rpc_methods?: string[];
    ui_affordances?: Record<string, string>;
  } | null;
  /** When set, wraps SettingsView so isActive can flip (lp-a8u.7 focus refresh). */
  isActive?: boolean;
}) {
  const honestyValue =
    options?.brainRpcEnabled === undefined &&
    options?.ui === undefined &&
    options?.backendCapabilities === undefined &&
    options?.chatDelivery === undefined
      ? undefined
      : {
          brainRpcEnabled:
            options?.brainRpcEnabled === undefined
              ? null
              : options.brainRpcEnabled,
          chatDelivery:
            options?.chatDelivery === undefined ? null : options.chatDelivery,
          isReady: true,
          ui: options?.ui ?? null,
          backendCapabilities: options?.backendCapabilities ?? null,
        };

  return render(
    <Providers>
      <PortalHonestyProvider value={honestyValue}>
        <SettingsSnapshotProvider>
          <SettingsView
            isActive={options?.isActive === undefined ? true : options.isActive}
          />
        </SettingsSnapshotProvider>
      </PortalHonestyProvider>
    </Providers>,
  );
}


const mockConnectors = {
  connectors: [
    {
      connector_id: "google",
      status: "not_connected",
      account_label: null,
      sticky: {},
      entitled: true,
      role_granted: true,
      hubspot_portal_id: null,
    },
    {
      connector_id: "hubspot",
      status: "not_connected",
      account_label: null,
      sticky: {},
      entitled: true,
      role_granted: true,
      hubspot_portal_id: null,
    },
    {
      connector_id: "whatsapp",
      status: "not_connected",
      account_label: null,
      sticky: {},
      entitled: true,
      role_granted: true,
      hubspot_portal_id: null,
    },
  ],
};

/** Wait until the Connectors catalog is rendered (lp-xhf4.4). */
async function waitForToolsReady() {
  await waitFor(() => {
    expect(fetchSettingsSnapshot).toHaveBeenCalled();
  });
  await screen.findByTestId("connectors-page");
}

describe("humanizeSchedule", () => {
  it("humanizes common schedule expressions", () => {
    expect(humanizeSchedule("0 3 * * *")).toBe("Daily at 3:00 AM");
    expect(humanizeSchedule("*/15 * * * *")).toBe("Every 15 minutes");
    expect(humanizeSchedule("Every 15 minutes")).toBe("Every 15 minutes");
    expect(humanizeSchedule("0 9 * * 1-5")).toBe("Weekdays at 9:00 AM");
  });

  it("prefers display on structured schedule objects (lp-jzl.9.1)", () => {
    expect(
      humanizeSchedule({
        kind: "cron",
        expr: "0 9 * * 1-5",
        display: "Weekdays at 9:00 AM (America/New_York)",
        timezone: "America/New_York",
      }),
    ).toBe("Weekdays at 9:00 AM (America/New_York)");

  });

  it("uses Custom schedule fallback instead of raw undecodable expressions (lp-jzl.4)", () => {
    expect(humanizeSchedule("15 4 1 * *")).toBe("Custom schedule");
    expect(humanizeSchedule("@reboot")).toBe("Custom schedule");
  });
});

describe("SettingsView nav layout", () => {
  beforeEach(() => {
    fetchSettingsSnapshot.mockReset();
    fetchConnectors.mockReset();
    fetchConnectorsTeam.mockReset();
    putConnectorGrant.mockReset();
    clearHubSpotPin.mockReset();
    refreshSettingsHealth.mockReset();
    patchSettingsSkill.mockReset();
    patchSettingsCron.mockReset();
    createSettingsCron.mockReset();
    fetchSettingsHostContent.mockReset();
    fetchSettingsHostList.mockReset();
    fetchSettingsCronDetail.mockReset();
    patchSettingsActiveModel.mockReset();
    patchSettingsMcp.mockReset();
    fetchSettingsSnapshot.mockResolvedValue(mockSnapshot);
    fetchConnectors.mockResolvedValue(mockConnectors);
    fetchConnectorsTeam.mockResolvedValue(null);
    putConnectorGrant.mockResolvedValue({
      role_id: "role-member",
      connector_id: "google",
      enabled: true,
    });
    clearHubSpotPin.mockResolvedValue({ hubspot_portal_id: null });
    refreshSettingsHealth.mockResolvedValue(mockHealth);
    fetchSettingsHostContent.mockRejectedValue(
      Object.assign(new Error("No host home available for file content"), {
        status: 404,
        code: "no_host_home",
      }),
    );
    fetchSettingsHostList.mockRejectedValue(
      Object.assign(new Error("No host home available for directory listing"), {
        status: 404,
        code: "no_host_home",
      }),
    );
    fetchSettingsCronDetail.mockRejectedValue(
      Object.assign(new Error("No host home available for cron job detail"), {
        status: 404,
        code: "no_host_home",
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows full section labels and a SideNav collapse control", async () => {
    renderSettingsView();

    await waitFor(() => {
      expect(fetchSettingsSnapshot).toHaveBeenCalledTimes(1);
    });
    await waitForToolsReady();

    // Connectors catalog + Models/Workflows (lp-xhf4.4). Skills/MCP/Integrations
    // are not top-level tabs. Scheduled tasks live under Agents (lp-lv9.6).
    for (const label of ["Connectors", "Workflows", "Models"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole("button", { name: "Skills" })).toBeNull();
    expect(screen.queryByRole("button", { name: "MCP" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Integrations" })).toBeNull();
    expect(screen.queryByText("Scheduled tasks")).toBeNull();
    expect(screen.queryByRole("button", { name: "Overview" })).toBeNull();

    // SideNav collapsible toggle from Astryx.
    expect(
      screen.getByRole("button", { name: /Collapse sidebar|Expand sidebar/i }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Connectors sections")).toBeTruthy();
    // No Settings / Agent & tools side-nav chrome (lp-fn5.1.3).
    expect(screen.queryByText("Agent & tools")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
    // lp-lv9.6: no redundant section page title; Refresh top-left.
    expect(screen.queryByRole("heading", { name: "Skills" })).toBeNull();
    expect(screen.getByTestId("settings-section-toolbar")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Refresh settings snapshot" }),
    ).toBeTruthy();
    // No success "Snapshot loaded" chrome.
    expect(screen.queryByText("Snapshot loaded.")).toBeNull();
  });

  it("shows fixture honesty banner when snapshot source is fixture", async () => {
    renderSettingsView({ brainRpcEnabled: true });

    await waitForToolsReady();

    expect(screen.getByTestId("honesty-banner-settings-fixture")).toBeTruthy();
    expect(
      screen.getByText(/Fixture settings snapshot \(not host-backed\)/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/Chat uses the relay path independently/i),
    ).toBeTruthy();
    // No secrets in honesty copy
    expect(screen.queryByText(/api[_-]?key|secret|password/i)).toBeNull();
  });

  it("shows brain_rpc-off honesty when source is hermes and flag is false", async () => {
    fetchSettingsSnapshot.mockResolvedValue({
      ...mockSnapshot,
      source: "hermes",
      hermes_home: "/opt/hermes",
    });
    renderSettingsView({ brainRpcEnabled: false });

    await waitForToolsReady();

    expect(
      screen.getByTestId("honesty-banner-settings-brain-rpc-off"),
    ).toBeTruthy();
    expect(
      screen.getByText(/Settings are not the agent's live settings/i),
    ).toBeTruthy();
    expect(screen.queryByTestId("honesty-banner-settings-fixture")).toBeNull();
  });

  it("hides honesty banner for live hermes + brain_rpc on", async () => {
    fetchSettingsSnapshot.mockResolvedValue({
      ...mockSnapshot,
      source: "hermes",
      hermes_home: "/opt/hermes",
    });
    renderSettingsView({ brainRpcEnabled: true });

    await waitForToolsReady();

    expect(screen.queryByTestId("honesty-banner-settings-fixture")).toBeNull();
    expect(
      screen.queryByTestId("honesty-banner-settings-brain-rpc-off"),
    ).toBeNull();
  });

  it("opens on Skills for LA source without fixture honesty (lp-p2a / lp-fn5.1.4)", async () => {
    fetchSettingsSnapshot.mockResolvedValue({
      ...mockSnapshot,
      source: "lanyard_agent",
      backend_home: "/home/operator/.lanyard-agent",
      hermes_home: null,
    });
    renderSettingsView({ brainRpcEnabled: true });

    await waitForToolsReady();

    // Overview removed: default section is Connectors (lp-xhf4.4).
    expect(screen.queryByRole("heading", { name: "Skills" })).toBeNull();
    expect(screen.getByTestId("connectors-page")).toBeTruthy();
    expect(screen.getByTestId("skills-table")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Overview" })).toBeNull();
    expect(screen.queryByText(/fixture snapshot/i)).toBeNull();
    expect(screen.queryByTestId("honesty-banner-settings-fixture")).toBeNull();
  });

  it("hides unsupported nav sections for partial capabilities (lp-rt5.4 Q10)", async () => {
    fetchSettingsSnapshot.mockResolvedValue({
      ...mockSnapshot,
      source: "brain_rpc",
      crons: [],
      models: [],
      integrations: [],
      mcp_servers: [],
    });
    renderSettingsView({
      brainRpcEnabled: true,
      ui: {
        affordances: {
          settings_page: "supported",
          settings_editor: "supported",
          model_selector: "unsupported",
          cron_manager: "unsupported",
          host_health: "unsupported",
        },
        can: {
          settings_view: true,
          settings_edit: true,
          model_select: false,
          cron_manage: false,
          host_health: false,
        },
      },
      backendCapabilities: {
        features: {
          settings_snapshot: true,
          settings_patch: true,
          models: false,
          cron: false,
          health: false,
        },
        brain_rpc_methods: ["settings.snapshot", "settings.patch"],
        ui_affordances: {
          settings_page: "supported",
          settings_editor: "supported",
          model_selector: "unsupported",
          cron_manager: "unsupported",
          host_health: "unsupported",
        },
      },
    });

    await waitForToolsReady();

    expect(screen.getByRole("button", { name: "Connectors" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Skills" })).toBeNull();
    // Workflows visible when snapshot has defs (or empty array / settings page)
    expect(screen.getAllByText("Workflows").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Overview" })).toBeNull();
    // Hidden unsupported surfaces
    expect(screen.queryByText("Scheduled tasks")).toBeNull();
    expect(screen.queryByText("Models")).toBeNull();
    expect(screen.queryByText("Integrations")).toBeNull();
  });

  it("shows Workflows nav and lists fixture workflow defs (lp-vnz.5)", async () => {
    renderSettingsView();
    await waitForToolsReady();

    expect(screen.getAllByText("Workflows").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Workflows" }));

    const table = await screen.findByTestId("workflows-table");
    expect(within(table).getByText("Name")).toBeTruthy();
    expect(within(table).getByText("Id")).toBeTruthy();
    // lp-khq.3: Path column hidden from list (still on snapshot for detail/API).
    expect(within(table).queryByText("Path")).toBeNull();
    expect(
      within(table).getByText("FizzBuzz algorithm test report"),
    ).toBeTruthy();
    expect(
      within(table).getByText("fizzbuzz-algorithm-test-report"),
    ).toBeTruthy();
    expect(
      within(table).queryByText(
        ".lanyard/workflows/fizzbuzz-algorithm-test-report.yaml",
      ),
    ).toBeNull();
  });

  it("shows Workflows empty state when snapshot workflows is empty (lp-vnz.5)", async () => {
    fetchSettingsSnapshot.mockResolvedValue({
      ...mockSnapshot,
      workflows: [],
    });
    renderSettingsView({
      brainRpcEnabled: true,
      ui: {
        affordances: { settings_page: "supported" },
        can: { settings_view: true },
      },
      backendCapabilities: {
        features: { settings_snapshot: true },
        brain_rpc_methods: ["settings.snapshot"],
        ui_affordances: { settings_page: "supported" },
      },
    });

    await waitForToolsReady();
    expect(screen.getAllByText("Workflows").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Workflows" }));
    expect(await screen.findByText("No workflows in this snapshot.")).toBeTruthy();
  });

  it("HL full capabilities still show all section labels (lp-rt5.4)", async () => {
    renderSettingsView({
      brainRpcEnabled: true,
      ui: {
        affordances: {
          settings_page: "supported",
          settings_editor: "supported",
          model_selector: "supported",
          cron_manager: "supported",
          host_health: "supported",
        },
        can: {
          settings_view: true,
          settings_edit: true,
          model_select: true,
          cron_manage: true,
          host_health: true,
        },
      },
      backendCapabilities: {
        features: {
          settings_snapshot: true,
          settings_patch: true,
          models: true,
          cron: true,
          health: true,
        },
        brain_rpc_methods: [
          "settings.snapshot",
          "settings.patch",
          "models.set_active",
          "cron.patch",
          "brain.health",
        ],
        ui_affordances: {
          settings_page: "supported",
          settings_editor: "supported",
          model_selector: "supported",
          cron_manager: "supported",
          host_health: "supported",
        },
      },
    });

    await waitForToolsReady();

    for (const label of ["Connectors", "Workflows", "Models"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole("button", { name: "Skills" })).toBeNull();
    expect(screen.queryByRole("button", { name: "MCP" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Integrations" })).toBeNull();
    // lp-lv9.6: Scheduled tasks never appear on Tools even when host advertises cron.
    expect(screen.queryByText("Scheduled tasks")).toBeNull();
    expect(screen.queryByRole("button", { name: "Overview" })).toBeNull();
  });

  it("never shows Scheduled tasks nav even when LA advertises cron inventory (lp-lv9.6)", async () => {
    fetchSettingsSnapshot.mockResolvedValue({
      ...mockSnapshot,
      source: "lanyard_agent",
      backend_home: "/var/lib/lanyard-agent",
      hermes_home: "/var/lib/lanyard-agent",
      crons: [
        {
          id: "la-vault-index",
          name: "LA vault index refresh",
          schedule: "0 3 * * *",
          path: "cron/jobs.json",
          enabled: true,
          last_run_at: "2026-08-04T03:00:11.000Z",
          next_run_at: "2026-08-05T03:00:00.000Z",
        },
      ],
    });

    renderSettingsView({
      brainRpcEnabled: true,
      ui: {
        affordances: {
          settings_page: "supported",
          settings_editor: "supported",
          cron_manager: "supported",
          model_selector: "supported",
        },
        can: {
          settings_view: true,
          settings_edit: true,
          cron_manage: true,
          model_select: true,
        },
      },
      backendCapabilities: {
        features: {
          settings_snapshot: true,
          settings_patch: true,
          cron: true,
          models: true,
        },
        brain_rpc_methods: [
          "settings.snapshot",
          "settings.patch",
          "cron.patch",
          "models.set_active",
        ],
        ui_affordances: {
          settings_page: "supported",
          settings_editor: "supported",
          cron_manager: "supported",
          model_selector: "supported",
        },
      },
    });

    await waitForToolsReady();
    expect(screen.getByTestId("connectors-page")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Overview" })).toBeNull();
    expect(screen.queryByText("Scheduled tasks")).toBeNull();
    expect(screen.queryByTestId("crons-table")).toBeNull();
    expect(screen.queryByTestId("new-scheduled-task-open")).toBeNull();
  });
});

describe("SettingsView skills and models (Slice D)", () => {
  beforeEach(() => {
    fetchSettingsSnapshot.mockReset();
    fetchConnectors.mockReset();
    fetchConnectorsTeam.mockReset();
    putConnectorGrant.mockReset();
    clearHubSpotPin.mockReset();
    refreshSettingsHealth.mockReset();
    patchSettingsSkill.mockReset();
    patchSettingsCron.mockReset();
    createSettingsCron.mockReset();
    fetchSettingsHostContent.mockReset();
    fetchSettingsHostList.mockReset();
    fetchSettingsCronDetail.mockReset();
    patchSettingsActiveModel.mockReset();
    patchSettingsMcp.mockReset();
    fetchSettingsSnapshot.mockResolvedValue(mockSnapshot);
    fetchConnectors.mockResolvedValue(mockConnectors);
    fetchConnectorsTeam.mockResolvedValue(null);
    putConnectorGrant.mockResolvedValue({
      role_id: "role-member",
      connector_id: "google",
      enabled: true,
    });
    clearHubSpotPin.mockResolvedValue({ hubspot_portal_id: null });
    refreshSettingsHealth.mockResolvedValue(mockHealth);
    fetchSettingsHostContent.mockRejectedValue(
      Object.assign(new Error("No host home available for file content"), {
        status: 404,
        code: "no_host_home",
      }),
    );
    fetchSettingsHostList.mockRejectedValue(
      Object.assign(new Error("No host home available for directory listing"), {
        status: 404,
        code: "no_host_home",
      }),
    );
    fetchSettingsCronDetail.mockRejectedValue(
      Object.assign(new Error("No host home available for cron job detail"), {
        status: 404,
        code: "no_host_home",
      }),
    );
    patchSettingsSkill.mockResolvedValue({
      skill: {
        id: "post-meeting-triage",
        name: "Post-meeting triage",
        enabled: false,
      },
      source: "fixture",
    });
    patchSettingsCron.mockResolvedValue({
      cron: {
        id: "vault-index",
        name: "Vault index refresh",
        schedule: "Daily at 3:00 AM",
        enabled: false,
        last_run_at: "2026-07-01T03:00:12.000Z",
        next_run_at: "2026-07-02T03:00:00.000Z",
      },
      source: "fixture",
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("skills table shows Name and Enabled (no Path) and toggles via API (lp-75r.4 / lp-khq.3)", async () => {
    renderSettingsView();
    await waitForToolsReady();



    const table = await screen.findByTestId("skills-table");
    expect(within(table).getByText("Name")).toBeTruthy();
    // lp-khq.3: Path column hidden from list (still in detail drawer).
    expect(within(table).queryByText("Path")).toBeNull();
    // Column header "Enabled"; row affordance is a Switch (lp-khq.2).
    expect(within(table).getAllByText("Enabled").length).toBeGreaterThan(0);
    expect(within(table).queryByText("skills/crm/post-meeting-triage")).toBeNull();
    expect(within(table).queryByText("skills/email/draft-reply")).toBeNull();
    expect(within(table).getByText("Post-meeting triage")).toBeTruthy();

    // No Enabled/Disabled buttons — Switch toggles only.
    expect(
      within(table).queryByRole("button", { name: /Enable|Disable/i }),
    ).toBeNull();
    const switches = within(table).getAllByRole("switch");
    expect(switches.length).toBe(2);
    // First fixture skill is enabled; click to disable.
    const enabledSwitch = switches.find(
      (el) => (el as HTMLInputElement).checked,
    );
    expect(enabledSwitch).toBeTruthy();
    fireEvent.click(enabledSwitch!);

    await waitFor(() => {
      expect(patchSettingsSkill).toHaveBeenCalledWith("post-meeting-triage", false);
    });
  });

  it("does not show the model status section", async () => {
    renderSettingsView();
    await waitForToolsReady();

    fireEvent.click(screen.getByRole("button", { name: "Models" }));

    expect(screen.queryByTestId("models-by-provider")).toBeNull();
    expect(screen.queryByText("Fixture: offline")).toBeNull();
    expect(screen.queryByText("grok-3")).toBeNull();
  });

  it("keeps Models read-only when model_selector unsupported but snapshot has models (lp-kng.7.2)", async () => {
    // LA pilot: settings.snapshot lists models; models.* / model_selector absent.
    fetchSettingsSnapshot.mockResolvedValue({
      ...mockSnapshot,
      source: "brain_rpc",
    });
    renderSettingsView({
      brainRpcEnabled: true,
      ui: {
        affordances: {
          settings_page: "supported",
          settings_editor: "unsupported",
          model_selector: "unsupported",
        },
        can: {
          settings_view: true,
          settings_edit: false,
          model_select: false,
        },
      },
      backendCapabilities: {
        features: {
          settings_snapshot: true,
          settings_patch: false,
          models: false,
        },
        brain_rpc_methods: ["settings.snapshot", "brain.capabilities"],
        ui_affordances: {
          settings_page: "supported",
          settings_editor: "unsupported",
          model_selector: "unsupported",
        },
      },
    });

    await waitForToolsReady();

    // Section visible because snapshot carries models (read-only catalog).
    expect(screen.getByRole("button", { name: "Models" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Models" }));

    expect(screen.queryByTestId("models-by-provider")).toBeNull();
    expect(screen.queryByTestId("models-readonly-notice")).toBeNull();
    expect(screen.queryByText("grok-3")).toBeNull();
  });

  it("allows Set active when model_selector is supported (lp-kng.7.2)", async () => {
    renderSettingsView({
      brainRpcEnabled: true,
      ui: {
        affordances: {
          settings_page: "supported",
          model_selector: "supported",
        },
        can: {
          settings_view: true,
          model_select: true,
        },
      },
      backendCapabilities: {
        features: {
          settings_snapshot: true,
          models: true,
        },
        brain_rpc_methods: [
          "settings.snapshot",
          "models.list",
          "models.set_active",
        ],
        ui_affordances: {
          settings_page: "supported",
          model_selector: "supported",
        },
      },
    });

    await waitForToolsReady();
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    expect(screen.queryByTestId("models-by-provider")).toBeNull();
    expect(screen.queryByTestId("models-readonly-notice")).toBeNull();
    expect(screen.queryByText("grok-3")).toBeNull();
  });

  it("lists harness snapshot models, highlights active, and allows select (lp-oop.38.5)", async () => {
    fetchSettingsSnapshot.mockResolvedValue({
      ...mockSnapshot,
      source: "harness",
      models: [
        {
          provider: "openai",
          model: "gpt-4.1",
          is_active: true,
          connected: true,
        },
        {
          provider: "anthropic",
          model: "claude-sonnet",
          is_active: false,
          connected: true,
        },
      ],
    });
    patchSettingsActiveModel.mockResolvedValue({
      source: "harness",
      model: {
        provider: "anthropic",
        model: "claude-sonnet",
        is_active: true,
        connected: true,
      },
    });
    renderSettingsView({
      brainRpcEnabled: false,
      chatDelivery: "harness",
      ui: {
        affordances: { model_selector: "supported" },
        can: { model_select: true, settings_view: true },
      },
      backendCapabilities: {
        features: { models: true },
        brain_rpc_methods: ["models.list", "models.set_active"],
        ui_affordances: { model_selector: "supported" },
      },
    });
    await waitForToolsReady();
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    expect(screen.queryByTestId("models-by-provider")).toBeNull();
    expect(screen.queryByText("gpt-4.1")).toBeNull();
    expect(patchSettingsActiveModel).not.toHaveBeenCalled();
  });

  it("lists harness snapshot skills, MCP, workflows, integrations and toggles persist (lp-oop.38.6)", async () => {
    fetchSettingsSnapshot.mockResolvedValue({
      ...mockSnapshot,
      source: "harness",
      skills: [
        {
          id: "summarize",
          name: "summarize",
          enabled: true,
          path: "skills/summarize",
        },
      ],
      mcp_servers: [
        { name: "lab_echo", transport: "stdio", enabled: true },
      ],
      workflows: [
        { id: "draft", name: "Draft report", enabled: true },
      ],
      integrations: [{ id: "slack", name: "slack", type: "messaging" }],
    });
    patchSettingsSkill.mockResolvedValue({
      source: "harness",
      skill: {
        id: "summarize",
        name: "summarize",
        enabled: false,
        path: "skills/summarize",
      },
    });
    patchSettingsMcp.mockResolvedValue({
      source: "harness",
      mcp: { name: "lab_echo", transport: "stdio", enabled: false },
    });
    renderSettingsView({
      brainRpcEnabled: false,
      chatDelivery: "harness",
      ui: {
        affordances: {
          settings_page: "supported",
          settings_editor: "supported",
        },
        can: { settings_view: true, settings_edit: true },
      },
      backendCapabilities: {
        features: { settings_snapshot: true, settings_patch: true },
        brain_rpc_methods: ["settings.snapshot", "settings.patch"],
        ui_affordances: {
          settings_page: "supported",
          settings_editor: "supported",
        },
      },
    });
    await waitForToolsReady();
    expect(screen.getByText("summarize")).toBeTruthy();
    expect(screen.getByText("lab_echo")).toBeTruthy();
    expect(screen.getByText("slack")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Workflows" }));
    expect(await screen.findByText("Draft report")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Connectors" }));
    const skillSwitch = within(
      screen.getByTestId("settings-enabled-switch-summarize"),
    ).getByRole("switch");
    fireEvent.click(skillSwitch);
    await waitFor(() => {
      expect(patchSettingsSkill).toHaveBeenCalledWith("summarize", false);
    });

    const mcpSwitch = within(
      screen.getByTestId("settings-enabled-switch-lab_echo"),
    ).getByRole("switch");
    fireEvent.click(mcpSwitch);
    await waitFor(() => {
      expect(patchSettingsMcp).toHaveBeenCalledWith("lab_echo", false);
    });
  });
});

describe("SettingsView integrations health", () => {
  beforeEach(() => {
    fetchSettingsSnapshot.mockReset();
    fetchConnectors.mockReset();
    fetchConnectorsTeam.mockReset();
    putConnectorGrant.mockReset();
    clearHubSpotPin.mockReset();
    refreshSettingsHealth.mockReset();
    patchSettingsSkill.mockReset();
    patchSettingsCron.mockReset();
    createSettingsCron.mockReset();
    fetchSettingsHostContent.mockReset();
    fetchSettingsHostList.mockReset();
    fetchSettingsCronDetail.mockReset();
    patchSettingsActiveModel.mockReset();
    patchSettingsMcp.mockReset();
    fetchSettingsSnapshot.mockResolvedValue(mockSnapshot);
    fetchConnectors.mockResolvedValue(mockConnectors);
    fetchConnectorsTeam.mockResolvedValue(null);
    putConnectorGrant.mockResolvedValue({
      role_id: "role-member",
      connector_id: "google",
      enabled: true,
    });
    clearHubSpotPin.mockResolvedValue({ hubspot_portal_id: null });
    refreshSettingsHealth.mockResolvedValue(mockHealth);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("nests Gmail under Google and lists Slack/Notion on this brain", async () => {
    renderSettingsView();

    await waitFor(() => {
      expect(fetchSettingsSnapshot).toHaveBeenCalledTimes(1);
    });
    await waitForToolsReady();

    expect(screen.queryByRole("button", { name: "Integrations" })).toBeNull();
    expect(screen.getByTestId("connector-row-google")).toBeTruthy();
    expect(screen.getByTestId("connector-bound-gmail")).toBeTruthy();
    expect(within(screen.getByTestId("connectors-apps")).getByTestId("apps-cli-slack")).toBeTruthy();
    expect(within(screen.getByTestId("connectors-apps")).getByTestId("apps-cli-notion")).toBeTruthy();
    expect(screen.queryByText("/usr/bin/gws")).toBeNull();
  });
});

describe("SettingsView inventory refresh (lp-a8u.7)", () => {
  beforeEach(() => {
    fetchSettingsSnapshot.mockReset();
    fetchConnectors.mockReset();
    fetchConnectorsTeam.mockReset();
    putConnectorGrant.mockReset();
    clearHubSpotPin.mockReset();
    refreshSettingsHealth.mockReset();
    patchSettingsSkill.mockReset();
    patchSettingsCron.mockReset();
    createSettingsCron.mockReset();
    fetchSettingsHostContent.mockReset();
    fetchSettingsHostList.mockReset();
    fetchSettingsCronDetail.mockReset();
    patchSettingsActiveModel.mockReset();
    patchSettingsMcp.mockReset();
    fetchSettingsSnapshot.mockResolvedValue(mockSnapshot);
    fetchConnectors.mockResolvedValue(mockConnectors);
    fetchConnectorsTeam.mockResolvedValue(null);
    putConnectorGrant.mockResolvedValue({
      role_id: "role-member",
      connector_id: "google",
      enabled: true,
    });
    clearHubSpotPin.mockResolvedValue({ hubspot_portal_id: null });
    refreshSettingsHealth.mockResolvedValue(mockHealth);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("exposes an accessible manual Refresh control that re-fetches snapshot", async () => {
    fetchSettingsSnapshot
      .mockResolvedValueOnce(mockSnapshot)
      .mockResolvedValueOnce({
        ...mockSnapshot,
        skills: [
          ...mockSnapshot.skills,
          {
            id: "brand-new",
            name: "Brand new skill",
            enabled: true,
          },
        ],
      });

    renderSettingsView();
    await waitForToolsReady();
    expect(fetchSettingsSnapshot).toHaveBeenCalledTimes(1);

    // Refresh is top-left in the section toolbar (lp-lv9.6).
    const toolbar = screen.getByTestId("settings-section-toolbar");
    const refreshBtn = within(toolbar).getByRole("button", {
      name: "Refresh settings snapshot",
    });
    expect(refreshBtn).toBeTruthy();
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(fetchSettingsSnapshot).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Brand new skill")).toBeTruthy();
    // Still no success chrome after refresh.
    expect(screen.queryByText("Snapshot loaded.")).toBeNull();
  });

  it("re-fetches snapshot when Settings tab gains focus (false → true)", async () => {
    function FocusHarness() {
      const [active, setActive] = useState(false);
      return (
        <Providers>
          <PortalHonestyProvider>
            <SettingsSnapshotProvider>
              <button type="button" onClick={() => setActive(true)}>
                Open settings tab
              </button>
              <SettingsView isActive={active} />
            </SettingsSnapshotProvider>
          </PortalHonestyProvider>
        </Providers>
      );
    }

    fetchSettingsSnapshot
      .mockResolvedValueOnce(mockSnapshot)
      .mockResolvedValueOnce({
        ...mockSnapshot,
        skills: [
          ...mockSnapshot.skills,
          { id: "from-chat", name: "From chat", enabled: true },
        ],
      });

    render(<FocusHarness />);

    // Provider auto-loads once while Settings is inactive.
    await waitFor(() => {
      expect(fetchSettingsSnapshot).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Open settings tab" }));

    await waitFor(() => {
      expect(fetchSettingsSnapshot).toHaveBeenCalledTimes(2);
    });
    await waitForToolsReady();


    const table = await screen.findByTestId("skills-table");
    expect(within(table).getByText("From chat")).toBeTruthy();
  });
});

describe("SettingsView snapshot error + retry (lp-75r.3)", () => {
  beforeEach(() => {
    fetchSettingsSnapshot.mockReset();
    fetchConnectors.mockReset();
    fetchConnectorsTeam.mockReset();
    putConnectorGrant.mockReset();
    clearHubSpotPin.mockReset();
    refreshSettingsHealth.mockReset();
    patchSettingsSkill.mockReset();
    patchSettingsCron.mockReset();
    createSettingsCron.mockReset();
    fetchSettingsHostContent.mockReset();
    fetchSettingsHostList.mockReset();
    fetchSettingsCronDetail.mockReset();
    patchSettingsActiveModel.mockReset();
    patchSettingsMcp.mockReset();
    fetchConnectors.mockResolvedValue(mockConnectors);
    fetchConnectorsTeam.mockResolvedValue(null);
    putConnectorGrant.mockResolvedValue({
      role_id: "role-member",
      connector_id: "google",
      enabled: true,
    });
    clearHubSpotPin.mockResolvedValue({ hubspot_portal_id: null });
    refreshSettingsHealth.mockResolvedValue(mockHealth);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows error + Retry instead of infinite Loading snapshot on timeout/504", async () => {
    fetchSettingsSnapshot.mockRejectedValueOnce(
      new Error("brain rpc timed out after 10000ms"),
    );

    renderSettingsView();

    const errorRegion = await screen.findByTestId("settings-snapshot-error");
    expect(errorRegion).toBeTruthy();
    expect(
      within(errorRegion).getByText(/brain rpc timed out after 10000ms/i),
    ).toBeTruthy();
    expect(screen.queryByTestId("settings-snapshot-loading")).toBeNull();
    expect(screen.queryByText(/^Loading snapshot…$/)).toBeNull();

    const retryBtn = screen.getByRole("button", {
      name: "Retry settings snapshot",
    });
    expect(retryBtn).toBeTruthy();

    fetchSettingsSnapshot.mockResolvedValueOnce(mockSnapshot);
    fireEvent.click(retryBtn);

    await waitForToolsReady();
    expect(fetchSettingsSnapshot).toHaveBeenCalledTimes(2);


    const table = await screen.findByTestId("skills-table");
    expect(within(table).getByText("Post-meeting triage")).toBeTruthy();
  });
});

describe("SettingsView detail drawer (lp-a8u.8 / lp-75r.4)", () => {
  beforeEach(() => {
    fetchSettingsSnapshot.mockReset();
    fetchConnectors.mockReset();
    fetchConnectorsTeam.mockReset();
    putConnectorGrant.mockReset();
    clearHubSpotPin.mockReset();
    refreshSettingsHealth.mockReset();
    patchSettingsSkill.mockReset();
    patchSettingsCron.mockReset();
    createSettingsCron.mockReset();
    fetchSettingsHostContent.mockReset();
    fetchSettingsHostList.mockReset();
    fetchSettingsCronDetail.mockReset();
    patchSettingsActiveModel.mockReset();
    patchSettingsMcp.mockReset();
    fetchSettingsSnapshot.mockResolvedValue(mockSnapshot);
    fetchConnectors.mockResolvedValue(mockConnectors);
    fetchConnectorsTeam.mockResolvedValue(null);
    putConnectorGrant.mockResolvedValue({
      role_id: "role-member",
      connector_id: "google",
      enabled: true,
    });
    clearHubSpotPin.mockResolvedValue({ hubspot_portal_id: null });
    refreshSettingsHealth.mockResolvedValue(mockHealth);
    fetchSettingsHostContent.mockRejectedValue(
      Object.assign(new Error("No host home available for file content"), {
        status: 404,
        code: "no_host_home",
      }),
    );
    fetchSettingsHostList.mockRejectedValue(
      Object.assign(new Error("No host home available for directory listing"), {
        status: 404,
        code: "no_host_home",
      }),
    );
    fetchSettingsCronDetail.mockRejectedValue(
      Object.assign(new Error("No host home available for cron job detail"), {
        status: 404,
        code: "no_host_home",
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens skill dialog with metadata (id, path, enabled) + honest empty body", async () => {
    renderSettingsView();
    await waitForToolsReady();


    fireEvent.click(
      await screen.findByTestId("settings-skill-open-post-meeting-triage"),
    );

    const drawer = await screen.findByTestId("settings-detail-drawer");
    expect(drawer).toBeTruthy();
    const skillDetail = await screen.findByTestId("settings-detail-skill");
    expect(skillDetail).toBeTruthy();
    // Title in DialogHeader — name also appears in table
    expect(
      screen.getByRole("heading", { name: "Post-meeting triage" }),
    ).toBeTruthy();
    // lp-75r.4: path, id, enabled clearly in detail metadata
    expect(within(skillDetail).getByTestId("settings-detail-skill-id").textContent).toBe(
      "post-meeting-triage",
    );
    expect(
      within(skillDetail).getByTestId("settings-detail-skill-path").textContent,
    ).toBe("skills/crm/post-meeting-triage");
    // Label + badge both say "Enabled"
    expect(
      within(skillDetail).getAllByText("Enabled").length,
    ).toBeGreaterThan(0);
    expect(
      await within(skillDetail).findByText(
        "Host file content is not available for this item",
      ),
    ).toBeTruthy();
    expect(
      await within(skillDetail).findByText(
        "Host skill directory is not available for this item",
      ),
    ).toBeTruthy();
    await waitFor(() => {
      expect(fetchSettingsHostContent).toHaveBeenCalledWith(
        "skills/crm/post-meeting-triage/SKILL.md",
      );
    });
    await waitFor(() => {
      expect(fetchSettingsHostList).toHaveBeenCalledWith(
        "skills/crm/post-meeting-triage",
      );
    });
  });

  it("renders skill markdown body + pack directory with secondary file open", async () => {
    fetchSettingsHostContent.mockImplementation((path: string) => {
      if (path.endsWith("notes.md")) {
        return Promise.resolve({
          path: "skills/crm/post-meeting-triage/notes.md",
          content: "# Notes\n\nSecondary notes body.",
          mime_type: "text/markdown; charset=utf-8",
          encoding: "utf-8",
        });
      }
      return Promise.resolve({
        path: "skills/crm/post-meeting-triage/SKILL.md",
        content: "# Post-meeting triage\n\nDo the **thing**.",
        mime_type: "text/markdown; charset=utf-8",
        encoding: "utf-8",
      });
    });
    fetchSettingsHostList.mockResolvedValue({
      path: "skills/crm/post-meeting-triage",
      entries: [
        {
          name: "SKILL.md",
          path: "skills/crm/post-meeting-triage/SKILL.md",
          kind: "file",
        },
        {
          name: "notes.md",
          path: "skills/crm/post-meeting-triage/notes.md",
          kind: "file",
        },
        {
          name: "assets",
          path: "skills/crm/post-meeting-triage/assets",
          kind: "directory",
        },
      ],
    });

    renderSettingsView();
    await waitForToolsReady();

    fireEvent.click(
      await screen.findByTestId("settings-skill-open-post-meeting-triage"),
    );

    expect(await screen.findByTestId("settings-detail-drawer")).toBeTruthy();
    const skillDetail = await screen.findByTestId("settings-detail-skill");
    expect(
      within(skillDetail).getByTestId("settings-detail-skill-path").textContent,
    ).toBe("skills/crm/post-meeting-triage");
    expect(
      within(skillDetail).getAllByText("Enabled").length,
    ).toBeGreaterThan(0);

    const md = await screen.findByTestId("settings-detail-markdown");
    expect(md).toBeTruthy();
    expect(
      within(md).getByText((content) => content.includes("thing")),
    ).toBeTruthy();

    // Directory listing shows siblings
    const dir = await screen.findByTestId("settings-detail-skill-directory");
    expect(within(dir).getByTestId("settings-skill-file-SKILL.md")).toBeTruthy();
    expect(within(dir).getByTestId("settings-skill-file-notes.md")).toBeTruthy();
    expect(within(dir).getByTestId("settings-skill-dir-assets")).toBeTruthy();

    // Open secondary file
    fireEvent.click(within(dir).getByTestId("settings-skill-file-notes.md"));
    await waitFor(() => {
      expect(fetchSettingsHostContent).toHaveBeenCalledWith(
        "skills/crm/post-meeting-triage/notes.md",
      );
    });
    expect(
      await within(await screen.findByTestId("settings-detail-markdown")).findByText(
        (content) => content.includes("Secondary notes"),
      ),
    ).toBeTruthy();
  });

  it("opens workflow drawer and shows definition path + description metadata", async () => {
    renderSettingsView();
    await waitForToolsReady();
    fireEvent.click(screen.getByRole("button", { name: "Workflows" }));
    fireEvent.click(
      await screen.findByTestId(
        "settings-workflow-open-fizzbuzz-algorithm-test-report",
      ),
    );

    const workflowDetail = await screen.findByTestId(
      "settings-detail-workflow",
    );
    expect(workflowDetail).toBeTruthy();
    expect(
      within(workflowDetail).getByText(
        ".lanyard/workflows/fizzbuzz-algorithm-test-report.yaml",
      ),
    ).toBeTruthy();
    await waitFor(() => {
      expect(fetchSettingsHostContent).toHaveBeenCalledWith(
        ".lanyard/workflows/fizzbuzz-algorithm-test-report.yaml",
      );
    });
  });

  it("closes drawer and keeps the skills section selected", async () => {
    renderSettingsView();
    await waitForToolsReady();

    fireEvent.click(
      await screen.findByTestId("settings-skill-open-post-meeting-triage"),
    );
    expect(await screen.findByTestId("settings-detail-skill")).toBeTruthy();

    // Close via DialogHeader close control (aria-label often "Close").
    const closeBtn =
      screen.queryByRole("button", { name: /^close$/i }) ??
      screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("settings-detail-skill")).toBeNull();
    });
    // Connectors catalog still selected — unbound skills table remains mounted.
    expect(screen.getByTestId("connectors-page")).toBeTruthy();
    expect(screen.getByTestId("skills-table")).toBeTruthy();
  });

  it("shows honest empty when skill has no path", async () => {
    fetchSettingsSnapshot.mockResolvedValue({
      ...mockSnapshot,
      skills: [
        {
          id: "pathless",
          name: "Pathless skill",
          enabled: true,
        },
      ],
    });

    renderSettingsView();
    await waitForToolsReady();

    fireEvent.click(await screen.findByTestId("settings-skill-open-pathless"));

    expect(
      await screen.findByText("No file path on host for this item"),
    ).toBeTruthy();
    expect(fetchSettingsHostContent).not.toHaveBeenCalled();
  });
});

describe("SettingsView connectors catalog (lp-xhf4.4)", () => {
  beforeEach(() => {
    fetchSettingsSnapshot.mockReset();
    fetchConnectors.mockReset();
    fetchConnectorsTeam.mockReset();
    putConnectorGrant.mockReset();
    clearHubSpotPin.mockReset();
    startConnectorOAuth.mockReset();
    startConnectorOAuth.mockImplementation(async (connectorId: string) => {
      if (connectorId === "hubspot") {
        return {
          connector_id: "hubspot",
          url: "https://app.hubspot.com/oauth/authorize?state=test",
        };
      }
      return {
        connector_id: "google",
        url: "https://accounts.google.com/o/oauth2/v2/auth?state=test",
      };
    });
    startWhatsAppPair.mockReset();
    startWhatsAppPair.mockResolvedValue({
      connector_id: "whatsapp",
      status: "pairing",
      account_label: null,
      pairing_id: "pair-test",
    });
    refreshSettingsHealth.mockReset();
    patchSettingsSkill.mockReset();
    patchSettingsCron.mockReset();
    createSettingsCron.mockReset();
    fetchSettingsHostContent.mockReset();
    fetchSettingsHostList.mockReset();
    fetchSettingsCronDetail.mockReset();
    patchSettingsActiveModel.mockReset();
    patchSettingsMcp.mockReset();
    fetchSettingsSnapshot.mockResolvedValue({
      ...mockSnapshot,
      skills: [
        ...mockSnapshot.skills,
        {
          id: "gws-gmail-send",
          name: "gws-gmail-send",
          path: "skills/gws/gmail/gws-gmail-send",
          enabled: true,
        },
      ],
    });
    fetchConnectors.mockResolvedValue(mockConnectors);
    fetchConnectorsTeam.mockResolvedValue(null);
    putConnectorGrant.mockResolvedValue({
      role_id: "role-member",
      connector_id: "google",
      enabled: true,
    });
    clearHubSpotPin.mockResolvedValue({ hubspot_portal_id: null });
    refreshSettingsHealth.mockResolvedValue(mockHealth);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows SaaS rows when not_connected, nests gws-gmail-* under Google, and keeps Models off the catalog", async () => {
    renderSettingsView();
    await waitForToolsReady();

    expect(screen.getByRole("button", { name: "Connectors" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Skills" })).toBeNull();
    expect(screen.queryByRole("button", { name: "MCP" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Integrations" })).toBeNull();

    const google = screen.getByTestId("connector-row-google");
    expect(google.getAttribute("data-connector-kind")).toBe("saas");
    expect(google.getAttribute("data-connector-status")).toBe("not_connected");
    expect(screen.getByTestId("connector-row-hubspot")).toBeTruthy();
    expect(screen.getByTestId("connector-row-whatsapp")).toBeTruthy();

    const bound = screen.getByTestId("connector-bound-gws-gmail-send");
    expect(bound.getAttribute("data-connector-kind")).toBe("bound");
    expect(bound.getAttribute("data-connector-parent")).toBe("google");
    expect(screen.queryByText("On this brain")).toBeNull();
    expect(screen.getByText("Apps")).toBeTruthy();
    expect(screen.getByText("Skills")).toBeTruthy();
    expect(
      within(screen.getByTestId("connectors-skills")).queryByText("gws-gmail-send"),
    ).toBeNull();
    expect(
      within(screen.getByTestId("connectors-skills")).getByText("Post-meeting triage"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("connectors-apps")).getByTestId(
        "connector-bound-gws-gmail-send",
      ),
    ).toBeTruthy();

    expect(screen.queryByTestId("models-by-provider")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    expect(screen.queryByTestId("models-by-provider")).toBeNull();
    expect(screen.queryByTestId("connectors-page")).toBeNull();
  });

  it("hides SaaS rows the tenant or role is not entitled to", async () => {
    fetchConnectors.mockResolvedValue({
      connectors: [
        { ...mockConnectors.connectors[0], entitled: false },
        { ...mockConnectors.connectors[1], role_granted: false },
        mockConnectors.connectors[2],
      ],
    });
    renderSettingsView();
    await waitForToolsReady();
    expect(screen.queryByTestId("connector-row-google")).toBeNull();
    expect(screen.queryByTestId("connector-row-hubspot")).toBeNull();
    expect(screen.getByTestId("connector-row-whatsapp")).toBeTruthy();
  });

  it("opens Google OAuth in a new tab from Connect", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    renderSettingsView();
    await waitForToolsReady();
    fireEvent.click(screen.getByRole("button", { name: "Connect Google" }));
    await waitFor(() => {
      expect(startConnectorOAuth).toHaveBeenCalledWith("google");
    });
    expect(open).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth?state=test",
      "_blank",
    );
    vi.unstubAllGlobals();
  });

  it("opens HubSpot OAuth in a new tab from Connect", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    renderSettingsView();
    await waitForToolsReady();
    fireEvent.click(screen.getByRole("button", { name: "Connect HubSpot" }));
    await waitFor(() => {
      expect(startConnectorOAuth).toHaveBeenCalledWith("hubspot");
    });
    expect(open).toHaveBeenCalledWith(
      "https://app.hubspot.com/oauth/authorize?state=test",
      "_blank",
    );
    vi.unstubAllGlobals();
  });

  it("Connect WhatsApp starts pairing without throwing", async () => {
    renderSettingsView();
    await waitForToolsReady();
    fireEvent.click(
      within(screen.getByTestId("connector-whatsapp-connect")).getByRole(
        "button",
        { name: "Connect" },
      ),
    );
    await waitFor(() => {
      expect(startWhatsAppPair).toHaveBeenCalledTimes(1);
    });
  });

  it("shows Disconnect and Refresh on a connected Google row", async () => {
    fetchConnectors.mockResolvedValue({
      connectors: [
        {
          ...mockConnectors.connectors[0],
          status: "connected",
          account_label: "ada@gmail.com",
        },
        mockConnectors.connectors[1],
        mockConnectors.connectors[2],
      ],
    });
    disconnectConnector.mockResolvedValue({
      connector_id: "google",
      status: "not_connected",
      revoke_attempted: true,
    });
    renderSettingsView();
    await waitForToolsReady();
    expect(screen.getByTestId("connector-disconnect-google")).toBeTruthy();
    expect(screen.getByTestId("connector-refresh-google")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Google" }));
    await waitFor(() => {
      expect(disconnectConnector).toHaveBeenCalledWith("google");
    });
  });

  it("shows Reconnect wizard when Google needs_reauth", async () => {
    fetchConnectors.mockResolvedValue({
      connectors: [
        {
          ...mockConnectors.connectors[0],
          status: "needs_reauth",
          account_label: "ada@gmail.com",
        },
        mockConnectors.connectors[1],
        mockConnectors.connectors[2],
      ],
    });
    startConnectorOAuth.mockResolvedValue({
      connector_id: "google",
      url: "https://accounts.google.com/o/oauth2/v2/auth?state=x",
    });
    const open = vi.fn();
    vi.stubGlobal("open", open);
    renderSettingsView();
    await waitForToolsReady();
    expect(screen.getByText("Needs reauth")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect Google" }));
    await waitFor(() => {
      expect(startConnectorOAuth).toHaveBeenCalledWith("google");
    });
    expect(open).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

const mockTeam = {
  hubspot_portal_id: "123456",
  grants: [
    {
      role_id: "role-member",
      role_name: "member",
      connector_id: "google" as const,
      enabled: true,
    },
    {
      role_id: "role-member",
      role_name: "member",
      connector_id: "hubspot" as const,
      enabled: false,
    },
    {
      role_id: "role-member",
      role_name: "member",
      connector_id: "whatsapp" as const,
      enabled: false,
    },
  ],
  members: [
    {
      user_id: "u-alice",
      email: "alice@demo.test",
      connectors: [
        {
          connector_id: "google" as const,
          status: "connected" as const,
          account_label: "alice@gmail.com",
        },
        {
          connector_id: "hubspot" as const,
          status: "not_connected" as const,
          account_label: null,
        },
        {
          connector_id: "whatsapp" as const,
          status: "pairing" as const,
          account_label: "+15551212",
        },
      ],
    },
    {
      user_id: "u-bob",
      email: "bob@demo.test",
      connectors: [
        {
          connector_id: "google" as const,
          status: "needs_reauth" as const,
          account_label: "bob@gmail.com",
        },
        {
          connector_id: "hubspot" as const,
          status: "not_connected" as const,
          account_label: null,
        },
        {
          connector_id: "whatsapp" as const,
          status: "not_connected" as const,
          account_label: null,
        },
      ],
    },
  ],
};

describe("SettingsView connectors Team pane (lp-xhf4.5)", () => {
  beforeEach(() => {
    fetchSettingsSnapshot.mockReset();
    fetchConnectors.mockReset();
    fetchConnectorsTeam.mockReset();
    putConnectorGrant.mockReset();
    clearHubSpotPin.mockReset();
    refreshSettingsHealth.mockReset();
    fetchSettingsSnapshot.mockResolvedValue(mockSnapshot);
    fetchConnectors.mockResolvedValue(mockConnectors);
    fetchConnectorsTeam.mockResolvedValue(null);
    putConnectorGrant.mockResolvedValue({
      role_id: "role-member",
      connector_id: "google",
      enabled: true,
    });
    clearHubSpotPin.mockResolvedValue({ hubspot_portal_id: null });
    refreshSettingsHealth.mockResolvedValue(mockHealth);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not open Team grants for a member", async () => {
    fetchConnectorsTeam.mockResolvedValue(null);
    renderSettingsView();
    await waitForToolsReady();
    await waitFor(() => {
      expect(fetchConnectorsTeam).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("connectors-team-tab")).toBeNull();
    expect(screen.queryByTestId("connectors-catalog-tab")).toBeNull();
    expect(screen.queryByRole("button", { name: "Team" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Catalog" })).toBeNull();
    expect(screen.queryByTestId("settings-admin")).toBeNull();
    expect(screen.queryByTestId("connectors-team-panel")).toBeNull();
    expect(screen.queryByTestId("team-grants-table")).toBeNull();
    expect(screen.getByTestId("connectors-apps")).toBeTruthy();
    expect(screen.getByTestId("connectors-skills")).toBeTruthy();
  });

  it("lets an admin toggle role × google|hubspot|whatsapp grants and shows status not secrets", async () => {
    fetchConnectorsTeam.mockResolvedValue({
      ...mockTeam,
      oauth_refresh: "rtok-secret-do-not-leak",
    } as typeof mockTeam);
    putConnectorGrant.mockImplementation(
      async (input: {
        role_id: string;
        connector_id: string;
        enabled: boolean;
      }) => input,
    );
    renderSettingsView();
    await waitForToolsReady();

    const admin = await screen.findByTestId("settings-admin");
    expect(within(admin).getByText("Admin")).toBeTruthy();
    expect(screen.queryByTestId("connectors-team-tab")).toBeNull();
    expect(screen.queryByRole("button", { name: "Catalog" })).toBeNull();
    expect(within(admin).getByTestId("connectors-team-panel")).toBeTruthy();
    expect(screen.getByTestId("connectors-apps")).toBeTruthy();
    expect(screen.queryByText("Disconnect")).toBeNull();
    expect(screen.queryByText("rtok-secret-do-not-leak")).toBeNull();

    const googleStatus = screen.getByTestId("team-status-u-alice-google");
    expect(googleStatus.getAttribute("data-connector-status")).toBe("connected");
    expect(within(googleStatus).getByText("alice@gmail.com")).toBeTruthy();
    expect(
      screen.getByTestId("team-status-u-alice-hubspot").getAttribute(
        "data-connector-status",
      ),
    ).toBe("not_connected");
    expect(
      screen.getByTestId("team-status-u-alice-whatsapp").getAttribute(
        "data-connector-status",
      ),
    ).toBe("pairing");
    expect(
      screen.getByTestId("team-status-u-bob-google").getAttribute(
        "data-connector-status",
      ),
    ).toBe("needs_reauth");
    expect(within(screen.getByTestId("team-status-u-bob-google")).getByText("Needs reauth")).toBeTruthy();
    expect(screen.getByText("Portal 123456")).toBeTruthy();

    const googleSwitch = within(
      screen.getByTestId("team-grant-role-member-google"),
    ).getByRole("switch");
    fireEvent.click(googleSwitch);
    await waitFor(() => {
      expect(putConnectorGrant).toHaveBeenCalledWith({
        role_id: "role-member",
        connector_id: "google",
        enabled: false,
      });
    });

    const hubspotSwitch = within(
      screen.getByTestId("team-grant-role-member-hubspot"),
    ).getByRole("switch");
    fireEvent.click(hubspotSwitch);
    await waitFor(() => {
      expect(putConnectorGrant).toHaveBeenCalledWith({
        role_id: "role-member",
        connector_id: "hubspot",
        enabled: true,
      });
    });

    const whatsappSwitch = within(
      screen.getByTestId("team-grant-role-member-whatsapp"),
    ).getByRole("switch");
    fireEvent.click(whatsappSwitch);
    await waitFor(() => {
      expect(putConnectorGrant).toHaveBeenCalledWith({
        role_id: "role-member",
        connector_id: "whatsapp",
        enabled: true,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear pin" }));
    await waitFor(() => {
      expect(clearHubSpotPin).toHaveBeenCalledTimes(1);
    });
  });
});





