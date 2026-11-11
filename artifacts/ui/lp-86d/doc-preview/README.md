# lp-86d.9 — markdown/doc preview pane body

QA proof that opening a vault markdown/doc via citation or soft citation
open mounts `chat-document-pane` with a **non-empty body** (not toolbar
chrome only).

## Stories

| Story | What it proves |
| --- | --- |
| `?story=citations-document-pane` | Vault citation chips + `artifact.open` open markdown with distinct fixture bodies |
| `?story=document-pane` | Default deep-link markdown preview body |
| `?story=document-pane&open=citation` | Soft citation open: start closed → chip click → body |

## Run

```bash
# From portal/packages/web
pnpm exec vite --port 3024 --host 127.0.0.1

cd ui-testing
export BASE_URL=http://127.0.0.1:3024
export UI_ARTIFACTS=../../../../artifacts/ui/lp-86d/doc-preview
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
pytest -v test_markdown_doc_preview.py
```

## Artifacts

- `citation-readme-body.png` / `citation-notes-body.png`
- `artifact-open-memo-body.png`
- `document-pane-default-body.png` / `soft-citation-open-body.png`
- `doc-preview-matrix.png`
- `doc-preview.json` / `RESULT.md`

Related: lp-86d.12 / lp-75r.6 (citation open paths), lp-dpr.1 (chrome-without-body fix).
