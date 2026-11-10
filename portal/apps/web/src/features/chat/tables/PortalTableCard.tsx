/**
 * PortalTableCard — render TableSpecV1 via Astryx Table.
 *
 * Bead: lp-a79.11
 * Plan: docs/plans/0009-portal-chat-charts/overview.md § TableSpec v1
 *
 * No Markdown involvement here — fence wire-up is lp-a79.12.
 */

import { useMemo, type CSSProperties, type ReactNode } from "react";

import {
  Table,
  proportional,
  type TableColumn,
  type TableDensity,
  type TableDividers,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import { renderTableCell } from "./renderTableCell.js";
import {
  TABLE_SPEC_LIMITS,
  type TableCellV1,
  type TableSpecV1,
} from "./types.js";

export type PortalTableCardProps = {
  spec: TableSpecV1;
  /** Join relative vault links against this project root when set. */
  projectVaultPath?: string | null;
  /** Called for vault link clicks; must open document pane / vault, not navigate. */
  onVaultPath?: (path: string) => void;
};

/** Row shape for Astryx Table (requires Record<string, unknown>). */
export type PortalTableRow = Record<string, unknown> & {
  /** Injected stable row key for Table idKey. */
  __portalRowId: string;
  /** Original cell map (column keys → TableCellV1). */
  __cells: Record<string, TableCellV1>;
};

const cardStyle: CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
};

const overflowStyle: CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  overflowX: "auto",
};

function truncateNote(shown: number, total: number): string {
  return `Showing ${shown} of ${total} rows`;
}

/**
 * Build Astryx columns from TableSpec columns with proportional widths
 * and renderCell for rich kinds (badge / link / text / number).
 */
export function buildPortalTableColumns(
  spec: TableSpecV1,
  ctx: {
    projectVaultPath?: string | null;
    onVaultPath?: (path: string) => void;
  },
): TableColumn<PortalTableRow>[] {
  return spec.columns.map((col) => {
    const weight =
      typeof col.widthWeight === "number" && col.widthWeight > 0
        ? col.widthWeight
        : 1;

    return {
      key: col.key,
      header: col.header ?? col.key,
      align: col.align,
      width: proportional(weight),
      // Sortable wiring is optional v1; leave false unless any col requests it later.
      sortable: col.sortable === true ? true : undefined,
      renderCell: (row) => {
        const cell = row.__cells[col.key];
        return renderTableCell(cell, {
          columnType: col.type,
          projectVaultPath: ctx.projectVaultPath,
          onVaultPath: ctx.onVaultPath,
        });
      },
    } satisfies TableColumn<PortalTableRow>;
  });
}

/**
 * Inject stable row ids and pack cells for renderCell lookup.
 * Prefer an existing scalar `id` cell when unique; otherwise row-N.
 */
export function injectPortalTableRows(
  rows: TableSpecV1["rows"],
  maxRows: number,
): { data: PortalTableRow[]; truncated: boolean; total: number } {
  const total = rows.length;
  const slice = rows.slice(0, Math.max(0, maxRows));
  const seen = new Set<string>();

  const data: PortalTableRow[] = slice.map((row, index) => {
    const cells: Record<string, TableCellV1> = { ...row };
    let rowId: string | null = null;
    const idCell = row.id;
    if (typeof idCell === "string" && idCell.trim()) {
      rowId = idCell.trim();
    } else if (typeof idCell === "number" && Number.isFinite(idCell)) {
      rowId = String(idCell);
    }
    if (!rowId || seen.has(rowId)) {
      rowId = `row-${index}`;
    }
    seen.add(rowId);

    return {
      __portalRowId: rowId,
      __cells: cells,
      // Expose scalar string values for default accessors / a11y dumps.
      ...Object.fromEntries(
        Object.entries(cells).map(([k, v]) => {
          if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
            return [k, v];
          }
          if (typeof v === "object" && v !== null && "kind" in v) {
            if (v.kind === "text") return [k, v.value];
            if (v.kind === "number") return [k, v.value];
            if (v.kind === "badge") return [k, v.label];
            if (v.kind === "link") return [k, v.label];
          }
          return [k, null];
        }),
      ),
    };
  });

  return {
    data,
    truncated: total > slice.length,
    total,
  };
}

/**
 * Render a parsed TableSpec as an Astryx Table card (title, description, body).
 * Density defaults to compact for chat.
 */
export function PortalTableCard({
  spec,
  projectVaultPath,
  onVaultPath,
}: PortalTableCardProps): ReactNode {
  const options = spec.options;
  const density: TableDensity = options?.density ?? "compact";
  const dividers: TableDividers = options?.dividers ?? "rows";
  const isStriped = options?.isStriped ?? false;
  const hasHover = options?.hasHover ?? true;
  const maxRows = Math.min(
    options?.maxRows ?? TABLE_SPEC_LIMITS.defaultOptionsMaxRows,
    TABLE_SPEC_LIMITS.maxOptionsMaxRows,
  );

  const { data, truncated, total } = useMemo(
    () => injectPortalTableRows(spec.rows, maxRows),
    [spec.rows, maxRows],
  );

  const columns = useMemo(
    () =>
      buildPortalTableColumns(spec, {
        projectVaultPath,
        onVaultPath,
      }),
    [spec, projectVaultPath, onVaultPath],
  );

  const ariaLabel = spec.title?.trim() || "Table";

  return (
    <div
      style={cardStyle}
      data-testid="portal-table-card"
      data-table-density={density}
    >
      <VStack gap={2}>
        {spec.title ? (
          <Text type="heading" size="sm" data-testid="portal-table-title">
            {spec.title}
          </Text>
        ) : null}
        {spec.description ? (
          <Text
            type="body"
            color="secondary"
            data-testid="portal-table-description"
          >
            {spec.description}
          </Text>
        ) : null}
        <div style={overflowStyle} data-testid="portal-table-scroll">
          <Table
            data={data}
            columns={columns}
            idKey="__portalRowId"
            density={density}
            dividers={dividers}
            isStriped={isStriped}
            hasHover={hasHover}
            aria-label={ariaLabel}
          />
        </div>
        {truncated ? (
          <Text
            type="body"
            color="secondary"
            size="sm"
            data-testid="portal-table-truncate-note"
          >
            {truncateNote(data.length, total)}
          </Text>
        ) : null}
      </VStack>
    </div>
  );
}
