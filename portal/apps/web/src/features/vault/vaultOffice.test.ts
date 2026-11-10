import { describe, expect, it } from "vitest";

import {
  extractSlideParagraphs,
  MAX_SHEET_ROWS,
  parsePptxSlidesFromZip,
  sheetFromAoA,
} from "./vaultOffice.js";

describe("sheetFromAoA", () => {
  it("uses the first row as headers and maps data rows", () => {
    const sheet = sheetFromAoA("Sheet1", [
      ["Name", "Score"],
      ["Ada", 10],
      ["Grace", 20],
    ]);

    expect(sheet.name).toBe("Sheet1");
    expect(sheet.columns.map((c) => c.header)).toEqual(["Name", "Score"]);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]).toMatchObject({ id: "0", c0: "Ada", c1: "10" });
    expect(sheet.rows[1]).toMatchObject({ id: "1", c0: "Grace", c1: "20" });
    expect(sheet.totalRows).toBe(2);
    expect(sheet.truncated).toBe(false);
  });

  it("dedupes blank/duplicate headers and pads short rows", () => {
    const sheet = sheetFromAoA("Data", [
      ["A", "", "A"],
      ["x"],
    ]);

    expect(sheet.columns.map((c) => c.header)).toEqual([
      "A",
      "Column 2",
      "A (2)",
    ]);
    expect(sheet.rows[0]).toMatchObject({
      c0: "x",
      c1: "",
      c2: "",
    });
  });

  it("truncates large sheets at MAX_SHEET_ROWS", () => {
    const header = ["n"];
    const data = Array.from({ length: MAX_SHEET_ROWS + 25 }, (_, i) => [i]);
    const sheet = sheetFromAoA("Big", [header, ...data]);

    expect(sheet.totalRows).toBe(MAX_SHEET_ROWS + 25);
    expect(sheet.truncated).toBe(true);
    expect(sheet.rows).toHaveLength(MAX_SHEET_ROWS);
    expect(sheet.rows[0]?.c0).toBe("0");
    expect(sheet.rows[MAX_SHEET_ROWS - 1]?.c0).toBe(String(MAX_SHEET_ROWS - 1));
  });

  it("handles empty sheets", () => {
    const sheet = sheetFromAoA("Empty", []);
    expect(sheet.columns).toEqual([]);
    expect(sheet.rows).toEqual([]);
    expect(sheet.totalRows).toBe(0);
    expect(sheet.truncated).toBe(false);
  });
});

describe("extractSlideParagraphs", () => {
  it("joins text runs within a paragraph and splits on </a:p>", () => {
    const xml = `
      <p:sp><p:txBody>
        <a:p><a:r><a:t>Hello</a:t></a:r><a:r><a:t> World</a:t></a:r></a:p>
        <a:p><a:r><a:t>  Second   line  </a:t></a:r></a:p>
        <a:p><a:r><a:t></a:t></a:r></a:p>
      </p:txBody></p:sp>
    `;
    expect(extractSlideParagraphs(xml)).toEqual(["Hello World", "Second line"]);
  });
});

describe("parsePptxSlidesFromZip", () => {
  it("orders slides numerically and splits title/body", async () => {
    const files: Record<
      string,
      { dir?: boolean; async: (type: "string") => Promise<string> }
    > = {
      "ppt/slides/slide10.xml": {
        async: async () =>
          `<a:p><a:t>Ten title</a:t></a:p><a:p><a:t>Ten body</a:t></a:p>`,
      },
      "ppt/slides/slide2.xml": {
        async: async () =>
          `<a:p><a:t>Two title</a:t></a:p><a:p><a:t>Two body</a:t></a:p>`,
      },
      "ppt/slides/slide1.xml": {
        async: async () =>
          `<a:p><a:t>One title</a:t></a:p><a:p><a:t>One body A</a:t></a:p><a:p><a:t>One body B</a:t></a:p>`,
      },
      "ppt/slides/_rels/slide1.xml.rels": {
        async: async () => "",
      },
    };

    const slides = await parsePptxSlidesFromZip({ files });
    expect(slides.map((s) => s.title)).toEqual([
      "One title",
      "Two title",
      "Ten title",
    ]);
    expect(slides[0]?.body).toEqual(["One body A", "One body B"]);
    expect(slides[0]?.index).toBe(1);
    expect(slides[2]?.index).toBe(3);
  });
});
