/** Shared Office (xlsx / pptx) preview helpers for VaultReader. */

export const MAX_SHEET_ROWS = 500;

export type SheetTableRow = Record<string, unknown> & { id: string };

export type ParsedSheet = {
  name: string;
  columns: { key: string; header: string }[];
  rows: SheetTableRow[];
  totalRows: number;
  truncated: boolean;
};

export type ParsedWorkbook = {
  sheetNames: string[];
  sheets: Record<string, ParsedSheet>;
};

export type PptxSlideContent = {
  index: number;
  title: string | null;
  body: string[];
};

function formatCell(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Build a tabular sheet model from a SheetJS worksheet AOA (array-of-arrays).
 * First row is used as headers when present.
 */
export function sheetFromAoA(
  name: string,
  aoa: unknown[][],
  maxRows: number = MAX_SHEET_ROWS,
): ParsedSheet {
  if (aoa.length === 0) {
    return {
      name,
      columns: [],
      rows: [],
      totalRows: 0,
      truncated: false,
    };
  }

  const headerRow = aoa[0] ?? [];
  const maxCols = Math.max(
    headerRow.length,
    ...aoa.map((row) => (Array.isArray(row) ? row.length : 0)),
  );

  const usedHeaders = new Map<string, number>();
  const columns: { key: string; header: string }[] = [];
  for (let col = 0; col < maxCols; col += 1) {
    const raw = headerRow[col];
    let header =
      raw == null || String(raw).trim() === ""
        ? `Column ${col + 1}`
        : String(raw);
    const count = usedHeaders.get(header) ?? 0;
    usedHeaders.set(header, count + 1);
    if (count > 0) {
      header = `${header} (${count + 1})`;
    }
    columns.push({ key: `c${col}`, header });
  }

  const dataRows = aoa.slice(1);
  const totalRows = dataRows.length;
  const truncated = totalRows > maxRows;
  const slice = truncated ? dataRows.slice(0, maxRows) : dataRows;

  const rows: SheetTableRow[] = slice.map((row, rowIndex) => {
    const cells = Array.isArray(row) ? row : [];
    const out: SheetTableRow = { id: String(rowIndex) };
    for (let col = 0; col < columns.length; col += 1) {
      out[columns[col]!.key] = formatCell(cells[col]);
    }
    return out;
  });

  return {
    name,
    columns,
    rows,
    totalRows,
    truncated,
  };
}

/** Minimal SheetJS surface used by the vault XLSX preview. */
export type SheetJsLike = {
  read: (
    data: ArrayBuffer,
    opts: { type: "array" },
  ) => {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    // SheetJS overloads are broad; keep this loose for interop.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sheet_to_json: (sheet: any, opts: object) => unknown[][];
  };
};

/**
 * Parse an XLSX workbook buffer with SheetJS into sheet table models.
 * Callers must pass the already-imported XLSX module (for lazy loading).
 */
export function parseWorkbook(
  XLSX: SheetJsLike,
  buffer: ArrayBuffer,
  maxRows: number = MAX_SHEET_ROWS,
): ParsedWorkbook {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetNames = workbook.SheetNames ?? [];
  const sheets: Record<string, ParsedSheet> = {};

  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) {
      sheets[name] = {
        name,
        columns: [],
        rows: [],
        totalRows: 0,
        truncated: false,
      };
      continue;
    }
    const aoa = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];
    sheets[name] = sheetFromAoA(name, aoa, maxRows);
  }

  return { sheetNames, sheets };
}

/**
 * Extract ordered paragraph text runs from a PPTX slide XML document.
 */
export function extractSlideParagraphs(xml: string): string[] {
  const paragraphs = xml.split(/<\/a:p>/i);
  const lines: string[] = [];
  for (const fragment of paragraphs) {
    const texts = [...fragment.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/gi)].map(
      (m) => m[1] ?? "",
    );
    const line = texts
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (line) {
      lines.push(line);
    }
  }
  return lines;
}

/**
 * Build structured slide content from JSZip-loaded PPTX bytes.
 * Callers pass a loaded JSZip instance (or zip-like API).
 */
export async function parsePptxSlidesFromZip(zip: {
  files: Record<
    string,
    { dir?: boolean; async: (type: "string") => Promise<string> } | undefined
  >;
}): Promise<PptxSlideContent[]> {
  const slidePaths = Object.keys(zip.files)
    .filter(
      (name) =>
        /^ppt\/slides\/slide\d+\.xml$/i.test(name) && !zip.files[name]?.dir,
    )
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const slides: PptxSlideContent[] = [];
  for (const slidePath of slidePaths) {
    const entry = zip.files[slidePath];
    if (!entry) {
      continue;
    }
    const xml = await entry.async("string");
    const lines = extractSlideParagraphs(xml);
    const title = lines[0] ?? null;
    const body = lines.slice(1);
    slides.push({
      index: slides.length + 1,
      title,
      body,
    });
  }
  return slides;
}
