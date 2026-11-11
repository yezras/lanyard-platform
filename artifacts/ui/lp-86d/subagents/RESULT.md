# lp-86d.5 — sub-agents chips + activity pane roster/detail

**Base URL:** `http://demo.localhost:3010`  
**Login:** `dev@demo.local` / `local-dev-password`  
**Pilot config:** `~/.lanyard-agent/config.yaml` → `subagents.enabled: true`  
**Method:** web-ui-testing (Playwright headless Chromium)  
**Verdict:** **PASS**

## Acceptance checklist

| Criterion | Result |
|-----------|--------|
| Subagents enabled for pilot | **PASS** (`subagents.enabled: true`, max_concurrent 0 = unlimited) |
| Prompt that spawns a subagent | **PASS** (`spawn_subagent` → live chip) |
| Subagent chip visible | **PASS** (`dither-avatar-sa-*` condensed roster; legacy `chat-subagent-run-chip` still supported) |
| Chip click opens activity pane | **PASS** |
| Roster/detail `chat-subagent-*` | **PASS** (`chat-subagent-detail`, `chat-subagent-roster`, `chat-subagent-roster-row`) |

## Story (Portal UI contract)

`/?story=activity-plane&phase=subagent&pane=closed&layout=split`

- Chip surface: `dither-avatar-sa-explore-1` (status running)
- Click → `chat-activity-pane` + `chat-subagent-detail` (`data-run-id=sa-explore-1`)
- Roster: 2 rows (`chat-subagent-roster-row`)

Shots: `01-story-chip-visible.png`, `02-story-chip-opens-detail.png`, `03-story-roster.png`

## Live (Lanyard Agent)

Prompt forced a single `spawn_subagent` (`qa-helper` / `SUBAGENT_OK`).

- Chip: `dither-avatar-sa-b612b737-6821-4c87-8c8c-5703cf095147` (running)
- Activity pane + detail status `running`
- Roster: 1 row

Shots: `10`–`16` live sequence

## Product note

Assistant turns with subagents use condensed **DitherAvatarRoster**
(`dither-avatar-{runId}`) instead of inline `chat-subagent-run-chip`. Activity
pane still uses `chat-subagent-detail` / roster / roster-row
(`DitherSubagentRow`).

## Test

`portal/packages/web/ui-testing/test_subagents_ui.py`

```bash
export BASE_URL=http://demo.localhost:3010
export UI_ARTIFACTS=../../../../artifacts/ui/lp-86d/subagents
pytest -v test_subagents_ui.py
```

## Fix beads

None — host emits subagent telemetry; Portal surfaces chips + activity pane.
