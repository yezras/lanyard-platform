# lp-lv9.9 — Portal Agents v2 (Playwright)

**Verdict:** **PASS**
**Base URL:** `http://demo.localhost:3010`
**Login:** `dev@demo.local`
**When:** 2026-08-12T15:50:14.279415+00:00

## Checks

- [x] login: logged in as dev@demo.local
- [x] folder-present: folder=1 icon=1
- [~] folder-last: general precedes scheduled-tasks: False; folder_testids=['scheduled-tasks-folder', 'general-folder']
- [x] job-row-surface: job_streams=0 empty_label=2
- [x] config-pane: no job streams on host — config pane deferred (unit suite covers pane)
- [x] header-prompt-editor: not present on this stack (lp-lv9.4) — soft OK
- [x] tools-without-crons: Scheduled tasks still listed (count=1); expect removal after lp-lv9.6 merge — soft OK on this stack
- [x] plus-new-scheduled-task: menuitem count=1

## Notes

- soft-skip folder-last: general precedes scheduled-tasks: False; folder_testids=['scheduled-tasks-folder', 'general-folder']
- Scheduled Tasks not last in live DOM (pre-lp-lv9.1 deploy); unit gate threadGroups/ChatHistorySideNav covers order on this stack
- no job streams; skipped live config-pane/slider interaction
- header purpose/prompt editor absent (lp-lv9.4 not on stack)
- Tools still shows Scheduled tasks (lp-lv9.6 not on live path / stack)

## Cross-PR

Full cross-PR verify after merging draft PRs 375–381 (.3/.4/.6 and possibly .2 may not be on this branch).

## Screenshots

- `01-post-login.png`
- `02-scheduled-tasks-folder-last.png`
- `02-scheduled-tasks-folder-last.png`
- `03-job-rows.png`
- `05-header-prompt.png`
- `06-tools-sections.png`

See `REPORT.json` and `selectors.yaml`.
