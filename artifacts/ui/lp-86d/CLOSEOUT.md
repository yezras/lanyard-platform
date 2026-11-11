# lp-86d close-out — evidence summary + remaining fix beads

**Bead:** `lp-86d.14`  
**Epic:** `lp-86d` — Localhost mocklab: Portal + Lanyard Agent live feature QA (web UI)  
**Recorded:** 2026-08-13T13:01:39Z  
**Method:** Playwright / web-ui-testing skill against `http://demo.localhost:3010` + Lanyard Agent gateway (`:9100`), not Hermes/mock as chat owner.

## Verdict

**Epic QA is complete for tracking purposes.**

| Metric | Value |
|--------|-------|
| Feature children | 13 QA beads + env bring-up + this close-out |
| Closed feature/env children | **11** (`lp-86d.1`–`.2`, `.4`–`.5`, `.7`–`.13`) |
| PASS evidence, bead still open (PR unmerged / ship left open) | **2** (`lp-86d.3`, `lp-86d.6`) |
| Residual product gap with open fix bead | **1** (`lp-vw3` from `lp-86d.7`) |
| Failures without a fix bead | **0** |

This close-out does **not** merge open QA PRs and does **not** shut down the live mocklab stack (stack left up for handoff — see [HANDOFF.md](./HANDOFF.md)).

## Acceptance for `lp-86d.14`

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Aggregate pass/fail per feature | **Met** | Feature matrix below |
| Every failure has a fix bead | **Met** | Fix-bead table; residual gap → `lp-vw3` |
| `secure-local-secrets` | **Met** | Live checkout: `bash portal/scripts/secure-local-secrets.sh` + `--check` ok |
| Kill Playwright browsers | **Met** | No leftover `playwright` / `ms-playwright` browser processes at close-out |
| Stack state documented for handoff | **Met** | [HANDOFF.md](./HANDOFF.md) |

## Feature matrix (pass / fail / partial)

| Bead | Feature | Verdict | Bead status | Evidence | Fix bead(s) |
|------|---------|---------|-------------|----------|-------------|
| `lp-86d.1` | Env: Portal stack + LA gateway | **PASS** | ✓ closed | Close reason: CP/relay/BFF/web + LA `:9100` portal-connected | — |
| `lp-86d.2` | Basic chat (LA assistant reply) | **PASS** | ✓ closed | Close reason: UI login + LA pong | — |
| `lp-86d.3` | Tool calls — ChatToolCalls lifecycle | **PASS** | ◐ open (PR #398) | [tools/RESULT.md](./tools/RESULT.md) | `lp-cav` ✓ (unblocked) |
| `lp-86d.4` | Skills — composer `/` + inventory | **PASS** | ✓ closed | Close reason: Settings Skills + slash inventory | — |
| `lp-86d.5` | Sub-agents — chips + activity pane | **PASS** | ✓ closed | [subagents/RESULT.md](./subagents/RESULT.md); PR #396 | `lp-63i` ✓ (unblocked) |
| `lp-86d.6` | Workflows — stage cards + activity tree | **PASS** | ◐ open (PR #400) | [workflows/RESULT.md](./workflows/RESULT.md) | `lp-ypu` ✓ (unblocked) |
| `lp-86d.7` | MCP servers — settings + chat indicator | **PASS_PARTIAL_GAP** | ✓ closed | [mcp/RESULT.md](./mcp/RESULT.md); PR #401 | **`lp-vw3` ○ open** |
| `lp-86d.8` | Jobs/cron — start job surface | **PASS** | ✓ closed | Live Settings scheduled tasks + chat cronjob wizard (post `lp-su0` / LA cron ship) | `lp-su0` ✓ |
| `lp-86d.9` | Document viewer — markdown body | **PASS** | ✓ closed | [doc-preview/RESULT.md](./doc-preview/RESULT.md); PR #402 | — |
| `lp-86d.10` | Document viewer — Office preview | **PASS** | ✓ closed | Close reason: Note.docx Office-ish preview | — |
| `lp-86d.11` | File references soft-open pane | **PASS** | ✓ closed | [file-ref/file-ref-soft-open.json](./file-ref/file-ref-soft-open.json); PR #403 | — |
| `lp-86d.12` | Citations open document pane | **PASS** | ✓ closed | [citations/](./citations/) (coordinated with `lp-75r.6`) | `lp-53n` ✓ (unblocked) |
| `lp-86d.13` | Settings + projects honesty | **PASS** (partial honesty) | ✓ closed | Skills/MCP load; crons honest; Directory top-nav absent | — |
| `lp-86d.14` | Close-out | **This document** | ◐ | `CLOSEOUT.md` + `HANDOFF.md` + `REPORT.json` | — |

### Counts

- **PASS:** 11 features (+ env)  
- **PASS_PARTIAL_GAP:** 1 (`lp-86d.7` MCP chat tool indicator)  
- **FAIL (open, no fix):** 0  

## Fix beads filed during / for this epic

| Fix bead | Parent QA | Status | Role |
|----------|-----------|--------|------|
| `lp-cav` | `lp-86d.3` | ✓ closed | LA mid-turn `tool_progress` → ChatToolCalls |
| `lp-63i` | `lp-86d.5` | ✓ closed | Pilot `subagents.enabled` + portal telemetry |
| `lp-ypu` | `lp-86d.6` | ✓ closed | Pilot `workflow.enabled` + `workflow_progress` emission |
| `lp-su0` | `lp-86d.8` | ✓ closed | Portal cron/jobs settings + start-job UI path |
| `lp-53n` | `lp-86d.12` | ✓ closed | Vault citation metadata so pane opens from chat |
| **`lp-vw3`** | **`lp-86d.7`** | **○ open (P2)** | **LA MCP product surface: config `mcp_servers` + chat MCP tool rows** |

### Residual open product gap (must remain tracked)

**`lp-vw3`** — Live mocklab 2026-08-13:

- Settings snapshot: `source=lanyard_agent`, `mcp_servers=[]`
- Tools → MCP: honest empty (“No MCP servers in this snapshot.”) — **settings acceptance met**
- Chat MCP-qualified tool rows (`mcp__*` / search_tool / use_tool) **unproven** until pilot advertises ≥1 MCP server
- Re-run path after fix: `artifacts/ui/lp-86d/mcp/run_mcp_qa.py` → expect verdict `PASS` (not `PASS_PARTIAL_GAP`)

No additional fix beads are required from this close-out: every historical failure either re-verified PASS after a closed fix, or is tracked by `lp-vw3`.

## Open QA PRs (evidence landed; merge is operator choice)

| PR | Bead | Notes |
|----|------|-------|
| [#398](https://github.com/LanyardBrain/lanyard-platform/pull/398) | `lp-86d.3` | Draft; PASS tools evidence; bead left open |
| [#396](https://github.com/LanyardBrain/lanyard-platform/pull/396) | `lp-86d.5` | Draft; PASS; bead already closed |
| [#400](https://github.com/LanyardBrain/lanyard-platform/pull/400) | `lp-86d.6` | Open; PASS workflows; bead left open pending merge |
| [#401](https://github.com/LanyardBrain/lanyard-platform/pull/401) | `lp-86d.7` | Open; PASS_PARTIAL_GAP + `lp-vw3` |
| [#402](https://github.com/LanyardBrain/lanyard-platform/pull/402) | `lp-86d.9` | Draft; PASS doc-preview |
| [#403](https://github.com/LanyardBrain/lanyard-platform/pull/403) | `lp-86d.11` | Draft; PASS file-ref soft-open |

Portal unit CI (`PortalShell.test.tsx`) is red on **main** as well — pre-existing, not introduced by these QA-only branches.

## Hygiene performed at close-out

```bash
# From monorepo root (live checkout used for mocklab stack)
bash portal/scripts/secure-local-secrets.sh
bash portal/scripts/secure-local-secrets.sh --check   # ok after chmod 600 on auth artifacts

# Playwright browsers: none running at close-out (no pkill required for active drivers)
```

Auth storage under `artifacts/ui/.auth/` remains **gitignored**; never commit storage state or `.env.mocklab-agent-dev`.

## Artifact index (canonical under `artifacts/ui/lp-86d/`)

| Path | Feature |
|------|---------|
| [tools/](./tools/) | ChatToolCalls lifecycle (`lp-86d.3`) |
| [subagents/](./subagents/) | Sub-agent chips + activity pane (`lp-86d.5`) |
| [workflows/](./workflows/) | Workflow cards + tree (`lp-86d.6`) |
| [mcp/](./mcp/) | MCP settings honesty + gap (`lp-86d.7`) |
| [doc-preview/](./doc-preview/) | Markdown/doc pane body (`lp-86d.9`) |
| [file-ref/](./file-ref/) | Soft mode A file refs (`lp-86d.11`) |
| [citations/](./citations/) | Citation → document pane (`lp-86d.12` / `lp-75r.6`) |
| [CLOSEOUT.md](./CLOSEOUT.md) | This summary |
| [HANDOFF.md](./HANDOFF.md) | Live stack state |
| [REPORT.json](./REPORT.json) | Machine-readable rollup |

Per-bead duplicates may also exist as `artifacts/ui/lp-86d.<n>/` from individual implementer runs; treat **`artifacts/ui/lp-86d/`** as the epic canonical tree.

## Explicit non-claims

- Not AWS staging (operator hold per epic description).
- Not a product ship gate for MCP chat rows until `lp-vw3` lands.
- Does not force-merge open QA PRs or close sibling beads still marked open for merge tracking.
- Hermes may still run on this host for unrelated desktop work; **portal chat owner is LA gateway channel `portal` connected**, not Hermes/mock.

## Epic close eligibility

`lp-86d` (parent epic) can be closed as a **tracking shell** when operators accept:

1. Feature matrix above (all children closed **or** documented PASS with residual only `lp-vw3`), and  
2. Open merge of QA evidence PRs is optional / separate from QA verdicts.

Recommended follow-ups (not blocking this close-out bead):

1. Merge or explicitly abandon open PRs #396–#403.  
2. Implement `lp-vw3`, then re-run MCP QA.  
3. Optionally close `lp-86d.3` / `lp-86d.6` after PR merge (evidence already PASS).
