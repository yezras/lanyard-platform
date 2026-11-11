# lp-uxy.15.11 — hard-reload after multi-subagent chat (shipped lp-uxy.11)

## Result: **PASS**

Live Web UI QA on `http://demo.localhost:3010` (login `dev@demo.local`).

Shipped fix: **lp-uxy.11** (hydrate isolation + chart/item error boundaries).
This bead supersedes residual **lp-uxy.14** (prior UIQA fail on chart item boundary).

## Method

- Skill: web-ui-testing (Playwright headless Chromium)
- Viewport: 1440×900
- Login: `dev@demo.local` / `local-dev-password`
- Auth-free fixtures: `/?story=activity-plane&phase={artifacts,nested,workflow,subagent}`
- Live thread: Clients → “Ship QA nested tools…” (Explorer + Coder subagents)

## Acceptance mapped

| Criterion | Evidence |
| --- | --- |
| Complex multi-subagent thread | Live “Ship QA nested tools” + activity-plane multi-subagent stories |
| Hard reload | `page.reload` twice after opening thread |
| History hydrates without blank/crash | Screenshots 07/08; no whole-page crash; Explorer/Coder chips + tools visible |
| Pass/fail note | `PASS_FAIL.md`, `REPORT.json` |
| Fix bead on fail | N/A (pass) |

## Screenshots

| File | What |
| --- | --- |
| `01-story-artifacts-{before,after}-reload.png` | Multi-writer subagent artifacts fixture survives reload |
| `02-story-nested-{before,after}-reload.png` | Nested live tool stream fixture survives reload |
| `03-story-workflow-{before,after}-reload.png` | Workflow + subagent chips survive reload |
| `04-story-subagent-{before,after}-reload.png` | Subagent chips survive reload |
| `05-live-after-login.png` | Authenticated portal home |
| `06-live-multi-subagent-before-reload.png` | Live Explorer+Coder thread (+ subagent detail pane) |
| `07-live-multi-subagent-after-reload.png` | Same thread after hard reload — hydrated, no blank |
| `08-live-multi-subagent-second-reload.png` | Second hard reload — still hydrated |
| `01-after-reload.png` | Alias of 07 for ship-qa REPORT convention |

## Notes

- No `TimelineItemErrorBoundary` (“Could not display this message”) on live or story paths in this run.
- Console showed transient 401/503 during navigation; UI still hydrated multi-subagent timeline after reload.
- Unit coverage for hydrate isolation remains under lp-uxy.11 (`useChatEvents` / `ChatTimeline` tests).

## Reproduce

```bash
# App must already serve demo.localhost:3010
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
python /path/to/lp-uxy.15.11-reload-qa.py   # or re-run equivalent Playwright flow
```
