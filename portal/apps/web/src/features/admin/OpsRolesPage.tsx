import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Table } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import {
  fetchOpsTenantRoles,
  type OpsRole,
  type OpsTenantSummary,
} from "../../api/opsAdmin.js";
import { formatIsoOrDash } from "./opsAdminView.js";

type Row = OpsRole;

type OpsRolesPageProps = {
  tenant: OpsTenantSummary;
};

export function OpsRolesPage({ tenant }: OpsRolesPageProps) {
  const [roles, setRoles] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRoles(null);
    setError(null);
    void (async () => {
      try {
        const next = await fetchOpsTenantRoles(tenant.tenant_id);
        if (!cancelled) {
          setRoles(next);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load roles");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant.tenant_id]);

  const columns = useMemo<TableColumn<Row>[]>(
    () => [
      {
        key: "name",
        header: "Role",
        renderCell: (row) => (
          <Text type="body" data-testid={`ops-role-${row.role_id}`}>
            {row.name}
          </Text>
        ),
      },
      {
        key: "hermes_profile",
        header: "Profile",
        renderCell: (row) => (
          <Text type="body">{row.hermes_profile || "—"}</Text>
        ),
      },
      {
        key: "path_prefixes",
        header: "Path prefixes",
        renderCell: (row) => (
          <Text type="supporting" color="secondary">
            {row.path_prefixes.length > 0
              ? row.path_prefixes.join(", ")
              : "—"}
          </Text>
        ),
      },
      {
        key: "created_at",
        header: "Created",
        renderCell: (row) => (
          <Text type="supporting" color="secondary">
            {formatIsoOrDash(row.created_at)}
          </Text>
        ),
      },
    ],
    [],
  );

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={4}>
          <VStack gap={4}>
            <Text type="body" weight="semibold">
              Roles
            </Text>
            {error ? (
              <Text
                type="body"
                color="secondary"
                role="alert"
                data-testid="ops-roles-load-error"
              >
                {error}
              </Text>
            ) : null}
            {roles && roles.length === 0 ? (
              <EmptyState
                title="No roles"
                description={`No RBAC roles exist for ${tenant.display_name} yet.`}
              />
            ) : null}
            {roles && roles.length > 0 ? (
              <div data-testid="ops-roles-table">
                <Table
                  data={roles}
                  columns={columns}
                  idKey="role_id"
                  density="balanced"
                  aria-label="Tenant roles"
                />
              </div>
            ) : null}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
