# lp-uxy.15.7 — sandbox cwd ACL honesty + Omnibox Mode A wrap

**Shipped feature:** lp-uxy.6
**Base URL:** `http://demo.localhost:3010`
**Login:** `dev@demo.local`
**When:** 2026-08-05T14:17:05.615797+00:00
**Verdict:** **PASS**

## Acceptance

Sandbox/cwd UX does not claim hard jail; Mode A product wrap visible/correct.

- [x] login: logged in as dev@demo.local
- [x] brain-rpc-enabled: brain_rpc_enabled=True kind=lanyard_agent profile=admin
- [x] backend-kind-lanyard-agent: kind=lanyard_agent
- [x] projects-list: status=200 count=9 names=['Workspace', 'Clients', 'demo', 'legal_work', 'QaBugWd24645', 'FixWd25140', 'k', 'dmeo']
- [x] soft-scope-hint-visible: hint='Scoped to Clients' pick='Clients' path='/home/operator/Lanyard/Clients'
- [x] no-hard-jail-claims-chat: forbidden_hits=[]
- [x] new-project-working-directory-language: subtitle_ok=True label_ok=True forbidden=[]
- [x] no-hard-jail-claims-settings: forbidden_hits=[]
- [x] capabilities-no-false-sandbox-jail: project_picker=supported features.projects_list=True features.projects_create=True
- [x] omnibox-path-escape-negative: returncode=0 tail='roj\nPASS: vault-only sibling -> /tmp/lp-uxy6-path-acl-xnwa6fgg/vault/sib.txt\n\nAll project path-escape negative checks passed.\nResidual (documented): shell argv is not path-ACL confined by this suite.\n'
- [x] omnibox-argv-self-test-mode-a-wrap: returncode=0 (shell_exec wrap shape when OMNIBOX_ENABLED=1; disabled=passthrough)
- [x] omnibox-mode-a-residual-honesty-docs: default_off=True la_residual=True not_hard_jail=True
- [x] live-backend-la-omnibox-residual-acknowledged: kind=lanyard_agent; LA has no Omnibox argv rewrite (lp-uxy.6 residual)
- [x] final-scope-hint-stable: final_hint='Scoped to Clients'

## Omnibox Mode A (contract + residual)

- path-escape negative: ok=True
- argv self-test (wrap shape): ok=True
- hook residual doc: ok=True (default_off=True, la_residual=True)
- security honesty doc (Not a hard jail): True

Live backend is **lanyard_agent** — Omnibox product wrap is HL-only; LA residual owner is LA product (documented). Deploy default is OFF.

## Scope hint (UI)

- text: `Scoped to Clients`
- project: `{'name': 'Clients', 'path': '/home/operator/Lanyard/Clients'}`

## Screenshots

- `01-post-login.png`
- `02-project-scope-hint.png`
- `02-project-scope-hint.png`
- `03-new-project-dialog.png`
- `04-settings-overview.png`
- `05-chat-scoped-final.png`

## Fix bead

None (all checks green).

See `REPORT.json` for machine-readable results.
