# Evil Charts vendor (Portal)

**Epic:** `lp-a79` · **Spike:** `lp-a79.1` · **Vendor full set:** `lp-a79.3`

## Styling decision (locked by spike)

| Field | Value |
|-------|--------|
| **Option chosen** | **A** — Tailwind v4 utilities + `@astryxdesign/core/tailwind-theme.css`, scoped under `.portal-chart` |
| **Why not B** | Option A Vite cost was low: `@tailwindcss/vite` + a chart-only CSS entry (`portal-chart.css`) that **skips preflight**, imports Astryx theme bridge, and aliases shadcn-style tokens (`background`, `muted-foreground`) onto Astryx CSS vars. No need to rewrite thousands of classnames on first pull. |
| **Fallback** | Option B (rewrite classnames → `chart.css` + Astryx vars) remains available if Tailwind/StyleX conflicts appear in production chat; re-evaluate in lp-a79.8 if needed. |

## Upstream

| Field | Value |
|-------|--------|
| **Repo** | https://github.com/legions-developer/evilcharts |
| **Pinned SHA** | `6f26c885b5852f1b1f571232bf28d5dd2220ef52` (main, 2026-07-28) |
| **Registry** | shadcn registry items `@evilcharts/recharts-*-chart` + shared UI (not an npm package) |
| **License** | **MIT** — Copyright (c) 2026 Gurbinder. Full text in upstream `LICENSE`. Vendored copies retain attribution via this file + source headers. |

## Files vendored

Paths are relative to `portal/packages/web/src/features/chat/charts/evil/`.

### Charts (recharts)

| Local path | Upstream path | Bead |
|------------|---------------|------|
| `charts/recharts-bar-chart.tsx` | `src/registry/charts/recharts-bar-chart.tsx` | lp-a79.1 |
| `charts/recharts-line-chart.tsx` | `src/registry/charts/recharts-line-chart.tsx` | lp-a79.3 |
| `charts/recharts-area-chart.tsx` | `src/registry/charts/recharts-area-chart.tsx` | lp-a79.3 |
| `charts/recharts-pie-chart.tsx` | `src/registry/charts/recharts-pie-chart.tsx` | lp-a79.3 |
| `charts/index.ts` | *(local barrel)* `EvilBarChart`, `EvilLineChart`, `EvilAreaChart`, `EvilPieChart` | lp-a79.3 |

### Shared UI

| Local path | Upstream path | Bead |
|------------|---------------|------|
| `ui/recharts-chart.tsx` | `src/registry/ui/recharts-chart.tsx` | lp-a79.1 |
| `ui/recharts-tooltip.tsx` | `src/registry/ui/recharts-tooltip.tsx` | lp-a79.1 |
| `ui/recharts-legend.tsx` | `src/registry/ui/recharts-legend.tsx` | lp-a79.1 |
| `ui/recharts-brush.tsx` | `src/registry/ui/recharts-brush.tsx` | lp-a79.1 |
| `ui/recharts-background.tsx` | `src/registry/ui/recharts-background.tsx` | lp-a79.1 |
| `ui/recharts-dot.tsx` | `src/registry/ui/recharts-dot.tsx` | lp-a79.3 (line/area) |
| `lib/utils.ts` | `src/lib/utils.ts` (**cn only** — dropped Next `SITE_URL` helpers) | lp-a79.1 |

### Not vendored

- echarts registry paths
- `examples/` demos
- composed / radar / radial / sankey charts (out of scope for chat bar/line/area/pie)

### Local edits on pull

1. Removed `"use client"` Next directives.
2. Rewrote `@/registry/ui/*` and `@/lib/utils` → **relative** imports under `charts/evil/` (no shadcn `@/components` layout).
3. `lib/utils.ts` keeps `cn()` via `clsx` + `tailwind-merge` only.
4. No runtime fetch of the shadcn/evilcharts registry — all source is committed.

## Runtime / tooling deps (`@lanyard/web`)

| Package | Role | Declared |
|---------|------|----------|
| `recharts` (pin `3.8.0`) | Chart engine | **production** dependency |
| `motion` | Bar/line/area grow-in + brush interactions | **production** dependency |
| `clsx`, `tailwind-merge` | `cn()` helper | production |
| `tailwindcss`, `@tailwindcss/vite` | Option A pipeline | **dev** dependencies |

## CSS / Vite (Option A)

1. **Keep** `portal/packages/web/src/features/chat/charts/portal-chart.css` as the single chart CSS entry:
   - `@config "./tailwind.chart.config.mjs"` with `important: ".portal-chart"`
   - `@source` chart/evil TSX (includes line/area/pie + `recharts-dot`)
   - `@import "tailwindcss/theme.css"` + utilities (no preflight)
   - `@import "@astryxdesign/core/tailwind-theme.css"`
   - shadcn token aliases in `@theme inline` (`background`, `foreground`, `muted`, `muted-foreground`)
2. **Keep** `@tailwindcss/vite` in `packages/web/vite.config.ts` plugins.
3. **Wrap** every chart root in `className="portal-chart"` (PortalChartCard should own this — lp-a79.4).
4. Import `portal-chart.css` from the **lazy chart chunk** (or story) — do not add Tailwind to global `styles/globals.css` unless a future decision expands hybrid styling.

## Public import surface

```ts
// Preferred (barrel)
import {
  EvilBarChart,
  EvilLineChart,
  EvilAreaChart,
  EvilPieChart,
} from "@/features/chat/charts/evil/charts"; // path as resolved by app

// Also re-exported from features/chat/charts/index.ts
import { EvilBarChart, EvilLineChart, EvilAreaChart, EvilPieChart } from "@/features/chat/charts";
```

Relative in-repo:

- `portal/packages/web/src/features/chat/charts/evil/charts/index.ts`
- `portal/packages/web/src/features/chat/charts/index.ts`

## Proof harness

- Story: `ChartBarProofStory` → open Vite with `?story=chart-bar-proof`
- Hard-coded monthly revenue/cost bars; no chat markdown integration (deferred to lp-a79.5)
- Full line/area/pie paint + PortalChartCard: lp-a79.4+

## Follow-ups

- [x] PortalChartCard + palette mapper (lp-a79.4)
- [x] Lazy `import()` so non-chart sessions avoid recharts/motion (lp-a79.8)
- [ ] Re-check Tailwind scope vs StyleX if chat layout regressions appear

## Bundle / lazy load (lp-a79.8)

### Boundary

| Surface | Strategy |
|---------|----------|
| Chat ```chart fences | `React.lazy(() => import("./charts/PortalChartCard.js"))` inside `ChatRichCodeBlock` + `Suspense` skeleton fallback |
| `parseChartSpec` / `ChartSpecErrorCard` / palette | **Static** in main/chat chunk (small pure JS, no recharts) |
| Chart proof story (`?story=chart-bar-proof`) | `React.lazy` from `main.tsx` so App entry does not import evil/recharts |
| Barrel `charts/index.ts` | Still re-exports Evil for stories/tests; chat path **must not** import PortalChartCard/Evil from the barrel (use direct modules + lazy card) |

### a11y (chat v1)

- Card root: `role="region"` + `aria-labelledby` (title) or `aria-label` (`"{type} chart"`).
- Plot: `role="img"` + `aria-label` matching title or type.
- Grow-in animations: PortalChartCard sets `animationType="none"`; Evil also respects `useReducedMotion` — `prefers-reduced-motion` does not break paint.
- Focus: no `tabIndex` on the card; Brush is **not** mounted for chat v1 (no brush focus trap).

### Size budget note

Measured after production `vite build` of `@lanyard/web` on this bead branch (2026-07-30):

| Asset (example hash) | Raw | Gzip | Role |
|----------------------|-----|------|------|
| `index-*.js` | ~880 KB | **~264 KB** | App + chat shell — **no `recharts` string** |
| `PortalChartCard-*.js` | ~48 KB | **~13 KB** | Lazy card + mapper (async) |
| `portal-chart-*.js` | ~580 KB | **~174 KB** | Evil + recharts + motion (async, shared with story) |
| `portal-chart-*.css` | ~22 KB | **~4 KB** | Chart Tailwind utilities (async) |
| `ChartBarProofStory-*.js` | ~2 KB | **~1 KB** | Story shell only (async from `main.tsx`) |

**Async chart total ≈ 191 KB gzip** (card + engine + CSS). Below the informal **~300 KB gzip** chat-v1 cap. Engine chunk is recharts-dominated; brush is not mounted in chat (still in vendor tree).

How to re-verify:

```bash
cd portal/packages/web && pnpm run build
# recharts only in async chart assets:
grep -l recharts dist/assets/*.js
# primary entry must not match:
! grep -q recharts dist/assets/index-*.js
```

If the async chart total exceeds ~300 KB gzip for chat v1:

1. Prefer **keeping** `animationType="none"` (already done).
2. **Do not mount Brush** in PortalChartCard (already true for chat v1 — `recharts-brush.tsx` remains vendored for future, not used).
3. Optional later: split pie vs cartesian lazy sub-chunks; drop `motion` from pie-only path.

### Brush decision (chat v1)

**Drop brush from chat rendering path** (not from vendor tree). PortalChartCard never renders `EvilBarChart.Brush` / line/area brush. Brush pulls extra recharts + motion interaction code; zoom-range is out of scope for agent chat charts. Revisit if product asks for time-range brushing.

## Decision one-liner

**Option A locked:** Tailwind v4 chart CSS entry + Astryx `tailwind-theme.css` under `.portal-chart`; Evil **bar/line/area/pie** + shared UI (incl. `recharts-dot`) vendored at `6f26c885` (MIT) with relative imports; no registry runtime fetch. **lp-a79.8:** PortalChartCard is lazy from chat; parseChartSpec stays eager; brush not used in chat v1.
