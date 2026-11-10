/**
 * Pure TableSpec v1 parser. Never throws.
 *
 * Bead: lp-a79.10
 * Mirrors chart parse pattern (json | schema | limits | empty).
 */

import {
  TABLE_BADGE_TONES,
  TABLE_COLUMN_ALIGNS,
  TABLE_COLUMN_TYPES,
  TABLE_SPEC_LIMITS,
  type TableBadgeToneV1,
  type TableCellV1,
  type TableColumnAlignV1,
  type TableColumnTypeV1,
  type TableColumnV1,
  type TableOptionsV1,
  type TableRichCellV1,
  type TableRowV1,
  type TableSpecV1,
} from "./types.js";

export type ParseTableSpecOk = { ok: true; spec: TableSpecV1 };
export type ParseTableSpecErr = {
  ok: false;
  /** Short, user-safe message (no stack). */
  error: string;
  code: "json" | "schema" | "limits" | "empty";
};
export type ParseTableSpecResult = ParseTableSpecOk | ParseTableSpecErr;

function err(
  code: ParseTableSpecErr["code"],
  error: string,
): ParseTableSpecErr {
  return { ok: false, code, error };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBadgeTone(value: unknown): value is TableBadgeToneV1 {
  return (
    typeof value === "string" &&
    (TABLE_BADGE_TONES as readonly string[]).includes(value)
  );
}

function isColumnType(value: unknown): value is TableColumnTypeV1 {
  return (
    typeof value === "string" &&
    (TABLE_COLUMN_TYPES as readonly string[]).includes(value)
  );
}

function isColumnAlign(value: unknown): value is TableColumnAlignV1 {
  return (
    typeof value === "string" &&
    (TABLE_COLUMN_ALIGNS as readonly string[]).includes(value)
  );
}

/** Map common severity labels → badge tone; unknown → neutral. */
export function badgeToneFromLabel(label: string): TableBadgeToneV1 {
  const key = label.trim().toLowerCase();
  if (key === "high" || key === "critical" || key === "error" || key === "fail") {
    return "error";
  }
  if (key === "medium" || key === "warn" || key === "warning") {
    return "warning";
  }
  if (key === "low" || key === "ok" || key === "success" || key === "pass") {
    return "success";
  }
  if (key === "info" || key === "informational") {
    return "info";
  }
  return "neutral";
}

/**
 * Reject dangerous URL schemes. External links must be http(s).
 * Vault paths must not use javascript:/data:/etc.
 */
export function isAllowedTableHref(
  href: string,
  target: "auto" | "external" | "vault" = "auto",
): boolean {
  const trimmed = href.trim();
  if (!trimmed) return false;
  if (trimmed.length > TABLE_SPEC_LIMITS.maxHrefChars) return false;

  // Block dangerous schemes everywhere (case-insensitive, with optional whitespace).
  if (/^\s*(javascript|data|vbscript|blob)\s*:/i.test(trimmed)) {
    return false;
  }

  const isHttp = /^https?:\/\//i.test(trimmed);

  if (target === "external") {
    return isHttp;
  }

  if (target === "vault") {
    // Vault stays in-app; reject absolute external schemes (except same-origin handled later).
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !isHttp && !/^file:/i.test(trimmed)) {
      return false;
    }
    // Still reject bare javascript after scheme check above; disallow mailto etc.
    if (/^\s*mailto:/i.test(trimmed)) return false;
    return true;
  }

  // auto: allow http(s) or non-scheme paths (vault-style). Reject other schemes.
  if (isHttp) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    // file: is treated as vault-path input elsewhere; allow for parity with vaultPathFromHref
    return /^file:/i.test(trimmed);
  }
  return true;
}

function parseColumn(
  raw: unknown,
  index: number,
): { ok: true; column: TableColumnV1 } | ParseTableSpecErr {
  if (!isPlainObject(raw)) {
    return err("schema", `columns[${index}] must be an object`);
  }

  if (typeof raw.key !== "string" || raw.key.trim() === "") {
    return err("schema", `columns[${index}].key must be a non-empty string`);
  }
  const key = raw.key.trim();
  if (key.length > TABLE_SPEC_LIMITS.maxKeyChars) {
    return err(
      "limits",
      `columns[${index}].key exceeds ${TABLE_SPEC_LIMITS.maxKeyChars} characters`,
    );
  }

  const column: TableColumnV1 = { key };

  if (raw.header !== undefined) {
    if (typeof raw.header !== "string") {
      return err("schema", `columns[${index}].header must be a string`);
    }
    if (raw.header.length > TABLE_SPEC_LIMITS.maxHeaderOrLabelChars) {
      return err(
        "limits",
        `columns[${index}].header exceeds ${TABLE_SPEC_LIMITS.maxHeaderOrLabelChars} characters`,
      );
    }
    column.header = raw.header;
  }

  if (raw.type !== undefined) {
    if (!isColumnType(raw.type)) {
      return err(
        "schema",
        `columns[${index}].type must be one of text|number|badge|link`,
      );
    }
    column.type = raw.type;
  }

  if (raw.align !== undefined) {
    if (!isColumnAlign(raw.align)) {
      return err(
        "schema",
        `columns[${index}].align must be one of start|center|end`,
      );
    }
    column.align = raw.align;
  }

  if (raw.widthWeight !== undefined) {
    if (!isFiniteNumber(raw.widthWeight) || raw.widthWeight <= 0) {
      return err(
        "schema",
        `columns[${index}].widthWeight must be a positive number`,
      );
    }
    column.widthWeight = raw.widthWeight;
  }

  if (raw.sortable !== undefined) {
    if (typeof raw.sortable !== "boolean") {
      return err("schema", `columns[${index}].sortable must be a boolean`);
    }
    column.sortable = raw.sortable;
  }

  return { ok: true, column };
}

function parseRichCell(
  raw: Record<string, unknown>,
  path: string,
): { ok: true; cell: TableRichCellV1 } | ParseTableSpecErr {
  const kind = raw.kind;
  if (kind === "text") {
    if (typeof raw.value !== "string") {
      return err("schema", `${path}: text cell value must be a string`);
    }
    if (raw.value.length > TABLE_SPEC_LIMITS.maxHeaderOrLabelChars) {
      return err(
        "limits",
        `${path}: text value exceeds ${TABLE_SPEC_LIMITS.maxHeaderOrLabelChars} characters`,
      );
    }
    return { ok: true, cell: { kind: "text", value: raw.value } };
  }

  if (kind === "number") {
    if (!isFiniteNumber(raw.value)) {
      return err("schema", `${path}: number cell value must be a finite number`);
    }
    const cell: TableRichCellV1 = { kind: "number", value: raw.value };
    if (raw.format !== undefined) {
      if (
        raw.format !== "plain" &&
        raw.format !== "compact" &&
        raw.format !== "percent"
      ) {
        return err(
          "schema",
          `${path}: number format must be plain|compact|percent`,
        );
      }
      cell.format = raw.format;
    }
    return { ok: true, cell };
  }

  if (kind === "badge") {
    if (typeof raw.label !== "string") {
      return err("schema", `${path}: badge label must be a string`);
    }
    if (raw.label.length > TABLE_SPEC_LIMITS.maxHeaderOrLabelChars) {
      return err(
        "limits",
        `${path}: badge label exceeds ${TABLE_SPEC_LIMITS.maxHeaderOrLabelChars} characters`,
      );
    }
    let tone: TableBadgeToneV1 | undefined;
    if (raw.tone !== undefined) {
      tone = isBadgeTone(raw.tone) ? raw.tone : "neutral";
    }
    return {
      ok: true,
      cell: tone
        ? { kind: "badge", label: raw.label, tone }
        : { kind: "badge", label: raw.label },
    };
  }

  if (kind === "link") {
    if (typeof raw.label !== "string") {
      return err("schema", `${path}: link label must be a string`);
    }
    if (raw.label.length > TABLE_SPEC_LIMITS.maxHeaderOrLabelChars) {
      return err(
        "limits",
        `${path}: link label exceeds ${TABLE_SPEC_LIMITS.maxHeaderOrLabelChars} characters`,
      );
    }
    if (typeof raw.href !== "string") {
      return err("schema", `${path}: link href must be a string`);
    }
    if (raw.href.length > TABLE_SPEC_LIMITS.maxHrefChars) {
      return err(
        "limits",
        `${path}: link href exceeds ${TABLE_SPEC_LIMITS.maxHrefChars} characters`,
      );
    }

    let target: "auto" | "external" | "vault" = "auto";
    if (raw.target !== undefined) {
      if (
        raw.target !== "auto" &&
        raw.target !== "external" &&
        raw.target !== "vault"
      ) {
        return err(
          "schema",
          `${path}: link target must be auto|external|vault`,
        );
      }
      target = raw.target;
    }

    if (!isAllowedTableHref(raw.href, target)) {
      return err(
        "schema",
        `${path}: link href is not allowed (use http(s) or vault path; javascript/data rejected)`,
      );
    }

    const cell: TableRichCellV1 = {
      kind: "link",
      label: raw.label,
      href: raw.href,
    };
    if (raw.target !== undefined) cell.target = target;
    if (raw.openInNewTab !== undefined) {
      if (typeof raw.openInNewTab !== "boolean") {
        return err("schema", `${path}: openInNewTab must be a boolean`);
      }
      cell.openInNewTab = raw.openInNewTab;
    }
    return { ok: true, cell };
  }

  return err(
    "schema",
    `${path}: rich cell kind must be text|number|badge|link`,
  );
}

/**
 * Normalize optional scalar → rich for typed columns (badge/link convenience).
 * Other scalars stay as-is for the render layer.
 */
function normalizeCell(
  cell: TableCellV1,
  columnType: TableColumnTypeV1 | undefined,
): TableCellV1 {
  if (cell === null || typeof cell === "object") {
    return cell;
  }

  if (columnType === "badge" && typeof cell === "string") {
    return {
      kind: "badge",
      label: cell,
      tone: badgeToneFromLabel(cell),
    };
  }

  if (columnType === "link" && typeof cell === "string") {
    return {
      kind: "link",
      label: cell,
      href: cell,
      target: "auto",
    };
  }

  if (columnType === "number" && typeof cell === "number") {
    return { kind: "number", value: cell };
  }

  if (columnType === "text" && typeof cell === "string") {
    return { kind: "text", value: cell };
  }

  return cell;
}

function parseCell(
  raw: unknown,
  path: string,
  columnType: TableColumnTypeV1 | undefined,
): { ok: true; cell: TableCellV1 } | ParseTableSpecErr {
  if (
    raw === null ||
    typeof raw === "string" ||
    typeof raw === "number" ||
    typeof raw === "boolean"
  ) {
    if (typeof raw === "string") {
      if (raw.length > TABLE_SPEC_LIMITS.maxHeaderOrLabelChars) {
        return err(
          "limits",
          `${path}: string exceeds ${TABLE_SPEC_LIMITS.maxHeaderOrLabelChars} characters`,
        );
      }
      // Scalar string used as link href when column is link — enforce scheme rules.
      if (columnType === "link" && !isAllowedTableHref(raw, "auto")) {
        return err(
          "schema",
          `${path}: link href is not allowed (javascript/data rejected)`,
        );
      }
    }
    if (typeof raw === "number" && !Number.isFinite(raw)) {
      return err("schema", `${path}: number must be finite`);
    }
    return { ok: true, cell: normalizeCell(raw, columnType) };
  }

  if (!isPlainObject(raw)) {
    return err("schema", `${path}: cell must be a scalar or rich object`);
  }

  if (typeof raw.kind !== "string") {
    return err("schema", `${path}: rich cell requires kind`);
  }

  const rich = parseRichCell(raw, path);
  if (!rich.ok) return rich;
  return { ok: true, cell: rich.cell };
}

function parseOptions(
  raw: unknown,
): { ok: true; options: TableOptionsV1 } | ParseTableSpecErr {
  if (!isPlainObject(raw)) {
    return err("schema", "options must be an object");
  }

  const options: TableOptionsV1 = {};

  if (raw.density !== undefined) {
    if (
      raw.density !== "compact" &&
      raw.density !== "balanced" &&
      raw.density !== "spacious"
    ) {
      return err("schema", "options.density must be compact|balanced|spacious");
    }
    options.density = raw.density;
  }

  if (raw.dividers !== undefined) {
    if (
      raw.dividers !== "rows" &&
      raw.dividers !== "columns" &&
      raw.dividers !== "grid" &&
      raw.dividers !== "none"
    ) {
      return err(
        "schema",
        "options.dividers must be rows|columns|grid|none",
      );
    }
    options.dividers = raw.dividers;
  }

  if (raw.isStriped !== undefined) {
    if (typeof raw.isStriped !== "boolean") {
      return err("schema", "options.isStriped must be a boolean");
    }
    options.isStriped = raw.isStriped;
  }

  if (raw.hasHover !== undefined) {
    if (typeof raw.hasHover !== "boolean") {
      return err("schema", "options.hasHover must be a boolean");
    }
    options.hasHover = raw.hasHover;
  }

  if (raw.maxRows !== undefined) {
    if (
      !isFiniteNumber(raw.maxRows) ||
      !Number.isInteger(raw.maxRows) ||
      raw.maxRows < 1
    ) {
      return err("schema", "options.maxRows must be a positive integer");
    }
    if (raw.maxRows > TABLE_SPEC_LIMITS.maxOptionsMaxRows) {
      return err(
        "limits",
        `options.maxRows exceeds hard max ${TABLE_SPEC_LIMITS.maxOptionsMaxRows}`,
      );
    }
    options.maxRows = raw.maxRows;
  }

  return { ok: true, options };
}

/**
 * Parse agent-emitted TableSpec JSON. Pure and safe for unit tests.
 * Never throws.
 */
export function parseTableSpec(input: string): ParseTableSpecResult {
  try {
    if (typeof input !== "string") {
      return err("empty", "Table spec is empty");
    }
    const trimmed = input.trim();
    if (!trimmed) {
      return err("empty", "Table spec is empty");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return err("json", "Invalid JSON");
    }

    if (!isPlainObject(parsed)) {
      return err("schema", "Table spec must be a JSON object");
    }

    if (parsed.version !== 1) {
      return err("schema", "version must be 1");
    }

    if (!Array.isArray(parsed.columns)) {
      return err("schema", "columns must be an array");
    }

    if (parsed.columns.length < TABLE_SPEC_LIMITS.minColumns) {
      return err("schema", "columns must include at least one column");
    }

    if (parsed.columns.length > TABLE_SPEC_LIMITS.maxColumns) {
      return err(
        "limits",
        `columns exceeds max of ${TABLE_SPEC_LIMITS.maxColumns}`,
      );
    }

    const columns: TableColumnV1[] = [];
    const seenKeys = new Set<string>();
    for (let i = 0; i < parsed.columns.length; i++) {
      const colResult = parseColumn(parsed.columns[i], i);
      if (!colResult.ok) return colResult;
      if (seenKeys.has(colResult.column.key)) {
        return err(
          "schema",
          `duplicate column key "${colResult.column.key}"`,
        );
      }
      seenKeys.add(colResult.column.key);
      columns.push(colResult.column);
    }

    if (!Array.isArray(parsed.rows)) {
      return err("schema", "rows must be an array");
    }

    if (parsed.rows.length > TABLE_SPEC_LIMITS.maxRows) {
      return err(
        "limits",
        `rows exceeds max of ${TABLE_SPEC_LIMITS.maxRows}`,
      );
    }

    const columnByKey = new Map(columns.map((c) => [c.key, c]));
    const rows: TableRowV1[] = [];

    for (let r = 0; r < parsed.rows.length; r++) {
      const rawRow = parsed.rows[r];
      if (!isPlainObject(rawRow)) {
        return err("schema", `rows[${r}] must be an object`);
      }
      const row: TableRowV1 = {};
      for (const [key, value] of Object.entries(rawRow)) {
        if (key.length > TABLE_SPEC_LIMITS.maxKeyChars) {
          return err(
            "limits",
            `rows[${r}] key exceeds ${TABLE_SPEC_LIMITS.maxKeyChars} characters`,
          );
        }
        const col = columnByKey.get(key);
        const cellResult = parseCell(
          value,
          `rows[${r}].${key}`,
          col?.type,
        );
        if (!cellResult.ok) return cellResult;
        row[key] = cellResult.cell;
      }
      rows.push(row);
    }

    const spec: TableSpecV1 = {
      version: 1,
      columns: columns as [TableColumnV1, ...TableColumnV1[]],
      rows,
    };

    if (parsed.title !== undefined) {
      if (typeof parsed.title !== "string") {
        return err("schema", "title must be a string");
      }
      if (parsed.title.length > TABLE_SPEC_LIMITS.maxTitleChars) {
        return err(
          "limits",
          `title exceeds ${TABLE_SPEC_LIMITS.maxTitleChars} characters`,
        );
      }
      spec.title = parsed.title;
    }

    if (parsed.description !== undefined) {
      if (typeof parsed.description !== "string") {
        return err("schema", "description must be a string");
      }
      if (parsed.description.length > TABLE_SPEC_LIMITS.maxDescriptionChars) {
        return err(
          "limits",
          `description exceeds ${TABLE_SPEC_LIMITS.maxDescriptionChars} characters`,
        );
      }
      spec.description = parsed.description;
    }

    if (parsed.options !== undefined) {
      const optResult = parseOptions(parsed.options);
      if (!optResult.ok) return optResult;
      spec.options = optResult.options;
    }

    return { ok: true, spec };
  } catch {
    // Defensive: public API must never throw.
    return err("schema", "Unexpected parse failure");
  }
}
