import { useMemo, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Switch } from "@astryxdesign/core/Switch";
import { Table } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type { SettingsMcpServer, SettingsSkill } from "../../api/types.js";
import type { SettingsDetailTarget } from "./SettingsDetailDrawer.js";
import {
  connectionStatusLabel,
  type BoundHostTool,
  type ConnectorsPageModel,
  type ConnectorId,
  type OnThisBrainRow,
  type SaasConnectorRow,
} from "./connectorsCatalog.js";
import { ConnectorsTeamPanel } from "./ConnectorsTeamPanel.js";
import type { ConnectorsTeamResponse } from "./connectorsTeam.js";

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
        event.stopPropagation();
      }}
    >
      <Switch
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

type SkillRow = SettingsSkill & Record<string, unknown>;
type McpRow = SettingsMcpServer & Record<string, unknown> & { id: string };

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
            "data-connector-kind": "on_this_brain",
            "aria-label": `View details for ${labelFor(item)}`,
          },
        }),
      },
    }),
    [labelFor, onOpen],
  );
}

function skillFromTool(tool: BoundHostTool | OnThisBrainRow): SettingsSkill {
  return {
    id: tool.id,
    name: tool.name,
    path: tool.path,
    enabled: Boolean(tool.enabled),
  };
}

function BoundToolsList({
  connectorId,
  tools,
  togglingSkillId,
  togglingMcpName,
  onToggleSkill,
  onToggleMcp,
  onOpenDetail,
}: {
  connectorId: SaasConnectorRow["connector_id"];
  tools: BoundHostTool[];
  togglingSkillId: string | null;
  togglingMcpName: string | null;
  onToggleSkill: (skill: SettingsSkill) => void;
  onToggleMcp: (server: SettingsMcpServer) => void;
  onOpenDetail: (target: SettingsDetailTarget) => void;
}) {
  if (tools.length === 0) {
    return null;
  }
  return (
    <VStack gap={2} data-testid={`connector-bound-tools-${connectorId}`}>
      {tools.map((tool) => (
        <HStack
          key={`${tool.kind}:${tool.id}`}
          gap={3}
          align="center"
          justify="space-between"
          data-testid={`connector-bound-${tool.id}`}
          data-connector-kind="bound"
          data-connector-parent={connectorId}
        >
          <button
            type="button"
            data-testid={
              tool.kind === "skill" ? `settings-skill-open-${tool.id}` : undefined
            }
            onClick={() => {
              if (tool.kind === "skill") {
                onOpenDetail({ kind: "skill", item: skillFromTool(tool) });
              }
            }}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              margin: 0,
              font: "inherit",
              color: "inherit",
              cursor: tool.kind === "skill" ? "pointer" : "default",
              textAlign: "start",
              textDecoration: tool.kind === "skill" ? "underline" : undefined,
              textUnderlineOffset: "2px",
            }}
          >
            {tool.name}
          </button>
          {tool.kind === "skill" ? (
            <EnabledToggleSwitch
              enabled={Boolean(tool.enabled)}
              entityLabel={tool.name}
              isBusy={togglingSkillId === tool.id}
              onToggle={() => onToggleSkill(skillFromTool(tool))}
            />
          ) : tool.kind === "mcp" ? (
            <EnabledToggleSwitch
              enabled={tool.enabled !== false}
              entityLabel={tool.name}
              isBusy={togglingMcpName === tool.id}
              onToggle={() =>
                onToggleMcp({
                  name: tool.name,
                  transport: "stdio",
                  command: tool.command,
                  enabled: tool.enabled,
                })
              }
            />
          ) : (
            <Badge label={tool.kind} variant="neutral" />
          )}
        </HStack>
      ))}
    </VStack>
  );
}

function SaasConnectorCard({
  row,
  connectingId,
  busyId,
  togglingSkillId,
  togglingMcpName,
  onConnect,
  onDisconnect,
  onRefresh,
  onReconnect,
  clearingStickyKey,
  pairingBusy,
  onToggleSkill,
  onToggleMcp,
  onClearSticky,
  onOpenDetail,
  onConnectWhatsApp,
}: {
  row: SaasConnectorRow;
  connectingId: SaasConnectorRow["connector_id"] | null;
  busyId: SaasConnectorRow["connector_id"] | null;
  togglingSkillId: string | null;
  togglingMcpName: string | null;
  onConnect: (connectorId: SaasConnectorRow["connector_id"]) => void;
  onDisconnect: (connectorId: SaasConnectorRow["connector_id"]) => void;
  onRefresh: (connectorId: SaasConnectorRow["connector_id"]) => void;
  onReconnect: (connectorId: SaasConnectorRow["connector_id"]) => void;
  clearingStickyKey: string | null;
  pairingBusy: boolean;
  onToggleSkill: (skill: SettingsSkill) => void;
  onToggleMcp: (server: SettingsMcpServer) => void;
  onClearSticky: (connectorId: SaasConnectorRow["connector_id"], actionClass: string) => void;
  onOpenDetail: (target: SettingsDetailTarget) => void;
  onConnectWhatsApp?: () => void;
}) {
  const busy = busyId === row.connector_id;
  const canDisconnect =
    row.status === "connected" ||
    row.status === "needs_reauth" ||
    row.status === "pairing";
  const canRefresh = row.status === "connected";
  const showOAuthConnect =
    (row.connector_id === "google" || row.connector_id === "hubspot") &&
    row.status === "not_connected";
  const showWizard =
    (row.connector_id === "google" || row.connector_id === "hubspot") &&
    row.status === "needs_reauth";
  return (
    <VStack
      gap={2}
      data-testid={`connector-row-${row.connector_id}`}
      data-connector-kind="saas"
      data-connector-status={row.status}
    >
      <HStack gap={3} align="center">
        <span>{row.label}</span>
        <Text type="supporting" color="secondary">
          {row.runtimes.join(" · ")}
        </Text>
        <Badge
          label={connectionStatusLabel(row.status)}
          variant={row.status === "connected" ? "success" : "neutral"}
        />
        {row.account_label ? (
          <Text type="supporting" color="secondary">
            {row.account_label}
          </Text>
        ) : null}
        {showOAuthConnect ? (
          <span data-testid={`connector-connect-${row.connector_id}`}>
            <Button
              label="Connect"
              variant="secondary"
              size="sm"
              isLoading={connectingId === row.connector_id}
              onClick={() => onConnect(row.connector_id)}
              aria-label={
                row.connector_id === "google"
                  ? "Connect Google"
                  : "Connect HubSpot"
              }
            />
          </span>
        ) : null}
        {canRefresh ? (
          <span data-testid={`connector-refresh-${row.connector_id}`}>
            <Button
              label="Refresh"
              variant="secondary"
              size="sm"
              isLoading={busy}
              onClick={() => onRefresh(row.connector_id)}
              aria-label={`Refresh ${row.label}`}
            />
          </span>
        ) : null}
        {showWizard ? (
          <span data-testid={`connector-reconnect-${row.connector_id}`}>
            <Button
              label="Reconnect"
              variant="secondary"
              size="sm"
              isLoading={busy}
              onClick={() => onReconnect(row.connector_id)}
              aria-label={`Reconnect ${row.label}`}
            />
          </span>
        ) : null}
        {canDisconnect ? (
          <span data-testid={`connector-disconnect-${row.connector_id}`}>
            <Button
              label="Disconnect"
              variant="secondary"
              size="sm"
              isLoading={busy}
              onClick={() => onDisconnect(row.connector_id)}
              aria-label={`Disconnect ${row.label}`}
            />
          </span>
        ) : null}
        {row.connector_id === "whatsapp" &&
        onConnectWhatsApp &&
        (row.status === "not_connected" ||
          row.status === "pairing" ||
          row.status === "needs_reauth") ? (
          <span data-testid="connector-whatsapp-connect">
            <Button
              label={row.status === "pairing" ? "Pairing…" : "Connect"}
              size="sm"
              variant="secondary"
              isDisabled={pairingBusy}
              onClick={onConnectWhatsApp}
            />
          </span>
        ) : null}
        {row.connector_id === "github" && row.status === "not_connected" ? (
          <Text type="supporting" color="secondary">
            Connects via gh auth login in your sandbox.
          </Text>
        ) : null}
      </HStack>
      {Object.keys(row.sticky).length > 0 ? (
        <VStack gap={1} data-testid={`connector-sticky-${row.connector_id}`}>
          {Object.keys(row.sticky).map((actionClass) => (
            <HStack
              key={actionClass}
              gap={2}
              align="center"
              data-testid={`connector-sticky-class-${actionClass}`}
            >
              <Text type="supporting" color="secondary">
                Always: {actionClass}
              </Text>
              <Button
                label="Clear"
                size="sm"
                variant="secondary"
                isDisabled={
                  clearingStickyKey === `${row.connector_id}:${actionClass}`
                }
                onClick={() => onClearSticky(row.connector_id, actionClass)}
              />
            </HStack>
          ))}
        </VStack>
      ) : null}
      <BoundToolsList
        connectorId={row.connector_id}
        tools={row.bound_tools}
        togglingSkillId={togglingSkillId}
        togglingMcpName={togglingMcpName}
        onToggleSkill={onToggleSkill}
        onToggleMcp={onToggleMcp}
        onOpenDetail={onOpenDetail}
      />
    </VStack>
  );
}

function UnboundSkillsTable({
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

function UnboundMcpTable({
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

export type ConnectorsPageProps = {
  model: ConnectorsPageModel;
  loadError: string | null;
  connectingId: SaasConnectorRow["connector_id"] | null;
  busyId: SaasConnectorRow["connector_id"] | null;
  togglingSkillId: string | null;
  togglingMcpName: string | null;
  onConnect: (connectorId: SaasConnectorRow["connector_id"]) => void;
  onDisconnect: (connectorId: SaasConnectorRow["connector_id"]) => void;
  onRefresh: (connectorId: SaasConnectorRow["connector_id"]) => void;
  onReconnect: (connectorId: SaasConnectorRow["connector_id"]) => void;
  clearingStickyKey: string | null;
  pairingBusy?: boolean;
  onToggleSkill: (skill: SettingsSkill) => void;
  onToggleMcp: (server: SettingsMcpServer) => void;
  onClearSticky: (
    connectorId: SaasConnectorRow["connector_id"],
    actionClass: string,
  ) => void;
  onOpenDetail: (target: SettingsDetailTarget) => void;
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
  onConnectWhatsApp?: () => void;
};

export function ConnectorsPage({
  model,
  loadError,
  connectingId,
  busyId,
  togglingSkillId,
  togglingMcpName,
  onConnect,
  onDisconnect,
  onRefresh,
  onReconnect,
  clearingStickyKey,
  pairingBusy = false,
  onToggleSkill,
  onToggleMcp,
  onClearSticky,
  onOpenDetail,
  team,
  togglingGrantKey,
  pinBusy,
  teamError,
  onToggleGrant,
  onClearHubSpotPin,
  onConnectWhatsApp,
}: ConnectorsPageProps) {
  const skillRows = useMemo(
    () =>
      model.on_this_brain
        .filter((row) => row.tool_kind === "skill")
        .map((row) => skillFromTool(row)) as SkillRow[],
    [model.on_this_brain],
  );
  const mcpRows = useMemo(
    () =>
      model.on_this_brain
        .filter((row) => row.tool_kind === "mcp")
        .map((row, index) => ({
          name: row.name,
          transport: "stdio",
          command: row.command,
          enabled: row.enabled,
          id: `${row.id}-${index}`,
        })) as McpRow[],
    [model.on_this_brain],
  );
  const cliRows = model.on_this_brain.filter((row) => row.tool_kind === "cli");
  const appsEmpty =
    model.saas.length === 0 && mcpRows.length === 0 && cliRows.length === 0;
  // GET /api/connectors/team is null for members (401/403). A payload is the
  // existing tenant-admin signal — Admin sits under Apps and Skills, not a tab.
  const showAdmin = team !== null;

  return (
    <VStack gap={6} style={{ minWidth: 0 }} data-testid="connectors-page">
      {loadError ? (
        <Text type="body" color="secondary" data-testid="connectors-load-error">
          {loadError}
        </Text>
      ) : null}
      <VStack gap={3} data-testid="connectors-apps">
        <Text type="body" weight="semibold">
          Apps
        </Text>
        {appsEmpty ? (
          <Text type="body" color="secondary">
            No connectors granted.
          </Text>
        ) : (
          <>
            {model.saas.map((row) => (
              <SaasConnectorCard
                key={row.connector_id}
                row={row}
                connectingId={connectingId}
                busyId={busyId}
                togglingSkillId={togglingSkillId}
                togglingMcpName={togglingMcpName}
                onConnect={onConnect}
                onDisconnect={onDisconnect}
                onRefresh={onRefresh}
                onReconnect={onReconnect}
                clearingStickyKey={clearingStickyKey}
                pairingBusy={pairingBusy}
                onToggleSkill={onToggleSkill}
                onToggleMcp={onToggleMcp}
                onClearSticky={onClearSticky}
                onOpenDetail={onOpenDetail}
                onConnectWhatsApp={onConnectWhatsApp}
              />
            ))}
            {mcpRows.length > 0 ? (
              <UnboundMcpTable
                rows={mcpRows}
                togglingMcpName={togglingMcpName}
                onToggleMcp={onToggleMcp}
              />
            ) : null}
            {cliRows.map((row) => (
              <HStack
                key={row.id}
                gap={3}
                data-testid={`apps-cli-${row.id}`}
                data-connector-kind="cli"
              >
                <Text type="body">{row.name}</Text>
                <Badge label={row.tool_kind} variant="neutral" />
              </HStack>
            ))}
          </>
        )}
      </VStack>
      <VStack gap={3} data-testid="connectors-skills">
        <Text type="body" weight="semibold">
          Skills
        </Text>
        {skillRows.length > 0 ? (
          <UnboundSkillsTable
            rows={skillRows}
            togglingSkillId={togglingSkillId}
            onToggleSkill={onToggleSkill}
            onOpenDetail={onOpenDetail}
          />
        ) : null}
      </VStack>
      {showAdmin && team ? (
        <VStack gap={3} data-testid="settings-admin">
          <Text type="body" weight="semibold">
            Admin
          </Text>
          <ConnectorsTeamPanel
            team={team}
            togglingGrantKey={togglingGrantKey}
            pinBusy={pinBusy}
            actionError={teamError}
            onToggleGrant={onToggleGrant}
            onClearHubSpotPin={onClearHubSpotPin}
          />
        </VStack>
      ) : null}
    </VStack>
  );
}
