import { useEffect, useMemo, useState } from "react";

import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Table } from "@astryxdesign/core/Table";
import {
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import {
  fetchOpsConnectorCatalog,
  type OpsConnectorCatalog,
} from "../../api/opsConnectors.js";
import {
  fetchOpsTenants,
  type OpsTenantSummary,
} from "../../api/opsAdmin.js";

type Row = OpsTenantSummary & { connected: number | null };

type OpsTenantsPageProps = {
  selectedTenantId?: string | null;
  onSelectTenant?: (tenant: OpsTenantSummary) => void;
};

export function OpsTenantsPage({
  selectedTenantId = null,
  onSelectTenant,
}: OpsTenantsPageProps) {
  const [tenants, setTenants] = useState<OpsTenantSummary[] | null>(null);
  const [catalog, setCatalog] = useState<OpsConnectorCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchOpsTenants();
        if (!cancelled) {
          setTenants(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load tenants");
        }
      }
    })();
    void (async () => {
      try {
        const next = await fetchOpsConnectorCatalog();
        if (!cancelled) {
          setCatalog(next);
        }
      } catch {
        // Connected counts stay "—" when the catalog is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo<Row[]>(
    () =>
      (tenants ?? []).map((tenant) => {
        const entry = catalog?.tenants.find(
          (row) => row.tenant_id === tenant.tenant_id,
        );
        const connected =
          entry?.connectors
            .filter((connector) => connector.enabled)
            .reduce((sum, connector) => sum + connector.status_counts.connected, 0) ??
          null;
        return { ...tenant, connected };
      }),
    [tenants, catalog],
  );

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={4}>
          <VStack gap={4}>
            <Text type="body" weight="semibold">
              Tenants
            </Text>
            {error ? (
              <Banner
                status="error"
                title={error}
                container="section"
                data-testid="ops-tenants-error"
              />
            ) : null}
            {tenants && tenants.length === 0 ? (
              <EmptyState title="No tenants" data-testid="ops-tenants-empty" />
            ) : null}
            {rows.length > 0 ? (
              <div data-testid="ops-tenants-table">
                <Table aria-label="Tenants" density="balanced" hasHover>
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell>Tenant</TableHeaderCell>
                      <TableHeaderCell>Tenant ID</TableHeaderCell>
                      <TableHeaderCell>Connectors</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.tenant_id}
                        data-testid={`ops-tenant-row-${row.tenant_slug}`}
                        onClick={
                          onSelectTenant
                            ? () =>
                                onSelectTenant({
                                  tenant_id: row.tenant_id,
                                  tenant_slug: row.tenant_slug,
                                  display_name: row.display_name,
                                })
                            : undefined
                        }
                        style={
                          onSelectTenant
                            ? {
                                cursor: "pointer",
                                ...(selectedTenantId === row.tenant_id
                                  ? {
                                      background:
                                        "var(--color-background-muted)",
                                    }
                                  : {}),
                              }
                            : undefined
                        }
                      >
                        <TableCell>
                          <VStack gap={0}>
                            <Text type="body">{row.display_name}</Text>
                            <Text type="supporting" color="secondary">
                              {row.tenant_slug}
                            </Text>
                          </VStack>
                        </TableCell>
                        <TableCell>
                          <Text
                            type="supporting"
                            data-testid={`ops-tenant-id-${row.tenant_slug}`}
                          >
                            {row.tenant_id}
                          </Text>
                        </TableCell>
                        <TableCell>
                          <Text
                            type="supporting"
                            data-testid={`ops-tenant-connected-${row.tenant_slug}`}
                          >
                            {row.connected === null
                              ? "—"
                              : `${row.connected} connected`}
                          </Text>
                        </TableCell>
                        <TableCell>
                          <span
                            style={{ color: "var(--color-text-green)" }}
                            data-testid={`ops-tenant-status-${row.tenant_slug}`}
                          >
                            Active
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
            {tenants ? (
              <Text type="supporting" color="secondary" data-testid="ops-tenants-count">
                {tenants.length} tenant{tenants.length === 1 ? "" : "s"}
              </Text>
            ) : null}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
