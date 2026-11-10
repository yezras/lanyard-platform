import type {
  ChartDataRow,
  ChartOptionsV1,
  ChartSeriesV1,
  ChartSpecCartesianV1,
  ChartSpecPieV1,
  ChartSpecV1,
  ChartTypeV1,
} from "./types.js";

export type ParseChartSpecOk = { ok: true; spec: ChartSpecV1 };
export type ParseChartSpecErr = {
  ok: false;
  error: string;
  code: "json" | "schema" | "limits" | "empty";
};
export type ParseChartSpecResult = ParseChartSpecOk | ParseChartSpecErr;

const MAX_ROWS = 64;
const MIN_ROWS = 1;
const MAX_SERIES = 8;
const MIN_SERIES = 1;
const MAX_KEY_LEN = 64;
const MAX_TITLE_LEN = 120;
const MAX_DESCRIPTION_LEN = 280;
const HEIGHT_MIN = 160;
const HEIGHT_MAX = 480;
const HEIGHT_DEFAULT = 280;

const CARTESIAN_TYPES = new Set<ChartTypeV1>(["bar", "line", "area"]);
const ALL_TYPES = new Set<ChartTypeV1>(["bar", "line", "area", "pie"]);

/** #rgb | #rrggbb | #rrggbbaa only — no url(), css vars, or named colors. */
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function err(
  code: ParseChartSpecErr["code"],
  error: string,
): ParseChartSpecErr {
  return { ok: false, code, error };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value);
}

function clampHeight(height: number): number {
  if (!Number.isFinite(height)) return HEIGHT_DEFAULT;
  return Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, Math.round(height)));
}

function validateBoundedString(
  value: unknown,
  field: string,
  maxLen: number,
  required: boolean,
): string | undefined | ParseChartSpecErr {
  if (value === undefined || value === null) {
    if (required) return err("schema", `Missing ${field}`);
    return undefined;
  }
  if (typeof value !== "string") {
    return err("schema", `${field} must be a string`);
  }
  if (value.length === 0 && required) {
    return err("schema", `${field} must be a non-empty string`);
  }
  if (value.length > maxLen) {
    return err("limits", `${field} exceeds max length ${maxLen}`);
  }
  return value;
}

function parseDataRows(raw: unknown): ChartDataRow[] | ParseChartSpecErr {
  if (!Array.isArray(raw)) {
    return err("schema", "data must be an array");
  }
  if (raw.length < MIN_ROWS) {
    return err("limits", `data must have at least ${MIN_ROWS} row(s)`);
  }
  if (raw.length > MAX_ROWS) {
    return err("limits", `data exceeds max of ${MAX_ROWS} rows`);
  }

  const rows: ChartDataRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!isPlainObject(row)) {
      return err("schema", `data[${i}] must be a plain object`);
    }
    const out: ChartDataRow = {};
    for (const [k, v] of Object.entries(row)) {
      if (k.length === 0 || k.length > MAX_KEY_LEN) {
        return err("limits", `data row key length must be 1–${MAX_KEY_LEN}`);
      }
      if (v === null) {
        out[k] = null;
        continue;
      }
      if (typeof v === "string") {
        if (v.length > MAX_KEY_LEN) {
          // cell string values: use same practical cap as keys for agent noise
          return err(
            "limits",
            `data[${i}].${k} string exceeds max length ${MAX_KEY_LEN}`,
          );
        }
        out[k] = v;
        continue;
      }
      if (typeof v === "number") {
        if (!Number.isFinite(v)) {
          return err("schema", `data[${i}].${k} must be a finite number`);
        }
        out[k] = v;
        continue;
      }
      return err(
        "schema",
        `data[${i}].${k} must be string, number, or null (nested values rejected)`,
      );
    }
    rows.push(out);
  }
  return rows;
}

function keyPresentOnSomeRow(rows: ChartDataRow[], key: string): boolean {
  return rows.some((row) => Object.prototype.hasOwnProperty.call(row, key));
}

function parseSeries(
  raw: unknown,
): [ChartSeriesV1, ...ChartSeriesV1[]] | ParseChartSpecErr {
  if (!Array.isArray(raw)) {
    return err("schema", "series must be an array");
  }
  if (raw.length < MIN_SERIES) {
    return err("limits", `series must have at least ${MIN_SERIES} series`);
  }
  if (raw.length > MAX_SERIES) {
    return err("limits", `series exceeds max of ${MAX_SERIES}`);
  }

  const series: ChartSeriesV1[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!isPlainObject(item)) {
      return err("schema", `series[${i}] must be an object`);
    }
    const keyResult = validateBoundedString(item.key, `series[${i}].key`, MAX_KEY_LEN, true);
    if (keyResult && typeof keyResult === "object" && "ok" in keyResult) {
      return keyResult;
    }
    const key = keyResult as string;

    let label: string | undefined;
    if (item.label !== undefined) {
      const labelResult = validateBoundedString(
        item.label,
        `series[${i}].label`,
        MAX_KEY_LEN,
        false,
      );
      if (labelResult && typeof labelResult === "object" && "ok" in labelResult) {
        return labelResult;
      }
      label = labelResult as string | undefined;
    }

    let color: string | undefined;
    if (item.color !== undefined) {
      if (typeof item.color !== "string" || !isHexColor(item.color)) {
        return err(
          "schema",
          `series[${i}].color must be #rgb, #rrggbb, or #rrggbbaa`,
        );
      }
      color = item.color;
    }

    const entry: ChartSeriesV1 = { key };
    if (label !== undefined) entry.label = label;
    if (color !== undefined) entry.color = color;
    series.push(entry);
  }

  return series as [ChartSeriesV1, ...ChartSeriesV1[]];
}

function parseOptions(raw: unknown): ChartOptionsV1 | undefined | ParseChartSpecErr {
  if (raw === undefined || raw === null) return undefined;
  if (!isPlainObject(raw)) {
    return err("schema", "options must be an object");
  }

  const options: ChartOptionsV1 = {};

  if (raw.stacked !== undefined) {
    if (typeof raw.stacked !== "boolean") {
      return err("schema", "options.stacked must be a boolean");
    }
    options.stacked = raw.stacked;
  }
  if (raw.horizontal !== undefined) {
    if (typeof raw.horizontal !== "boolean") {
      return err("schema", "options.horizontal must be a boolean");
    }
    options.horizontal = raw.horizontal;
  }
  if (raw.showLegend !== undefined) {
    if (typeof raw.showLegend !== "boolean") {
      return err("schema", "options.showLegend must be a boolean");
    }
    options.showLegend = raw.showLegend;
  }
  if (raw.showGrid !== undefined) {
    if (typeof raw.showGrid !== "boolean") {
      return err("schema", "options.showGrid must be a boolean");
    }
    options.showGrid = raw.showGrid;
  }
  if (raw.showTooltip !== undefined) {
    if (typeof raw.showTooltip !== "boolean") {
      return err("schema", "options.showTooltip must be a boolean");
    }
    options.showTooltip = raw.showTooltip;
  }
  if (raw.height !== undefined) {
    if (typeof raw.height !== "number" || !Number.isFinite(raw.height)) {
      return err("schema", "options.height must be a finite number");
    }
    options.height = clampHeight(raw.height);
  }

  return options;
}

function validateCartesianSeriesValues(
  data: ChartDataRow[],
  series: ChartSeriesV1[],
): ParseChartSpecErr | null {
  for (const s of series) {
    if (!keyPresentOnSomeRow(data, s.key)) {
      return err("schema", `series key "${s.key}" is not present on any data row`);
    }
    for (let i = 0; i < data.length; i++) {
      const v = data[i][s.key];
      if (v === undefined || v === null) continue;
      if (typeof v !== "number" || !Number.isFinite(v)) {
        return err(
          "schema",
          `data[${i}].${s.key} must be a number or null for series values`,
        );
      }
    }
  }
  return null;
}

function validatePieValues(
  data: ChartDataRow[],
  valueKey: string,
  nameKey: string,
): ParseChartSpecErr | null {
  if (!keyPresentOnSomeRow(data, nameKey)) {
    return err("schema", `nameKey "${nameKey}" is not present on any data row`);
  }
  if (!keyPresentOnSomeRow(data, valueKey)) {
    return err("schema", `valueKey "${valueKey}" is not present on any data row`);
  }
  for (let i = 0; i < data.length; i++) {
    const v = data[i][valueKey];
    if (v === undefined || v === null) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return err(
        "schema",
        `data[${i}].${valueKey} must be a number or null for pie values`,
      );
    }
    if (v < 0) {
      return err("schema", `data[${i}].${valueKey} must be ≥ 0 for pie charts`);
    }
  }
  return null;
}

/**
 * Pure ChartSpec v1 parser. Safe for unit tests. Never throws.
 */
export function parseChartSpec(input: string): ParseChartSpecResult {
  try {
    if (typeof input !== "string") {
      return err("empty", "Chart spec is empty");
    }
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return err("empty", "Chart spec is empty");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return err("json", "Invalid chart JSON");
    }

    if (!isPlainObject(parsed)) {
      return err("schema", "Chart spec must be a JSON object");
    }

    if (parsed.version !== 1) {
      return err("schema", "Unsupported chart version (expected 1)");
    }

    if (typeof parsed.type !== "string" || !ALL_TYPES.has(parsed.type as ChartTypeV1)) {
      return err("schema", "type must be one of bar, line, area, pie");
    }
    const type = parsed.type as ChartTypeV1;

    const titleResult = validateBoundedString(
      parsed.title,
      "title",
      MAX_TITLE_LEN,
      false,
    );
    if (titleResult && typeof titleResult === "object" && "ok" in titleResult) {
      return titleResult;
    }
    const title = titleResult as string | undefined;

    const descResult = validateBoundedString(
      parsed.description,
      "description",
      MAX_DESCRIPTION_LEN,
      false,
    );
    if (descResult && typeof descResult === "object" && "ok" in descResult) {
      return descResult;
    }
    const description = descResult as string | undefined;

    const dataResult = parseDataRows(parsed.data);
    if (!Array.isArray(dataResult)) {
      return dataResult;
    }
    const data = dataResult;

    const optionsResult = parseOptions(parsed.options);
    if (optionsResult && typeof optionsResult === "object" && "ok" in optionsResult) {
      return optionsResult as ParseChartSpecErr;
    }
    const options = optionsResult as ChartOptionsV1 | undefined;

    if (CARTESIAN_TYPES.has(type)) {
      const xKeyResult = validateBoundedString(parsed.xKey, "xKey", MAX_KEY_LEN, true);
      if (xKeyResult && typeof xKeyResult === "object" && "ok" in xKeyResult) {
        return xKeyResult;
      }
      const xKey = xKeyResult as string;
      if (!keyPresentOnSomeRow(data, xKey)) {
        return err("schema", `xKey "${xKey}" is not present on any data row`);
      }

      const seriesResult = parseSeries(parsed.series);
      if (!Array.isArray(seriesResult)) {
        return seriesResult;
      }
      const series = seriesResult;

      const seriesValErr = validateCartesianSeriesValues(data, series);
      if (seriesValErr) return seriesValErr;

      const spec: ChartSpecCartesianV1 = {
        version: 1,
        type: type as "bar" | "line" | "area",
        xKey,
        series,
        data,
      };
      if (title !== undefined) spec.title = title;
      if (description !== undefined) spec.description = description;
      if (options !== undefined) spec.options = options;
      return { ok: true, spec };
    }

    // pie
    const nameKeyResult = validateBoundedString(
      parsed.nameKey,
      "nameKey",
      MAX_KEY_LEN,
      true,
    );
    if (nameKeyResult && typeof nameKeyResult === "object" && "ok" in nameKeyResult) {
      return nameKeyResult;
    }
    const nameKey = nameKeyResult as string;

    const valueKeyResult = validateBoundedString(
      parsed.valueKey,
      "valueKey",
      MAX_KEY_LEN,
      true,
    );
    if (valueKeyResult && typeof valueKeyResult === "object" && "ok" in valueKeyResult) {
      return valueKeyResult;
    }
    const valueKey = valueKeyResult as string;

    const pieValErr = validatePieValues(data, valueKey, nameKey);
    if (pieValErr) return pieValErr;

    let colors: string[] | undefined;
    if (parsed.colors !== undefined) {
      if (!Array.isArray(parsed.colors)) {
        return err("schema", "colors must be an array of hex colors");
      }
      colors = [];
      for (let i = 0; i < parsed.colors.length; i++) {
        const c = parsed.colors[i];
        if (typeof c !== "string" || !isHexColor(c)) {
          return err(
            "schema",
            `colors[${i}] must be #rgb, #rrggbb, or #rrggbbaa`,
          );
        }
        colors.push(c);
      }
    }

    const spec: ChartSpecPieV1 = {
      version: 1,
      type: "pie",
      nameKey,
      valueKey,
      data,
    };
    if (title !== undefined) spec.title = title;
    if (description !== undefined) spec.description = description;
    if (options !== undefined) spec.options = options;
    if (colors !== undefined) spec.colors = colors;
    return { ok: true, spec };
  } catch {
    // Defensive: never throw from the public boundary.
    return err("schema", "Failed to parse chart spec");
  }
}
