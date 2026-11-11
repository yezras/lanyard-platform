# lp-oop.33 — Playwright UI QA on harness path

`web-ui-testing` MockLab harness path: **send**, **stream**, **vault tree without wake**.

## Re-run

```bash
bash deploy/scripts/prove-mocklab-short-stack-harness-ui.sh
```

Offline (no browser): `bash deploy/scripts/smoke-mocklab-short-stack-harness-ui.sh`.

Do **not** point Playwright at `https://app.withlanyard.com/mocklab`. Live AWS
`chat_delivery` is still default relay (Hermes 504). OPERATOR HOLD forbids
re-applying torn-down staging AWS.

Local login (seeded by `serve-short-stack-harness-ui.ts`):
`agent-dev@mocklab.local` / `local-dev-password`.

## Evidence

| File | What |
|------|------|
| `01-login-home.png` … `05-assistant-reply.png` | Login, Agents, composer, send, harness stream/`echo:` |
| `06-vault-tree.png` | Directory tree on `VaultPlane=cp_s3` (marker `short-stack-no-wake.md`) |
| `REPORT.json` | Checks + hop + vault_tree did-not-502-wake |
| `RESULT.md` | Human hop record |

`run_qa.py` refuses a `withlanyard.com` `BASE_URL`.
