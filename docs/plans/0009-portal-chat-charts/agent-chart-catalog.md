# Agent catalog: chat charts + tables

**Bead:** `lp-a79.7`  
**Epic:** `lp-a79`  
**Audience:** anyone wiring Hermes / Lanyard Agent (or other host) system prompts so agents emit rich chat blocks Portal can render.  
**You do not need** Evil Charts source, Astryx Table internals, or Portal React code to use this doc.

| Surface | Markdown fence | JSON contract | Portal source of truth |
|---------|----------------|---------------|------------------------|
| Chart | ` ```chart ` (alias `chart-json`) | `ChartSpecV1` | `portal/packages/web/src/features/chat/charts/types.ts` |
| Table | ` ```table ` (alias `table-json`) | `TableSpecV1` | `portal/packages/web/src/features/chat/tables/types.ts` |

**Related plan:** [overview.md](./overview.md) (architecture, renderer API, phased beads).

---

## Ownership

| Concern | Owner |
|---------|--------|
| Schema (`ChartSpecV1` / `TableSpecV1`), parsers, UI renderers | **Portal** (this monorepo) |
| Including the prompt fragment below in host system / tool prompts | **Agent host** (Hermes-Lanyard, Lanyard Agent, or other backend product — **external repos**) |
| Optional later tools (`emit_chart` / `emit_table`) | Host + Portal agreement; v1 is **markdown fences only** |

Portal does not inject this fragment into external agent products. Host maintainers copy the [Prompt fragment](#prompt-fragment-copy-paste) into their system prompt packs.

---

## When to use what

| User need | Prefer | Notes |
|-----------|--------|--------|
| Compare categories, time series, composition | **` ```chart `** | bar / line / area / pie only in v1 |
| Tabular inventory, findings, comparisons with status or links | **` ```table `** | badges + vault/external links |
| Tiny 2–3 column plain numbers, no badges/links | GFM pipe table **or** ` ```table ` | GFM stays readable; rich path is fence-only |
| Diagram / flowchart | Mermaid (existing chat path) | **Not** a chart fence |
| Custom React UI | — | **Never** emit JSX/TSX |

### Chart type guide

| Type | Use when |
|------|----------|
| `bar` | Discrete categories (months, teams, status buckets) |
| `line` | Trends over an ordered axis (weeks, versions) |
| `area` | Trends with volume emphasis; set `options.stacked: true` for parts-of-whole over time |
| `pie` | Share of a single total (few slices; prefer ≤8) |

### Table vs GFM

- Use **` ```table `** when you need **badge** cells, **vault** document links, **external** ticket/URL links, column types, or stable structured data.
- Use plain GFM `|` tables only for simple text grids. Portal does not upgrade GFM tables to Astryx Table in v1.

---

## Limits (hard)

Keep payloads small so chat stays responsive and parsers accept the block.

### Charts (`ChartSpecV1`)

| Rule | Limit |
|------|--------|
| `version` | Must be `1` |
| `type` | `bar` \| `line` \| `area` \| `pie` |
| `data` rows | 1…**64** |
| Cartesian series | 1…**8** |
| Keys / series labels | max **64** chars |
| `title` | max **120** chars |
| `description` | max **280** chars |
| Series / pie values | numbers (or `null`); pie values ≥ 0 |
| Colors (optional) | `#rgb` / `#rrggbb` / `#rrggbbaa` only — no `url()`, CSS vars, or named colors |
| `options.height` | 160–480 px (default 280; Portal clamps) |
| Row values | string \| number \| null only (no nested objects) |

### Tables (`TableSpecV1`)

| Rule | Limit |
|------|--------|
| `version` | Must be `1` |
| Columns | 1…**12**; unique `key`s |
| Rows | 0…**100** (empty table with headers allowed) |
| Header / cell labels | max **120** chars |
| `title` | max **120** chars |
| `description` | max **280** chars |
| Column / row keys | max **64** chars |
| Link `href` | max **2048** chars |
| `options.maxRows` | default 50 display hint; hard max **100** |
| Link schemes | external: `http:` / `https:` only; vault: path (no `javascript:` / `data:`) |
| Badge `tone` | `neutral` \| `success` \| `warning` \| `error` \| `info` \| `accent` |

---

## Schema summary

### ChartSpec v1

Fence body is **only** the JSON object (no prose inside the fence).

**Cartesian** (`bar` | `line` | `area`):

```ts
{
  version: 1;
  type: "bar" | "line" | "area";
  title?: string;
  description?: string;
  xKey: string;                    // category key on each data row
  series: [{ key: string; label?: string; color?: string }, ...]; // 1…8
  data: Array<Record<string, string | number | null>>; // 1…64
  options?: {
    stacked?: boolean;             // bar / area
    horizontal?: boolean;          // bar
    showLegend?: boolean;          // default true
    showGrid?: boolean;            // default true
    showTooltip?: boolean;         // default true
    height?: number;               // 160–480, default 280
  };
}
```

**Pie:**

```ts
{
  version: 1;
  type: "pie";
  title?: string;
  description?: string;
  nameKey: string;                 // slice label key
  valueKey: string;                // numeric slice value key
  data: Array<Record<string, string | number | null>>;
  colors?: string[];               // optional hex list aligned to data order
  options?: { showLegend?: boolean; showTooltip?: boolean; height?: number };
}
```

Prefer **omitting** `color` / `colors` so Portal applies the Lanyard brand palette.

### TableSpec v1

```ts
{
  version: 1;
  title?: string;
  description?: string;
  columns: [{
    key: string;
    header?: string;
    type?: "text" | "number" | "badge" | "link";  // default "text"
    align?: "start" | "center" | "end";
    widthWeight?: number;          // proportional width; default 1
    sortable?: boolean;            // optional; v1 may ignore until wired
  }, ...];                         // 1…12
  rows: Array<Record<string, Cell>>; // 0…100
  options?: {
    density?: "compact" | "balanced" | "spacious"; // chat default compact
    dividers?: "rows" | "columns" | "grid" | "none";
    isStriped?: boolean;
    hasHover?: boolean;
    maxRows?: number;              // ≤100
  };
}
```

**Cell** = scalar (`string` | `number` | `boolean` | `null`) **or** rich object:

| `kind` | Shape | Render |
|--------|--------|--------|
| `text` | `{ "kind": "text", "value": string }` | Plain text |
| `number` | `{ "kind": "number", "value": number, "format"?: "plain"\|"compact"\|"percent" }` | Number |
| `badge` | `{ "kind": "badge", "label": string, "tone"?: ... }` | Categorical badge |
| `link` | `{ "kind": "link", "label": string, "href": string, "target"?: "auto"\|"external"\|"vault", "openInNewTab"?: boolean }` | Link |

**Links:**

- `target: "external"` — `https?://…` → open in new tab (`rel=noopener`).
- `target: "vault"` — vault-relative or absolute vault path → open document/vault pane in Portal (in-app; never browser file navigation).
- `target: "auto"` (or omit) — `https?://` → external; otherwise treated as vault path.

Prefer **explicit rich cells** for badges and links so mixed rows stay unambiguous. Scalar shorthand on a `type: "badge"` column (e.g. `"severity": "High"`) may be normalized by Portal; do not rely on host-side tone maps.

---

## Examples (four chart types)

### Bar

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

### Line

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

### Area

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

### Pie

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

### Table (badges + vault + external links)

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

---

## Anti-patterns (do not)

| Do not | Why |
|--------|-----|
| Emit React / JSX / TSX / HTML widgets | Agents cannot mount components; Portal only parses JSON specs |
| Put chart data in a Mermaid fence | Mermaid is for diagrams; charts use ` ```chart ` |
| Dump 10k rows into a table or chart | Hard limits: 64 chart rows, 100 table rows — summarize or aggregate |
| Nest objects/arrays inside chart `data` cells | Only string \| number \| null |
| Use `javascript:`, `data:`, or non-http(s) external URLs in links | Rejected by parser |
| Put prose or markdown outside the JSON but inside the fence | Fence body must be a single JSON object |
| Rely on CSS color names or `var(--…)` for series colors | Hex only if set; prefer omit for brand palette |
| Use radar / sankey / composed / ECharts-only types | v1: bar, line, area, pie only |
| Expect GFM pipe tables to become badges/links | Rich cells require ` ```table ` |

Invalid or over-limit JSON does **not** crash chat: Portal shows an error card or falls back to fenced code. Prefer valid specs.

---

## Prompt fragment (copy-paste)

Host system-prompt authors: paste the block below into Hermes-Lanyard / Lanyard Agent (or other host) system prompts or prompt packs. Keep it in sync when Portal bumps `ChartSpec` / `TableSpec` version (still `1` as of this doc).

````text
## Portal rich blocks (charts + tables)

When numbers benefit from visualization, or the user asks for a chart/graph, emit a fenced JSON block with language tag `chart` (or `chart-json`). When presenting inventories, findings, comparisons, or rows that need status badges or links, emit a fenced JSON block with language tag `table` (or `table-json`). Prefer these over ASCII art. Prefer `table` over GFM pipe tables when badges or vault/external links matter.

Rules:
- Fence body must be a single JSON object. No JSX, HTML, or React.
- Charts: version must be 1; type one of bar | line | area | pie.
  - bar/line/area: require xKey, series (1–8 items with key), data (1–64 rows of string|number|null).
  - pie: require nameKey, valueKey, data (values ≥ 0).
  - Optional title/description; omit series colors unless emphasis needed (hex #rgb/#rrggbb only).
  - options may include stacked, horizontal, showLegend, showGrid, showTooltip, height (160–480).
- Tables: version must be 1; columns 1–12 with unique keys; rows 0–100.
  - column type: text | number | badge | link.
  - cells: scalars or rich {kind: text|number|badge|link, ...}.
  - badge: {kind:"badge", label, tone?: neutral|success|warning|error|info|accent}.
  - link: {kind:"link", label, href, target?: auto|external|vault}.
    - external: http(s) only, open in new tab.
    - vault: vault path; Portal opens document pane (never raw file:// navigation).
  - No javascript: or data: hrefs. Max 12 columns, 100 rows.
- Do not use mermaid for quantitative charts. Do not emit 10k-row dumps — aggregate first.
- Invalid JSON will show as an error in chat; validate mentally against limits before sending.

Minimal chart sketch:
```chart
{"version":1,"type":"bar","title":"Example","xKey":"x","series":[{"key":"y","label":"Y"}],"data":[{"x":"A","y":1},{"x":"B","y":2}]}
```

Minimal table sketch:
```table
{"version":1,"title":"Example","columns":[{"key":"name","header":"Name"},{"key":"status","header":"Status","type":"badge"}],"rows":[{"name":"Alpha","status":{"kind":"badge","label":"OK","tone":"success"}}]}
```
````

### Handoff: where hosts should include this

| Host product | Repo (external to monorepo) | Suggested inclusion point |
|--------------|----------------------------|---------------------------|
| **Hermes-Lanyard** | Hermes-Lanyard (external backend product) | Primary **system prompt** / persona pack for Portal-facing sessions; any “chat markdown capabilities” section shared with tools that stream assistant markdown |
| **Lanyard Agent** | Lanyard Agent (external backend product) | Same: system prompt or versioned **prompt pack** used when the backend serves Portal chat |
| **Hermes upstream** | Hermes upstream (if used without Lanyard overlays) | Only if that deployment serves Portal; same fragment |
| **Portal** | This monorepo | Schema + renderer only — **does not** replace host prompt inclusion in v1 |

**No host code change is required inside `lanyard-platform`** for this bead. Wire the fragment in the external host repo(s) when those products ship Portal chat markdown.

If a future monorepo path adds shared agent prompt packs under e.g. `contracts/` or `docs/prompt-packs/`, sync this catalog there and keep a single version note (`ChartSpec` / `TableSpec` v1).

### Host inclusion status (2026-07-31, `lp-75r.9`)

| Host | Status | Evidence |
|------|--------|----------|
| **Lanyard Agent** | **Shipped** — `formatPortalRichBlocksSection()` always in `buildSystemPrompt` (`packages/agent-core/src/system-prompt.ts`); wired by gateway `agent-wiring.ts` | LA `lp-dha` merge `751ef96` / PR #224; vitest suite `Portal rich blocks (lp-dha)` |
| **Hermes-Lanyard** | **Not included** (grep: no Portal rich-blocks section) | Residual only if HL still serves Portal tenants |
| **Local demo mock-gateway** | **N/A** — no system prompt; does not invent chart fences | Expected; not a Portal regression |
| **Portal renderer** | **Shipped** — inline `PortalChartCard` only (no side pane) | Story `?story=chart-bar-pie`; E2E map + screenshot: [e2e-verify-rich-blocks.md](./e2e-verify-rich-blocks.md) |

Full **prompt source → runtime binary** map for demo tenant topologies: [e2e-verify-rich-blocks.md](./e2e-verify-rich-blocks.md).

---

## Sync policy

1. **Types win:** if this catalog disagrees with `types.ts` / parsers, fix the catalog (or bump a versioned schema via a deliberate Portal bead).
2. Bump examples when field names change (depends on `lp-a79.2` / `lp-a79.10` field freeze).
3. Hosts should re-copy the prompt fragment after any schema version change (v1 → v2).

---

## Out of scope (v1)

- Server-side chart image tools
- Radar, radial, composed, sankey, ECharts engine
- Chart/table editing or vault persistence of specs
- Auto-converting all GFM tables to Astryx Table
- Host monorepo prompt-pack packaging (document-only handoff until host repos pick it up)
