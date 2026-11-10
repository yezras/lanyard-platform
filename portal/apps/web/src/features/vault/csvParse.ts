/**
 * RFC 4180-ish CSV/TSV parser with quoted fields.
 * Supports commas, tabs, and optional custom delimiter.
 */

export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  // Strip BOM
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  while (i < input.length) {
    const ch = input[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === delimiter) {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\r") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i += 1;
      if (input[i] === "\n") {
        i += 1;
      }
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  // Trailing field / row (including empty file → no rows)
  if (field.length > 0 || row.length > 0 || inQuotes) {
    row.push(field);
    rows.push(row);
  }

  // Drop a single trailing empty row from a final newline
  if (
    rows.length > 0 &&
    rows[rows.length - 1]!.length === 1 &&
    rows[rows.length - 1]![0] === "" &&
    input.endsWith("\n")
  ) {
    rows.pop();
  }

  return rows;
}

/** Infer delimiter from first line (prefer tab if present, else comma). */
export function detectDelimiter(text: string): "," | "\t" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.includes("\t") && !firstLine.includes(",")) {
    return "\t";
  }
  // Prefer tab when more tabs than commas on the header line
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}
