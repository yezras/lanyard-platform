# lp-oop.33 — Playwright UI QA on harness path

**Result:** PASS
**Stamp:** 20260817T173218Z
**Bead:** `lp-oop.33`

## Hop

```
Browser  ─HTTP + SSE─►  BFF (CHAT_DELIVERY=harness, VaultPlane=cp_s3)  ─HTTP + SSE─►  Harness
Directory  ─GET /api/vault/tree─►  BFF  ─CP HTTP─►  FakeS3   (no ensure_online)
```

Send + stream used the harness hop (`text/event-stream`, `message_send`). Vault tree listed FakeS3 roots `/Projects`, `/AGENTS.md`, `/short-stack-no-wake.md` and did **not** 502 wake (`ensure_online_during_tree=0`, `bff_ensureOnline=0`, `cp_ensureOnline=0`). See `REPORT.json`.

## Re-run

```bash
bash deploy/scripts/prove-mocklab-short-stack-harness-ui.sh
```

## Honesty

- Live AWS MockLab `chat_delivery` is **not** flipped (OPERATOR HOLD; guest/Relay stays default).
- Login used the local UI-QA seed user, not `.env.mocklab-agent-dev`.
- Vault tree listed FakeS3 via CP HTTP. `ensure_online` was not called on `GET /api/vault/tree`.
