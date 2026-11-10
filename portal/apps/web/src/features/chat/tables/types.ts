/**
 * TableSpec v1 — agent-facing JSON schema for ```table fences.
 *
 * Bead: lp-a79.10
 * Plan: docs/plans/0009-portal-chat-charts/overview.md § TableSpec v1
 *
 * Pure types only (no React). Portal maps these to Astryx Table cells.
 */

export type TableSpecVersion = 1;

/** Column role for default formatting when cells are scalars. */
export type TableColumnTypeV1 =
  | "text"
  | "number"
  | "badge" // categorical → Astryx Badge
  | "link"; // link object or string URL/path

export type TableColumnAlignV1 = "start" | "center" | "end";

export type TableColumnV1 = {
  key: string;
  header?: string;
  type?: TableColumnTypeV1; // default "text"
  align?: TableColumnAlignV1;
  /** Relative width weight; maps to proportional(n). Default 1. */
  widthWeight?: number;
  /** v1 optional; wire useTableSortable only if true on any col */
  sortable?: boolean;
};

/** Scalar cell — type inferred from column.type */
export type TableScalarCellV1 = string | number | boolean | null;

export type TableBadgeToneV1 =
  | "neutral"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "accent";

/**
 * Explicit rich cell. Prefer this for badges and links so agents
 * do not rely on column-level type alone when a row mixes kinds.
 */
export type TableRichCellV1 =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number; format?: "plain" | "compact" | "percent" }
  | {
      kind: "badge";
      /** Display label */
      label: string;
      /**
       * Maps to Astryx Badge variant when possible.
       * Unknown → default/neutral badge (parser normalizes).
       */
      tone?: TableBadgeToneV1;
    }
  | {
      kind: "link";
      label: string;
      /**
       * - external: https? URL → open new tab (rel=noopener)
       * - vault: vault-relative or absolute vault path → onVaultPath click
       */
      href: string;
      target?: "auto" | "external" | "vault";
      /**
       * external only: default true → target=_blank
       * vault always stays in-app
       */
      openInNewTab?: boolean;
    };

export type TableCellV1 = TableScalarCellV1 | TableRichCellV1;

export type TableRowV1 = Record<string, TableCellV1>;

export type TableOptionsV1 = {
  density?: "compact" | "balanced" | "spacious"; // default compact in chat
  dividers?: "rows" | "columns" | "grid" | "none"; // default rows
  isStriped?: boolean;
  hasHover?: boolean; // default true
  /** Max body rows before truncate note. Default 50, hard max 100. */
  maxRows?: number;
};

export type TableSpecV1 = {
  version: TableSpecVersion; // 1
  title?: string;
  description?: string;
  columns: [TableColumnV1, ...TableColumnV1[]]; // 1…12
  rows: TableRowV1[]; // 0…100 (empty table allowed with headers)
  options?: TableOptionsV1;
};

/** Hard limits from plan overview. */
export const TABLE_SPEC_LIMITS = {
  maxColumns: 12,
  minColumns: 1,
  maxRows: 100,
  maxHeaderOrLabelChars: 120,
  maxTitleChars: 120,
  maxDescriptionChars: 280,
  maxKeyChars: 64,
  maxHrefChars: 2048,
  maxOptionsMaxRows: 100,
  defaultOptionsMaxRows: 50,
} as const;

export const TABLE_COLUMN_TYPES: readonly TableColumnTypeV1[] = [
  "text",
  "number",
  "badge",
  "link",
] as const;

export const TABLE_COLUMN_ALIGNS: readonly TableColumnAlignV1[] = [
  "start",
  "center",
  "end",
] as const;

export const TABLE_BADGE_TONES: readonly TableBadgeToneV1[] = [
  "neutral",
  "success",
  "warning",
  "error",
  "info",
  "accent",
] as const;
