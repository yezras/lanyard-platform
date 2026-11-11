# 0013 — Portal Agents UI refresh: testing

**Bead:** `lp-fn5.7.1` (sub-epic G / `lp-fn5.7`)  
**Product:** `@lanyard/web`  
**Harness:** `portal/packages/web/ui-testing` (web-ui-testing skill patterns)

## Surfaces

| Surface | URL | Credentials |
|---------|-----|-------------|
| Local product | `http://demo.localhost:3010` | `dev@demo.local` / `local-dev-password` |
| Product (loopback) | `http://127.0.0.1:3010` | same (Host may need tenant cookie via demo host) |
| Marketing demo mock | `http://127.0.0.1:3000` (lanyard-site mock-portal) | none (static mock) |

Prefer **`BASE_URL=http://demo.localhost:3010`** so the BFF resolves the demo tenant.

Stack prerequisites:

- BFF on `:4000` (`pnpm dev:bff` from `portal/` with demo-env)
- Vite web on `:3010` (`pnpm dev:web` or `pnpm exec vite --port 3010 --host 0.0.0.0` from `portal/packages/web`, `BFF_URL=http://127.0.0.1:4000`)
- `demo.localhost` → loopback (`::1` / `127.0.0.1` in `/etc/hosts`)

## Selector map

Source of truth:

```text
portal/packages/web/ui-testing/selectors.yaml
```

Keys for this epic (non-exhaustive):

| Key / testid | Surface |
|--------------|---------|
| `nav_agents` / role button **Agents** | Top tab (was Chat) |
| `nav_tools` / role button **Tools** | Top tab (was Settings) |
| `create-menu` / aria **New** | Unified + create menu |
| menuitems **New Chat**, **New Project**, **New Scheduled Task** | Plus menu items |
| `agent-side-nav-row-{id}` | Agent / job chat row |
| `agent-side-nav-title-{id}` (+ `-editing`) | Double-click rename |
| label **Agent name** | Inline rename input |
| `scheduled-tasks-folder` | Synthetic Scheduled Tasks group |
| `scheduled-tasks-folder-icon` | Calendar glyph on folder |
| `data-job-stream="true"` | Job stream rows under folder |
| aria **Tools sections** | Tools left rail (no Overview) |
| `skills-table`, `scheduled-tasks-table`, `crons-table` | Tools panels |

Dynamic row testids use thread ids; tests locate via CSS prefix or first owned non-job row.

## Pytest suite

```bash
# 1. Doctor (once per host)
bash "$HOME/.grok/skills/web-ui-testing/scripts/doctor.sh"

# 2. Product stack up (BFF :4000 + Vite :3010)

# 3. Run Agents refresh proofs
cd portal/packages/web/ui-testing
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"  # or .venv
export BASE_URL=http://demo.localhost:3010
export UI_ARTIFACTS=../../../../artifacts/ui/portal-agents-refresh
pytest -v test_portal_agents_refresh.py

# 4. Kill leftover Chromium after runs
bash "$HOME/.grok/skills/web-ui-testing/scripts/kill_browsers.sh"
```

### Coverage matrix

| Acceptance | Test / check |
|------------|----------------|
| selectors.yaml updated | `test_selectors_yaml_covers_agents_refresh_keys` + map file |
| Plus menu | `plus-menu-items` (New Chat / New Project / New Scheduled Task) |
| Rename | `agent-rename-edit-mode` + `agent-rename` / `agent-rename-persisted` |
| Tools tab | `tools-tab-no-overview`, `tools-section-selectors`, Scheduled tasks section |
| Scheduled folder | `scheduled-tasks-folder`, icon, optional job streams |
| Artifacts stored | `artifacts/ui/portal-agents-refresh/*.png` + `REPORT.json` |

## Artifacts

Directory (committed baselines optional; screenshots produced by CI/local runs):

```text
artifacts/ui/portal-agents-refresh/
  01-post-login-agents.png
  02-create-menu-open.png
  03-scheduled-tasks-folder.png
  04-agent-rename-editing.png
  05-agent-renamed.png
  06-tools-tab-skills.png
  07-tools-scheduled-tasks.png
  08-agents-no-scope-hint.png
  REPORT.json
  RESULT.md
```

Session storage (gitignored): `artifacts/ui/.auth/demo-localhost-lp-fn5.7.1.json` (mode 0600 via `secure_paths`).

## Unit tests (already on main)

Product logic is covered by Vitest under `portal/packages/web/src`:

- `PortalShell.test.tsx` — Agents / Tools tabs
- `ChatHistorySideNav.test.tsx` — create menu, Scheduled Tasks folder
- `AgentSideNavRow.test.tsx` / `AgentTitleEditor.test.tsx` — dither + rename
- Settings / schema tests — Overview removed, Scheduled tasks label

Playwright does **not** replace those; it proves the integrated shell on a live stack.

## Marketing mock (`:3000`)

Parity UI lives in `lanyard-site` mock-portal (sub-epic F / `lp-fn5.6`). Optional follow-up: mirror high-touch selectors against `http://127.0.0.1:3000` when that app is running. Product proofs in this suite target **:3010** only.

## Kill browsers

Always run after local Playwright sessions:

```bash
bash "$HOME/.grok/skills/web-ui-testing/scripts/kill_browsers.sh"
# or: python3 "$HOME/.grok/skills/web-ui-testing/scripts/kill_browsers.py"
```
