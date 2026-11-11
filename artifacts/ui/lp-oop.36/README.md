# lp-oop.36 — harness-path no-tool UI QA

Browser proof of [lp-oop.31](../../mocklab/short-stack/RESULT.md) acceptance: one no-tool turn, **Relay not on the hop**.

## Re-run

```bash
bash deploy/scripts/prove-mocklab-short-stack-no-tool-ui.sh
```

Do **not** point Playwright at `https://app.withlanyard.com/mocklab`. Live AWS `chat_delivery` is still default relay (Hermes 504). Flipped-MockLab Playwright is `lp-oop.33`.

Local login (seeded by `serve-short-stack-ui-qa.ts`): `agent-dev@mocklab.local` / `local-dev-password`.

## Evidence

| File | What |
|------|------|
| `01-login-home.png` … `05-assistant-reply.png` | Chat pane: login, Agents, composer, send, harness `echo:` |
| `REPORT.json` | Checks + `hop.relay` counters (all 0) |
| `RESULT.md` | Human hop record |

`run_qa.py` refuses a `withlanyard.com` `BASE_URL`.
