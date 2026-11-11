# lp-fn5.7.1 — Portal Agents UI refresh (Playwright)

**Verdict:** **PASS**
**Base URL:** `http://demo.localhost:3010`
**Login:** `dev@demo.local`
**When:** 2026-08-12T12:30:40.851464+00:00

## Checks

- [x] login: logged in as dev@demo.local
- [x] nav-agents-vault-tools: agents=1 vault=1 tools=1 legacy_chat=0 legacy_settings=0
- [x] create-menu-testid: create-menu count=2
- [x] plus-menu-items: menu lists New Chat, New Project, New Scheduled Task
- [x] scheduled-tasks-folder: folder=2 icon=2 label=4
- [x] scheduled-tasks-folder-content: job_streams=0 empty_label=2
- [x] agent-title-present: title='Workspace' testid=agent-side-nav-title-218292ab-2303-41a7-968c-589f6a9012bc
- [x] agent-rename-edit-mode: editing testid=agent-side-nav-title-218292ab-2303-41a7-968c-589f6a9012bc-editing
- [x] agent-rename: edit closed; renamed='QA Agent 123034' display='QA Agent 123034' persisted=True
- [x] agent-rename-persisted: body/display contains 'QA Agent 123034': True
- [x] tools-tab-no-overview: overview=0 tools_nav=1 skills_surface=2
- [x] tools-section-selectors: all type selectors present
- [x] tools-scheduled-tasks-section: cron_surface=3
- [x] no-scoped-to-hint: scoped_hits=0

## Screenshots

- `01-post-login-agents.png`
- `01-post-login-agents.png`
- `02-create-menu-open.png`
- `03-scheduled-tasks-folder.png`
- `04-agent-rename-editing.png`
- `05-agent-renamed.png`
- `06-tools-tab-skills.png`
- `06-tools-tab-skills.png`
- `07-tools-scheduled-tasks.png`
- `08-agents-no-scope-hint.png`

See `REPORT.json` and `selectors.yaml`.
