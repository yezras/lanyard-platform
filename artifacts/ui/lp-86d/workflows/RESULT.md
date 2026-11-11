# lp-86d.6 — workflows stage cards + activity tree indicators

**Base URL:** `http://demo.localhost:3010`  
**Login:** `dev@demo.local` / `local-dev-password`  
**Pilot config:** `~/.lanyard-agent/config.yaml` → `workflow.enabled: true` (agent_budget 128); `subagents.enabled: true`  
**Method:** web-ui-testing (Playwright headless Chromium)  
**Verdict:** **PASS**

## Acceptance checklist

| Criterion | Result |
|-----------|--------|
| Prompt/start a programmatic workflow | **PASS** (`/workflow run research-lite --budget 8`) |
| `chat-workflow-run-card` visible | **PASS** (`wf_3b85e0b6d1570c0e`, status running) |
| Stages on card | **PASS** (3 stages) |
| Nested subagents under stages | **PASS** (`chat-workflow-nested-subagent`, count ≥ 1) |
| Activity pane workflow tree | **PASS** (`chat-workflow-detail` + `chat-workflow-run-tree`) |

## Story (Portal UI contract)

`/?story=activity-plane&phase=workflow&pane=closed&layout=split`

- Card: `chat-workflow-run-card` `data-workflow-id=wf-onboard-1` status running
- Stages: 3 (`chat-workflow-stage`) with nested subagents (2)
- Header click → activity `data-side-focus=workflow` + `chat-workflow-detail` + `chat-workflow-run-tree`

Shots: `01-story-card-visible.png`, `02-story-stages-nested.png`, `03-story-activity-tree.png`

## Live (Lanyard Agent)

Slash (deterministic; no model tool-choice):

```
/workflow run research-lite --budget 8 --args '{"question":"lp-86d.6 workflow stage card QA"}'
```

Note: bare `--args {...}` fails gateway parse (`--args must be valid JSON`); single-quoted JSON works.

- Card: `chat-workflow-run-card` `data-workflow-id=wf_3b85e0b6d1570c0e` status running
- Stages: 3; nested subagent visible under stage
- Header → `chat-activity-pane` + `chat-workflow-detail` + `chat-workflow-run-tree`
- Host run dir: `~/.lanyard-agent/data/workflows/wf_3b85e0b6d1570c0e/`

Shots: `10`–`16` live sequence

## Product note

- Host emits `portal_event: workflow_progress` with ordered `stages[]` (lp-ypu / LA #216).
- Portal: `WorkflowRunCard` (timeline) + `WorkflowTree` (activity pane).
- Nested identity requires dual-emit of subagent tool_progress matching `stages[].subagent_ids`.

## Test

`portal/packages/web/ui-testing/test_workflows_ui.py`

```bash
export BASE_URL=http://demo.localhost:3010
export UI_ARTIFACTS=../../../../artifacts/ui/lp-86d/workflows
pytest -v test_workflows_ui.py
```

## Fix beads

None — pilot `workflow.enabled=true`; host emits progress; Portal stage cards + activity tree render.
