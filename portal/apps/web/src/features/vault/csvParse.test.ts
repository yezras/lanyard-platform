import { describe, expect, it } from "vitest";

import { detectDelimiter, parseCsv } from "./csvParse.js";

describe("parseCsv", () => {
  it("parses simple comma-separated rows", () => {
    const rows = parseCsv("name,age\nAlice,30\nBob,25\n");
    expect(rows).toEqual([
      ["name", "age"],
      ["Alice", "30"],
      ["Bob", "25"],
    ]);
  });

  it("handles quoted fields with commas and escaped quotes", () => {
    const rows = parseCsv('a,"b,c","say ""hi"""\n1,2,3');
    expect(rows).toEqual([
      ["a", "b,c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });

  it("parses TSV with tab delimiter", () => {
    const rows = parseCsv("a\tb\nc\td", "\t");
    expect(rows).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles CRLF line endings", () => {
    const rows = parseCsv("x,y\r\n1,2\r\n");
    expect(rows).toEqual([
      ["x", "y"],
      ["1", "2"],
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("detectDelimiter", () => {
  it("prefers tab when header is tab-separated", () => {
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });

  it("defaults to comma", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
  });
});
