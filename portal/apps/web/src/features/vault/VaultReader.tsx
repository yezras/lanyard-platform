import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Markdown } from "@astryxdesign/core/Markdown";
import { StackItem } from "@astryxdesign/core/Stack";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Table } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type { VaultFileContent } from "../../api/types.js";

import { detectDelimiter, parseCsv } from "./csvParse.js";
import { languageFromPath } from "./previewLanguage.js";
import {
  vaultDocxStyle,
  vaultHtmlStyle,
  vaultImageStyle,
  vaultPdfStyle,
  vaultReaderFillStyle,
} from "./vaultLayout.js";
import {
  MAX_SHEET_ROWS,
  parsePptxSlidesFromZip,
  parseWorkbook,
  type ParsedSheet,
  type ParsedWorkbook,
  type PptxSlideContent,
  type SheetJsLike,
  type SheetTableRow,
} from "./vaultOffice.js";
import { resolveVaultPreviewKind } from "./vaultPreviewKind.js";

const CSV_MAX_ROWS = 500;

type VaultReaderProps = {
  content: VaultFileContent | null;
  isLoading: boolean;
  error: string | null;
};

function basename(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

function extensionOf(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return name.slice(dot + 1).toLowerCase();
}

function VaultReaderHeader({ path }: { path: string }) {
  return (
    <Text type="heading" size="md" maxLines={1}>
      {basename(path)}
    </Text>
  );
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function contentToArrayBuffer(content: VaultFileContent): ArrayBuffer {
  if (content.encoding === "base64") {
    return base64ToArrayBuffer(content.content);
  }
  return new TextEncoder().encode(content.content).buffer;
}

/** Decode vault text payload; supports base64-encoded text previews. */
export function decodeTextContent(content: VaultFileContent): string {
  if (content.encoding === "utf-8") {
    return content.content;
  }
  try {
    return new TextDecoder().decode(base64ToArrayBuffer(content.content));
  } catch {
    return content.content;
  }
}

/**
 * Layout-faithful DOCX preview via docx-preview (client-side only).
 * Container stays mounted so renderAsync can paint into the ref.
 */
function DocxPreview({ content }: { content: VaultFileContent }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setParseError(null);

    void (async () => {
      try {
        const buffer = contentToArrayBuffer(content);
        const { renderAsync } = await import("docx-preview");
        if (cancelled) {
          return;
        }
        const host = containerRef.current;
        if (!host) {
          throw new Error("Preview container unavailable");
        }
        host.innerHTML = "";
        await renderAsync(buffer, host, undefined, {
          className: "vault-docx",
          inWrapper: true,
          useBase64URL: true,
        });
        if (!cancelled) {
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setParseError(
            err instanceof Error ? err.message : "Failed to parse file",
          );
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [content]);

  if (parseError) {
    return (
      <EmptyState title="Preview failed" description={parseError} isCompact />
    );
  }

  return (
    <>
      {loading ? (
        <Text type="body" color="secondary">
          Loading preview…
        </Text>
      ) : null}
      <div
        ref={containerRef}
        data-testid="vault-docx-preview"
        style={{
          ...vaultDocxStyle,
          display: loading ? "none" : undefined,
        }}
      />
    </>
  );
}

function XlsxSheetTable({ sheet }: { sheet: ParsedSheet }) {
  const columns = useMemo<TableColumn<SheetTableRow>[]>(
    () =>
      sheet.columns.map((col) => ({
        key: col.key,
        header: col.header,
        renderCell: (row) => String(row[col.key] ?? ""),
      })),
    [sheet.columns],
  );

  if (sheet.columns.length === 0) {
    return (
      <Text type="body" color="secondary">
        (Empty sheet)
      </Text>
    );
  }

  return (
    <VStack gap={2}>
      {sheet.truncated ? (
        <Text type="body" color="secondary" size="sm">
          Showing first {MAX_SHEET_ROWS.toLocaleString()} of{" "}
          {sheet.totalRows.toLocaleString()} data rows
        </Text>
      ) : null}
      <div
        style={{
          overflow: "auto",
          maxWidth: "100%",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-container, 8px)",
        }}
      >
        <Table
          data={sheet.rows}
          columns={columns}
          idKey="id"
          density="compact"
          dividers="grid"
          hasHover
          textOverflow="truncate"
          aria-label={`${sheet.name} sheet`}
        />
      </div>
    </VStack>
  );
}

function XlsxPreview({ content }: { content: VaultFileContent }) {
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setParseError(null);
    setWorkbook(null);
    setActiveSheet("");

    void (async () => {
      try {
        const buffer = contentToArrayBuffer(content);
        const XLSX = (await import("xlsx")) as unknown as SheetJsLike;
        const parsed = parseWorkbook(XLSX, buffer);
        if (!cancelled) {
          setWorkbook(parsed);
          setActiveSheet(parsed.sheetNames[0] ?? "");
        }
      } catch (err) {
        if (!cancelled) {
          setParseError(
            err instanceof Error ? err.message : "Failed to parse spreadsheet",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [content]);

  if (loading) {
    return (
      <Text type="body" color="secondary">
        Loading preview…
      </Text>
    );
  }

  if (parseError) {
    return (
      <EmptyState title="Preview failed" description={parseError} isCompact />
    );
  }

  if (!workbook || workbook.sheetNames.length === 0) {
    return (
      <EmptyState
        title="Empty spreadsheet"
        description="No sheets found in this file."
        isCompact
      />
    );
  }

  const active =
    workbook.sheets[activeSheet] ??
    workbook.sheets[workbook.sheetNames[0] ?? ""];

  return (
    <VStack gap={3}>
      {workbook.sheetNames.length > 1 ? (
        <TabList
          value={activeSheet || workbook.sheetNames[0]!}
          onChange={setActiveSheet}
          size="sm"
          hasDivider
        >
          {workbook.sheetNames.map((name) => (
            <Tab key={name} value={name} label={name} />
          ))}
        </TabList>
      ) : (
        <Text type="body" color="secondary" size="sm">
          {workbook.sheetNames[0]}
        </Text>
      )}
      {active ? <XlsxSheetTable sheet={active} /> : null}
    </VStack>
  );
}

const slideFrameStyle: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-container, 8px)",
  background: "var(--color-bg-elevated, var(--color-bg, #fff))",
  boxShadow:
    "0 1px 3px color-mix(in srgb, var(--color-fg, #000) 8%, transparent)",
  padding: "var(--spacing-4, 1rem)",
  minHeight: "10rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
};

function PptxFallbackSlides({ slides }: { slides: PptxSlideContent[] }) {
  const [index, setIndex] = useState(0);
  const total = slides.length;
  const safeIndex = Math.min(Math.max(index, 0), Math.max(total - 1, 0));
  const slide = slides[safeIndex];

  if (!slide) {
    return <EmptyState title="No slides found" isCompact />;
  }

  return (
    <VStack gap={3}>
      <HStack hAlign="between" vAlign="center" gap={2}>
        <Text type="body" color="secondary" size="sm">
          Slide {safeIndex + 1} of {total}
        </Text>
        <HStack gap={2}>
          <Button
            label="Previous"
            variant="secondary"
            size="sm"
            isDisabled={safeIndex <= 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
          />
          <Button
            label="Next"
            variant="secondary"
            size="sm"
            isDisabled={safeIndex >= total - 1}
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
          />
        </HStack>
      </HStack>
      <div style={slideFrameStyle} data-testid="pptx-fallback-slide">
        <Text type="label" color="secondary" size="sm">
          Slide {slide.index}
        </Text>
        {slide.title ? (
          <Text type="large" weight="semibold">
            {slide.title}
          </Text>
        ) : (
          <Text type="body" color="secondary">
            (No title)
          </Text>
        )}
        {slide.body.length > 0 ? (
          <VStack gap={1}>
            {slide.body.map((line, i) => (
              <Text key={`${slide.index}-${i}`} type="body">
                {line}
              </Text>
            ))}
          </VStack>
        ) : (
          <Text type="body" color="secondary">
            (No additional text)
          </Text>
        )}
      </div>
      {total > 1 ? (
        <VStack gap={2}>
          <Text type="label" color="secondary" size="sm">
            All slides
          </Text>
          {slides.map((s, i) => (
            <button
              key={s.index}
              type="button"
              onClick={() => setIndex(i)}
              style={{
                ...slideFrameStyle,
                minHeight: "auto",
                cursor: "pointer",
                textAlign: "left",
                outline:
                  i === safeIndex
                    ? "2px solid var(--color-accent, var(--color-border-strong, #888))"
                    : undefined,
                outlineOffset: 2,
              }}
            >
              <Text type="label" color="secondary" size="sm">
                Slide {s.index}
                {s.title ? ` — ${s.title}` : ""}
              </Text>
              {s.body[0] ? (
                <Text type="body" color="secondary" maxLines={2}>
                  {s.body[0]}
                </Text>
              ) : null}
            </button>
          ))}
        </VStack>
      ) : null}
    </VStack>
  );
}

type PptxPreviewerInstance = {
  preview: (file: ArrayBuffer) => Promise<unknown>;
  destroy: () => void;
};

function PptxPreview({ content }: { content: VaultFileContent }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fallbackSlides, setFallbackSlides] = useState<
    PptxSlideContent[] | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    let previewer: PptxPreviewerInstance | null = null;

    setLoading(true);
    setParseError(null);
    setFallbackSlides(null);

    void (async () => {
      const buffer = contentToArrayBuffer(content);

      const loadFallback = async () => {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(buffer);
        return parsePptxSlidesFromZip(zip);
      };

      try {
        const mod = await import("pptx-preview");
        if (cancelled) {
          return;
        }
        const host = hostRef.current;
        if (!host) {
          throw new Error("Preview container not ready");
        }
        host.innerHTML = "";
        const measured = host.clientWidth;
        const width = Math.min(Math.max(measured || 720, 320), 960);
        const height = Math.round(width * (9 / 16));
        previewer = mod.init(host, {
          width,
          height,
          mode: "list",
        }) as PptxPreviewerInstance;
        await previewer.preview(buffer);
        if (!cancelled) {
          setLoading(false);
        }
      } catch {
        try {
          const slides = await loadFallback();
          if (!cancelled) {
            if (previewer) {
              try {
                previewer.destroy();
              } catch {
                /* ignore */
              }
              previewer = null;
            }
            if (hostRef.current) {
              hostRef.current.innerHTML = "";
            }
            setFallbackSlides(slides);
            setLoading(false);
          }
        } catch (err) {
          if (!cancelled) {
            setParseError(
              err instanceof Error
                ? err.message
                : "Failed to parse presentation",
            );
            setLoading(false);
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      if (previewer) {
        try {
          previewer.destroy();
        } catch {
          /* ignore */
        }
      }
      if (hostRef.current) {
        hostRef.current.innerHTML = "";
      }
    };
  }, [content]);

  if (parseError) {
    return (
      <EmptyState title="Preview failed" description={parseError} isCompact />
    );
  }

  if (fallbackSlides) {
    return <PptxFallbackSlides slides={fallbackSlides} />;
  }

  return (
    <VStack gap={2}>
      {loading ? (
        <Text type="body" color="secondary">
          Loading preview…
        </Text>
      ) : null}
      <div
        ref={hostRef}
        data-testid="pptx-visual-host"
        style={{
          width: "100%",
          maxWidth: "100%",
          overflow: "auto",
          visibility: loading ? "hidden" : "visible",
          minHeight: loading ? 1 : undefined,
        }}
      />
    </VStack>
  );
}

type CsvRow = Record<string, unknown> & { __rowId: string };

function CsvPreview({ text, path }: { text: string; path: string }) {
  const { columns, rows, totalDataRows, truncated } = useMemo(() => {
    const ext = extensionOf(path);
    const delimiter =
      ext === "tsv" ? ("\t" as const) : detectDelimiter(text);
    const matrix = parseCsv(text, delimiter);
    if (matrix.length === 0) {
      return {
        columns: [] as TableColumn<CsvRow>[],
        rows: [] as CsvRow[],
        totalDataRows: 0,
        truncated: false,
      };
    }

    const header = matrix[0]!;
    const dataRows = matrix.slice(1);
    const totalDataRows = dataRows.length;
    const visible = dataRows.slice(0, CSV_MAX_ROWS);
    const colCount = Math.max(
      header.length,
      ...visible.map((r) => r.length),
      1,
    );

    const columns: TableColumn<CsvRow>[] = [];
    for (let i = 0; i < colCount; i += 1) {
      const key = `col${i}`;
      const label = (header[i] ?? "").trim() || `Column ${i + 1}`;
      columns.push({
        key,
        header: label,
        renderCell: (row) => String(row[key] ?? ""),
      });
    }

    const rows: CsvRow[] = visible.map((cells, ri) => {
      const row: CsvRow = { __rowId: String(ri) };
      for (let i = 0; i < colCount; i += 1) {
        row[`col${i}`] = cells[i] ?? "";
      }
      return row;
    });

    return {
      columns,
      rows,
      totalDataRows,
      truncated: totalDataRows > CSV_MAX_ROWS,
    };
  }, [text, path]);

  if (columns.length === 0) {
    return (
      <Text type="body" color="secondary">
        Empty CSV
      </Text>
    );
  }

  return (
    <VStack gap={2}>
      {truncated ? (
        <Text type="body" color="secondary" size="sm">
          Showing first {CSV_MAX_ROWS} of {totalDataRows} rows
        </Text>
      ) : null}
      <div style={{ overflow: "auto", maxWidth: "100%" }}>
        <Table
          data={rows}
          columns={columns}
          idKey="__rowId"
          density="compact"
          dividers="rows"
          isStriped
        />
      </div>
    </VStack>
  );
}

export function VaultReader({ content, isLoading, error }: VaultReaderProps) {
  if (isLoading) {
    return (
      <Text type="body" color="secondary">
        Loading…
      </Text>
    );
  }

  if (error) {
    return <EmptyState title={error} isCompact />;
  }

  if (!content) {
    return <EmptyState title="Select a file" isCompact />;
  }

  const kind = resolveVaultPreviewKind(content);

  if (kind === "markdown") {
    return (
      <VStack gap={3}>
        <VaultReaderHeader path={content.path} />
        <Markdown headingLevelStart={2}>{decodeTextContent(content)}</Markdown>
      </VStack>
    );
  }

  if (kind === "pdf") {
    const dataUrl =
      content.encoding === "base64"
        ? `data:application/pdf;base64,${content.content}`
        : content.content;
    return (
      <VStack gap={3} height="100%" style={vaultReaderFillStyle}>
        <VaultReaderHeader path={content.path} />
        <StackItem
          size="fill"
          style={{
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <iframe
            style={vaultPdfStyle}
            title="PDF preview"
            src={dataUrl}
            data-testid="vault-pdf-preview"
          />
        </StackItem>
      </VStack>
    );
  }

  if (kind === "image") {
    const dataUrl =
      content.encoding === "base64"
        ? `data:${content.mime_type};base64,${content.content}`
        : content.content;
    return (
      <VStack gap={3}>
        <VaultReaderHeader path={content.path} />
        <img
          style={vaultImageStyle}
          alt={basename(content.path)}
          src={dataUrl}
        />
      </VStack>
    );
  }

  if (kind === "docx") {
    return (
      <VStack
        gap={3}
        data-preview-kind="docx"
        data-open-mode="preview"
        data-testid="vault-office-preview"
      >
        <VaultReaderHeader path={content.path} />
        <DocxPreview content={content} />
      </VStack>
    );
  }

  if (kind === "xlsx") {
    return (
      <VStack
        gap={3}
        data-preview-kind="xlsx"
        data-open-mode="preview"
        data-testid="vault-office-preview"
      >
        <VaultReaderHeader path={content.path} />
        <XlsxPreview content={content} />
      </VStack>
    );
  }

  if (kind === "pptx") {
    return (
      <VStack
        gap={3}
        data-preview-kind="pptx"
        data-open-mode="preview"
        data-testid="vault-office-preview"
      >
        <VaultReaderHeader path={content.path} />
        <PptxPreview content={content} />
      </VStack>
    );
  }

  if (kind === "html") {
    const html = decodeTextContent(content);
    return (
      <VStack gap={3}>
        <VaultReaderHeader path={content.path} />
        <iframe
          style={vaultHtmlStyle}
          title="HTML preview"
          srcDoc={html}
          sandbox=""
        />
      </VStack>
    );
  }

  if (kind === "csv") {
    const text = decodeTextContent(content);
    return (
      <VStack gap={3}>
        <VaultReaderHeader path={content.path} />
        <CsvPreview text={text} path={content.path} />
      </VStack>
    );
  }

  if (kind === "code") {
    const text = decodeTextContent(content);
    const language = languageFromPath(content.path);
    const multiLine = text.includes("\n");
    return (
      <VStack gap={3}>
        <VaultReaderHeader path={content.path} />
        <CodeBlock
          code={text}
          language={language}
          hasLineNumbers={multiLine}
          width="100%"
          maxHeight="70vh"
        />
      </VStack>
    );
  }

  return (
    <EmptyState
      title="Unsupported preview"
      description={content.mime_type}
      isCompact
    />
  );
}
