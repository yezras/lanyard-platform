# lp-khq.7 — Composer: Select from vault file picker + vault deep-link

**Verdict: PASS**

Auth-free story `/?story=composer-attach-menu` + Playwright smoke.

## Acceptance

- [x] Pick file from + → Select from vault (folder browse) → path appears in composer
- [x] Open vault link deep-links Vault tab path (current folder; `/` at roots)
- [x] Works without knowing `@` syntax

## Screenshots

- `01-story-root.png` — story with + trigger
- `02-attach-menu-open.png` — root menu
- `03-skills-panel.png` — nested skills list
- `04-skill-inserted.png` — skill in value panel
- `05-vault-panel-root.png` — vault roots + Open vault
- `06-vault-folder-drill.png` — drilled into `/Business/Contracts`
- `07-vault-file-inserted.png` — path ref in composer
- `08-open-vault-deeplink.png` — last_action `vault:open-tab:/Projects`

## Run

```bash
# From packages/web
pnpm exec vite --port 3035 --host 127.0.0.1
cd ui-testing
export BASE_URL=http://127.0.0.1:3035
export UI_ARTIFACTS=../../../../artifacts/ui/lp-khq.7
pytest -v test_composer_attach_menu.py
```
