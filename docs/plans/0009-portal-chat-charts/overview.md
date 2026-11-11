# Portal chat charts + tables (Evil Charts + Astryx Table)

**Epic:** `lp-a79`  
**Date:** 2026-07-30  
**Playbook:** sequenced verifiable units  

### Beads map

| Bead | Phase |
|------|--------|
| lp-a79.1 | Spike: styling bridge + one bar proof |
| lp-a79.2 | ChartSpec v1 + parseChartSpec + tests |
| lp-a79.3 | Vendor Evil Recharts bar/line/area/pie (blocked on .1) |
| lp-a79.4 | PortalChartCard + palette mapper (blocked on .2, .3) |
| lp-a79.5 | Markdown `components.code` wire-up for charts (blocked on .4) |
| lp-a79.6 | Streaming / error / limits UX for charts (blocked on .5) |
| lp-a79.7 | Agent catalog doc (charts + tables; blocked on .2 + .10) |
| lp-a79.8 | Lazy load + a11y for charts (blocked on .4, .5) |
| lp-a79.9 | E2E/UI evidence charts bar + pie (blocked on .5, .6) |
| lp-a79.10 | TableSpec v1 + parseTableSpec + tests |
| lp-a79.11 | PortalTableCard via Astryx Table + rich cells + links |
| lp-a79.12 | Wire ` ```table ` fences into ChatMessageContent |
| lp-a79.13 | E2E/UI evidence: table with badge + vault/external link |

## Goals

1. When the agent (or user request → agent) produces a chart, Portal renders a polished interactive chart inline in chat.
2. Visual system: **Evil Charts** (Recharts engine first) for bar / line / area / pie.
3. When the agent produces a **table**, Portal renders it with **Astryx `@astryxdesign/core/Table`** (native design system — not HTML/GFM plain tables).
4. Tables support **rich cells** (categorical badges via Astryx `Badge` / `StatusDot`) and **links** (external → new tab; vault path → open vault/document pane).
5. Agent never emits React/JSX. Agent emits **versioned JSON** (`ChartSpecV1` / `TableSpecV1`); Portal maps it to components.
6. Integration sits on existing Astryx chat markdown (`ChatMessageContent` → `Markdown`), not a new side pane.

## Non-goals (v1)

- Radar, radial, composed, sankey (Evil Charts has them; defer).
- ECharts engine (dense time series); start Recharts only.
- Chart editing, export-to-image, or vault persistence of chart/table specs.
- Full-app Tailwind migration; only chart-surface styling glue.
- Agent runtime tool that *draws* charts server-side (optional later as `render_chart` tool).
- Full Table plugin suite (pagination, column settings, row expansion) unless needed for >N rows — v1 compact density + optional sort later.
- Replacing every GFM pipe-table in markdown automatically (Astryx `MarkdownComponents` has no `table` override today). Structured ```` ```table ```` is the rich path; plain GFM tables stay as Markdown default until/unless Astryx adds a table slot.

## Research summary

| Piece | Finding |
|-------|---------|
| Evil Charts | shadcn **registry** (copy-paste), not npm package. `pnpm dlx shadcn@latest add @evilcharts/recharts-bar-chart` etc. |
| Engines | Recharts (SVG, design-first) or ECharts (canvas). Same compound API shape. |
| Portal UI | `@astryxdesign/core` StyleX + neutral theme. **No chart components.** No recharts/motion today. |
| Astryx Table | First-class data-driven `Table` + `columns` + `renderCell`. Composition: Badge, StatusDot, Text, Avatar, HStack. Width via `proportional()` / `pixel()`. Density / dividers / hover built-in. |
| Bridge | Astryx ships `tailwind-theme.css` for hybrid Tailwind v4 + Astryx tokens (charts only). |
| Markdown | `Markdown` accepts `components.code` — fence hook for ```` ```chart ```` and ```` ```table ````. GFM tables parse, but **no** `components.table` override in 0.1.4. |
| Agent path | Schema + prompt/catalog; optional later SSE/tool event. |
| Chat links | Existing vault citation / `onCitationClick` / `isVaultPathHref` patterns in `ChatMessageContent` — reuse for table vault links. |

## Architecture

```
Agent message markdown
  ├── ```chart\n{ JSON ChartSpecV1 }\n```
  │     └── ChatMessageContent
  │           └── Markdown components.code
  │                 └── parseChartSpec ──fail──► ChartSpecErrorCard
  │                       │ ok
  │                       ▼
  │                 PortalChartCard (lazy)
  │                       ├── mapSpecToConfig (Lanyard palette)
  │                       └── Evil*Chart (vendored recharts-*)
  │
  └── ```table\n{ JSON TableSpecV1 }\n```
        └── ChatMessageContent
              └── Markdown components.code
                    └── parseTableSpec ──fail──► TableSpecErrorCard
                          │ ok
                          ▼
                    PortalTableCard
                          ├── map columns → Astryx TableColumn + renderCell
                          ├── text | number | badge | link cells
                          └── link.kind vault → onVaultPath; external → target=_blank
```

**Principle:** agent-facing contracts are stable JSON. Evil Charts and Astryx Table are implementation details under `portal/packages/web/src/features/chat/charts/` and `.../tables/` (or a shared `rich/` parent — implementer may colocate).

---

## ChartSpec v1 (agent-facing schema)

Single versioned object. Fence language: `chart` (preferred). Accept `chart-json` as alias.

### TypeScript (source of truth lives in portal; this is the plan sketch)

```ts
/** Semantic version of the wire schema — not the package version. */
export type ChartSpecVersion = 1;

export type ChartTypeV1 = "bar" | "line" | "area" | "pie";

/** One plotted series for cartesian charts (bar | line | area). */
export type ChartSeriesV1 = {
  /** Must match a key on each data row. */
  key: string;
  /** Legend / tooltip label. Defaults to key. */
  label?: string;
  /**
   * Optional CSS color. Prefer omitting so Portal applies brand palette.
   * Accepted for agent emphasis (e.g. "highlight this series in red").
   */
  color?: string;
};

export type ChartOptionsV1 = {
  /** Stack series (bar / area). Default false. */
  stacked?: boolean;
  /** Horizontal bars only. Default false. */
  horizontal?: boolean;
  /** Default true. */
  showLegend?: boolean;
  /** Default true for cartesian; ignored for pie. */
  showGrid?: boolean;
  /** Default true. */
  showTooltip?: boolean;
  /** Chart plot height in px. Clamped 160–480. Default 280. */
  height?: number;
};

/**
 * Discriminated by `type`.
 * Agent emits this as the sole content of a ```chart fence.
 */
export type ChartSpecV1 =
  | ChartSpecCartesianV1
  | ChartSpecPieV1;

type ChartSpecBaseV1 = {
  version: ChartSpecVersion; // must be 1
  title?: string;
  description?: string;
  data: ChartDataRow[];
  options?: ChartOptionsV1;
};

/** Row: string/number values only; nested objects rejected. */
export type ChartDataRow = Record<string, string | number | null>;

export type ChartSpecCartesianV1 = ChartSpecBaseV1 & {
  type: "bar" | "line" | "area";
  /** Category / independent axis key on each row. */
  xKey: string;
  /** At least one series. Keys must exist on rows (when non-null). */
  series: [ChartSeriesV1, ...ChartSeriesV1[]];
};

export type ChartSpecPieV1 = ChartSpecBaseV1 & {
  type: "pie";
  /** Slice label key. */
  nameKey: string;
  /** Slice value key (numeric). */
  valueKey: string;
  /**
   * Optional color list aligned to data order.
   * Prefer omit → Portal palette.
   */
  colors?: string[];
};
```

### Validation rules (parse boundary)

| Rule | Limit / behavior |
|------|------------------|
| JSON parse | Fail → error card with short message (no stack). |
| `version` | Must be `1`. |
| `type` | Enum only. |
| `data` | Array length 1…64 rows. |
| Series count | 1…8 for cartesian. |
| Keys | `xKey` / series keys / pie keys must be non-empty strings; present on ≥1 row. |
| Values | Numbers (or null) for series/valueKey; pie values ≥ 0. |
| Strings | Keys and labels max 64 chars; title max 120; description max 280. |
| Colors | Optional `#rgb` / `#rrggbb` / `#rrggbbaa` only (no `url()`, no CSS vars from agent). |
| Height | Clamp to 160–480. |
| Streaming | Do **not** parse incomplete fences; only when fence is closed (post-stream or complete block). |
| Fail-open | Invalid chart still shows as fenced code (or dedicated error card), never blank message. |

### Example: bar

````markdown
```chart
{
  "version": 1,
  "type": "bar",
  "title": "Q1 revenue vs cost",
  "xKey": "month",
  "series": [
    { "key": "revenue", "label": "Revenue" },
    { "key": "cost", "label": "Cost" }
  ],
  "data": [
    { "month": "Jan", "revenue": 120, "cost": 80 },
    { "month": "Feb", "revenue": 150, "cost": 95 },
    { "month": "Mar", "revenue": 180, "cost": 110 }
  ],
  "options": { "showLegend": true, "height": 280 }
}
```
````

### Example: line

````markdown
```chart
{
  "version": 1,
  "type": "line",
  "title": "Weekly active users",
  "xKey": "week",
  "series": [{ "key": "wau", "label": "WAU" }],
  "data": [
    { "week": "W1", "wau": 420 },
    { "week": "W2", "wau": 510 },
    { "week": "W3", "wau": 498 },
    { "week": "W4", "wau": 620 }
  ]
}
```
````

### Example: area

````markdown
```chart
{
  "version": 1,
  "type": "area",
  "title": "Traffic sources",
  "xKey": "day",
  "series": [
    { "key": "organic", "label": "Organic" },
    { "key": "paid", "label": "Paid" }
  ],
  "data": [
    { "day": "Mon", "organic": 40, "paid": 12 },
    { "day": "Tue", "organic": 44, "paid": 18 },
    { "day": "Wed", "organic": 51, "paid": 15 }
  ],
  "options": { "stacked": true }
}
```
````

### Example: pie

````markdown
```chart
{
  "version": 1,
  "type": "pie",
  "title": "Share of spend",
  "nameKey": "category",
  "valueKey": "amount",
  "data": [
    { "category": "Compute", "amount": 42 },
    { "category": "Storage", "amount": 18 },
    { "category": "Network", "amount": 12 },
    { "category": "Other", "amount": 8 }
  ]
}
```
````

---

## PortalChartCard API (frontend)

```ts
// features/chat/charts/types.ts  — ChartSpecV1 above

// features/chat/charts/parseChartSpec.ts
export type ParseChartSpecOk = { ok: true; spec: ChartSpecV1 };
export type ParseChartSpecErr = {
  ok: false;
  error: string;       // short, user-safe
  code: "json" | "schema" | "limits" | "empty";
};
export type ParseChartSpecResult = ParseChartSpecOk | ParseChartSpecErr;

/** Pure. Safe for unit tests. Never throws. */
export function parseChartSpec(input: string): ParseChartSpecResult;

// features/chat/charts/PortalChartCard.tsx
export type PortalChartCardProps = {
  spec: ChartSpecV1;
  /** Optional test id prefix. */
  "data-testid"?: string;
  isLoading?: boolean;
};

/**
 * Renders title + Evil chart. Lazy-load heavy chart engine from parent
 * via React.lazy boundary in ChatChartCodeBlock.
 */
export function PortalChartCard(props: PortalChartCardProps): JSX.Element;

// features/chat/charts/ChatChartCodeBlock.tsx
/**
 * Markdown `components.code` implementation.
 * language in { chart, chart-json } → parse → PortalChartCard | error.
 * other languages → default Astryx CodeBlock behavior (delegate).
 */
export function ChatChartCodeBlock(props: {
  code: string;
  language?: string;
}): JSX.Element;

// features/chat/charts/mapSpecToEvilConfig.ts
/** Build Evil Charts ChartConfig + series color CSS vars from Lanyard palette. */
export function mapSpecToEvilConfig(spec: ChartSpecV1): {
  config: ChartConfig;
  // type-specific props handed to EvilBarChart | EvilLineChart | …
};
```

### Brand palette (default series colors)

Order applied when agent omits `color`:

1. `#0047ab` (primary)
2. `#4f81bd` (supporting)
3. `#000080` (navy)
4. `#0d9488` (teal accent)
5. `#b45309` (amber)
6. `#be123c` (rose)
7. `#6d28d9` (violet)
8. `#374151` (neutral)

Light/dark: v1 ships light-only (Portal default). Config still fills both `light` and `dark` arrays with the same colors so Evil Charts validation passes.

### Layout chrome

```
┌─────────────────────────────────────────┐
│ Title (optional)                        │
│ Description (optional, muted)           │
│ ┌─────────────────────────────────────┐ │
│ │         Evil*Chart (plot)           │ │
│ │         height from options         │ │
│ └─────────────────────────────────────┘ │
│ Legend (if enabled; may be in-plot)     │
└─────────────────────────────────────────┘
```

Use Astryx `Card` (or plain bordered surface with Astryx spacing tokens) for the outer shell so charts feel native in chat; Evil Charts owns only the plot SVG.

---

## TableSpec v1 (agent-facing schema)

Fence language: `table` (alias `table-json`). Rendered with **Astryx `Table`**, not raw HTML.

### Why not only GFM pipe tables?

Astryx Markdown already parses GFM `|` tables, but `MarkdownComponents` (core 0.1.4) has **no `table` slot** — so we cannot swap the default table chrome for XDS Table without forking Markdown. Structured JSON also enables:

- typed **badge** cells (categorical)
- **vault** vs **external** links with correct click behavior
- column align/width hints
- stable agent contract independent of pipe escaping

Plain GFM tables remain readable as Markdown’s default; agent is instructed to prefer ` ```table ` when badges/links matter.

### TypeScript sketch

```ts
export type TableSpecVersion = 1;

/** Column role for default formatting when cells are scalars. */
export type TableColumnTypeV1 =
  | "text"
  | "number"
  | "badge"   // categorical → Astryx Badge
  | "link";   // link object or string URL/path

export type TableColumnAlignV1 = "start" | "center" | "end";

export type TableColumnV1 = {
  key: string;
  header?: string;
  type?: TableColumnTypeV1; // default "text"
  align?: TableColumnAlignV1;
  /** Relative width weight; maps to proportional(n). Default 1. */
  widthWeight?: number;
  sortable?: boolean; // v1 optional; wire useTableSortable only if true on any col
};

/** Scalar cell — type inferred from column.type */
export type TableScalarCellV1 = string | number | boolean | null;

/**
 * Explicit rich cell. Prefer this for badges and links so agents
 * do not rely on column-level type alone when a row mixes kinds.
 */
export type TableRichCellV1 =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number; format?: "plain" | "compact" | "percent" }
  | {
      kind: "badge";
      /** Display label */
      label: string;
      /**
       * Maps to Astryx Badge variant when possible.
       * Unknown → default/neutral badge.
       */
      tone?: "neutral" | "success" | "warning" | "error" | "info" | "accent";
    }
  | {
      kind: "link";
      label: string;
      /**
       * - external: https? URL → open new tab (rel=noopener)
       * - vault: vault-relative or absolute vault path → onVaultPath click
       *   (document pane / vault deep-link), same family as citation chips
       */
      href: string;
      target?: "auto" | "external" | "vault";
      /**
       * external only: default true → target=_blank
       * vault always stays in-app (never full navigation to file://)
       */
      openInNewTab?: boolean;
    };

export type TableCellV1 = TableScalarCellV1 | TableRichCellV1;

export type TableRowV1 = Record<string, TableCellV1>;

export type TableOptionsV1 = {
  density?: "compact" | "balanced" | "spacious"; // default compact in chat
  dividers?: "rows" | "columns" | "grid" | "none"; // default rows
  isStriped?: boolean;
  hasHover?: boolean; // default true
  /** Max body rows before truncate + “showing N of M” note. Default 50, hard max 100. */
  maxRows?: number;
};

export type TableSpecV1 = {
  version: TableSpecVersion; // 1
  title?: string;
  description?: string;
  columns: [TableColumnV1, ...TableColumnV1[]]; // 1…12
  rows: TableRowV1[]; // 0…100 (empty table allowed with headers)
  options?: TableOptionsV1;
};
```

### Validation rules

| Rule | Limit / behavior |
|------|------------------|
| JSON / version | Same pattern as charts |
| columns | 1…12; unique keys |
| rows | 0…100; extra rows dropped with warning in error? Prefer hard reject over-limit |
| cell strings | label/header max 120 chars; href max 2048 |
| link.href | external must be `http:`/`https:` only; vault must not be `javascript:` / `data:` |
| badge.tone | enum; unknown → neutral |
| target auto | `https?://` → external; else vault path heuristics (reuse `isVaultPathHref` / relative path rules) |

### Example: categories + vault + external links

````markdown
```table
{
  "version": 1,
  "title": "Open findings",
  "columns": [
    { "key": "id", "header": "ID", "type": "text", "widthWeight": 1 },
    { "key": "severity", "header": "Severity", "type": "badge", "align": "center" },
    { "key": "owner", "header": "Owner", "type": "text" },
    { "key": "doc", "header": "Doc", "type": "link" },
    { "key": "ticket", "header": "Ticket", "type": "link" }
  ],
  "rows": [
    {
      "id": "F-12",
      "severity": { "kind": "badge", "label": "High", "tone": "error" },
      "owner": "Alex",
      "doc": {
        "kind": "link",
        "label": "runbook.md",
        "href": "docs/runbooks/finding-f12.md",
        "target": "vault"
      },
      "ticket": {
        "kind": "link",
        "label": "LIN-204",
        "href": "https://linear.app/example/issue/LIN-204",
        "target": "external",
        "openInNewTab": true
      }
    },
    {
      "id": "F-13",
      "severity": { "kind": "badge", "label": "Low", "tone": "success" },
      "owner": "Sam",
      "doc": {
        "kind": "link",
        "label": "notes.md",
        "href": "projects/alpha/notes.md",
        "target": "vault"
      },
      "ticket": null
    }
  ],
  "options": { "density": "compact", "hasHover": true, "dividers": "rows" }
}
```
````

Scalar shorthand for badge columns (optional convenience):

```json
{ "severity": "High" }
```

…with `columns[].type: "badge"` maps label=`High`, tone from a small label→tone map (`high/error`, `medium/warning`, `low/success`, default neutral) or always neutral if unknown.

---

## PortalTableCard API

```ts
// features/chat/tables/types.ts — TableSpecV1 above

// features/chat/tables/parseTableSpec.ts
export function parseTableSpec(input: string): ParseTableSpecResult; // never throws

// features/chat/tables/PortalTableCard.tsx
export type PortalTableCardProps = {
  spec: TableSpecV1;
  /** Vault path click — same contract as ChatMessageContent onCitationClick */
  onVaultPath?: (path: string) => void;
  /** Optional project root for relative vault resolution */
  projectVaultPath?: string | null;
  "data-testid"?: string;
};

/**
 * Renders title + Astryx Table.
 * columns → TableColumn[] with width: proportional(widthWeight),
 * renderCell from cell kind / column type.
 */
export function PortalTableCard(props: PortalTableCardProps): JSX.Element;

// features/chat/tables/renderTableCell.tsx
/** Pure-ish mapper: TableCellV1 + column meta → ReactNode using Badge, Text, Link. */
export function renderTableCell(...): ReactNode;

// features/chat/tables/ChatTableCodeBlock — or extend unified ChatRichCodeBlock
// language in { table, table-json }
```

### Astryx composition (required)

| Cell kind | Astryx primitive |
|-----------|------------------|
| text | default cell / `Text` |
| number | `Text` end-aligned when column.align end |
| badge | `Badge` (`label`, map tone → variant) |
| link external | `Link` or `<a target="_blank" rel="noopener noreferrer">` |
| link vault | clickable control (Button/Link/Token-style) calling `onVaultPath` — **never** navigate browser to filesystem path |

Table chrome:

```tsx
import { Table, proportional } from "@astryxdesign/core/Table";
import { Badge } from "@astryxdesign/core/Badge";
// ...

<Table
  data={rowsWithId}
  columns={astryxColumns}
  density={options.density ?? "compact"}
  dividers={options.dividers ?? "rows"}
  isStriped={options.isStriped}
  hasHover={options.hasHover ?? true}
  textOverflow="truncate"
/>
```

Each data row needs a stable React key field — inject `__rowId` or use index in a wrapper type `TableRowModel`.

### Layout chrome

```
┌─────────────────────────────────────────┐
│ Title (optional)                        │
│ Description (optional)                  │
│ ┌─────────────────────────────────────┐ │
│ │  Astryx Table (scroll-x if needed)  │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

Horizontal overflow: wrap table in overflow-x auto container so chat column width does not crush columns (Astryx warns to set proportional widths).

---

## Evil Charts integration strategy

### Engine

- **v1:** Recharts only (`@evilcharts/recharts-{bar,line,area,pie}-chart`).
- Lazy `import()` so non-chart chats do not pay for recharts/motion.

### Install / vendor

Evil Charts is not an npm library. Plan:

1. Add runtime deps: `recharts`, `motion`.
2. Optionally add Tailwind v4 **scoped** to chart CSS entry (see below) **or** rewrite vendored classnames to plain CSS modules / Astryx tokens.
3. Vendor shared UI modules into:

```
portal/packages/web/src/features/chat/charts/evil/
  ui/          # recharts-chart, tooltip, legend, brush, background
  charts/      # bar, line, area, pie
  lib/utils.ts # cn() if Tailwind path chosen
```

4. Document upstream SHA/URL in `evil/VENDOR.md` for re-pulls.
5. Prefer registry pull once in a spike bead, then commit vendored source (no runtime network).

### Styling decision (spike chooses one)

| Option | Approach | Risk |
|--------|----------|------|
| **A (preferred spike)** | Tailwind v4 + `@astryxdesign/core/tailwind-theme.css` imported only from chart CSS entry; chart root gets isolation class. | Tailwind build plumbing in Vite. |
| **B** | Rewrite Evil classnames to a small `chart.css` using Astryx CSS vars. | More vendor churn; cleaner long-term DS purity. |

Spike bead must pick A or B with a one-line note in `VENDOR.md` before full vendor of four chart types.

### Path aliases

Vite already supports `@/` or package-relative imports — prefer **relative imports within `charts/evil/`** so we do not depend on shadcn `@/components` layout.

---

## Chat integration

### File touch points

| File | Change |
|------|--------|
| `ChatMessageContent.tsx` | Merge `components.code` with citations; route `chart` / `table` languages; pass `onCitationClick` → table vault links. |
| `ChatMessageContent.test.tsx` | Fixtures for ` ```chart ` and ` ```table ` fences. |
| New `features/chat/charts/*` | Chart spec, parse, card, vendor, tests. |
| New `features/chat/tables/*` | Table spec, parse, PortalTableCard, cell renderers, tests. |
| Prefer unified `ChatRichCodeBlock` | Single `components.code` that dispatches chart \| table \| default code. |
| `package.json` | `recharts`, `motion` (+ tailwind if Option A). No extra dep for tables (Astryx already present). |

### Streaming behavior

- While `isStreaming` and the trailing fence is incomplete: show code placeholder or nothing (do not flash error).
- When stream completes or fence closes mid-message: parse and render chart/table.
- Implementation: rich code block always parse; if `JSON.parse` fails and parent says streaming, render muted “Building chart/table…” skeleton; if not streaming, show error card.

### Accessibility

- Title as heading or `aria-label` on chart/table container.
- Evil/Recharts accessibilityLayer where available.
- Respect `prefers-reduced-motion` (Evil Charts already gates grow-in).
- Tables: real `<table>` semantics from Astryx; links keyboard-focusable; vault controls are buttons/links with clear labels.

---

## Agent understanding (catalog)

Agents do not import frontend code. They need:

1. **System / tool prompt fragment** (host-owned or Portal-injected context pack):
   - When user asks for a chart or numbers benefit from visualization, emit a ` ```chart ` block.
   - When presenting tabular comparisons, inventories, findings, or anything with categories/links, emit a ` ```table ` block (prefer over pipe tables when badges/links matter).
   - Schema summary + chart examples (bar/line/area/pie) + table examples (badge + vault + external).
   - Limits (charts: 64 rows / 8 series; tables: 100 rows / 12 cols).
2. **Optional tool** (phase 2): `emit_chart` / `emit_table` with JSON args identical to specs — UI can also render from tool result cards. v1 markdown fence is enough if Hermes/LA already streams markdown.

**Ownership:** Portal owns schema + renderer. Agent host (Hermes / Lanyard Agent) owns prompt inclusion.

**Agent catalog (host prompt handoff):** [agent-chart-catalog.md](./agent-chart-catalog.md)  
**E2E verify (prompt → binary → inline paint, `lp-75r.9`):** [e2e-verify-rich-blocks.md](./e2e-verify-rich-blocks.md)  
— schema summary, limits, four chart examples + table example, anti-patterns, copy-paste prompt fragment, and where Hermes / Lanyard Agent should include it (external repos; no host code in this monorepo).

---

## Testing strategy

| Layer | What |
|-------|------|
| Unit | `parseChartSpec` — valid/invalid/limits/pie vs cartesian. |
| Unit | `parseTableSpec` — columns/rows limits, badge/link cells, href allowlist. |
| Unit | `mapSpecToEvilConfig` — palette assignment, stacked flags. |
| Unit | `renderTableCell` / link target resolution (vault vs external). |
| Component | `PortalChartCard` renders title + plot container. |
| Component | `PortalTableCard` renders Astryx Table with Badge + link. |
| Component | `ChatMessageContent` with chart/table fences uses code override. |
| Visual (optional) | Playwright screenshot of fixture thread with charts + table. |
| Bundle | Assert chart chunk is separate (vite manualChunks or dynamic import smoke). |

---

## Phased implementation (beads map)

| Phase | Bead focus | Exit criteria |
|-------|------------|---------------|
| 0 | Spike: styling bridge Option A vs B + one bar chart story | Decision in VENDOR.md; bar renders in Story/dev page |
| 1 | ChartSpec v1 + parseChartSpec + tests | Pure module green |
| 2 | Vendor Evil Recharts bar/line/area/pie + deps | Imports resolve; no network at build |
| 3 | PortalChartCard + mapper + brand palette | Four types from fixtures |
| 4 | Markdown `components.code` wire-up (charts) | Real chat message renders chart |
| 5 | Streaming / error / limits UX (charts; extend for tables in .12) | No blank fails; stream-safe |
| 6 | Agent catalog doc + prompt handoff (charts + tables) | Docs + example messages |
| 7 | Lazy load + size budget + a11y pass (charts) | Dynamic import; reduced motion |
| 8 | E2E charts evidence | Playwright or UI-testing proof artifact |
| 9 | TableSpec v1 + parseTableSpec + tests | Pure module green |
| 10 | PortalTableCard + rich cells + vault/external links | Astryx Table from fixtures |
| 11 | Markdown wire-up for ` ```table ` | Chat renders table; vault click wired |
| 12 | E2E table evidence (badge + links) | Screenshot/test pass |

Dependencies: chart chain as before. Tables: `.10` parallel with charts; `.11` needs `.10`; `.12` needs `.11` + vault click props from chat; `.7` needs `.2` and `.10`; `.13` E2E needs `.12`.

---

## File layout (target)

```
portal/packages/web/src/features/chat/charts/
  index.ts
  types.ts
  parseChartSpec.ts
  parseChartSpec.test.ts
  mapSpecToEvilConfig.ts
  mapSpecToEvilConfig.test.ts
  PortalChartCard.tsx
  PortalChartCard.test.tsx
  ChartSpecErrorCard.tsx
  palette.ts
  evil/
    VENDOR.md
    charts/
    ui/
    lib/
portal/packages/web/src/features/chat/tables/
  index.ts
  types.ts
  parseTableSpec.ts
  parseTableSpec.test.ts
  renderTableCell.tsx
  renderTableCell.test.ts
  resolveTableLink.ts
  resolveTableLink.test.ts
  PortalTableCard.tsx
  PortalTableCard.test.tsx
  TableSpecErrorCard.tsx
portal/packages/web/src/features/chat/
  ChatRichCodeBlock.tsx   # dispatches chart | table | default code
  ChatMessageContent.tsx  # wires components.code + onVaultPath
docs/plans/0009-portal-chat-charts/
  overview.md
  agent-chart-catalog.md  # charts + tables
```

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Tailwind vs StyleX conflict | Scope Tailwind utilities under `.portal-chart` root; spike early. Tables stay pure Astryx. |
| Vendor drift | Pin git SHA in VENDOR.md; only re-pull on deliberate bead. |
| Bundle bloat | Dynamic import charts only; tables use existing Astryx. |
| Agent bad JSON | Strict parse + error card + fall back to code block. |
| XSS via chart/table JSON | No raw HTML cells; link schemes allowlisted; no `javascript:`/`data:`. |
| Streaming flicker | Gate incomplete JSON while `isStreaming`. |
| Vault path navigation | Reuse citation path resolution; never `<a href="/abs/path">` full page nav. |
| GFM vs rich table confusion | Catalog: use fence for rich; GFM ok for plain only. |

---

## Acceptance (epic-level)

- [ ] Agent-emitted ` ```chart ` JSON (ChartSpec v1) renders bar/line/area/pie inline in Portal chat.
- [ ] Agent-emitted ` ```table ` JSON (TableSpec v1) renders via **Astryx Table** with compact chat density.
- [ ] Table cells support **badge** (categorical) and **link** (external new-tab + vault open-in-pane).
- [ ] Invalid/incomplete specs never crash the timeline; error or skeleton only.
- [ ] Charts use Lanyard brand palette by default and Evil Charts Recharts visuals.
- [ ] Agent catalog documents chart + table schemas and examples for host prompt inclusion.
- [ ] Unit tests for chart/table parse + mappers; UI proof for bar + pie + table (badge + link).
- [ ] Chart code is lazy-loaded (no recharts on initial shell for non-chart sessions).
