# @lanyard/web UI testing (web-ui-testing skill)

Headless Playwright + pytest harness for live Vite proofs.

## lp-hdzm.29 — FakeOps /admin selector map

`selectors.yaml` maps FakeOps high-touch controls (admin nav, tenant row/chip,
add user, connector onboard, surfaces, registry search/promote). Keys are
snake_case; `testid` values match hyphenated `data-testid` attributes.

Static proof (no live app):

```bash
cd portal/apps/web/ui-testing
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
pytest -v test_fakeops_selectors.py
```

Playwright flows 1–8 are lp-hdzm.30.

## lp-hdzm.30 — FakeOps Playwright flows 1–8

Auth-free story `/?story=fakeops-admin` mounts the real ops shell against an
in-memory FakeOps store (no BFF/CP). Tenant-admin and tenant-cookie sessions
are `fakeops-admin-tenant` and `fakeops-admin-unauth`.

The suite starts Vite unless `FAKEOPS_BASE_URL` is set.

```bash
cd portal/apps/web/ui-testing
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
pytest -v test_fakeops_selectors.py test_fakeops_flows.py
bash "$HOME/.grok/skills/web-ui-testing/scripts/kill_browsers.sh"
```

Vision shots land under monorepo `artifacts/ui/lp-0018/`:

- `01-superadmin-tenants.png`
- `02-mocklab-connectors.png`
- `03-connector-detail.png`
- `REPORT.json`

## lac-bx3.16 — Group room multi-speaker timeline and roster (U1–U4)

Auth-free story `/?story=group-rooms` proves roster (Skip, Lev, Bana, Alice),
three persona speakers, composer `@` against the roster, and Skip's private
subagent nested under Skip (not a fourth peer). Narrow viewport (390×844) is
included.

```bash
export BASE_URL=http://demo.localhost:3010
export UI_ARTIFACTS=../../../../artifacts/ui/group-rooms
cd portal/apps/web/ui-testing
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
pytest -v test_group_rooms.py
bash "$HOME/.grok/skills/web-ui-testing/scripts/kill_browsers.sh"
```

Artifacts under monorepo `artifacts/ui/group-rooms/`.


## lp-khq.5 / lp-khq.6 / lp-khq.7 / lp-khq.12.3 / lp-khq.12.4 — Composer + attach menu

Auth-free story `/?story=composer-attach-menu` proves the composer **+**
menu in the **footer** (former paperclip slot): **Attach file** (local upload
stub), Skills (nested list + one-line descriptions), Select from vault
(**folder browse** + path insert). No New workflow / Workflow wizard chrome
(lp-v62i.2.1). No Open vault deep-link (lp-khq.12.4). No `/` or `@` required.
Standalone paperclip is removed.

```bash
# From packages/web
pnpm exec vite --port 3035 --host 127.0.0.1
cd ui-testing
export BASE_URL=http://127.0.0.1:3035
export UI_ARTIFACTS=../../../../artifacts/ui/lp-khq.12.4
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
pytest -v test_composer_attach_menu.py
```

Artifacts under monorepo `artifacts/ui/lp-khq.12.4/` (also covers .5 / .6 / .7 / .12.3):

- `01-story-root.png` … `07-vault-file-inserted.png`, `08-attach-file-menu.png`
- `REPORT.json` / `RESULT.md`

Unit: `composerAttachMenuModel.test.ts`, `composerAttachMenu.test.tsx`,
`ComposerAttachMenuProofStory.test.tsx`, `ChatView.test.tsx` (attach menu
folder drill; Attach file in + menu; Open vault removed).

## lp-fn5.7.1 — Portal Agents UI refresh

Live demo proof of Agents IA: top tabs **Agents | Vault | Tools**, unified **+**
create menu, agent double-click rename, **Scheduled Tasks** folder, Tools rail
without Overview.

Selector map keys live in `selectors.yaml` (nav_agents, create_menu,
scheduled_tasks_folder, tools_sections_nav, …). Plan notes:
`docs/plans/0013-portal-agents-ui-refresh/testing.md`.

```bash
# Stack: BFF :4000 + Vite :3010 (demo tenant)
export BASE_URL=http://demo.localhost:3010
export UI_ARTIFACTS=../../../../artifacts/ui/portal-agents-refresh
# From packages/web/ui-testing
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
pytest -v test_portal_agents_refresh.py
bash "$HOME/.grok/skills/web-ui-testing/scripts/kill_browsers.sh"
```

Login: `dev@demo.local` / `local-dev-password`.

Artifacts under monorepo `artifacts/ui/portal-agents-refresh/`:

- `01-post-login-agents.png` … `08-agents-no-scope-hint.png`
- `REPORT.json` / `RESULT.md`

## lp-75r.6 / lp-86d.12 — Citations open document pane

Auth-free story `/?story=citations-document-pane` seeds an assistant message with
two vault citation chips, plus controls for `artifact.open` and file-tool
`tool_target`. Each open path mounts `DocumentPaneHost` with distinct fixture
body. External https does **not** open the pane.

Solves empty chat history after BFF restart (0 chips) without requiring mocklab
login: fixtures are in-story. Mock-gateway also emits tools + `artifact.open` +
citations when a live message is sent.

```bash
# From packages/web
pnpm exec vite --port 3023 --host 127.0.0.1
cd ui-testing
export BASE_URL=http://127.0.0.1:3023
export UI_ARTIFACTS=../../../../artifacts/ui/lp-75r.6
# optional mirror for lp-86d.12:
# export UI_ARTIFACTS=../../../../artifacts/ui/lp-86d/citations
pytest -v test_citations_document_pane.py
```

Artifacts under monorepo `artifacts/ui/lp-75r.6/` (mirrored to
`artifacts/ui/lp-86d/citations/`):

- `seeded-citations-closed.png`
- `vault-citation-1-readme.png` / `vault-citation-2-notes.png`
- `artifact-open-memo.png` / `tool-target-legal.png`
- `external-https-no-pane.png` / `citations-matrix-composite.png`
- `citations-document-pane.json`

Unit: `CitationsDocumentPaneProofStory.test.tsx` + existing
`PortalShell.test` lp-vnz.8 / `chatArtifactRouting.test`.

## lp-86d.9 — markdown/doc preview pane body

Auth-free stories prove vault markdown/doc open paths mount
`chat-document-pane` with a **non-empty body** (not chrome-only):

- `?story=citations-document-pane` — citation chips + artifact.open
- `?story=document-pane` — default markdown deep-link
- `?story=document-pane&open=citation` — soft citation open

```bash
# From packages/web
pnpm exec vite --port 3024 --host 127.0.0.1
cd ui-testing
export BASE_URL=http://127.0.0.1:3024
export UI_ARTIFACTS=../../../../artifacts/ui/lp-86d/doc-preview
pytest -v test_markdown_doc_preview.py
```

Artifacts under monorepo `artifacts/ui/lp-86d/doc-preview/`:

- `citation-readme-body.png` / `citation-notes-body.png`
- `artifact-open-memo-body.png`
- `document-pane-default-body.png` / `soft-citation-open-body.png`
- `doc-preview-matrix.png` / `doc-preview.json` / `RESULT.md`

Unit: `useDocumentPanePreview.test.tsx` (lp-dpr.1),
`CitationsDocumentPaneProofStory.test.tsx`, `DocumentPaneShell.test.tsx`.

## Secret hygiene (lp-p37.13)

Playwright `storage_state` (session cookies) must land under
`artifacts/ui/.auth/` with **owner-only** permissions (`0600` file, `0700` dir).
Never commit that directory (gitignored).

```python
from secure_paths import secure_secret_path

AUTH = Path("../../../artifacts/ui/.auth/mocklab-agent.json")
context.storage_state(path=str(AUTH))
secure_secret_path(AUTH)  # chmod 600 + parent 700
```

Or from monorepo root after any UI QA run:

```bash
bash portal/scripts/secure-local-secrets.sh
```

Env: `UI_STORAGE_STATE` points at an existing auth-state file (see `conftest.py`).
Mocklab passwords stay in gitignored `.env.mocklab-agent-dev` (`chmod 600`).

## lp-a79.9 — Bar + pie charts in chat timeline

Auth-free story `/?story=chart-bar-pie` renders an assistant bubble with prose
plus `chart` fences (bar **Q1 revenue vs cost**, pie **Spend by category**) and
one invalid fence → `ChartSpecErrorCard` (no crash) via `ChatMessageContent` →
`PortalChartCard`.

```bash
# Preferred: self-contained CDP proof (starts Vite + Chromium)
# From monorepo root:
node portal/packages/web/scripts/chart-bar-pie-proof.mjs

# Or Playwright (live Vite required):
# From packages/web
pnpm exec vite --port 3023 --host 127.0.0.1
cd ui-testing
export BASE_URL=http://127.0.0.1:3023
export UI_ARTIFACTS=../../../../artifacts/ui/lp-a79
pytest -v test_chart_bar_pie.py
```

Artifacts under monorepo `artifacts/ui/lp-a79/`:

- `chart-bar-pie.png`
- `chart-bar-pie.json`

## lp-a79.13 — Table badge + vault/external links in chat

Auth-free story `/?story=table-badge-links` renders an assistant bubble with a
`table` fence findings fixture (categorical **High** badge, vault `runbook.md`,
external Linear ticket) via `ChatMessageContent` → `PortalTableCard` (Astryx Table).

**Documented vault path:** project `/home/u/Core` + href
`docs/runbooks/finding-f12.md` → resolved
`/home/u/Core/docs/runbooks/finding-f12.md` (onCitationClick / onVaultPath).

```bash
# Preferred: self-contained CDP proof (starts Vite + Chromium)
# From monorepo root:
node portal/packages/web/scripts/table-badge-links-proof.mjs

# Or Playwright (live Vite required):
# From packages/web
pnpm exec vite --port 3022 --host 127.0.0.1
cd ui-testing
export BASE_URL=http://127.0.0.1:3022
export UI_ARTIFACTS=../../../../artifacts/ui/lp-a79
pytest -v test_table_badge_links.py
```

Artifacts under monorepo `artifacts/ui/lp-a79/`:

- `table-badge-links.png`
- `table-badge-links.json`

## portal-mnn.7 — Vite `/src/api` proxy MIME

Proves the reserved-path proxy bypass: `/src/api/*.ts` is served as JavaScript
modules (not BFF `text/plain` 404), and AuthView paints.

```bash
# 1. doctor (once per host)
bash "$HOME/.grok/skills/web-ui-testing/scripts/doctor.sh"

# 2. Start fixed Vite from packages/web (prefer free port if :3010 is old host)
BFF_URL=http://127.0.0.1:4000 pnpm exec vite --port 3016 --host 127.0.0.1

# 3. Run smoke
cd packages/web/ui-testing
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# or reuse skill venv:
# source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"

export BASE_URL=http://127.0.0.1:3016
export UI_ARTIFACTS=../../../artifacts/ui/vite-src-api-proxy-mime
pytest -v test_vite_src_api_proxy_mime.py
```

Screenshot: `artifacts/ui/vite-src-api-proxy-mime/load.png`

MetaMask `ObjectMultiplex` console noise is ignored.

## lp-dpr.8 — Chat activity plane (phases 0–6)

Auth-free story route `/?story=activity-plane` renders the activity-plane
happy paths with fixture timeline + document preview (no login / BFF):

| Phase | Query | Proof |
| --- | --- | --- |
| 0–1 soft open | `phase=soft&pane=document` | Document pane body non-empty |
| 2 tools | `phase=tools&pane=closed` | ChatToolCalls tool rows |
| 3–4 shell | `phase=subagent&pane=activity` | Activity pane chrome + roster |
| 5 subagent | `phase=subagent&pane=closed` | Chip click → subagent detail |
| 6 workflow | `phase=workflow&pane=closed` | Stages + nested subagents + tree |
| all | `phase=all&pane=document` | Composite + exclusive side chrome |

```bash
# From packages/web
pnpm exec vite --port 3021 --host 127.0.0.1

cd ui-testing
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
export BASE_URL=http://127.0.0.1:3021
export UI_ARTIFACTS=../../../artifacts/ui/lp-dpr.8-activity-plane
pytest -v test_activity_plane.py
```

Screenshots land under `artifacts/ui/lp-dpr.8-activity-plane/`:

- `phase0-1-soft-open-content.png`
- `phase2-tool-rows.png`
- `phase3-4-activity-pane-shell.png`
- `phase5-subagent-chip-activity.png`
- `phase6-workflow-stages.png`
- `phase-all-composite.png`
- `phase-all-activity-exclusive.png`

## lp-5q6.13 — Chat document pane desktop layout

Auth-free story route `/?story=document-pane` renders the chat document pane
shell with fixture markdown (no login / BFF required).

```bash
# From packages/web
pnpm exec vite --port 3017 --host 127.0.0.1

cd ui-testing
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
export BASE_URL=http://127.0.0.1:3017
export UI_ARTIFACTS=../../../artifacts/ui/document-pane-desktop
pytest -v test_document_pane_desktop.py
```

Screenshot: `artifacts/ui/document-pane-desktop/document-pane-desktop.png`

## lp-5q6.15 — Responsive / accessible document pane

Auth-free story route `/?story=document-pane` (optional `&layout=split|drawer`)
covers desktop wide, laptop, tablet, and mobile screenshots plus drawer mode.

```bash
# From packages/web
pnpm exec vite --port 3017 --host 127.0.0.1

cd ui-testing
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
export BASE_URL=http://127.0.0.1:3017
export UI_ARTIFACTS=../../../artifacts/ui/document-pane-responsive
pytest -v test_document_pane_responsive.py
```

Screenshots land under `artifacts/ui/document-pane-responsive/`:

- `document-pane-desktop-wide.png`
- `document-pane-laptop.png`
- `document-pane-tablet.png`
- `document-pane-mobile.png`

## lp-5q6.27 — ONLYOFFICE editor host (feature flag)

Auth-free story `/?story=document-pane&mode=onlyoffice` mounts the flag-gated
editor host with a **mocked DocsAPI** (nonblank surface). No live Document
Server or BFF Office mint is required for the screenshot proof.

```bash
# From packages/web
pnpm exec vite --port 3018 --host 127.0.0.1

cd ui-testing
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
export BASE_URL=http://127.0.0.1:3018
export UI_ARTIFACTS=../../../artifacts/ui/lp-5q6.27-onlyoffice-editor-host
pytest -v test_onlyoffice_editor_host.py
```

Screenshot: `artifacts/ui/lp-5q6.27-onlyoffice-editor-host/onlyoffice-editor-host-nonblank.png`

Runtime enable (production default **off**):

- `VITE_ONLYOFFICE_EDITOR=true`
- `VITE_ONLYOFFICE_DS_URL=http://127.0.0.1:8080` (browser → Document Server; loopback HTTP is lab-only)
- or (non-production builds only) `window.__LANYARD_FEATURE_FLAGS__ = { onlyoffice_editor: true, onlyoffice_document_server_url: "http://127.0.0.1:8080" }`
- Production builds ignore query-string DS URL / enablement (`?onlyoffice_ds_url=…`); see operate-onlyoffice-document-server.md §1.1 (lp-p37.3)

## lp-5q6.37 — Browser verification (chat pane + Office editor)

End-to-end browser QA for the chat document pane and ONLYOFFICE lab editor host.
Auth-free story route covers:

| Acceptance | Story / assertion |
| --- | --- |
| Open pane from citation (desktop + mobile) | `?story=document-pane&open=citation&layout=split\|drawer` |
| No overlap / readable chat / usable composer / stable controls | layout split screenshots + geometry checks |
| ONLYOFFICE canvas nonblank | `?mode=onlyoffice` mock DocsAPI surface |
| Preview fallback (flag off) | `?mode=flag_off` → `data-renderer=preview`, no host |
| Preview fallback (DS unavailable) | `?mode=ds_unavailable` → load_failure → Back to preview |
| A11y: focus, close, reload, open-in-vault | labeled controls + action counters on story root |

```bash
# From packages/web
pnpm exec vite --port 3019 --host 127.0.0.1

cd ui-testing
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
export BASE_URL=http://127.0.0.1:3019
export UI_ARTIFACTS=../../../artifacts/ui/lp-5q6.37-chat-pane-office-browser-qa
pytest -v test_chat_pane_office_browser_qa.py
```

Screenshots land under `artifacts/ui/lp-5q6.37-chat-pane-office-browser-qa/`:

- `citation-open-desktop.png`
- `citation-open-mobile.png`
- `layout-no-overlap-desktop.png`
- `onlyoffice-lab-editor-nonblank.png`
- `preview-fallback-flag-off.png`
- `preview-fallback-ds-unavailable.png`
- `a11y-focus-close-reload-open-in-vault.png`

## lp-5q6.38 — Localhost mocklab product chain (chat → agent → pane → human save)

Auth-free story `/?story=document-pane&mode=e2e_chain` shows the pane after an
agent revision checkpoint (ready for human Office edit). Full live lab DS chain
requires **through-Document-Server** forcesave (not synthetic BFF fixture status-2):

```bash
# From monorepo root
bash deploy/scripts/prove-localhost-office-e2e.sh
```

Optional story-only screenshots:

```bash
# From packages/web
pnpm exec vite --port 3019 --host 127.0.0.1

cd ui-testing
export BASE_URL=http://127.0.0.1:3019
export UI_ARTIFACTS=../../../../artifacts/localhost/lp-5q6.38/screenshots
pytest -v test_localhost_office_e2e.py::test_story_e2e_chain_pane_visible \
  test_localhost_office_e2e.py::test_story_progress_strip
```

Live through-DS human save (lab BFF + DS already up):

```bash
export LAB_BFF_URL=http://127.0.0.1:4100
export LAB_DS_URL=http://127.0.0.1:8080
export UI_ARTIFACTS=../../../../artifacts/localhost/lp-5q6.38/screenshots
pytest -v test_localhost_office_e2e.py::test_through_ds_human_save_forcesave
```

Evidence: `artifacts/localhost/lp-5q6.38/` (no secrets). Does **not** authorize
AWS staging or production Office edit.
