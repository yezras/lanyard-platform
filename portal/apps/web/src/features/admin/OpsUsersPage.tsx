import { useEffect, useMemo, useState } from "react";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import {
  BreadcrumbItem,
  Breadcrumbs,
} from "@astryxdesign/core/Breadcrumbs";
import { Button } from "@astryxdesign/core/Button";
import {
  Dialog,
  DialogHeader,
} from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import {
  Layout,
  LayoutContent,
  LayoutFooter,
} from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";

import type { OpsTenantSummary } from "../../api/opsAdmin.js";
import {
  fetchOpsTenantConnectors,
  type OpsTenantOnboardedConnector,
} from "../../api/opsConnectors.js";
import {
  createOpsTenantUser,
  deleteOpsTenantUser,
  fetchOpsTenantUsers,
  putOpsConnectorUserGrant,
  type OpsTenantUser,
  type OpsTenantUserRole,
} from "../../api/opsTenantAdmin.js";
import { LogoTile } from "./adminConnectorLogo.js";
import { findAdminCatalogEntry } from "./adminConnectorCatalogSeed.js";
import { formatIsoOrDash } from "./opsAdminView.js";
import {
  connectorsAfterGrant,
  isLastTenantAdmin,
  parseAddUserDraft,
} from "./opsUsers.js";

const ROLE_LABELS: Record<OpsTenantUserRole, string> = {
  tenant_admin: "Tenant admin",
  member: "Member",
};

type OpsUsersPageProps = {
  tenant: OpsTenantSummary;
  userId?: string | null;
  onOpenUser?: (userId: string) => void;
  onBack?: () => void;
};

function Card({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        background: "var(--color-background-surface)",
        padding: "var(--spacing-4)",
      }}
    >
      {children}
    </div>
  );
}

function AddUserDialog({
  tenantId,
  isOpen,
  onOpenChange,
  onCreated,
}: {
  tenantId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (user: OpsTenantUser) => void;
}): React.JSX.Element {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OpsTenantUserRole>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = parseAddUserDraft({ displayName, email, role });

  function reset() {
    setDisplayName("");
    setEmail("");
    setRole("member");
    setBusy(false);
    setError(null);
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      reset();
    }
    onOpenChange(open);
  }

  async function handleSubmit() {
    if (!draft || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createOpsTenantUser({
        tenantId,
        displayName: draft.displayName,
        email: draft.email,
        role: draft.role,
      });
      onCreated(created);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add user failed");
      setBusy(false);
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      purpose="form"
      width={440}
    >
      <Layout
        header={
          <DialogHeader title="Add user" onOpenChange={handleOpenChange} />
        }
        content={
          <LayoutContent>
            <VStack gap={4} data-testid="ops-add-user-dialog">
              <TextInput
                label="Name"
                value={displayName}
                onChange={setDisplayName}
                isDisabled={busy}
              />
              <TextInput
                label="Email"
                value={email}
                onChange={setEmail}
                isDisabled={busy}
              />
              <SegmentedControl
                label="Role"
                value={role}
                onChange={(value) => setRole(value as OpsTenantUserRole)}
                size="sm"
                layout="fill"
                isDisabled={busy}
              >
                <SegmentedControlItem value="tenant_admin" label="Admin" />
                <SegmentedControlItem value="member" label="Member" />
              </SegmentedControl>
              {error ? (
                <div data-testid="ops-add-user-error" role="alert">
                  <Banner status="error" title={error} container="section" />
                </div>
              ) : null}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              <Button
                type="button"
                label="Cancel"
                variant="secondary"
                size="sm"
                isDisabled={busy}
                onClick={() => handleOpenChange(false)}
              />
              <Button
                type="button"
                label="Add user"
                variant="primary"
                size="sm"
                data-testid="ops-add-user-submit"
                isDisabled={!draft || busy}
                isLoading={busy}
                onClick={() => {
                  void handleSubmit();
                }}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

function UserDetail({
  tenant,
  user,
  lastAdmin,
  connectors,
  connectorsError,
  onBack,
  onRemoved,
  onGrantChange,
}: {
  tenant: OpsTenantSummary;
  user: OpsTenantUser;
  lastAdmin: boolean;
  connectors: OpsTenantOnboardedConnector[] | null;
  connectorsError: string | null;
  onBack: () => void;
  onRemoved: () => void;
  onGrantChange: (connectorId: string, granted: boolean) => void;
}): React.JSX.Element {
  const [busyRemove, setBusyRemove] = useState(false);
  const [busyConnector, setBusyConnector] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleRemove() {
    if (lastAdmin || busyRemove) {
      return;
    }
    setBusyRemove(true);
    setActionError(null);
    try {
      await deleteOpsTenantUser({
        tenantId: tenant.tenant_id,
        userId: user.user_id,
      });
      onRemoved();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Remove user failed");
      setBusyRemove(false);
    }
  }

  async function handleGrant(connectorId: string, granted: boolean) {
    setBusyConnector(connectorId);
    setActionError(null);
    try {
      await putOpsConnectorUserGrant({
        tenantId: tenant.tenant_id,
        connectorId,
        userId: user.user_id,
        granted,
      });
      onGrantChange(connectorId, granted);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Grant update failed");
    } finally {
      setBusyConnector(null);
    }
  }

  return (
    <VStack gap={4} data-testid="ops-user-detail">
      <Breadcrumbs label="User breadcrumb" variant="supporting">
        <BreadcrumbItem onClick={onBack}>Users</BreadcrumbItem>
        <BreadcrumbItem isCurrent>{user.display_name}</BreadcrumbItem>
      </Breadcrumbs>
      <HStack gap={4} align="start">
        <Card>
          <VStack gap={2}>
            <HStack gap={3} align="center">
              <Avatar name={user.display_name} size="small" />
              <VStack gap={0}>
                <Text
                  type="large"
                  weight="semibold"
                  data-testid="ops-user-detail-name"
                >
                  {user.display_name}
                </Text>
                <Text type="supporting" color="secondary">
                  {user.email}
                </Text>
              </VStack>
            </HStack>
            <Badge variant="neutral" label={ROLE_LABELS[user.role]} />
            <Button
              type="button"
              label="Remove"
              variant="secondary"
              size="sm"
              data-testid="ops-user-remove"
              isDisabled={lastAdmin || busyRemove}
              isLoading={busyRemove}
              onClick={() => {
                void handleRemove();
              }}
            />
          </VStack>
        </Card>
      </HStack>
      {actionError ? (
        <div data-testid="ops-user-detail-error" role="alert">
          <Banner status="error" title={actionError} container="section" />
        </div>
      ) : null}
      {connectorsError ? (
        <div data-testid="ops-user-grants-error" role="alert">
          <Banner status="error" title={connectorsError} container="section" />
        </div>
      ) : null}
      <VStack gap={2}>
        <Text type="body" weight="semibold">
          Connectors
        </Text>
        {connectors && connectors.length === 0 && !connectorsError ? (
          <EmptyState title="No connectors yet" />
        ) : null}
        {connectors && connectors.length > 0 ? (
          <div
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              background: "var(--color-background-surface)",
            }}
            data-testid="ops-user-grants"
          >
            <List hasDividers>
              {connectors.map((row) => {
                const granted = user.connectors.includes(row.connector_id);
                return (
                  <ListItem
                    key={row.connector_id}
                    label={row.label}
                    startContent={<LogoTile label={row.label} />}
                    endContent={
                      <span data-testid={`ops-user-grant-${row.connector_id}`}>
                        <Switch
                          label={`${user.display_name} can use ${row.label}`}
                          isLabelHidden
                          value={granted}
                          isLoading={busyConnector === row.connector_id}
                          onChange={(checked) => {
                            void handleGrant(row.connector_id, checked);
                          }}
                        />
                      </span>
                    }
                  />
                );
              })}
            </List>
          </div>
        ) : null}
      </VStack>
    </VStack>
  );
}

export function OpsUsersPage({
  tenant,
  userId,
  onOpenUser,
  onBack,
}: OpsUsersPageProps) {
  const [users, setUsers] = useState<OpsTenantUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [localUserId, setLocalUserId] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<
    OpsTenantOnboardedConnector[] | null
  >(null);
  const [connectorsError, setConnectorsError] = useState<string | null>(null);

  const selectedUserId = userId !== undefined ? userId : localUserId;

  useEffect(() => {
    let cancelled = false;
    setUsers(null);
    setError(null);
    void (async () => {
      try {
        const next = await fetchOpsTenantUsers(tenant.tenant_id);
        if (!cancelled) {
          setUsers(next);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load users");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant.tenant_id]);

  useEffect(() => {
    if (!selectedUserId) {
      return;
    }
    let cancelled = false;
    setConnectors(null);
    setConnectorsError(null);
    void (async () => {
      try {
        const next = await fetchOpsTenantConnectors(tenant.tenant_id);
        if (!cancelled) {
          setConnectors(next);
        }
      } catch (err) {
        if (!cancelled) {
          setConnectorsError(
            err instanceof Error ? err.message : "Failed to load connectors",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedUserId, tenant.tenant_id]);

  const selectedUser = useMemo(
    () => users?.find((row) => row.user_id === selectedUserId) ?? null,
    [users, selectedUserId],
  );

  function openUser(id: string) {
    if (onOpenUser) {
      onOpenUser(id);
      return;
    }
    setLocalUserId(id);
  }

  function closeUser() {
    if (onBack) {
      onBack();
      return;
    }
    setLocalUserId(null);
  }

  function handleCreated(user: OpsTenantUser) {
    setUsers((current) => (current ? [...current, user] : [user]));
  }

  function handleRemoved(userIdToDrop: string) {
    setUsers((current) =>
      current ? current.filter((row) => row.user_id !== userIdToDrop) : current,
    );
    closeUser();
  }

  function handleGrantChange(connectorId: string, granted: boolean) {
    if (!selectedUserId) {
      return;
    }
    setUsers(
      (current) =>
        current?.map((row) => {
          if (row.user_id !== selectedUserId) {
            return row;
          }
          return {
            ...row,
            connectors: connectorsAfterGrant(
              row.connectors,
              connectorId,
              granted,
            ),
          };
        }) ?? current,
    );
  }

  const lastAdmin =
    users && selectedUser
      ? isLastTenantAdmin(users, selectedUser.user_id)
      : false;

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={4}>
          {selectedUserId && selectedUser ? (
            <UserDetail
              tenant={tenant}
              user={selectedUser}
              lastAdmin={lastAdmin}
              connectors={connectors}
              connectorsError={connectorsError}
              onBack={closeUser}
              onRemoved={() => handleRemoved(selectedUser.user_id)}
              onGrantChange={handleGrantChange}
            />
          ) : (
            <VStack gap={4}>
              <HStack gap={4} align="start">
                <Button
                  type="button"
                  label="Add user"
                  variant="primary"
                  size="sm"
                  data-testid="ops-add-user"
                  onClick={() => setDialogOpen(true)}
                />
              </HStack>
              {error ? (
                <div data-testid="ops-users-error" role="alert">
                  <Banner
                    status="error"
                    title="Could not load users"
                    description={error}
                  />
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
                  data-testid="ops-users-list"
                >
                  <List hasDividers>
                    {users.map((user) => (
                      <ListItem
                        key={user.user_id}
                        label={user.display_name}
                        description={user.email}
                        data-testid={`ops-user-row-${user.user_id}`}
                        onClick={() => openUser(user.user_id)}
                        startContent={
                          <Avatar name={user.display_name} size="small" />
                        }
                        endContent={
                          <HStack gap={4} align="center">
                            <HStack gap={1} align="center">
                              {user.connectors.map((connectorId) => {
                                const seed = findAdminCatalogEntry(connectorId);
                                return (
                                  <span
                                    key={connectorId}
                                    data-testid={`ops-user-connector-${user.user_id}-${connectorId}`}
                                  >
                                    <LogoTile
                                      label={seed?.label ?? connectorId}
                                    />
                                  </span>
                                );
                              })}
                            </HStack>
                            <Badge
                              variant="neutral"
                              label={ROLE_LABELS[user.role]}
                            />
                            <Text type="supporting" color="secondary">
                              {user.last_active_at
                                ? formatIsoOrDash(user.last_active_at)
                                : "—"}
                            </Text>
                          </HStack>
                        }
                      />
                    ))}
                  </List>
                </div>
              ) : null}
              {users ? (
                <Text
                  type="supporting"
                  color="secondary"
                  data-testid="ops-users-count"
                >
                  {users.length} {users.length === 1 ? "person" : "people"}
                </Text>
              ) : null}
              {selectedUserId && users && !selectedUser ? (
                <div data-testid="ops-user-missing" role="alert">
                  <Banner status="error" title="User not found" />
                </div>
              ) : null}
            </VStack>
          )}
          <AddUserDialog
            tenantId={tenant.tenant_id}
            isOpen={dialogOpen}
            onOpenChange={setDialogOpen}
            onCreated={handleCreated}
          />
        </LayoutContent>
      }
    />
  );
}
