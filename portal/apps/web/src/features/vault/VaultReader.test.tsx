import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import type { VaultFileContent } from "../../api/types.js";
import { Providers } from "../../app/providers.js";

import { VaultReader } from "./VaultReader.js";

const renderAsync = vi.fn();

vi.mock("docx-preview", () => ({
  renderAsync: (...args: unknown[]) => renderAsync(...args),
}));

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function mockContent(
  partial: Partial<VaultFileContent> &
    Pick<VaultFileContent, "path" | "content">,
): VaultFileContent {
  return {
    mime_type: "text/plain",
    encoding: "utf-8",
    ...partial,
  };
}

function renderReader(
  content: VaultFileContent | null,
  props?: {
    isLoading?: boolean;
    error?: string | null;
  },
) {
  return render(
    <Providers>
      <VaultReader
        content={content}
        isLoading={props?.isLoading ?? false}
        error={props?.error ?? null}
      />
    </Providers>,
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function buildXlsxBase64(): string {
  const wb = XLSX.utils.book_new();
  const sheetA = XLSX.utils.aoa_to_sheet([
    ["Name", "Score"],
    ["Ada", 10],
  ]);
  const sheetB = XLSX.utils.aoa_to_sheet([
    ["City", "Pop"],
    ["Paris", 2],
  ]);
  XLSX.utils.book_append_sheet(wb, sheetA, "People");
  XLSX.utils.book_append_sheet(wb, sheetB, "Cities");
  const out = XLSX.write(wb, {
    type: "array",
    bookType: "xlsx",
  });
  const bytes =
    out instanceof ArrayBuffer
      ? new Uint8Array(out)
      : out instanceof Uint8Array
        ? out
        : new Uint8Array(out as ArrayLike<number>);
  return arrayBufferToBase64(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

afterEach(() => {
  cleanup();
});

describe("VaultReader text-family previews", () => {
  it("renders sandboxed HTML iframe via srcDoc", () => {
    const html = "<html><body><h1>Hello vault</h1></body></html>";
    const { container } = renderReader(
      mockContent({
        path: "/docs/page.html",
        mime_type: "text/html",
        content: html,
      }),
    );

    expect(screen.getByText("page.html")).toBeTruthy();
    const iframe = container.querySelector('iframe[title="HTML preview"]');
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute("srcdoc")).toBe(html);
    expect(iframe?.hasAttribute("sandbox")).toBe(true);
    expect(iframe?.getAttribute("sandbox")).toBe("");
  });

  it("renders CSV as a table with header cells", () => {
    const { container } = renderReader(
      mockContent({
        path: "/data/people.csv",
        mime_type: "text/csv",
        content: "name,role\nAlice,Engineer\nBob,Designer\n",
      }),
    );

    expect(screen.getByText("people.csv")).toBeTruthy();
    expect(container.textContent).toContain("name");
    expect(container.textContent).toContain("role");
    expect(container.textContent).toContain("Alice");
    expect(container.textContent).toContain("Engineer");
    expect(container.textContent).toContain("Bob");
    expect(container.querySelector("table")).toBeTruthy();
  });

  it("renders TypeScript with CodeBlock not Unsupported", () => {
    const code = "export const x: number = 1;\n";
    const { container } = renderReader(
      mockContent({
        path: "/src/index.ts",
        mime_type: "text/typescript",
        content: code,
      }),
    );

    expect(screen.queryByText("Unsupported preview")).toBeNull();
    expect(screen.getByText("index.ts")).toBeTruthy();
    expect(container.textContent).toContain("export");
    expect(container.textContent).toContain("number");
    expect(
      container.querySelector(".astryx-codeblock") ||
        container.querySelector("[data-language]"),
    ).toBeTruthy();
  });

  it("renders JSON with CodeBlock", () => {
    const { container } = renderReader(
      mockContent({
        path: "/config.json",
        mime_type: "application/json",
        content: '{\n  "ok": true\n}\n',
      }),
    );

    expect(screen.queryByText("Unsupported preview")).toBeNull();
    expect(container.textContent).toContain("ok");
    expect(container.textContent).toContain("true");
  });

  it("renders Python with CodeBlock", () => {
    const { container } = renderReader(
      mockContent({
        path: "/scripts/run.py",
        mime_type: "text/x-python",
        content: "def main():\n    print('hi')\n",
      }),
    );

    expect(screen.queryByText("Unsupported preview")).toBeNull();
    expect(container.textContent).toContain("def main");
  });

  it("decodes base64 text for code preview", () => {
    const text = "const a = 1;\n";
    const b64 = btoa(text);
    const { container } = renderReader(
      mockContent({
        path: "/a.js",
        mime_type: "application/javascript",
        encoding: "base64",
        content: b64,
      }),
    );

    expect(container.textContent).toContain("const a");
  });

  it("shows Unsupported for binary/unknown mime", () => {
    renderReader(
      mockContent({
        path: "/blob.bin",
        mime_type: "application/octet-stream",
        encoding: "base64",
        content: "AAAA",
      }),
    );

    expect(screen.getByText("Unsupported preview")).toBeTruthy();
    expect(screen.getByText("application/octet-stream")).toBeTruthy();
  });

  it("shows select-a-file empty state when content is null", () => {
    renderReader(null);
    expect(screen.getByText("Select a file")).toBeTruthy();
  });

  it("renders PDF iframe that fills remaining reader height", () => {
    renderReader(
      mockContent({
        path: "/docs/report.pdf",
        mime_type: "application/pdf",
        encoding: "base64",
        content: btoa("%PDF-1.4"),
      }),
    );

    expect(screen.getByText("report.pdf")).toBeTruthy();
    const iframe = screen.getByTestId("vault-pdf-preview");
    expect(iframe.tagName).toBe("IFRAME");
    const src = iframe.getAttribute("src") ?? "";
    expect(src.startsWith("data:")).toBe(true);
    expect(src.includes("pdf")).toBe(true);
    expect(src.includes("base64")).toBe(true);
    // Full-pane layout (not fixed minHeight-only half page)
    expect(iframe.style.height).toBe("100%");
    // jsdom may serialize 0 as "0" rather than "0px"
    expect(["0", "0px"]).toContain(iframe.style.minHeight);
    const flex = iframe.style.flex;
    expect(flex === "1" || flex.startsWith("1 ")).toBe(true);
  });
});

describe("VaultReader DOCX preview", () => {
  beforeEach(() => {
    renderAsync.mockReset();
    renderAsync.mockImplementation(
      async (_data: unknown, container: HTMLElement) => {
        container.innerHTML =
          '<div class="vault-docx-wrapper"><p>Rich DOCX body</p></div>';
      },
    );
  });

  it("shows loading then mounts the docx-preview container", async () => {
    let resolveRender!: () => void;
    renderAsync.mockImplementation(
      (_data: unknown, container: HTMLElement) =>
        new Promise<void>((resolve) => {
          resolveRender = () => {
            container.innerHTML =
              '<div class="vault-docx-wrapper"><p>Rich DOCX body</p></div>';
            resolve();
          };
        }),
    );

    renderReader({
      path: "/Projects/A/brief.docx",
      mime_type: DOCX_MIME,
      encoding: "base64",
      content: btoa("PK fake-docx"),
    });

    expect(screen.getByText("brief.docx")).toBeTruthy();
    expect(screen.getByText("Loading preview…")).toBeTruthy();
    expect(screen.getByTestId("vault-docx-preview")).toBeTruthy();

    await waitFor(() => {
      expect(renderAsync).toHaveBeenCalled();
    });

    resolveRender();

    await waitFor(() => {
      expect(screen.queryByText("Loading preview…")).toBeNull();
      expect(screen.getByTestId("vault-docx-preview").textContent).toMatch(
        /Rich DOCX body/,
      );
    });

    const host = screen.getByTestId("vault-docx-preview");
    expect(renderAsync.mock.calls.some((call) => call[1] === host)).toBe(true);
  });

  it("shows Preview failed EmptyState when docx-preview throws", async () => {
    renderAsync.mockRejectedValueOnce(new Error("corrupt zip"));

    renderReader({
      path: "/Projects/A/broken.docx",
      mime_type: DOCX_MIME,
      encoding: "base64",
      content: btoa("not-a-docx"),
    });

    await waitFor(() => {
      expect(screen.getByText("Preview failed")).toBeTruthy();
      expect(screen.getByText("corrupt zip")).toBeTruthy();
    });
    expect(screen.queryByTestId("vault-docx-preview")).toBeNull();
  });

  it("detects DOCX by file extension when mime is generic", async () => {
    renderReader({
      path: "/Projects/A/notes.docx",
      mime_type: "application/octet-stream",
      encoding: "base64",
      content: btoa("PK"),
    });

    await waitFor(() => {
      expect(renderAsync).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByTestId("vault-docx-preview").textContent).toMatch(
        /Rich DOCX body/,
      );
    });
  });
});

describe("VaultReader office previews", () => {
  it("renders multi-sheet xlsx with switchable tabs and tabular data", async () => {
    const content: VaultFileContent = {
      path: "/Projects/data.xlsx",
      mime_type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      encoding: "base64",
      content: buildXlsxBase64(),
    };

    const { container } = render(
      <Providers>
        <VaultReader content={content} isLoading={false} error={null} />
      </Providers>,
    );

    expect(await screen.findByText("data.xlsx")).toBeTruthy();
    expect(screen.queryByText("Unsupported preview")).toBeNull();
    expect(container.querySelector('[data-preview-kind="xlsx"]')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Ada")).toBeTruthy();
      expect(screen.getByText("Name")).toBeTruthy();
    });

    const peopleTab = await screen.findByRole("button", { name: "People" });
    const citiesTab = await screen.findByRole("button", { name: "Cities" });
    expect(peopleTab).toBeTruthy();
    expect(citiesTab).toBeTruthy();
    expect(screen.queryByText("Paris")).toBeNull();

    fireEvent.click(citiesTab);

    await waitFor(() => {
      expect(screen.getByText("Paris")).toBeTruthy();
      expect(screen.getByText("City")).toBeTruthy();
    });
    expect(screen.queryByText("Ada")).toBeNull();
  });

  it("renders framed pptx fallback or visual host for presentation files", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree>
          <p:sp><p:txBody>
            <a:p><a:r><a:t>Kickoff</a:t></a:r></a:p>
            <a:p><a:r><a:t>Welcome to the deck</a:t></a:r></a:p>
          </p:txBody></p:sp>
        </p:spTree></p:cSld>
      </p:sld>`,
    );
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const content: VaultFileContent = {
      path: "/Projects/deck.pptx",
      mime_type:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      encoding: "base64",
      content: arrayBufferToBase64(buffer),
    };

    const { container } = render(
      <Providers>
        <VaultReader content={content} isLoading={false} error={null} />
      </Providers>,
    );

    expect(screen.queryByText("Unsupported preview")).toBeNull();
    expect(container.querySelector('[data-preview-kind="pptx"]')).toBeTruthy();

    await waitFor(
      () => {
        const visual = screen.queryByTestId("pptx-visual-host");
        const fallback = screen.queryByTestId("pptx-fallback-slide");
        const title = screen.queryByText("Kickoff");
        expect(visual || fallback || title).toBeTruthy();
      },
      { timeout: 5000 },
    );
  });
});

/**
 * lp-rt5.7 / lp-upc: selecting/citing DOCX/XLSX/PPTX/.xls always mounts Office
 * client preview — never the generic Unsupported placeholder, never host/X11.
 */
describe("VaultReader office types never Unsupported (lp-rt5.7 / lp-upc)", () => {
  beforeEach(() => {
    renderAsync.mockReset();
    renderAsync.mockImplementation(
      async (_data: unknown, container: HTMLElement) => {
        container.innerHTML =
          '<div class="vault-docx-wrapper"><p>Rich DOCX body</p></div>';
      },
    );
  });

  it("docx: mounts docx-preview host, not Unsupported", async () => {
    const { container } = renderReader({
      path: "/Projects/A/brief.docx",
      mime_type: DOCX_MIME,
      encoding: "base64",
      content: btoa("PK fake-docx"),
    });

    expect(screen.queryByText("Unsupported preview")).toBeNull();
    expect(container.querySelector('[data-preview-kind="docx"]')).toBeTruthy();
    expect(screen.getByTestId("vault-docx-preview")).toBeTruthy();
    expect(screen.getByTestId("vault-office-preview").getAttribute("data-open-mode")).toBe(
      "preview",
    );
    await waitFor(() => {
      expect(renderAsync).toHaveBeenCalled();
    });
  });

  it("xlsx: mounts sheet preview, not Unsupported (edge mime)", async () => {
    const { container } = renderReader({
      path: "/Projects/A/data.xlsx",
      mime_type: "application/octet-stream",
      encoding: "base64",
      content: buildXlsxBase64(),
    });

    expect(screen.queryByText("Unsupported preview")).toBeNull();
    expect(container.querySelector('[data-preview-kind="xlsx"]')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("Ada")).toBeTruthy();
    });
  });

  it("xls: routes to xlsx client preview (defined behavior, never Unsupported)", async () => {
    // SheetJS reads modern OOXML even when extension is .xls — proves kind routing.
    const { container } = renderReader({
      path: "/Projects/A/legacy.xls",
      mime_type: "application/vnd.ms-excel",
      encoding: "base64",
      content: buildXlsxBase64(),
    });

    expect(screen.queryByText("Unsupported preview")).toBeNull();
    expect(container.querySelector('[data-preview-kind="xlsx"]')).toBeTruthy();
    expect(screen.getByTestId("vault-office-preview").getAttribute("data-open-mode")).toBe(
      "preview",
    );
    await waitFor(() => {
      expect(screen.getByText("Ada")).toBeTruthy();
    });
  });

  it("pptx: mounts presentation preview, not Unsupported (edge mime)", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree>
          <p:sp><p:txBody>
            <a:p><a:r><a:t>SlideOne</a:t></a:r></a:p>
          </p:txBody></p:sp>
        </p:spTree></p:cSld>
      </p:sld>`,
    );
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const { container } = renderReader({
      path: "/Projects/A/deck.pptx",
      mime_type: "application/octet-stream",
      encoding: "base64",
      content: arrayBufferToBase64(buffer),
    });

    expect(screen.queryByText("Unsupported preview")).toBeNull();
    expect(container.querySelector('[data-preview-kind="pptx"]')).toBeTruthy();
    await waitFor(
      () => {
        const visual = screen.queryByTestId("pptx-visual-host");
        const fallback = screen.queryByTestId("pptx-fallback-slide");
        const title = screen.queryByText("SlideOne");
        expect(visual || fallback || title).toBeTruthy();
      },
      { timeout: 5000 },
    );
  });
});
