import { describe, expect, it } from "vitest";

import {
  badgeToneFromLabel,
  isAllowedTableHref,
  parseTableSpec,
} from "./parseTableSpec.js";
import { TABLE_SPEC_LIMITS } from "./types.js";

/** Findings example from plan overview (badge + vault + external). */
const FINDINGS_TABLE_JSON = JSON.stringify({
  version: 1,
  title: "Open findings",
  columns: [
    { key: "id", header: "ID", type: "text", widthWeight: 1 },
    { key: "severity", header: "Severity", type: "badge", align: "center" },
    { key: "owner", header: "Owner", type: "text" },
    { key: "doc", header: "Doc", type: "link" },
    { key: "ticket", header: "Ticket", type: "link" },
  ],
  rows: [
    {
      id: "F-12",
      severity: { kind: "badge", label: "High", tone: "error" },
      owner: "Alex",
      doc: {
        kind: "link",
        label: "runbook.md",
        href: "docs/runbooks/finding-f12.md",
        target: "vault",
      },
      ticket: {
        kind: "link",
        label: "LIN-204",
        href: "https://linear.app/example/issue/LIN-204",
        target: "external",
        openInNewTab: true,
      },
    },
    {
      id: "F-13",
      severity: { kind: "badge", label: "Low", tone: "success" },
      owner: "Sam",
      doc: {
        kind: "link",
        label: "notes.md",
        href: "projects/alpha/notes.md",
        target: "vault",
      },
      ticket: null,
    },
  ],
  options: { density: "compact", hasHover: true, dividers: "rows" },
});

describe("parseTableSpec", () => {
  it("parses the findings rich table (badge + vault + external)", () => {
    const result = parseTableSpec(FINDINGS_TABLE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.spec.version).toBe(1);
    expect(result.spec.title).toBe("Open findings");
    expect(result.spec.columns).toHaveLength(5);
    expect(result.spec.columns[0].key).toBe("id");
    expect(result.spec.columns[1].type).toBe("badge");
    expect(result.spec.rows).toHaveLength(2);

    const severity = result.spec.rows[0].severity;
    expect(severity).toEqual({
      kind: "badge",
      label: "High",
      tone: "error",
    });

    const doc = result.spec.rows[0].doc;
    expect(doc).toMatchObject({
      kind: "link",
      label: "runbook.md",
      href: "docs/runbooks/finding-f12.md",
      target: "vault",
    });

    const ticket = result.spec.rows[0].ticket;
    expect(ticket).toMatchObject({
      kind: "link",
      href: "https://linear.app/example/issue/LIN-204",
      target: "external",
      openInNewTab: true,
    });

    expect(result.spec.rows[1].ticket).toBeNull();
    expect(result.spec.options).toEqual({
      density: "compact",
      hasHover: true,
      dividers: "rows",
    });
  });

  it("allows empty rows with headers only", () => {
    const result = parseTableSpec(
      JSON.stringify({
        version: 1,
        columns: [{ key: "name", header: "Name" }],
        rows: [],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.rows).toEqual([]);
    expect(result.spec.columns).toHaveLength(1);
  });

  it("normalizes scalar badge/link cells from column type", () => {
    const result = parseTableSpec(
      JSON.stringify({
        version: 1,
        columns: [
          { key: "severity", type: "badge" },
          { key: "url", type: "link" },
        ],
        rows: [{ severity: "High", url: "https://example.com/x" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.rows[0].severity).toEqual({
      kind: "badge",
      label: "High",
      tone: "error",
    });
    expect(result.spec.rows[0].url).toEqual({
      kind: "link",
      label: "https://example.com/x",
      href: "https://example.com/x",
      target: "auto",
    });
  });

  it("maps unknown badge tone to neutral", () => {
    const result = parseTableSpec(
      JSON.stringify({
        version: 1,
        columns: [{ key: "s", type: "badge" }],
        rows: [
          {
            s: { kind: "badge", label: "Weird", tone: "not-a-tone" },
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.rows[0].s).toEqual({
      kind: "badge",
      label: "Weird",
      tone: "neutral",
    });
  });

  it("rejects bad JSON with code json", () => {
    const result = parseTableSpec("{ not json");
    expect(result).toEqual({
      ok: false,
      code: "json",
      error: "Invalid JSON",
    });
  });

  it("rejects empty input with code empty", () => {
    expect(parseTableSpec("").code).toBe("empty");
    expect(parseTableSpec("   ").code).toBe("empty");
  });

  it("rejects missing columns", () => {
    const result = parseTableSpec(
      JSON.stringify({ version: 1, rows: [] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("schema");
    expect(result.error).toMatch(/columns/i);
  });

  it("rejects empty columns array", () => {
    const result = parseTableSpec(
      JSON.stringify({ version: 1, columns: [], rows: [] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("schema");
  });

  it("rejects more than 12 columns with code limits", () => {
    const columns = Array.from({ length: 13 }, (_, i) => ({
      key: `c${i}`,
    }));
    const result = parseTableSpec(
      JSON.stringify({ version: 1, columns, rows: [] }),
    );
    expect(result).toMatchObject({
      ok: false,
      code: "limits",
    });
    if (result.ok) return;
    expect(result.error).toMatch(/12/);
  });

  it("rejects more than 100 rows with code limits", () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ id: String(i) }));
    const result = parseTableSpec(
      JSON.stringify({
        version: 1,
        columns: [{ key: "id" }],
        rows,
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      code: "limits",
    });
    if (result.ok) return;
    expect(result.error).toMatch(/100/);
  });

  it("rejects javascript: href", () => {
    const result = parseTableSpec(
      JSON.stringify({
        version: 1,
        columns: [{ key: "a", type: "link" }],
        rows: [
          {
            a: {
              kind: "link",
              label: "x",
              href: "javascript:alert(1)",
              target: "external",
            },
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("schema");
    expect(result.error).toMatch(/href|javascript|not allowed/i);
  });

  it("rejects data: href", () => {
    const result = parseTableSpec(
      JSON.stringify({
        version: 1,
        columns: [{ key: "a" }],
        rows: [
          {
            a: {
              kind: "link",
              label: "x",
              href: "data:text/html,hi",
            },
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/href|not allowed/i);
  });

  it("rejects javascript: scalar link cell", () => {
    const result = parseTableSpec(
      JSON.stringify({
        version: 1,
        columns: [{ key: "a", type: "link" }],
        rows: [{ a: "javascript:void(0)" }],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects external target without http(s)", () => {
    const result = parseTableSpec(
      JSON.stringify({
        version: 1,
        columns: [{ key: "a" }],
        rows: [
          {
            a: {
              kind: "link",
              label: "local",
              href: "docs/x.md",
              target: "external",
            },
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate column keys", () => {
    const result = parseTableSpec(
      JSON.stringify({
        version: 1,
        columns: [{ key: "a" }, { key: "a" }],
        rows: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("schema");
    expect(result.error).toMatch(/duplicate/i);
  });

  it("rejects wrong version", () => {
    const result = parseTableSpec(
      JSON.stringify({
        version: 2,
        columns: [{ key: "a" }],
        rows: [],
      }),
    );
    expect(result).toMatchObject({ ok: false, code: "schema" });
  });

  it("rejects oversized header / label strings", () => {
    const long = "x".repeat(TABLE_SPEC_LIMITS.maxHeaderOrLabelChars + 1);
    const result = parseTableSpec(
      JSON.stringify({
        version: 1,
        columns: [{ key: "a", header: long }],
        rows: [],
      }),
    );
    expect(result).toMatchObject({ ok: false, code: "limits" });
  });

  it("never throws on pathological input", () => {
    const inputs: string[] = [
      "",
      "null",
      "[]",
      '{"version":1}',
      "\u0000",
      FINDINGS_TABLE_JSON.slice(0, 20),
    ];
    for (const input of inputs) {
      expect(() => parseTableSpec(input)).not.toThrow();
      const result = parseTableSpec(input);
      expect(typeof result.ok).toBe("boolean");
    }
  });
});

describe("badgeToneFromLabel", () => {
  it("maps high/medium/low and defaults to neutral", () => {
    expect(badgeToneFromLabel("High")).toBe("error");
    expect(badgeToneFromLabel("medium")).toBe("warning");
    expect(badgeToneFromLabel("Low")).toBe("success");
    expect(badgeToneFromLabel("something-else")).toBe("neutral");
  });
});

describe("isAllowedTableHref", () => {
  it("allows http(s) and vault paths; rejects javascript/data", () => {
    expect(isAllowedTableHref("https://example.com")).toBe(true);
    expect(isAllowedTableHref("http://example.com/a")).toBe(true);
    expect(isAllowedTableHref("docs/runbooks/x.md")).toBe(true);
    expect(isAllowedTableHref("/Projects/A/README.md")).toBe(true);
    expect(isAllowedTableHref("javascript:alert(1)")).toBe(false);
    expect(isAllowedTableHref("data:text/plain,hi")).toBe(false);
    expect(isAllowedTableHref("docs/x.md", "external")).toBe(false);
    expect(isAllowedTableHref("https://x.com", "external")).toBe(true);
  });
});
