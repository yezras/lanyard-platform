/**
 * Unified Markdown `components.code` dispatcher for chat rich fences.
 *
 * Languages:
 * - table | table-json → parseTableSpec → PortalTableCard | skeleton | error
 * - chart | chart-json → parseChartSpec → PortalChartCard | skeleton | error
 * - everything else → Astryx CodeBlock (same as Markdown default)
 *
 * Beads: lp-a79.12 (tables), lp-a79.5 (charts), lp-a79.6 (chart streaming/error UX),
 *        lp-a79.8 (lazy chart chunk + a11y)
 * Plan: docs/plans/0009-portal-chat-charts/overview.md § Streaming behavior
 *
 * isStreaming is closed over from ChatMessageContent (Markdown does not pass
 * it on components.code). Prefer stable factory identity so valid charts are
 * not remounted when only streaming state / minor props change — callers use
 * a live options getter or keep isStreaming out of useMemo deps via ref.
 *
 * Chart engine (recharts / Evil / motion) is React.lazy-loaded so the default
 * chat shell does not ship recharts. parseChartSpec stays in the main chunk
 * (small pure JS).
 */

import {
  Component,
  lazy,
  memo,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from "react";

import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Text } from "@astryxdesign/core/Text";

// Direct imports (not charts/index barrel) so tree-shaking never pulls evil/recharts.
import { ChartSpecErrorCard } from "./charts/ChartSpecErrorCard.js";
import {
  parseChartSpec,
  type ParseChartSpecErr,
} from "./charts/parseChartSpec.js";
import { CHART_HEIGHT_DEFAULT } from "./charts/palette.js";
import type { ChartSpecV1 } from "./charts/types.js";
import {
  parseTableSpec,
  PortalTableCard,
  TableSpecErrorCard,
} from "./tables/index.js";

/**
 * Async chunk: PortalChartCard + mapSpecToEvilConfig + evil/* + recharts + motion.
 * See evil/VENDOR.md § Bundle / lazy load (lp-a79.8).
 */
const LazyPortalChartCard = lazy(async () => {
  const m = await import("./charts/PortalChartCard.js");
  return { default: m.PortalChartCard };
});

/** Fence languages that render as PortalTableCard. */
export const TABLE_FENCE_LANGUAGES = new Set(["table", "table-json"]);

/** Fence languages that render as PortalChartCard. */
export const CHART_FENCE_LANGUAGES = new Set(["chart", "chart-json"]);

export type ChatRichCodeBlockOptions = {
  isStreaming?: boolean;
  /**
   * Live options read on each code-block render. When provided, wins over
   * static `isStreaming` / vault fields so factory identity can stay stable
   * while stream state flips (avoids remounting valid charts).
   */
  getOptions?: () => ChatRichCodeBlockOptions;
  /** Vault link clicks — same contract as ChatMessageContent onCitationClick. */
  onVaultPath?: (path: string) => void;
  /** Project root for relative vault resolution in table cells. */
  projectVaultPath?: string | null;
};

export type ChatRichCodeBlockProps = {
  code: string;
  language?: string;
};

const skeletonBaseStyle: CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  padding: "var(--spacing-3, 12px)",
  borderRadius: "var(--radius-md, 8px)",
  border: "1px solid var(--color-border-default, rgba(0,0,0,0.08))",
  background: "var(--color-bg-muted, rgba(0,0,0,0.03))",
  display: "flex",
  alignItems: "center",
};

function normalizeLanguage(language?: string): string {
  return (language ?? "").trim().toLowerCase();
}

function resolveOptions(
  options: ChatRichCodeBlockOptions,
): Required<
  Pick<ChatRichCodeBlockOptions, "isStreaming">
> &
  Pick<ChatRichCodeBlockOptions, "onVaultPath" | "projectVaultPath"> {
  const live = options.getOptions?.() ?? {};
  return {
    isStreaming: live.isStreaming ?? options.isStreaming ?? false,
    onVaultPath: live.onVaultPath ?? options.onVaultPath,
    projectVaultPath:
      live.projectVaultPath !== undefined
        ? live.projectVaultPath
        : options.projectVaultPath,
  };
}

/**
 * Muted placeholder while streaming incomplete table/chart JSON.
 * Avoids flashing error cards mid-stream.
 * Chart skeleton uses default plot height so layout does not jump when the
 * real chart mounts (lp-a79.6).
 */
export function RichSpecSkeleton({
  label = "Building table…",
  kind = "table",
}: {
  label?: string;
  kind?: "table" | "chart";
}): ReactNode {
  const style: CSSProperties =
    kind === "chart"
      ? {
          ...skeletonBaseStyle,
          minHeight: CHART_HEIGHT_DEFAULT,
          justifyContent: "center",
        }
      : { ...skeletonBaseStyle, minHeight: 64 };

  return (
    <div
      style={style}
      data-testid="rich-spec-skeleton"
      data-skeleton-kind={kind}
      aria-busy="true"
      aria-live="polite"
    >
      <Text type="body" color="secondary" size="sm">
        {label}
      </Text>
    </div>
  );
}

function DefaultCodeBlock({
  code,
  language,
}: ChatRichCodeBlockProps): ReactNode {
  return <CodeBlock code={code} language={language} isCollapsible />;
}

function TableFenceBody({
  code,
  isStreaming,
  onVaultPath,
  projectVaultPath,
}: {
  code: string;
  isStreaming?: boolean;
  onVaultPath?: (path: string) => void;
  projectVaultPath?: string | null;
}): ReactNode {
  const parsed = parseTableSpec(code);

  if (parsed.ok) {
    return (
      <PortalTableCard
        spec={parsed.spec}
        projectVaultPath={projectVaultPath}
        onVaultPath={onVaultPath}
      />
    );
  }

  // Incomplete / empty JSON while streaming — skeleton, not error flash.
  if (
    isStreaming &&
    (parsed.code === "json" || parsed.code === "empty")
  ) {
    return <RichSpecSkeleton label="Building table…" kind="table" />;
  }

  return <TableSpecErrorCard error={parsed.error} code={parsed.code} />;
}

/**
 * Isolate chart engine failures (recharts Invalid hook call / dual React,
 * bad ResponsiveContainer measure, evil chart context) so a ```chart fence
 * cannot wipe the parent assistant turn — tools + subagent chips stay visible
 * after hard reload (lp-uxy.11 UIQA).
 */
export class ChartFenceErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("[ChatRichCodeBlock] chart fence render failed:", error);
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <ChartSpecErrorCard
          message="Could not display this chart"
          code="schema"
          raw=""
        />
      );
    }
    return this.props.children;
  }
}

/**
 * Memoized chart card so identical specs across streaming tokens do not
 * remount Recharts (lp-a79.6: prefer not to unmount valid charts).
 * Suspense fallback reuses the chart-height skeleton so layout stays stable
 * while the lazy chunk loads (lp-a79.8).
 * ChartFenceErrorBoundary (lp-uxy.11) keeps recharts throws out of the turn.
 */

/**
 * Always-safe chart summary (no recharts). recharts Invalid hook call often
 * fires in useLayoutEffect and bypasses error boundaries, wiping the whole
 * assistant turn on hard reload (lp-uxy.11 UIQA residual).
 */
function StaticChartTable({
  spec,
}: {
  spec: import("./charts/types.js").ChartSpecV1;
}): ReactNode {
  const rows = Array.isArray(spec.data) ? spec.data.slice(0, 24) : [];
  const keys = new Set<string>();
  if (spec.type === "pie") {
    keys.add(spec.nameKey);
    keys.add(spec.valueKey);
  } else {
    keys.add(spec.xKey);
    for (const s of spec.series) keys.add(s.key);
  }
  const cols = [...keys];
  return (
    <div
      data-testid="chat-static-chart-table"
      style={{
        width: "100%",
        overflowX: "auto",
        border: "1px solid var(--color-border, #e5e7eb)",
        borderRadius: 8,
        padding: 12,
      }}
    >
      {spec.title ? (
        <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 14 }}>
          {spec.title}
        </div>
      ) : null}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                style={{
                  textAlign: "left",
                  padding: "4px 8px",
                  borderBottom: "1px solid var(--color-border, #e5e7eb)",
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td
                  key={c}
                  style={{
                    padding: "4px 8px",
                    borderBottom: "1px solid var(--color-border, #f3f4f6)",
                  }}
                >
                  {row[c] == null ? "" : String(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {spec.data.length > rows.length ? (
        <Text type="supporting" color="secondary" style={{ marginTop: 6 }}>
          Showing {rows.length} of {spec.data.length} rows
        </Text>
      ) : null}
    </div>
  );
}

/**
 * Prefer static table; interactive recharts only on explicit user request so
 * dual-React / Invalid hook call cannot blank multi-subagent turns (lp-uxy.11).
 */
function SafeStablePortalChartCard({
  spec,
}: {
  spec: import("./charts/types.js").ChartSpecV1;
}): ReactNode {
  const [mode, setMode] = useState<"static" | "interactive" | "failed">(
    "static",
  );

  useEffect(() => {
    if (mode !== "interactive") return;
    const onErr = (event: ErrorEvent) => {
      const msg = String(event.message ?? event.error ?? "");
      if (
        /Invalid hook call|useContext\(null\)|Cannot read propert(y|ies) of null/i.test(
          msg,
        )
      ) {
        event.preventDefault?.();
        setMode("failed");
      }
    };
    window.addEventListener("error", onErr);
    return () => window.removeEventListener("error", onErr);
  }, [mode]);

  if (mode === "static" || mode === "failed") {
    return (
      <div data-testid="chat-safe-chart-card">
        <StaticChartTable spec={spec} />
        {mode === "static" ? (
          <button
            type="button"
            data-testid="chat-chart-try-interactive"
            onClick={() => setMode("interactive")}
            style={{
              marginTop: 8,
              fontSize: 12,
              cursor: "pointer",
              background: "transparent",
              border: "1px solid var(--color-border, #e5e7eb)",
              borderRadius: 6,
              padding: "4px 8px",
            }}
          >
            Show interactive chart
          </button>
        ) : (
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }} data-testid="chat-chart-interactive-failed">
            Interactive chart unavailable (engine error). Table above is complete.
          </div>
        )}
      </div>
    );
  }

  return (
    <ChartFenceErrorBoundary>
      <Suspense
        fallback={<RichSpecSkeleton label="Loading chart…" kind="chart" />}
      >
        <LazyPortalChartCard spec={spec} />
      </Suspense>
    </ChartFenceErrorBoundary>
  );
}

const StablePortalChartCard = memo(function StablePortalChartCard({
  spec,
}: {
  spec: ChartSpecV1;
}): ReactNode {
  return (
    <ChartFenceErrorBoundary>
      <Suspense
        fallback={<RichSpecSkeleton label="Loading chart…" kind="chart" />}
      >
        <LazyPortalChartCard spec={spec} />
      </Suspense>
    </ChartFenceErrorBoundary>
  );
});

/**
 * Whether a chart parse failure should be withheld during streaming
 * (show skeleton instead of error card — no red flash on incomplete JSON).
 *
 * - json / empty: always incomplete mid-stream
 * - schema / limits: only when the fence body is still truncated-looking
 *   (unbalanced braces) so a complete-but-invalid stream chunk can still
 *   surface an error if the agent already finished the object early
 */
export function shouldWithholdChartErrorWhileStreaming(
  code: ParseChartSpecErr["code"],
  raw: string,
): boolean {
  if (code === "json" || code === "empty") {
    return true;
  }
  // Incomplete-looking body: still streaming the object.
  const trimmed = raw.trim();
  if (!trimmed) return true;
  const opens = (trimmed.match(/\{/g) ?? []).length;
  const closes = (trimmed.match(/\}/g) ?? []).length;
  if (opens > closes) return true;
  return false;
}

/**
 * Chart fence body for ```chart / ```chart-json.
 * Plan name: ChatChartCodeBlock — lives in the unified dispatcher.
 *
 * Paths:
 * - ok → PortalChartCard (memoized, error-boundary isolated)
 * - streaming + incomplete → muted “Building chart…” skeleton
 * - complete invalid → ChartSpecErrorCard (json | schema | limits | empty)
 */
export function ChartFenceBody({
  code,
  isStreaming,
}: {
  code: string;
  isStreaming?: boolean;
}): ReactNode {
  let parsed: ReturnType<typeof parseChartSpec>;
  try {
    parsed = parseChartSpec(code);
  } catch {
    return (
      <ChartSpecErrorCard
        message="Could not parse chart fence"
        code="json"
        raw={code}
      />
    );
  }

  if (parsed.ok) {
    return <SafeStablePortalChartCard spec={parsed.spec} />;
  }

  if (
    isStreaming &&
    shouldWithholdChartErrorWhileStreaming(parsed.code, code)
  ) {
    return <RichSpecSkeleton label="Building chart…" kind="chart" />;
  }

  return (
    <ChartSpecErrorCard
      message={parsed.error}
      code={parsed.code}
      raw={code}
    />
  );
}

/** Plan alias — same as ChartFenceBody for ```chart fences. */
export const ChatChartCodeBlock = ChartFenceBody;

/**
 * Factory so Markdown's fixed `{ code, language }` props can close over
 * streaming + vault context from ChatMessageContent.
 *
 * Prefer passing `getOptions` so the returned component identity can stay
 * fixed while `isStreaming` flips at stream end (no chart remount).
 */
export function createChatRichCodeBlock(
  options: ChatRichCodeBlockOptions = {},
): ComponentType<ChatRichCodeBlockProps> {
  function ChatRichCodeBlock({
    code,
    language,
  }: ChatRichCodeBlockProps): ReactNode {
    const {
      isStreaming,
      onVaultPath,
      projectVaultPath,
    } = resolveOptions(options);
    const lang = normalizeLanguage(language);

    if (TABLE_FENCE_LANGUAGES.has(lang)) {
      return (
        <TableFenceBody
          code={code}
          isStreaming={isStreaming}
          onVaultPath={onVaultPath}
          projectVaultPath={projectVaultPath}
        />
      );
    }

    if (CHART_FENCE_LANGUAGES.has(lang)) {
      return <ChartFenceBody code={code} isStreaming={isStreaming} />;
    }

    return <DefaultCodeBlock code={code} language={language} />;
  }

  ChatRichCodeBlock.displayName = "ChatRichCodeBlock";
  return ChatRichCodeBlock;
}
