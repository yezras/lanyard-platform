# lp-oop.34 — Kitchen-sink re-QA (harness path UI)

**Result:** PASS
**Stamp:** 20260817T175439Z
**Bead:** `lp-oop.34`

## Hop

```
Browser  ─HTTP + SSE─►  BFF (CHAT_DELIVERY=harness, VaultPlane=cp_s3)  ─HTTP + SSE─►  Harness
Directory  ─GET /api/vault/tree─►  BFF  ─CP HTTP─►  FakeS3   (no ensure_online)
```

Guest path stays default Relay. Live AWS MockLab `chat_delivery` is **not** flipped.

## Re-run

```bash
bash deploy/scripts/prove-mocklab-short-stack-kitchen-sink.sh
```

## Honesty

- Live AWS MockLab `chat_delivery` is **not** flipped (OPERATOR HOLD; guest/Relay stays default).
- Login used the local UI-QA seed user, not `.env.mocklab-agent-dev`.
- Kitchen-sink live tool turns (bash / web_search / subagents / workflow fire) stay **held** until a human pin + flip.
