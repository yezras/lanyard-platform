import { useEffect, useMemo, useState } from "react";

import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Table } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import {
  fetchOpsTenantAudit,
  type OpsAuditEntry,
  type OpsTenantSummary,
} from "../../api/opsAdmin.js";
import { formatIsoOrDash } from "./opsAdminView.js";

type Row = OpsAuditEntry;

type OpsAuditPageProps = {
  tenant: OpsTenantSummary;
};

export function OpsAuditPage({ tenant }: OpsAuditPageProps) {
  const [entries, setEntries] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    void (async () => {
      try {
        const next = await fetchOpsTenantAudit(tenant.tenant_id);
        if (!cancelled) {
          setEntries(next);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load audit");
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
        key: "created_at",
        header: "Time",
        renderCell: (row) => (
          <Text type="supporting" color="secondary">
            {formatIsoOrDash(row.created_at)}
          </Text>
        ),
      },
      {
        key: "action",
        header: "Action",
        renderCell: (row) => (
          <Text type="body" data-testid={`ops-audit-${row.audit_id}`}>
            {row.action}
          </Text>
        ),
      },
      {
        key: "actor",
        header: "Actor",
        renderCell: (row) => <Text type="body">{row.actor ?? "—"}</Text>,
      },
      {
        key: "result",
        header: "Result",
        renderCell: (row) => (
          <Text type="supporting" color="secondary">
            {row.result || "—"}
          </Text>
        ),
      },
      {
        key: "instance_id",
        header: "Instance",
        renderCell: (row) => (
          <Text type="supporting" color="secondary">
            {row.instance_id ?? "—"}
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
              Audit log
            </Text>
            {error ? (
              <div data-testid="ops-audit-load-error" role="alert">
                <Banner status="error" title={error} container="section" />
              </div>
            ) : null}
            {entries && entries.length === 0 ? (
              <EmptyState title="No audit entries" data-testid="ops-audit-empty" />
            ) : null}
            {entries && entries.length > 0 ? (
              <div data-testid="ops-audit-table">
                <Table
                  data={entries}
                  columns={columns}
                  idKey="audit_id"
                  density="balanced"
                  aria-label="Tenant audit log"
                />
              </div>
            ) : null}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
