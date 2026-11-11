# lp-86d.9 — markdown/doc preview pane body

**Status:** PASS

## Acceptance

- [x] Open vault markdown/doc via citation or soft file reference
- [x] `chat-document-pane` shows non-empty body (not chrome-only)
- [x] `data-renderer=preview` for markdown (VaultReader path)
- [x] Reject empty `Select a file` chrome-only body

## Paths proven

- citation → `/Projects/A/README.md` (README body)
- citation → `/Projects/A/notes.md` (notes body)
- artifact.open → `/Projects/A/memo.md` (memo body)
- document-pane default deep-link → `/Projects/A/README.md`
- document-pane soft `open=citation` → `/Projects/A/README.md`

## Screenshots

- `citation-readme-body.png`
- `citation-notes-body.png`
- `artifact-open-memo-body.png`
- `document-pane-default-body.png`
- `soft-citation-open-body.png`
- `doc-preview-matrix.png`

## Evidence

- `doc-preview.json`

## Notes

Auth-free stories prove markdown/doc preview body is non-empty when opened via citation chip, soft open=citation, default deep link, or artifact.open. Live LA agent citation metadata is covered by lp-86d.12 / lp-75r.6; this bead focuses on pane body content (not chrome-only toolbar). Artifacts: artifacts/ui/lp-86d/doc-preview/.
