# lp-75r.6 — Citations open side document pane

**Related:** lp-86d.12 (artifacts mirrored under `artifacts/ui/lp-86d/citations/`)

## Acceptance proof

| Path | How | Evidence |
|------|-----|----------|
| Vault citation chips | Seeded `ChatMessageContent` + `vault-citation-1/2` | `vault-citation-*-*.png` |
| `artifact.open` | Simulate control → `panelActionsFromChatEvent` | `artifact-open-memo.png` |
| `tool_target` | Simulate control → `openToolTargetAction` | `tool-target-legal.png` |
| External https | Intentionally blocked | `external-https-no-pane.png` |

Story: `/?story=citations-document-pane`  
Playwright: `portal/packages/web/ui-testing/test_citations_document_pane.py`  
Evidence JSON: `citations-document-pane.json`

Live mocklab: send any chat message with `pnpm dev:mock-gateway` — sequence now
includes `tool_progress` (tool_target), `artifact.open`, and footer citations.
Empty history after BFF restart is expected; re-send a message or use the
auth-free story for deterministic proof.
