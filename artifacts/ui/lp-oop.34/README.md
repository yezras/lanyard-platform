# lp-oop.34 — Kitchen-sink re-QA (harness path)

Kitchen-sink matrix on a **local** BFF with `ChatDelivery=harness` and `VaultPlane=cp_s3`. Guest path stays default Relay. Waivers are named.

## Re-run

```bash
bash deploy/scripts/prove-mocklab-short-stack-kitchen-sink.sh
bash deploy/scripts/smoke-mocklab-short-stack-kitchen-sink.sh
```

Do **not** point Playwright at `https://app.withlanyard.com/mocklab`. Live AWS `chat_delivery` is still default relay. This leaf does not flip it.

Local login (seeded by `serve-short-stack-kitchen-sink.ts`): `agent-dev@mocklab.local` / `local-dev-password`.

## Evidence

| File | What |
|------|------|
| `01-auth-home.png` … `12-final.png` | Shell, chat, vault, tools, MCP, scheduled tasks |
| `REPORT.json` | Checks + named waivers + hop |
| `RESULT.md` | Human hop record |
| `artifacts/mocklab/short-stack/kitchen-sink/RESULT.md` | Gate verdict `GO` / `GO_WITH_WAIVERS` |

`run_qa.py` refuses a `withlanyard.com` `BASE_URL`.
