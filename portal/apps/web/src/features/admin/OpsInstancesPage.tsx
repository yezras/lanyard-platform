import { useEffect, useMemo, useState } from "react";

import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Table } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import {
  fetchOpsTenantInstances,
  type OpsGatewayInstance,
  type OpsTenantSummary,
} from "../../api/opsAdmin.js";
import { formatIsoOrDash } from "./opsAdminView.js";

type Row = OpsGatewayInstance;

type OpsInstancesPageProps = {
  tenant: OpsTenantSummary;
};

export function OpsInstancesPage({ tenant }: OpsInstancesPageProps) {
  const [instances, setInstances] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInstances(null);
    setError(null);
    void (async () => {
      try {
        const next = await fetchOpsTenantInstances(tenant.tenant_id);
        if (!cancelled) {
          setInstances(next);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load instances",
          );
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
        key: "instance_id",
        header: "Instance",
        renderCell: (row) => (
          <Text type="body" data-testid={`ops-instance-${row.instance_id}`}>
            {row.instance_id}
          </Text>
        ),
      },
      {
        key: "runtime_kind",
        header: "Runtime",
        renderCell: (row) => <Text type="body">{row.runtime_kind || "—"}</Text>,
      },
      {
        key: "presence",
        header: "Presence",
        renderCell: (row) => <Text type="body">{row.presence || "—"}</Text>,
      },
      {
        key: "health_status",
        header: "Health",
        renderCell: (row) => (
          <Text type="supporting" color="secondary">
            {row.health_status || "—"}
          </Text>
        ),
      },
      {
        key: "last_activity_at",
        header: "Last activity",
        renderCell: (row) => (
          <Text type="supporting" color="secondary">
            {formatIsoOrDash(row.last_activity_at)}
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
              Gateway instances
            </Text>
            {error ? (
              <Banner
                status="error"
                title={error}
                container="section"
                data-testid="ops-instances-fetch-error"
              />
            ) : null}
            {instances && instances.length === 0 ? (
              <EmptyState
                title="No instances"
                description={`No gateway instance is registered for ${tenant.display_name}.`}
                data-testid="ops-instances-empty"
              />
            ) : null}
            {instances && instances.length > 0 ? (
              <div data-testid="ops-instances-table">
                <Table
                  data={instances}
                  columns={columns}
                  idKey="instance_id"
                  density="balanced"
                  aria-label="Gateway instances"
                />
              </div>
            ) : null}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
