# lp-khq.5 — Composer + attach menu shell

**Verdict: PASS**

Auth-free story `/?story=composer-attach-menu` + Playwright smoke.

## Fix (review re-open)

Previous insert path used Astryx `insertToken` / `insertText` without updating
controlled `value` (those APIs do not emit `onChange`). Send stayed disabled and
the value panel stayed empty. Inserts now **always** update controlled composer
text (`onComposerChange`); unit + Playwright assert `data-value` / text content.

## Acceptance

- [x] + opens menu with Skills, Select from vault, workflow entries
- [x] Selecting skill inserts `/name` into controlled composer (ready to send)
- [x] Selecting vault file inserts path reference into controlled composer
- [x] Unit tests assert composer value (not only last_action)
- [x] Screenshots under `artifacts/ui/lp-khq.5/` with non-empty value panel

## Screenshots

- `01-story-root.png` — story with + trigger
- `02-attach-menu-open.png` — root menu
- `03-skills-panel.png` — nested skills list
- `04-skill-inserted.png` — skill in value panel (`/summarize`)
- `05-vault-panel.png` — vault file list
- `06-vault-inserted.png` — skill + vault path in value panel

## Run

```bash
# From packages/web
pnpm exec vite --port 3035 --host 127.0.0.1
cd ui-testing
export BASE_URL=http://127.0.0.1:3035
export UI_ARTIFACTS=../../../../artifacts/ui/lp-khq.5
pytest -v test_composer_attach_menu.py
```
