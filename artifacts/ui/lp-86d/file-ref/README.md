# lp-86d.11 — File references soft-open document pane (mode A)

## Acceptance proof

| Path | How | Evidence |
|------|-----|----------|
| User path_reference | Soft mode A (no open verb) → `openDocumentIntentFromUserMessage` | `user-soft-mode-a-pane-body.png` |
| Assistant free-text path | Defensive soft-open via `panelActionsFromChatEvent` | `assistant-free-text-soft-open.png` |
| Path pill (reopen chip) | Soft-open → close → click pill → body reloads | `path-pill-reopen-body.png` |
| Pane not chrome-only | Fixture body visible in `chat-document-pane-body` | all body screenshots |

Story: `/?story=file-ref-soft-open`  
Playwright: `portal/packages/web/ui-testing/test_file_ref_soft_open_document_pane.py`  
Evidence JSON: `file-ref-soft-open.json`

Product path: soft mode A (lp-dpr.2) — first office vault path / unique basename
reference in a user or assistant message opens the chat document pane without
requiring open/work verbs. Path pills are durable reopen chips (lp-a8u.2)
minted after a successful soft-open.

Related soft-open composite (activity plane phases 0–1): `artifacts/ui/lp-dpr.8-activity-plane/`.
