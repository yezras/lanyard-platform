import { useEffect, useMemo, useState } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import {
  fetchOpsCanonicalConnectors,
  fetchOpsTenantConnectors,
  putOpsConnectorOnboard,
  type OpsCanonicalConnector,
  type OpsSurfaceId,
  type OpsTenantOnboardedConnector,
} from "../../api/opsConnectors.js";
import type { OpsTenantSummary } from "../../api/opsAdmin.js";
import { LogoTile } from "./adminConnectorLogo.js";
import {
  buildOnboardedRows,
  CONNECTOR_STATUS_LABELS,
  searchCanonicalNotOnTenant,
  type OpsConnectorId,
} from "./opsConnectors.js";

const STATUS_TOKEN_COLORS = {
  connected: "var(--color-text-green)",
  reauth: "var(--color-text-orange)",
  pairing: "var(--color-text-blue)",
  not_connected: "var(--color-text-secondary)",
} as const;

const AUTH_CHIP_VARIANTS = {
  OAuth: "blue",
  MCP: "teal",
  CLI: "neutral",
  "API key": "yellow",
  QR: "neutral",
} as const;

function AuthChips({ chips }: { chips: string[] }) {
  return (
    <HStack gap={1} align="center">
      {chips.map((chip) => (
        <Badge
          key={chip}
          variant={
            AUTH_CHIP_VARIANTS[chip as keyof typeof AUTH_CHIP_VARIANTS] ??
            "neutral"
          }
          label={chip}
        />
      ))}
    </HStack>
  );
}

function StatusText({ status }: { status: keyof typeof STATUS_TOKEN_COLORS }) {
  return (
    <span
      style={{ color: STATUS_TOKEN_COLORS[status] }}
      data-testid={`ops-connector-status-${status.replace("_", "-")}`}
    >
      {CONNECTOR_STATUS_LABELS[status]}
    </span>
  );
}

function OnboardPicker(input: {
  canonical: OpsCanonicalConnector[];
  onboardedIds: ReadonlySet<string>;
  busyId: string | null;
  onOnboard: (connectorId: string, surfaces: OpsSurfaceId[]) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const results = useMemo(
    () =>
      searchCanonicalNotOnTenant({
        canonical: input.canonical,
        onboardedIds: input.onboardedIds,
        query,
      }),
    [input.canonical, input.onboardedIds, query],
  );

  return (
    <div
      data-testid="ops-connector-onboard-picker"
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        background: "var(--color-background-surface)",
        padding: "var(--spacing-3)",
        width: 300,
      }}
    >
      <VStack gap={2}>
        <Text type="body" weight="semibold">
          Onboard
        </Text>
        <TextInput
          label="Search connectors"
          isLabelHidden
          placeholder="Search…"
          value={query}
          onChange={(value: string) => setQuery(value)}
        />
        <List density="compact">
          {results.slice(0, 8).map((entry) => (
            <ListItem
              key={entry.id}
              label={entry.label}
              startContent={<LogoTile label={entry.label} />}
              endContent={
                input.busyId === entry.id ? (
                  <Spinner label={`Onboarding ${entry.label}…`} size="sm" />
                ) : (
                  <Button
                    type="button"
                    label="Onboard"
                    variant="secondary"
                    size="sm"
                    onClick={() => input.onOnboard(entry.id, entry.available_surfaces)}
                  />
                )
              }
            />
          ))}
        </List>
        {results.length === 0 ? <EmptyState title="None" /> : null}
      </VStack>
    </div>
  );
}

type OpsConnectorsPageProps = {
  tenant: OpsTenantSummary;
  onOpenConnector: (connectorId: OpsConnectorId) => void;
};

export function OpsConnectorsPage({
  tenant,
  onOpenConnector,
}: OpsConnectorsPageProps) {
  const [onboarded, setOnboarded] = useState<OpsTenantOnboardedConnector[] | null>(
    null,
  );
  const [canonical, setCanonical] = useState<OpsCanonicalConnector[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingOff, setPendingOff] = useState<{
    connectorId: string;
    label: string;
  } | null>(null);

  async function reload(): Promise<void> {
    const [nextOnboarded, nextCanonical] = await Promise.all([
      fetchOpsTenantConnectors(tenant.tenant_id),
      fetchOpsCanonicalConnectors(),
    ]);
    setOnboarded(nextOnboarded);
    setCanonical(nextCanonical);
  }

  useEffect(() => {
    let cancelled = false;
    setOnboarded(null);
    setError(null);
    void (async () => {
      try {
        const [nextOnboarded, nextCanonical] = await Promise.all([
          fetchOpsTenantConnectors(tenant.tenant_id),
          fetchOpsCanonicalConnectors(),
        ]);
        if (!cancelled) {
          setOnboarded(nextOnboarded);
          setCanonical(nextCanonical);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load connectors",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant.tenant_id]);

  const rows = useMemo(
    () => (onboarded ? buildOnboardedRows(onboarded) : []),
    [onboarded],
  );
  const onboardedIds = useMemo(
    () => new Set(rows.map((row) => row.connector_id)),
    [rows],
  );

  async function handleOnboard(connectorId: string, surfaces: OpsSurfaceId[]) {
    setBusyId(connectorId);
    setError(null);
    try {
      await putOpsConnectorOnboard({
        tenantId: tenant.tenant_id,
        connectorId,
        surfaces,
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onboard failed");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmOff(): Promise<void> {
    if (!pendingOff) {
      return;
    }
    const { connectorId } = pendingOff;
    setBusyId(connectorId);
    setError(null);
    try {
      await putOpsConnectorOnboard({
        tenantId: tenant.tenant_id,
        connectorId,
        surfaces: [],
      });
      setPendingOff(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onboard failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={4}>
          <VStack gap={4}>
            <Button
              type="button"
              label="Onboard"
              variant="primary"
              size="sm"
              data-testid="ops-connector-onboard"
              onClick={() => setPickerOpen((open) => !open)}
            />
            {error ? (
              <div data-testid="ops-connectors-error">
                <Banner status="error" title={error} container="section" />
              </div>
            ) : null}
            <HStack gap={4} align="start">
              <div style={{ flex: 1, minWidth: 0 }}>
                {onboarded && rows.length === 0 ? (
                  <EmptyState title="No connectors yet" />
                ) : null}
                {rows.length > 0 ? (
                  <div
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      background: "var(--color-background-surface)",
                    }}
                    data-testid="ops-connectors-list"
                  >
                    <List hasDividers>
                      {rows.map((row) => (
                        <ListItem
                          key={row.connector_id}
                          label={row.label}
                          onClick={() => onOpenConnector(row.connector_id)}
                          startContent={<LogoTile label={row.label} />}
                          data-testid={`ops-connector-row-${row.connector_id}`}
                          description={
                            <HStack gap={2} align="center">
                              <AuthChips chips={row.authChips} />
                              <StatusText status={row.status} />
                            </HStack>
                          }
                          endContent={
                            <HStack gap={2} align="center">
                              <span
                                data-testid={`ops-connector-switch-${row.connector_id}`}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => event.stopPropagation()}
                              >
                                <Switch
                                  label={`${row.label} onboard`}
                                  isLabelHidden
                                  value={true}
                                  isLoading={busyId === row.connector_id}
                                  onChange={(checked) => {
                                    if (!checked) {
                                      setPendingOff({
                                        connectorId: row.connector_id,
                                        label: row.label,
                                      });
                                    }
                                  }}
                                />
                              </span>
                              <Text
                                type="supporting"
                                color="secondary"
                                data-testid={`ops-connector-users-${row.connector_id}`}
                              >
                                {row.connectedUsers}{" "}
                                {row.connectedUsers === 1 ? "user" : "users"}
                              </Text>
                              <Text type="supporting" color="secondary">
                                ›
                              </Text>
                            </HStack>
                          }
                        />
                      ))}
                    </List>
                  </div>
                ) : null}
              </div>
              {pickerOpen ? (
                <OnboardPicker
                  canonical={canonical}
                  onboardedIds={onboardedIds}
                  busyId={busyId}
                  onOnboard={(connectorId, surfaces) => {
                    void handleOnboard(connectorId, surfaces);
                  }}
                />
              ) : null}
            </HStack>
            <Dialog
              isOpen={pendingOff !== null}
              onOpenChange={(open) => {
                if (!open) {
                  setPendingOff(null);
                }
              }}
              purpose="form"
              width={400}
              data-testid="ops-connector-off-confirm"
            >
              <Layout
                header={
                  <DialogHeader
                    title={pendingOff ? `Turn off ${pendingOff.label}?` : "Turn off?"}
                    onOpenChange={(open) => {
                      if (!open) {
                        setPendingOff(null);
                      }
                    }}
                  />
                }
                footer={
                  <LayoutFooter>
                    <HStack gap={2} hAlign="end">
                      <Button
                        type="button"
                        label="Cancel"
                        size="sm"
                        variant="secondary"
                        onClick={() => setPendingOff(null)}
                      />
                      <Button
                        type="button"
                        label="Turn off"
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          void confirmOff();
                        }}
                      />
                    </HStack>
                  </LayoutFooter>
                }
              />
            </Dialog>
          </VStack>
        </LayoutContent>
      }
    />
  );
}
