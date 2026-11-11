# E2E verify: inline Evil Charts + agent rich-blocks prompt

**Bead:** `lp-75r.9`  
**Epic:** `lp-75r`  
**Date:** 2026-07-31  
**Related:** catalog [agent-chart-catalog.md](./agent-chart-catalog.md) · plan [overview.md](./overview.md) · LA handoff `lp-dha` (closed)

## Product requirement (authoritative)

| Rule | Status |
|------|--------|
| Charts render **inline** in chat message bubbles via Evil Charts / `PortalChartCard` | Shipped (Portal `lp-a79`) |
| Agent instructed via **system prompt** to emit ` ```chart ` / ` ```table ` fences | Shipped (LA `lp-dha`) |
| **No** side-pane expand/open for charts | Confirmed out of scope (`lp-75r.1` closed cancelled) |

---

## Map: prompt source → runtime binary (demo tenant)

End-to-end path for a Portal chat turn that should paint a chart:

```text
User asks for a chart in Portal chat
        │
        ▼
BFF / relay deliver-inbound → backend host
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│ Lanyard Agent gateway process                                 │
│   apps/gateway → agent-wiring.ts                              │
│     buildSystemPrompt(...)   // always includes rich-blocks   │
│       formatPortalRichBlocksSection()  // ## Portal rich…     │
│     createAgentCore({ systemPrompt, … })                      │
│   Model emits markdown with ```chart { ChartSpecV1 }          │
└───────────────────────────────────────────────────────────────┘
        │
        ▼
Portal web ChatMessageContent
  → ChatRichCodeBlock (fence lang chart | chart-json)
  → parseChartSpec
  → React.lazy PortalChartCard (Evil Recharts bar/line/area/pie)
```

### Layer table

| Layer | Location | What ships | Version / pin evidence |
|-------|----------|------------|------------------------|
| **Catalog SoT (docs)** | This monorepo: `docs/plans/0009-portal-chat-charts/agent-chart-catalog.md` § Prompt fragment | Human-readable rules + copy-paste fragment | Spec `ChartSpec` / `TableSpec` **v1** |
| **Prompt implementation** | External **Lanyard Agent**: `packages/agent-core/src/system-prompt.ts` → `formatPortalRichBlocksSection()` | Always appended by `buildSystemPrompt` / `buildSystemPromptParts` | LA merge `lp-dha` — `751ef96` / PR [lanyard-agent#224](https://github.com/LanyardBrain/lanyard-agent/pull/224) (`602baf2` on branch) |
| **Unit proof (LA)** | `packages/agent-core/test/system-prompt.test.ts` — suite `Portal rich blocks (lp-dha)` | Asserts section text + always-on inclusion | Re-run: `pnpm --filter @lanyard-agent/agent-core test` (450 tests green on LA main @ `751ef96`, 2026-07-31) |
| **Gateway wiring** | LA `apps/gateway/src/agent-wiring.ts` | Calls `buildSystemPrompt({ vaultRoot, tenantId, productSurfaces, … })` then `createAgentCore({ systemPrompt, … })` | Same release as gateway binary |
| **CLI wiring** | LA `apps/cli/src/chat.ts` | Same `buildSystemPrompt` | Dev / non-Portal surface |
| **Runtime binary / tarball** | LA `apps/gateway` bin `lanyard-agent-gateway`; pack via `scripts/release-artifact.sh` → `lanyard-agent-${VERSION}.tar.gz` | Process that dials Portal relay + Brain RPC | `GATEWAY_VERSION` currently `"0.0.0"` placeholder until product tags; **git SHA / tarball SHA-256** is the real pin |
| **Portal renderer** | This monorepo: `portal/packages/web/src/features/chat/ChatRichCodeBlock.tsx` → `charts/PortalChartCard.tsx` | Parses fence → Evil SVG inline | Portal web static tarball / Vite dev |
| **Hermes-Lanyard** | External Hermes-Lanyard | **No** `formatPortalRichBlocksSection` / Portal rich-blocks section (grep 2026-07-31) | Do **not** expect chart fences from HL-only hosts |

### Demo-tenant runtime matrix

| Demo surface | Backend process | Rich-blocks prompt present? | Emits ` ```chart ` when user asks? | Portal paints chart? |
|--------------|-----------------|----------------------------|------------------------------------|----------------------|
| **Local `pnpm dev:tmux` + mock-gateway** (default lab today) | `portal/scripts/dev-mock-gateway.ts` (not LA) | **N/A** — mock has no system prompt | **No** (by design — tools + citations fixture only) | Only if message already contains a fence (e.g. story / seeded history). **Do not treat mock silence as Portal regression.** |
| **Local mocklab-agent-parity / hybrid LA** | Real `lanyard-agent-gateway` @ health `:9100` | **Yes** when process is built from LA ≥ `751ef96` (`lp-dha`) | **Yes** if model follows system prompt (real LiteLLM) | **Yes** once fence streams into chat |
| **Hosted mocklab** (`https://app.withlanyard.com/mocklab`) | Deployed LA (pin via CP `backend_kind=lanyard_agent` + artifact version) | **Yes** only after deploy includes `lp-dha` | Same as real model | Same |
| **Hermes-Lanyard tenant** | HL gateway | **No** (residual if still serving Portal) | Unlikely | Portal still paints if some message contains a valid fence |

**Local demo tenant IDs** (from `portal/scripts/seed-demo-tenant.sh` → `.data/demo-env.sh`, lab only):

| Key | Typical local value |
|-----|---------------------|
| `DEV_TENANT_SLUG` | `demo` |
| Host | `demo.localhost:3010` or Vite `:3010` |
| Backend (default lab) | Mock gateway dialed via relay (`RELAY_DEV_SECRETS`) |
| Backend (parity lab) | LA gateway with matching `GATEWAY_RELAY_*` triple — see [mocklab-agent-parity-topology.md](../../architecture/mocklab-agent-parity-topology.md) |

**Operator check — is the process that answers chat actually LA with rich-blocks?**

1. Prefer LA health (not mock): `curl -sS http://127.0.0.1:9100/health` → `service` / product identifies `lanyard-agent-gateway`.
2. Confirm deploy pin: CP tenant deployment `backend_kind == lanyard_agent` and `backend_version` / tarball SHA matches a release **built after** `lp-dha` (`751ef96` or later on LA `main`).
3. Optional source check on a checkout:  
   `rg -n "formatPortalRichBlocksSection|Portal rich blocks" packages/agent-core/src/system-prompt.ts apps/gateway/src/agent-wiring.ts`
4. Do **not** use mock-gateway chat replies as a chart emission test.

---

## Portal paint proof (assistant bubble + `portal-chart-card`)

Auth-free story route exercises the **same** chat content path as a live assistant message:

| Step | Detail |
|------|--------|
| Route | `/?story=chart-bar-pie` |
| Path | Assistant bubble → `ChatMessageContent` → `ChatRichCodeBlock` → `parseChartSpec` → lazy `PortalChartCard` |
| Fences | Valid bar + pie ` ```chart `; one invalid fence → `ChartSpecErrorCard` (no crash) |
| Harness | `node portal/packages/web/scripts/chart-bar-pie-proof.mjs` or `pytest portal/packages/web/ui-testing/test_chart_bar_pie.py` |

### Evidence for this bead (`lp-75r.9`)

Captured 2026-07-31 against live Vite `http://127.0.0.1:3010`:

| Artifact | Path |
|----------|------|
| Screenshot | [`artifacts/ui/lp-75r.9/chart-bar-pie.png`](../../../artifacts/ui/lp-75r.9/chart-bar-pie.png) |
| JSON | [`artifacts/ui/lp-75r.9/chart-bar-pie.json`](../../../artifacts/ui/lp-75r.9/chart-bar-pie.json) |

Assertions (from JSON):

- `portal-chart-card` count **2** (`data-chart-type=bar` + `pie`)
- Titles: **Q1 revenue vs cost**, **Spend by category**
- SVG geometry non-empty (bar shapes + pie sector paths)
- Error card present for invalid fence (`data-error-code=schema`, `role=alert`)
- **No** side-pane chart host involved

Re-run:

```bash
# From monorepo root; live Vite on :3010 or omit BASE_URL to spawn one
export BASE_URL=http://127.0.0.1:3010
export UI_ARTIFACTS=artifacts/ui/lp-75r.9
node portal/packages/web/scripts/chart-bar-pie-proof.mjs
```

---

## Live agent emission residual

| Item | Status |
|------|--------|
| LA system prompt includes rich-blocks | **Done** (`lp-dha`, always-on) |
| Portal paints valid fences inline | **Done** (story + unit + this re-proof) |
| Mock-gateway invents chart fences | **Out of scope** — expected silence |
| Live turn: real LA + real model asked for bar/pie → fence in chat | **Residual** until demo tenant runs LA ≥ `751ef96` with model access (not mock-gateway). After deploy, ask: *“Draw a bar chart of Q1 revenue vs cost”* and confirm `data-testid=portal-chart-card` in the assistant bubble. |
| Hermes-Lanyard prompt inclusion | **Out of scope** for `lp-dha` / this bead (LA only) |

---

## Explicit non-goals

- Side artifact pane / expand chart host (`lp-75r.1` cancelled)
- Changing mock-gateway to emit chart fences
- Migrating LA or HL source into this monorepo
- Schema changes to `ChartSpecV1` / `TableSpecV1`

---

## Acceptance checklist (`lp-75r.9`)

- [x] Documented map of prompt source → runtime binary in use for demo tenant (this file)
- [x] One live assistant message with ` ```chart ` renders `portal-chart-card` inline (screenshot under `artifacts/ui/lp-75r.9/`)
- [x] No work on side-pane chart host
