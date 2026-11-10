import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Button } from "@astryxdesign/core/Button";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutPanel } from "@astryxdesign/core/Layout";
import {
  SideNav,
  SideNavItem,
  SideNavSection,
} from "@astryxdesign/core/SideNav";
import { Switch } from "@astryxdesign/core/Switch";
import { Table } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { VStack } from "@astryxdesign/core/VStack";
import {
  ArrowPathIcon,
  CpuChipIcon,
  LinkIcon,
  QueueListIcon,
} from "@heroicons/react/24/outline";

import {
  buildSettingsUiSchema,
  disabledReasonMessage,
  modelEditIsSupported,
  type SettingsSectionId,
  visibleSections,
} from "@lanyard/web-settings-schema";

import {
  clearHubSpotPin,
  disconnectConnector,
  fetchConnectors,
  fetchConnectorsTeam,
  isConnectorOAuthMessage,
  patchConnectorSticky,
  putConnectorGrant,
  refreshConnector,
  startConnectorOAuth,
  startWhatsAppPair,
} from "../../api/connectors.js";
import { useOptionalChatThread } from "../projects/ChatThreadContext.js";
import {
  patchSettingsActiveModel,
  patchSettingsMcp,
  patchSettingsSkill,
  refreshSettingsHealth,
} from "../../api/settings.js";
import type {
  SettingsHealthCheckResponse,
  SettingsMcpServer,
  SettingsModel,
  SettingsSkill,
  SettingsSnapshot,
  SettingsWorkflow,
} from "../../api/types.js";
import {
  HonestyBanner,
  resolveHonestyNotice,
  useOptionalPortalHonesty,
} from "../honesty/index.js";
import { AdminModelCatalog } from "./AdminModelCatalog.js";
import { ConnectorsPage } from "./ConnectorsPage.js";
import {
  buildConnectorsPageModel,
  type ConnectorId,
  type SpaConnectorStatus,
} from "./connectorsCatalog.js";
import {
  grantToggleKey,
  type ConnectorsTeamResponse,
} from "./connectorsTeam.js";
import {
  SettingsDetailDrawer,
  type SettingsDetailTarget,
} from "./SettingsDetailDrawer.js";
import { useSettingsSnapshot } from "./SettingsSnapshotContext.js";

export { formatSettingsSourceLabel, humanizeSchedule } from "./settingsFormat.js";

type SettingsSection = SettingsSectionId;

const SIDE_NAV_RESIZE = {
  defaultWidth: 240,
  minWidth: 200,
  maxWidth: 360,
} as const;

/**
 * Connectors rail (lp-xhf4.4). Skills/MCP/Integrations live on the catalog
 * page, not as top-level tabs. Models stay a sibling rail. Scheduled tasks
 * live under Agents (lp-lv9.6).
 */
const SECTION_NAV: {
  id: SettingsSection;
  label: string;
  icon: typeof LinkIcon;
}[] = [
  { id: "connectors", label: "Connectors", icon: LinkIcon },
  { id: "workflows", label: "Workflows", icon: QueueListIcon },
  { id: "models", label: "Models", icon: CpuChipIcon },
];

type SkillRow = SettingsSkill & Record<string, unknown>;
type McpRow = SettingsMcpServer & Record<string, unknown> & { id: string };
type WorkflowRow = SettingsWorkflow & Record<string, unknown>;

function formatOptionalTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function EmptySectionMessage({ entity }: { entity: string }) {
  return (
    <Text type="body" color="secondary">
      No {entity} in this snapshot.
    </Text>
  );
}

/**
 * lp-khq.2: on/off slider for Skills/MCP (replaces Enabled/Disabled buttons).
 * Label is sr-only (isLabelHidden); no tooltip chrome.
 */
function EnabledToggleSwitch({
  enabled,
  entityLabel,
  isBusy,
  onToggle,
}: {
  enabled: boolean;
  entityLabel: string;
  isBusy: boolean;
  onToggle: () => void;
}) {
  return (
    <span
      data-testid={`settings-enabled-switch-${entityLabel}`}
      onClick={(event) => {
        // Keep row-open handlers from treating the control as a row click.
        event.stopPropagation();
      }}
    >
      <Switch
        // Accessible name only — visually the track is the affordance.
        label={enabled ? "Enabled" : "Disabled"}
        isLabelHidden
        value={enabled}
        isLoading={isBusy}
        onChange={() => {
          onToggle();
        }}
      />
    </span>
  );
}

type SectionContentProps = {
  section: SettingsSection;
  snapshot: SettingsSnapshot | null;
  health: SettingsHealthCheckResponse | null;
  status: string;
  /** True while GET /api/settings/snapshot is in flight. */
  isSnapshotLoading: boolean;
  /** Provider load error when snapshot is null (timeout / 504 / host error). */
  snapshotLoadError: string | null;
  /** Retry snapshot fetch (lp-75r.3 — never infinite-spin on 504). */
  onRetrySnapshot: () => void;
  connectorModel: ReturnType<typeof buildConnectorsPageModel>;
  connectorsLoadError: string | null;
  team: ConnectorsTeamResponse | null;
  togglingGrantKey: string | null;
  pinBusy: boolean;
  teamError: string | null;
  onToggleGrant: (input: {
    role_id: string;
    connector_id: ConnectorId;
    enabled: boolean;
  }) => void;
  onClearHubSpotPin: () => void;
  connectingId: SpaConnectorStatus["connector_id"] | null;
  onConnect: (connectorId: SpaConnectorStatus["connector_id"]) => void;
  connectorBusyId: SpaConnectorStatus["connector_id"] | null;
  onDisconnectConnector: (connectorId: SpaConnectorStatus["connector_id"]) => void;
  onRefreshConnector: (connectorId: SpaConnectorStatus["connector_id"]) => void;
  onReconnectConnector: (connectorId: SpaConnectorStatus["connector_id"]) => void;
  clearingStickyKey: string | null;
  onClearSticky: (connectorId: ConnectorId, actionClass: string) => void;
  pairingBusy?: boolean;
  onConnectWhatsApp?: () => void;
  onRefreshHealth: () => void;
  isRefreshingHealth: boolean;
  togglingSkillId: string | null;
  togglingMcpName: string | null;
  activatingModelKey: string | null;
  /** lp-kng.7.2: model set-active only when host advertises a real path. */
  canActivateModel: boolean;
  activateDisabledReason?: string;
  onToggleSkill: (skill: SettingsSkill) => void;
  onToggleMcp: (server: SettingsMcpServer) => void;
  onActivateModel: (model: SettingsModel) => void;
  onOpenDetail: (target: SettingsDetailTarget) => void;
};

function useRowOpenPlugin<T extends Record<string, unknown>>(
  onOpen: (row: T) => void,
  labelFor: (row: T) => string,
) {
  return useMemo(
    () => ({
      rowOpen: {
        transformBodyRow: (
          props: {
            htmlProps: HTMLAttributes<HTMLTableRowElement>;
            styles: unknown[];
            children?: ReactNode;
          },
          item: T,
        ) => ({
          ...props,
          htmlProps: {
            ...props.htmlProps,
            onClick: (event: MouseEvent<HTMLTableRowElement>) => {
              props.htmlProps.onClick?.(event);
              if (event.defaultPrevented) return;
              // Ignore clicks that originated on nested controls (toggles).
              const target = event.target;
              if (
                target instanceof Element &&
                target.closest(
                  "button, a, input, select, textarea, [role='button'], [role='switch']",
                )
              ) {
                return;
              }
              onOpen(item);
            },
            onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
              props.htmlProps.onKeyDown?.(event);
              if (event.defaultPrevented) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(item);
              }
            },
            tabIndex: 0,
            style: {
              ...(typeof props.htmlProps.style === "object" &&
              props.htmlProps.style !== null
                ? props.htmlProps.style
                : {}),
              cursor: "pointer",
            },
            "data-settings-row": labelFor(item),
            "aria-label": `View details for ${labelFor(item)}`,
          },
        }),
      },
    }),
    [labelFor, onOpen],
  );
}

function SkillsTable({
  rows,
  togglingSkillId,
  onToggleSkill,
  onOpenDetail,
}: {
  rows: SkillRow[];
  togglingSkillId: string | null;
  onToggleSkill: (skill: SettingsSkill) => void;
  onOpenDetail: (target: SettingsDetailTarget) => void;
}) {
  const columns = useMemo<TableColumn<SkillRow>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        renderCell: (row) => (
          <button
            type="button"
            data-testid={`settings-skill-open-${row.id}`}
            onClick={() => onOpenDetail({ kind: "skill", item: row })}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              margin: 0,
              font: "inherit",
              color: "inherit",
              cursor: "pointer",
              textAlign: "start",
              textDecoration: "underline",
              textUnderlineOffset: "2px",
            }}
          >
            {String(row.name)}
          </button>
        ),
      },
      // lp-khq.3: Path is detail-drawer / API only — hide host filesystem noise from list.
      {
        key: "enabled",
        header: "Enabled",
        renderCell: (row) => (
          <EnabledToggleSwitch
            enabled={Boolean(row.enabled)}
            entityLabel={String(row.name)}
            isBusy={togglingSkillId === row.id}
            onToggle={() => onToggleSkill(row)}
          />
        ),
      },
    ],
    [onOpenDetail, onToggleSkill, togglingSkillId],
  );

  const plugins = useRowOpenPlugin<SkillRow>(
    (row) => onOpenDetail({ kind: "skill", item: row }),
    (row) => String(row.name),
  );

  return (
    <div data-testid="skills-table">
      <Table
        data={rows}
        columns={columns}
        idKey="id"
        density="balanced"
        hasHover
        plugins={plugins}
        aria-label="Skills"
      />
    </div>
  );
}

function WorkflowsTable({
  rows,
  onOpenDetail,
}: {
  rows: WorkflowRow[];
  onOpenDetail: (target: SettingsDetailTarget) => void;
}) {
  const columns = useMemo<TableColumn<WorkflowRow>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        renderCell: (row) => (
          <button
            type="button"
            data-testid={`settings-workflow-open-${row.id}`}
            onClick={() => onOpenDetail({ kind: "workflow", item: row })}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              margin: 0,
              font: "inherit",
              color: "inherit",
              cursor: "pointer",
              textAlign: "start",
              textDecoration: "underline",
              textUnderlineOffset: "2px",
            }}
          >
            {String(row.name)}
          </button>
        ),
      },
      {
        key: "id",
        header: "Id",
        renderCell: (row) => String(row.id),
      },
      // lp-khq.3: Path stays on snapshot for detail/API; omit from list columns.
      {
        key: "updated_at",
        header: "Updated",
        renderCell: (row) =>
          formatOptionalTimestamp(
            typeof row.updated_at === "string" ? row.updated_at : null,
          ),
      },
    ],
    [onOpenDetail],
  );

  const plugins = useRowOpenPlugin<WorkflowRow>(
    (row) => onOpenDetail({ kind: "workflow", item: row }),
    (row) => String(row.name),
  );

  return (
    <div data-testid="workflows-table">
      <Table
        data={rows}
        columns={columns}
        idKey="id"
        density="balanced"
        hasHover
        plugins={plugins}
        aria-label="Workflows"
      />
    </div>
  );
}

function McpTable({
  rows,
  togglingMcpName,
  onToggleMcp,
}: {
  rows: McpRow[];
  togglingMcpName: string | null;
  onToggleMcp: (server: SettingsMcpServer) => void;
}) {
  const columns = useMemo<TableColumn<McpRow>[]>(
    () => [
      { key: "name", header: "Name" },
      { key: "transport", header: "Transport" },
      {
        key: "command",
        header: "Command",
        renderCell: (row) => row.command ?? "—",
      },
      {
        key: "enabled",
        header: "Enabled",
        renderCell: (row) => (
          <EnabledToggleSwitch
            enabled={row.enabled !== false}
            entityLabel={String(row.name)}
            isBusy={togglingMcpName === row.name}
            onToggle={() => onToggleMcp(row)}
          />
        ),
      },
    ],
    [onToggleMcp, togglingMcpName],
  );

  return (
    <div data-testid="mcp-table">
      <Table
        data={rows}
        columns={columns}
        idKey="id"
        density="balanced"
        aria-label="MCP servers"
      />
    </div>
  );
}


function SectionContent({
  section,
  snapshot,
  health,
  status,
  isSnapshotLoading,
  snapshotLoadError,
  onRetrySnapshot,
  connectorModel,
  connectorsLoadError,
  team,
  togglingGrantKey,
  pinBusy,
  teamError,
  onToggleGrant,
  onClearHubSpotPin,
  connectingId,
  onConnect,
  connectorBusyId,
  onDisconnectConnector,
  onRefreshConnector,
  onReconnectConnector,
  pairingBusy = false,
  onConnectWhatsApp,
  onRefreshHealth,
  isRefreshingHealth,
  togglingSkillId,
  togglingMcpName,
  activatingModelKey: _activatingModelKey,
  canActivateModel: _canActivateModel,
  activateDisabledReason: _activateDisabledReason,
  onToggleSkill,
  onToggleMcp,
  onActivateModel: _onActivateModel,
  onClearSticky,
  clearingStickyKey,
  onOpenDetail,
}: SectionContentProps) {
  const skillRows = useMemo(
    () => (snapshot?.skills ?? []) as SkillRow[],
    [snapshot?.skills],
  );
  const workflowRows = useMemo(
    () => (snapshot?.workflows ?? []) as WorkflowRow[],
    [snapshot?.workflows],
  );
  const mcpRows = useMemo(
    () =>
      (snapshot?.mcp_servers ?? []).map((server, index) => ({
        ...server,
        id: `${server.name}-${index}`,
      })) as McpRow[],
    [snapshot?.mcp_servers],
  );

  if (!snapshot) {
    // lp-75r.3: never leave Skills stuck on "Loading snapshot…" after a
    // 504 / Brain RPC timeout — show the error and an explicit Retry.
    const errorMessage =
      snapshotLoadError ||
      (status && status !== "Loading snapshot…" ? status : null);
    if (isSnapshotLoading && !errorMessage) {
      return (
        <Text
          type="body"
          color="secondary"
          data-testid="settings-snapshot-loading"
        >
          Loading snapshot…
        </Text>
      );
    }
    if (errorMessage) {
      return (
        <VStack gap={3} data-testid="settings-snapshot-error" align="start">
          <Text type="body" color="secondary">
            {errorMessage}
          </Text>
          <Button
            label="Retry"
            variant="secondary"
            size="sm"
            icon={<Icon icon={ArrowPathIcon} size="sm" />}
            isLoading={isSnapshotLoading}
            onClick={onRetrySnapshot}
            aria-label="Retry settings snapshot"
          />
        </VStack>
      );
    }
    return (
      <Text
        type="body"
        color="secondary"
        data-testid="settings-snapshot-loading"
      >
        {status || "Loading snapshot…"}
      </Text>
    );
  }

  switch (section) {
    case "connectors":
      return (
        <ConnectorsPage
          model={connectorModel}
          loadError={connectorsLoadError}
          connectingId={connectingId}
          busyId={connectorBusyId}
          togglingSkillId={togglingSkillId}
          togglingMcpName={togglingMcpName}
          onConnect={onConnect}
          onDisconnect={onDisconnectConnector}
          onRefresh={onRefreshConnector}
          onReconnect={onReconnectConnector}
          clearingStickyKey={clearingStickyKey}
          pairingBusy={pairingBusy}
          onToggleSkill={onToggleSkill}
          onToggleMcp={onToggleMcp}
          onClearSticky={onClearSticky}
          onOpenDetail={onOpenDetail}
          team={team}
          togglingGrantKey={togglingGrantKey}
          pinBusy={pinBusy}
          teamError={teamError}
          onToggleGrant={onToggleGrant}
          onClearHubSpotPin={onClearHubSpotPin}
          onConnectWhatsApp={onConnectWhatsApp}
        />
      );

    case "skills":
      return skillRows.length > 0 ? (
        <SkillsTable
          rows={skillRows}
          togglingSkillId={togglingSkillId}
          onToggleSkill={onToggleSkill}
          onOpenDetail={onOpenDetail}
        />
      ) : (
        <EmptySectionMessage entity="skills" />
      );

    case "workflows":
      return workflowRows.length > 0 ? (
        <WorkflowsTable rows={workflowRows} onOpenDetail={onOpenDetail} />
      ) : (
        <EmptySectionMessage entity="workflows" />
      );

    // Scheduled tasks moved to Agents (lp-lv9.6) — Tools has no crons section.
    case "crons":
      return null;

    case "mcp":
      return mcpRows.length > 0 ? (
        <McpTable
          rows={mcpRows}
          togglingMcpName={togglingMcpName}
          onToggleMcp={onToggleMcp}
        />
      ) : (
        <EmptySectionMessage entity="MCP servers" />
      );

    case "models":
      return <AdminModelCatalog isAdmin={team !== null} />;

    case "integrations":
      return (
        <IntegrationsSection
          integrations={snapshot.integrations ?? []}
          health={health}
          onRefreshHealth={onRefreshHealth}
          isRefreshingHealth={isRefreshingHealth}
        />
      );

    default:
      return null;
  }
}


export type SettingsViewProps = {
  /**
   * Whether Settings is the active Portal tab (lp-a8u.7).
   * Keep-alive mounts Settings while Chat/Vault are shown; when this flips
   * false → true, re-fetch the shared snapshot so inventory created via chat
   * appears without a full remount. Default true for standalone tests.
   */
  isActive?: boolean;
};

export function SettingsView({ isActive = true }: SettingsViewProps = {}) {
  const isNarrow = useMediaQuery("(max-width: 768px)");
  const [mobileView, setMobileView] = useState<"nav" | "detail">("nav");
  const [activeSection, setActiveSection] = useState<SettingsSection>("connectors");
  const {
    snapshot,
    setSnapshot,
    refreshSnapshot,
    isLoading: isSnapshotLoading,
    loadError: snapshotLoadError,
  } = useSettingsSnapshot();
  const {
    brainRpcEnabled,
    chatDelivery,
    vaultPlane,
    ui,
    backendCapabilities,
    isReady,
  } = useOptionalPortalHonesty();
  const chatThread = useOptionalChatThread();
  const honestyNotice = useMemo(
    () =>
      resolveHonestyNotice({
        surface: "settings",
        brainRpcEnabled,
        chatDelivery,
        vaultPlane,
        settingsSource: snapshot?.source ?? null,
      }),
    [brainRpcEnabled, chatDelivery, vaultPlane, snapshot?.source],
  );

  /**
   * lp-rt5.4: section visibility from web-settings-schema (capabilities +
   * snapshot). No capability context → optimistic full nav (fixture/offline).
   */
  const settingsUiSchema = useMemo(
    () =>
      buildSettingsUiSchema({
        snapshot: snapshot ?? undefined,
        ui: ui ?? undefined,
        capabilities: backendCapabilities ?? undefined,
        snapshotError: snapshotLoadError
          ? { error: snapshotLoadError, unavailable: true }
          : undefined,
      }),
    [snapshot, ui, backendCapabilities, snapshotLoadError],
  );

  /**
   * lp-kng.7.2: gate Settings → Models "Set active" on real host path.
   * Unknown capability context (fixtures / offline) stays optimistic interactive.
   * Honest LA baseline (model_selector unsupported, no models.*) is read-only.
   */
  const modelEditSupported = useMemo(() => {
    if (!isReady && !ui && !backendCapabilities) {
      return null;
    }
    return modelEditIsSupported(ui, backendCapabilities ?? undefined);
  }, [backendCapabilities, isReady, ui]);
  const canActivateModel =
    chatDelivery === "harness" || modelEditSupported !== false;
  const activateDisabledReason = useMemo(() => {
    if (canActivateModel) return undefined;
    const modelsSection = settingsUiSchema.sections.find(
      (s) => s.id === "models",
    );
    const fromControl = modelsSection?.controls.find(
      (c) => c.kind === "model_activate" && c.availability.disabledReason,
    )?.availability.disabledReason;
    return fromControl ?? disabledReasonMessage("model_selector_unsupported");
  }, [canActivateModel, settingsUiSchema]);
  const navSectionIds = useMemo(
    () => visibleSections(settingsUiSchema).map((s) => s.id),
    [settingsUiSchema],
  );
  const visibleNav = useMemo(
    () => SECTION_NAV.filter((item) => navSectionIds.includes(item.id)),
    [navSectionIds],
  );

  // If the active section was hidden by capabilities, land on the first visible.
  useEffect(() => {
    if (visibleNav.length === 0) return;
    if (!visibleNav.some((item) => item.id === activeSection)) {
      setActiveSection(visibleNav[0]!.id);
    }
  }, [visibleNav, activeSection]);
  const [status, setStatus] = useState("Loading snapshot…");
  const [health, setHealth] = useState<SettingsHealthCheckResponse | null>(null);
  const [isRefreshingHealth, setIsRefreshingHealth] = useState(false);
  const [togglingSkillId, setTogglingSkillId] = useState<string | null>(null);
  const [togglingMcpName, setTogglingMcpName] = useState<string | null>(null);
  const [activatingModelKey, setActivatingModelKey] = useState<string | null>(
    null,
  );
  const [detailTarget, setDetailTarget] = useState<SettingsDetailTarget | null>(
    null,
  );
  const [connectorStatuses, setConnectorStatuses] = useState<
    SpaConnectorStatus[]
  >([]);
  const [connectorsLoadError, setConnectorsLoadError] = useState<string | null>(
    null,
  );
  const [team, setTeam] = useState<ConnectorsTeamResponse | null>(null);
  const [togglingGrantKey, setTogglingGrantKey] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<
    SpaConnectorStatus["connector_id"] | null
  >(null);
  const [clearingStickyKey, setClearingStickyKey] = useState<string | null>(
    null,
  );
  const [pairingBusy, setPairingBusy] = useState(false);
  const [connectorBusyId, setConnectorBusyId] = useState<
    SpaConnectorStatus["connector_id"] | null
  >(null);

  const loadConnectors = useCallback(async () => {
    try {
      const body = await fetchConnectors();
      setConnectorStatuses(body.connectors);
      setConnectorsLoadError(null);
    } catch (error) {
      setConnectorStatuses([]);
      setConnectorsLoadError(
        error instanceof Error ? error.message : "Failed to load connectors",
      );
    }
    try {
      setTeam(await fetchConnectorsTeam());
    } catch {
      setTeam(null);
    }
  }, []);

  const handleConnect = useCallback(
    async (connectorId: SpaConnectorStatus["connector_id"]) => {
      if (connectorId !== "google" && connectorId !== "hubspot") {
        return;
      }
      setConnectingId(connectorId);
      try {
        const started = await startConnectorOAuth(connectorId);
        window.open(started.url, "_blank");
      } catch (error) {
        setConnectorsLoadError(
          error instanceof Error
            ? error.message
            : connectorId === "google"
              ? "Google connect failed"
              : "HubSpot connect failed",
        );
      } finally {
        setConnectingId(null);
      }
    },
    [],
  );

  const onDisconnectConnector = useCallback(
    async (connectorId: SpaConnectorStatus["connector_id"]) => {
      setConnectorBusyId(connectorId);
      try {
        await disconnectConnector(connectorId);
        await loadConnectors();
      } catch (error) {
        setConnectorsLoadError(
          error instanceof Error ? error.message : "Disconnect failed",
        );
      } finally {
        setConnectorBusyId(null);
      }
    },
    [loadConnectors],
  );

  const onRefreshConnector = useCallback(
    async (connectorId: SpaConnectorStatus["connector_id"]) => {
      setConnectorBusyId(connectorId);
      try {
        await refreshConnector(connectorId);
        await loadConnectors();
      } catch (error) {
        setConnectorsLoadError(
          error instanceof Error ? error.message : "Refresh failed",
        );
      } finally {
        setConnectorBusyId(null);
      }
    },
    [loadConnectors],
  );

  const onReconnectConnector = useCallback(
    async (connectorId: SpaConnectorStatus["connector_id"]) => {
      setConnectorBusyId(connectorId);
      try {
        const started = await startConnectorOAuth(connectorId);
        window.open(started.url, "_blank", "noopener,noreferrer");
      } catch (error) {
        setConnectorsLoadError(
          error instanceof Error ? error.message : "Reconnect failed",
        );
      } finally {
        setConnectorBusyId(null);
      }
    },
    [],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        !isConnectorOAuthMessage(event.origin, window.location.origin, event.data)
      ) {
        return;
      }
      void loadConnectors();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadConnectors]);

  const handleConnectWhatsApp = useCallback(async () => {
    setPairingBusy(true);
    try {
      const threadId = chatThread?.threadId?.trim();
      await startWhatsAppPair(threadId ? { threadId } : undefined);
      await loadConnectors();
    } catch (error) {
      setConnectorsLoadError(
        error instanceof Error ? error.message : "WhatsApp pairing failed",
      );
    } finally {
      setPairingBusy(false);
    }
  }, [chatThread?.threadId, loadConnectors]);

  const loadSnapshot = useCallback(async () => {
    setStatus("Loading snapshot…");
    try {
      await Promise.all([refreshSnapshot(), loadConnectors()]);
      // lp-lv9.6: no success "Snapshot loaded" chrome — errors only.
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load snapshot");
    }
  }, [loadConnectors, refreshSnapshot]);

  const connectorModel = useMemo(
    () =>
      buildConnectorsPageModel({
        connectors: connectorStatuses,
        skills: snapshot?.skills,
        mcp_servers: snapshot?.mcp_servers,
        integrations: snapshot?.integrations,
      }),
    [connectorStatuses, snapshot],
  );

  /**
   * Re-fetch when the Settings tab gains focus (false → true).
   * Initial mount with isActive=true does not re-fetch here — the provider
   * auto-loads once, and tests with default isActive avoid a double call.
   */
  const wasActiveRef = useRef(isActive);
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = isActive;
    if (isActive && !wasActive) {
      void loadSnapshot();
    }
  }, [isActive, loadSnapshot]);

  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  const refreshHealth = useCallback(async () => {
    setIsRefreshingHealth(true);
    setStatus("Pinging integrations…");
    try {
      const body = await refreshSettingsHealth();
      setHealth(body);
      setStatus("Health check complete.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Health check failed");
    } finally {
      setIsRefreshingHealth(false);
    }
  }, []);

  const handleClearSticky = useCallback(
    async (connectorId: ConnectorId, actionClass: string) => {
      const key = `${connectorId}:${actionClass}`;
      setClearingStickyKey(key);
      try {
        const updated = await patchConnectorSticky({
          connectorId,
          actionClass,
          enabled: false,
        });
        setConnectorStatuses((current) =>
          current.map((row) =>
            row.connector_id === connectorId ? updated : row,
          ),
        );
      } catch (error) {
        setConnectorsLoadError(
          error instanceof Error ? error.message : "Failed to clear sticky",
        );
      } finally {
        setClearingStickyKey(null);
      }
    },
    [],
  );

  const handleToggleSkill = useCallback(async (skill: SettingsSkill) => {
    const nextEnabled = !skill.enabled;
    setTogglingSkillId(skill.id);
    setSnapshot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        skills: prev.skills.map((s) =>
          s.id === skill.id ? { ...s, enabled: nextEnabled } : s,
        ),
      };
    });
    try {
      const result = await patchSettingsSkill(skill.id, nextEnabled);
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          skills: prev.skills.map((s) =>
            s.id === skill.id ? { ...s, ...result.skill } : s,
          ),
        };
      });
      setStatus(
        `${result.skill.name} ${result.skill.enabled ? "enabled" : "disabled"}.`,
      );
    } catch (error) {
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          skills: prev.skills.map((s) =>
            s.id === skill.id ? { ...s, enabled: skill.enabled } : s,
          ),
        };
      });
      setStatus(error instanceof Error ? error.message : "Failed to update skill");
    } finally {
      setTogglingSkillId(null);
    }
  }, []);

  const handleToggleGrant = useCallback(
    async (input: {
      role_id: string;
      connector_id: ConnectorId;
      enabled: boolean;
    }) => {
      const key = grantToggleKey(input.role_id, input.connector_id);
      setTogglingGrantKey(key);
      setTeamError(null);
      const previous = team;
      setTeam((current) => {
        if (!current) return current;
        return {
          ...current,
          grants: current.grants.map((grant) =>
            grant.role_id === input.role_id &&
            grant.connector_id === input.connector_id
              ? { ...grant, enabled: input.enabled }
              : grant,
          ),
        };
      });
      try {
        const result = await putConnectorGrant(input);
        setTeam((current) => {
          if (!current) return current;
          return {
            ...current,
            grants: current.grants.map((grant) =>
              grant.role_id === result.role_id &&
              grant.connector_id === result.connector_id
                ? { ...grant, enabled: result.enabled }
                : grant,
            ),
          };
        });
      } catch (error) {
        setTeam(previous);
        setTeamError(
          error instanceof Error ? error.message : "Failed to update grant",
        );
      } finally {
        setTogglingGrantKey(null);
      }
    },
    [team],
  );

  const handleClearHubSpotPin = useCallback(async () => {
    setPinBusy(true);
    setTeamError(null);
    const previous = team?.hubspot_portal_id ?? null;
    setTeam((current) =>
      current ? { ...current, hubspot_portal_id: null } : current,
    );
    try {
      await clearHubSpotPin();
    } catch (error) {
      setTeam((current) =>
        current ? { ...current, hubspot_portal_id: previous } : current,
      );
      setTeamError(
        error instanceof Error ? error.message : "Failed to clear HubSpot pin",
      );
    } finally {
      setPinBusy(false);
    }
  }, [team]);

  const handleToggleMcp = useCallback(async (server: SettingsMcpServer) => {
    const nextEnabled = server.enabled === false;
    setTogglingMcpName(server.name);
    setSnapshot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        mcp_servers: prev.mcp_servers.map((s) =>
          s.name === server.name ? { ...s, enabled: nextEnabled } : s,
        ),
      };
    });
    try {
      const result = await patchSettingsMcp(server.name, nextEnabled);
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          mcp_servers: prev.mcp_servers.map((s) =>
            s.name === server.name ? { ...s, ...result.mcp } : s,
          ),
        };
      });
      setStatus(
        `${result.mcp.name} ${result.mcp.enabled !== false ? "enabled" : "disabled"}.`,
      );
    } catch (error) {
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          mcp_servers: prev.mcp_servers.map((s) =>
            s.name === server.name ? { ...s, enabled: server.enabled } : s,
          ),
        };
      });
      setStatus(error instanceof Error ? error.message : "Failed to update MCP");
    } finally {
      setTogglingMcpName(null);
    }
  }, []);

  const handleActivateModel = useCallback(
    async (model: SettingsModel) => {
      // Defense in depth: never PATCH when host has no model activate path.
      if (!canActivateModel) {
        setStatus(
          activateDisabledReason ??
            disabledReasonMessage("model_selector_unsupported"),
        );
        return;
      }
      const key = `${model.provider}::${model.model}`;
      setActivatingModelKey(key);
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          models: prev.models.map((m) => ({
            ...m,
            is_active:
              m.provider === model.provider && m.model === model.model,
          })),
        };
      });
      try {
        const result = await patchSettingsActiveModel(
          model.provider,
          model.model,
        );
        setSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            models: prev.models.map((m) => ({
              ...m,
              is_active:
                m.provider === result.model.provider &&
                m.model === result.model.model,
            })),
          };
        });
        setStatus(`Active model set to ${result.model.model}.`);
      } catch (error) {
        // Reload to restore previous active flags.
        void loadSnapshot();
        setStatus(
          error instanceof Error ? error.message : "Failed to set active model",
        );
      } finally {
        setActivatingModelKey(null);
      }
    },
    [activateDisabledReason, canActivateModel, loadSnapshot, setSnapshot],
  );

  // Reflect shared provider load into local status; success chrome is omitted (lp-lv9.6).
  const hasAnnouncedSnapshot = useRef(false);
  useEffect(() => {
    if (isSnapshotLoading && !snapshot) {
      setStatus("Loading snapshot…");
      return;
    }
    if (snapshotLoadError && !snapshot) {
      setStatus(snapshotLoadError);
      return;
    }
    if (snapshot && !hasAnnouncedSnapshot.current) {
      hasAnnouncedSnapshot.current = true;
      setStatus("");
    }
  }, [isSnapshotLoading, snapshotLoadError, snapshot]);

  const selectSection = (section: SettingsSection) => {
    setActiveSection(section);
    setMobileView("detail");
  };

  // Section rail: type selectors only (no "Settings" / "Agent & tools" chrome).
  const navItems = (
    <SideNavSection title="" isHeaderHidden>
      {visibleNav.map((item) => (
        <SideNavItem
          key={item.id}
          label={item.label}
          icon={item.icon}
          isSelected={!isNarrow && activeSection === item.id}
          onClick={() => selectSection(item.id)}
        />
      ))}
    </SideNavSection>
  );

  const mobileNavList = (
    <SideNav aria-label="Connectors sections">{navItems}</SideNav>
  );

  const desktopSideNav = (
    <SideNav
      collapsible
      resizable={SIDE_NAV_RESIZE}
      aria-label="Connectors sections"
    >
      {navItems}
    </SideNav>
  );

  const refreshControl = (
    <Button
      label="Refresh"
      variant="ghost"
      size="sm"
      icon={<Icon icon={ArrowPathIcon} size="sm" />}
      isLoading={isSnapshotLoading}
      onClick={() => void loadSnapshot()}
      aria-label="Refresh settings snapshot"
    />
  );

  const sectionPanel = (
    <VStack gap={6} style={{ minWidth: 0 }}>
      {/* lp-lv9.6: no section page title; Refresh occupies the old title slot (top-left). */}
      {!isNarrow ? (
        <HStack
          gap={3}
          align="center"
          justify="start"
          style={{ width: "100%", minWidth: 0 }}
          data-testid="settings-section-toolbar"
        >
          {refreshControl}
        </HStack>
      ) : null}
      {/* Status line: errors + patch feedback only (no success "Snapshot loaded" chrome). */}
      {status ? (
        <Text type="supporting" color="secondary" data-testid="settings-status">
          {status}
        </Text>
      ) : null}
      {activeSection === "models" ? null : <HonestyBanner notice={honestyNotice} />}
      <SectionContent
        section={activeSection}
        snapshot={snapshot}
        health={health}
        status={status}
        isSnapshotLoading={isSnapshotLoading}
        snapshotLoadError={snapshotLoadError}
        onRetrySnapshot={() => void loadSnapshot()}
        connectorModel={connectorModel}
        connectorsLoadError={connectorsLoadError}
        team={team}
        togglingGrantKey={togglingGrantKey}
        pinBusy={pinBusy}
        teamError={teamError}
        onToggleGrant={(input) => void handleToggleGrant(input)}
        onClearHubSpotPin={() => void handleClearHubSpotPin()}
        connectingId={connectingId}
        onConnect={(connectorId) => void handleConnect(connectorId)}
        connectorBusyId={connectorBusyId}
        onDisconnectConnector={(id) => void onDisconnectConnector(id)}
        onRefreshConnector={(id) => void onRefreshConnector(id)}
        onReconnectConnector={(id) => void onReconnectConnector(id)}
        pairingBusy={pairingBusy}
        onConnectWhatsApp={() => {
          void handleConnectWhatsApp();
        }}
        onRefreshHealth={() => void refreshHealth()}
        isRefreshingHealth={isRefreshingHealth}
        togglingSkillId={togglingSkillId}
        togglingMcpName={togglingMcpName}
        activatingModelKey={activatingModelKey}
        canActivateModel={canActivateModel}
        activateDisabledReason={activateDisabledReason}
        onToggleSkill={(skill) => void handleToggleSkill(skill)}
        onToggleMcp={(server) => void handleToggleMcp(server)}
        onActivateModel={(model) => void handleActivateModel(model)}
        onClearSticky={(connectorId, actionClass) =>
          void handleClearSticky(connectorId, actionClass)
        }
        clearingStickyKey={clearingStickyKey}
        onOpenDetail={setDetailTarget}
      />
      <SettingsDetailDrawer
        target={detailTarget}
        onClose={() => setDetailTarget(null)}
      />
    </VStack>
  );

  if (isNarrow && mobileView === "nav") {
    return (
      <Layout
        height="fill"
        content={<LayoutContent padding={4}>{mobileNavList}</LayoutContent>}
      />
    );
  }

  return (
    <Layout
      height="fill"
      start={
        isNarrow ? undefined : (
          <LayoutPanel hasDivider padding={0}>
            {desktopSideNav}
          </LayoutPanel>
        )
      }
      content={
        <LayoutContent padding={4} style={{ minWidth: 0 }}>
          <VStack gap={0} style={{ minWidth: 0 }}>
            {isNarrow ? (
              <Toolbar
                label="Back to Settings"
                gap={2}
                startContent={
                  <>
                    <Button
                      label="Back to Settings"
                      variant="ghost"
                      size="sm"
                      onClick={() => setMobileView("nav")}
                    />
                    {refreshControl}
                  </>
                }
              />
            ) : null}
            {sectionPanel}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
