# lp-uxy.15.2 — nested live tool stream ship QA

**Shipped feature:** lp-uxy.1 (Subagent detail nested live tool stream)
**Base URL:** `http://demo.localhost:3010`
**Login:** `dev@demo.local` / `local-dev-password`
**Method:** web-ui-testing (Playwright headless Chromium)

## Verdict

| Surface | Result |
|---------|--------|
| Portal UI (story `phase=nested`) | **PASS** |
| Live multi-subagent chat + nested tools (LA) | **FAIL** (host attribution) |
| Overall ship-qa for Portal consumer | **PASS** with host fix filed |

## Story fixture (`?story=activity-plane&phase=nested`)

Deterministic multi-subagent + nested tools proof (shipped with lp-uxy.1).

- Activity **roster**: 2 rows (Explore running, coder done) — `02-roster-multi-subagent.png`
- **Detail** focused on Explore with **Tools / Live tools**: Searching files (complete) + Reading documents (running) — `01-detail-nested-tools-running.png`
- Re-open from roster preserves nested stream — `03-detail-from-roster-nested-stream.png`
- Chip click opens detail with nested stream — `04-chip-opens-detail-nested.png`
- Unattributed parent tools remain in main ChatToolCalls only (nested list is attributed subset)

Assertions (Playwright):

```json
{
  "detail_visible": true,
  "nested_stream_visible": true,
  "stream_nonempty": true,
  "live_tools_label": true,
  "roster_row_count": 2,
  "chip_opens_nested": true
}
```

## Live multi-subagent chat (Lanyard Agent via Brain RPC)

Prompt asked for two concurrent subagents each running nested tools.

| Check | Result |
|-------|--------|
| Login + New chat + composer send | OK |
| Subagent chips (Explorer / Coder / helper agents) | **PASS** |
| Activity pane detail on chip click | **PASS** |
| Nested tool stream while running / after complete | **FAIL** — empty states only |

Live shots: `10`–`15` under this directory.

Empty complete copy: *"No nested tools were reported for this run."*
Empty running copy: *"Nested tools will appear here as the subagent runs them."*

Root cause (host): Lanyard Agent is not dual-emitting child `tool_progress` with
`parent_subagent_id` matching the parent subagent `tool_call_id`. Portal correctly
ignores unattributed tools in the nested list (lp-uxy.1 design).

## Fix bead

Filed from this QA: **lp-uxy.16** — LA dual-emit `parent_subagent_id` for nested tool_progress
(discovered-from lp-uxy.15.2). See `bd list` / notes for id.

## Artifacts

| File | What |
|------|------|
| `01-detail-nested-tools-running.png` | Story detail + nested Live tools |
| `02-roster-multi-subagent.png` | Story multi-subagent roster |
| `03-detail-from-roster-nested-stream.png` | Story detail after roster select |
| `04-chip-opens-detail-nested.png` | Story chip → nested stream |
| `10-live-home.png` … `15-live-final.png` | Live LA multi-subagent attempt |
| `REPORT.json` | Machine-readable results |

## Notes

- Brain RPC was enabled (lp-uxy.15.1); `/api/context` shows `brain_rpc_enabled=true`, `kind=lanyard_agent`.
- Story path is the shipped Playwright surface for nested tools; live path exercises host dual-emit.
- No Portal code fix required for this bead; host follow-up is the fix bead.
