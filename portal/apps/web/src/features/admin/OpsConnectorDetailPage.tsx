import { useEffect, useMemo, useState } from "react";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import {
  BreadcrumbItem,
  Breadcrumbs,
} from "@astryxdesign/core/Breadcrumbs";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Switch } from "@astryxdesign/core/Switch";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type { OpsTenantSummary } from "../../api/opsAdmin.js";
import {
  deleteOpsClassCSecret,
  fetchOpsClassCSecrets,
  putOpsClassCSecret,
  type OpsClassCSecretStatus,
} from "../../api/opsClassCSecrets.js";
import {
  fetchOpsTenantConnectors,
  putOpsConnectorOnboard,
  type OpsSurfaceId,
  type OpsTenantOnboardedConnector,
} from "../../api/opsConnectors.js";
import {
  fetchOpsConnectorUsers,
  fetchOpsMemberSubset,
  putOpsConnectorUserGrant,
  putOpsMemberSubset,
  type OpsConnectorUser,
  type OpsMemberSubset,
} from "../../api/opsTenantAdmin.js";
import { isFirstClassConnectorId } from "../settings/connectorsCatalog.js";
import { LogoTile } from "./adminConnectorLogo.js";
import {
  CONNECTOR_STATUS_LABELS,
  connectorStatus,
  isLastSurfaceOff,
  remainingSurfaces,
} from "./opsConnectors.js";
import {
  groupedMemberTools,
  MEMBER_SUBSET_GROUP_LABELS,
  showsMemberSubset,
  toggleAllowedTool,
} from "./opsMemberSubset.js";

const STATUS_TOKEN_COLORS: Record<string, string> = {
  Connected: "var(--color-text-green)",
  "Needs reauth": "var(--color-text-orange)",
  Pairing: "var(--color-text-blue)",
  "Not connected": "var(--color-text-secondary)",
};

const SURFACE_LABELS: Record<OpsSurfaceId, string> = {
  mcp: "MCP",
  api: "API",
  cli: "CLI",
};

function Card({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        background: "var(--color-background-surface)",
        padding: "var(--spacing-4)",
        flex: 1,
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

type OpsConnectorDetailPageProps = {
  tenant: OpsTenantSummary;
  connectorId: string;
  onBack: () => void;
};

export function OpsConnectorDetailPage({
  tenant,
  connectorId,
  onBack,
}: OpsConnectorDetailPageProps) {
  const [connector, setConnector] = useState<OpsTenantOnboardedConnector | null>(
    null,
  );
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [users, setUsers] = useState<OpsConnectorUser[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [busySurface, setBusySurface] = useState<OpsSurfaceId | null>(null);
  const [pendingOff, setPendingOff] = useState<OpsSurfaceId | null>(null);
  const [subset, setSubset] = useState<OpsMemberSubset | null>(null);
  const [subsetError, setSubsetError] = useState<string | null>(null);
  const [busyTool, setBusyTool] = useState<string | null>(null);
  const [classC, setClassC] = useState<OpsClassCSecretStatus[] | null>(null);
  const [classCError, setClassCError] = useState<string | null>(null);
  const [classCDrafts, setClassCDrafts] = useState<
    Partial<Record<OpsSurfaceId, string>>
  >({});
  const [busyClassC, setBusyClassC] = useState<OpsSurfaceId | null>(null);
  const showClassCPaste = !isFirstClassConnectorId(connectorId);

  useEffect(() => {
    let cancelled = false;
    setConnector(null);
    setCatalogError(null);
    setUsers(null);
    setUsersError(null);
    setGrantError(null);
    setSurfaceError(null);
    setSubset(null);
    setSubsetError(null);
    setClassC(null);
    setClassCError(null);
    setClassCDrafts({});
    void (async () => {
      try {
        const rows = await fetchOpsTenantConnectors(tenant.tenant_id);
        if (!cancelled) {
          setConnector(
            rows.find((row) => row.connector_id === connectorId) ?? null,
          );
        }
      } catch (err) {
        if (!cancelled) {
          setCatalogError(
            err instanceof Error ? err.message : "Failed to load connector",
          );
        }
      }
    })();
    void (async () => {
      try {
        const next = await fetchOpsConnectorUsers({
          tenantId: tenant.tenant_id,
          connectorId,
        });
        if (!cancelled) {
          setUsers(next);
        }
      } catch (err) {
        if (!cancelled) {
          setUsersError(
            err instanceof Error ? err.message : "Failed to load users",
          );
        }
      }
    })();
    void (async () => {
      try {
        const next = await fetchOpsMemberSubset({
          tenantId: tenant.tenant_id,
          connectorId,
        });
        if (!cancelled) {
          setSubset(next);
        }
      } catch (err) {
        if (!cancelled) {
          setSubsetError(
            err instanceof Error ? err.message : "Failed to load member subset",
          );
        }
      }
    })();
    if (showClassCPaste) {
      void (async () => {
        try {
          const next = await fetchOpsClassCSecrets({
            tenantId: tenant.tenant_id,
            connectorId,
          });
          if (!cancelled) {
            setClassC(next.surfaces);
          }
        } catch (err) {
          if (!cancelled) {
            setClassCError(
              err instanceof Error ? err.message : "Failed to load secrets",
            );
          }
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [tenant.tenant_id, connectorId, showClassCPaste]);

  const label = connector?.label ?? connectorId;
  const chips = connector?.auth_chips ?? [];
  const status = connector
    ? connectorStatus(connector.status_counts)
    : "not_connected";
  const statusLabel = CONNECTOR_STATUS_LABELS[status];
  const available = connector?.available_surfaces ?? [];
  const currentSurfaces = connector?.surfaces ?? [];
  const showSurfaceGroup = available.length > 1;

  async function applySurfaces(next: OpsSurfaceId[]): Promise<void> {
    setSurfaceError(null);
    try {
      const result = await putOpsConnectorOnboard({
        tenantId: tenant.tenant_id,
        connectorId,
        surfaces: next,
      });
      if (result.surfaces.length === 0) {
        onBack();
        return;
      }
      setConnector((current) =>
        current
          ? { ...current, surfaces: result.surfaces }
          : current,
      );
    } catch (err) {
      setSurfaceError(
        err instanceof Error ? err.message : "Surface update failed",
      );
    }
  }

  async function handleSurface(surface: OpsSurfaceId, on: boolean) {
    if (on) {
      if (currentSurfaces.includes(surface)) {
        return;
      }
      setBusySurface(surface);
      await applySurfaces([...currentSurfaces, surface]);
      setBusySurface(null);
      return;
    }
    if (isLastSurfaceOff(currentSurfaces, surface)) {
      setPendingOff(surface);
      return;
    }
    setBusySurface(surface);
    await applySurfaces(remainingSurfaces(currentSurfaces, surface));
    setBusySurface(null);
  }

  async function confirmLastOff() {
    if (!pendingOff) {
      return;
    }
    const surface = pendingOff;
    setBusySurface(surface);
    setPendingOff(null);
    await applySurfaces(remainingSurfaces(currentSurfaces, surface));
    setBusySurface(null);
  }

  async function handleSubsetTool(name: string, on: boolean) {
    if (!subset) {
      return;
    }
    const allowedTools = toggleAllowedTool(subset.allowed_tools, name, on);
    setBusyTool(name);
    setSubsetError(null);
    try {
      const next = await putOpsMemberSubset({
        tenantId: tenant.tenant_id,
        connectorId,
        allowedTools,
      });
      setSubset(next);
    } catch (err) {
      setSubsetError(
        err instanceof Error ? err.message : "Member subset update failed",
      );
    } finally {
      setBusyTool(null);
    }
  }

  async function handleGrant(user: OpsConnectorUser, granted: boolean) {
    setBusyUserId(user.user_id);
    setGrantError(null);
    try {
      await putOpsConnectorUserGrant({
        tenantId: tenant.tenant_id,
        connectorId,
        userId: user.user_id,
        granted,
      });
      setUsers(
        (current) =>
          current?.map((row) =>
            row.user_id === user.user_id ? { ...row, granted } : row,
          ) ?? current,
      );
    } catch (err) {
      setGrantError(
        err instanceof Error ? err.message : "Grant update failed",
      );
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleClassCSave(surface: OpsSurfaceId) {
    const value = classCDrafts[surface]?.trim();
    if (!value) {
      return;
    }
    setBusyClassC(surface);
    setClassCError(null);
    try {
      const status = await putOpsClassCSecret({
        tenantId: tenant.tenant_id,
        connectorId,
        surfaceId: surface,
        value,
      });
      setClassCDrafts((prev) => ({ ...prev, [surface]: "" }));
      setClassC((current) => {
        const rows = current ?? [];
        const without = rows.filter((row) => row.surface_id !== surface);
        return [...without, status];
      });
    } catch (err) {
      setClassCError(
        err instanceof Error ? err.message : "Secret save failed",
      );
    } finally {
      setBusyClassC(null);
    }
  }

  async function handleClassCDelete(surface: OpsSurfaceId) {
    setBusyClassC(surface);
    setClassCError(null);
    try {
      await deleteOpsClassCSecret({
        tenantId: tenant.tenant_id,
        connectorId,
        surfaceId: surface,
      });
      setClassC((current) =>
        (current ?? []).map((row) =>
          row.surface_id === surface
            ? { ...row, present: false, fingerprint: null, rotated_at: null }
            : row,
        ),
      );
    } catch (err) {
      setClassCError(
        err instanceof Error ? err.message : "Secret delete failed",
      );
    } finally {
      setBusyClassC(null);
    }
  }

  const surfaceNames = useMemo(
    () => currentSurfaces.map((id) => SURFACE_LABELS[id]).join(", "),
    [currentSurfaces],
  );
  const subsetGroups = subset ? groupedMemberTools(subset.tools) : null;
  const showSubset =
    subset !== null && showsMemberSubset(subset.kind, subset.tools.length);

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={4}>
          <VStack gap={4}>
            <Breadcrumbs label="Connector breadcrumb" variant="supporting">
              <BreadcrumbItem onClick={onBack}>Connectors</BreadcrumbItem>
              <BreadcrumbItem isCurrent>{label}</BreadcrumbItem>
            </Breadcrumbs>
            <VStack gap={1}>
              <HStack gap={2} align="center">
                <LogoTile label={label} />
                <Text
                  type="large"
                  weight="semibold"
                  data-testid="ops-connector-detail-name"
                >
                  {label}
                </Text>
              </HStack>
              <HStack gap={2} align="center">
                {chips.map((chip) => (
                  <Badge
                    key={chip}
                    variant={chip === "OAuth" ? "blue" : "neutral"}
                    label={chip}
                  />
                ))}
                <span
                  data-testid="ops-connector-detail-status"
                  style={{
                    color:
                      STATUS_TOKEN_COLORS[statusLabel] ??
                      "var(--color-text-secondary)",
                  }}
                >
                  {statusLabel}
                </span>
              </HStack>
            </VStack>
            {catalogError ? (
              <div data-testid="ops-connector-detail-error">
                <Banner status="error" title={catalogError} container="section" />
              </div>
            ) : null}
            {surfaceError ? (
              <div data-testid="ops-connector-surface-error">
                <Banner status="error" title={surfaceError} container="section" />
              </div>
            ) : null}
            {classCError ? (
              <div data-testid="ops-class-c-error">
                <Banner status="error" title={classCError} container="section" />
              </div>
            ) : null}
            <Card>
              <VStack gap={2}>
                <Text type="body" weight="semibold">
                  Surfaces
                </Text>
                {showSurfaceGroup ? (
                  <VStack gap={2} data-testid="ops-surface-group">
                    {available.map((surface) => (
                      <span
                        key={surface}
                        data-testid={`ops-surface-${surface}`}
                      >
                        <Switch
                          label={SURFACE_LABELS[surface]}
                          value={currentSurfaces.includes(surface)}
                          isLoading={busySurface === surface}
                          onChange={(checked) => {
                            void handleSurface(surface, checked);
                          }}
                        />
                      </span>
                    ))}
                  </VStack>
                ) : (
                  <Text type="body" data-testid="ops-surface-single">
                    {surfaceNames ||
                      (available[0] ? SURFACE_LABELS[available[0]] : "—")}
                  </Text>
                )}
              </VStack>
            </Card>
            <HStack gap={3} align="start">
              <Card>
                <VStack gap={2}>
                  <Text type="body" weight="semibold">
                    Auth
                  </Text>
                  <HStack gap={6} align="start">
                    <VStack gap={1}>
                      <Text type="supporting" color="secondary">
                        Type
                      </Text>
                      <Text type="body">{chips[0] ?? "—"}</Text>
                      {showClassCPaste ? null : (
                        <>
                          <Text type="supporting" color="secondary">
                            Last authorized
                          </Text>
                          <Text type="body">—</Text>
                        </>
                      )}
                    </VStack>
                    {showClassCPaste ? null : (
                      <VStack gap={1}>
                        <Text type="supporting" color="secondary">
                          Account
                        </Text>
                        <Text type="body">—</Text>
                      </VStack>
                    )}
                  </HStack>
                  {showClassCPaste ? (
                    <VStack gap={2} data-testid="ops-class-c-paste">
                      {currentSurfaces.map((surface) => {
                        const status = classC?.find(
                          (row) => row.surface_id === surface,
                        );
                        const present = status?.present === true;
                        return (
                          <HStack key={surface} gap={3} align="center">
                            <Text
                              type="supporting"
                              color="secondary"
                              data-testid={`ops-class-c-status-${surface}`}
                            >
                              {present
                                ? `set · ${status?.fingerprint ?? "fingerprint n/a"}`
                                : "not set"}
                            </Text>
                            <TextInput
                              label={`${SURFACE_LABELS[surface]} value`}
                              isLabelHidden
                              value={classCDrafts[surface] ?? ""}
                              onChange={(next) =>
                                setClassCDrafts((prev) => ({
                                  ...prev,
                                  [surface]: next,
                                }))
                              }
                              placeholder={
                                present ? "Replace value…" : "Paste value…"
                              }
                              isDisabled={busyClassC === surface}
                              htmlName={`ops-class-c-${surface}`}
                              data-testid={`ops-class-c-input-${surface}`}
                            />
                            <Button
                              type="button"
                              label={present ? "Rotate" : "Set"}
                              size="sm"
                              isLoading={busyClassC === surface}
                              isDisabled={!(classCDrafts[surface] ?? "").trim()}
                              onClick={() => void handleClassCSave(surface)}
                              data-testid={`ops-class-c-save-${surface}`}
                            />
                            {present ? (
                              <Button
                                type="button"
                                label="Delete"
                                variant="secondary"
                                size="sm"
                                isLoading={busyClassC === surface}
                                onClick={() => void handleClassCDelete(surface)}
                                data-testid={`ops-class-c-delete-${surface}`}
                              />
                            ) : null}
                          </HStack>
                        );
                      })}
                    </VStack>
                  ) : (
                    <Button
                      type="button"
                      label="Reauthorize"
                      variant="primary"
                      size="sm"
                    />
                  )}
                </VStack>
              </Card>
              <Card>
                <VStack gap={2}>
                  <Text type="body" weight="semibold">
                    Status
                  </Text>
                  <HStack gap={6} align="start">
                    <VStack gap={1}>
                      <Text type="supporting" color="secondary">
                        Connected
                      </Text>
                      <Text type="body" data-testid="ops-connector-detail-connected">
                        {connector?.status_counts.connected ?? 0}
                      </Text>
                    </VStack>
                    <VStack gap={1}>
                      <Text type="supporting" color="secondary">
                        Pairing
                      </Text>
                      <Text type="body" data-testid="ops-connector-detail-pairing">
                        {connector?.status_counts.pairing ?? 0}
                      </Text>
                    </VStack>
                    <VStack gap={1}>
                      <Text type="supporting" color="secondary">
                        Reauth needed
                      </Text>
                      <Text type="body" data-testid="ops-connector-detail-reauth">
                        {connector?.status_counts.needs_reauth ?? 0}
                      </Text>
                    </VStack>
                  </HStack>
                </VStack>
              </Card>
            </HStack>
            <VStack gap={2}>
              <Text type="body" weight="semibold">
                Users who can use {label}
              </Text>
              {usersError ? (
                <div data-testid="ops-connector-users-error">
                  <Banner status="error" title={usersError} container="section" />
                </div>
              ) : null}
              {grantError ? (
                <div data-testid="ops-connector-grant-error">
                  <Banner status="error" title={grantError} container="section" />
                </div>
              ) : null}
              {users && users.length === 0 ? (
                <EmptyState title="No users yet" />
              ) : null}
              {users && users.length > 0 ? (
                <div
                  style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    background: "var(--color-background-surface)",
                  }}
                  data-testid="ops-connector-users-list"
                >
                  <List hasDividers>
                    {users.map((user) => (
                      <ListItem
                        key={user.user_id}
                        label={user.display_name}
                        description={user.email}
                        startContent={<Avatar name={user.display_name} size="small" />}
                        endContent={
                          <HStack gap={3} align="center">
                            <Badge variant="neutral" label={user.role_label} />
                            <span data-testid={`ops-connector-grant-${user.user_id}`}>
                              <Switch
                                label={`${user.display_name} can use ${label}`}
                                isLabelHidden
                                value={user.granted}
                                isLoading={busyUserId === user.user_id}
                                onChange={(checked) => {
                                  void handleGrant(user, checked);
                                }}
                              />
                            </span>
                          </HStack>
                        }
                      />
                    ))}
                  </List>
                </div>
              ) : null}
            </VStack>
            {subsetError ? (
              <div data-testid="ops-member-subset-error">
                <Banner status="error" title={subsetError} container="section" />
              </div>
            ) : null}
            {showSubset && subset && subsetGroups ? (
              <VStack gap={2} data-testid="ops-member-subset">
                <Text type="body" weight="semibold">
                  Member subset
                </Text>
                {(["read", "write"] as const).map((group) => {
                  const tools = subsetGroups[group];
                  if (tools.length === 0) {
                    return null;
                  }
                  return (
                    <VStack
                      key={group}
                      gap={2}
                      data-testid={`ops-member-subset-${group}`}
                    >
                      <Text type="supporting" color="secondary">
                        {MEMBER_SUBSET_GROUP_LABELS[group]}
                      </Text>
                      {tools.map((tool) => (
                        <span
                          key={tool.name}
                          data-testid={`ops-member-subset-tool-${tool.name}`}
                        >
                          <Switch
                            label={tool.name}
                            value={subset.allowed_tools.includes(tool.name)}
                            isLoading={busyTool === tool.name}
                            onChange={(checked) => {
                              void handleSubsetTool(tool.name, checked);
                            }}
                          />
                        </span>
                      ))}
                    </VStack>
                  );
                })}
              </VStack>
            ) : null}
            <Dialog
              isOpen={pendingOff !== null}
              onOpenChange={(open) => {
                if (!open) {
                  setPendingOff(null);
                }
              }}
              purpose="form"
              width={400}
              data-testid="ops-surface-off-confirm"
            >
              <Layout
                header={
                  <DialogHeader
                    title="Turn off this surface?"
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
                          void confirmLastOff();
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
