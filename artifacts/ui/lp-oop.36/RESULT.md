# lp-oop.36 — harness-path no-tool UI proof

**Result:** PASS
**Stamp:** 20260817T163142Z
**Bead:** `lp-oop.36` (UI re-open of `lp-oop.31`)

## Hop

```
Browser  ─HTTP + SSE─►  BFF (CHAT_DELIVERY=harness)  ─HTTP + SSE─►  Harness
```

Relay was **not** on the hop (see `REPORT.json` `hop.relay`). Live AWS MockLab `chat_delivery` is **not** flipped.

## Re-run

```bash
bash deploy/scripts/prove-mocklab-short-stack-no-tool-ui.sh
```

## Honesty

- Live AWS browser path stays guest-gateway + Relay (Hermes 504 on production is out of this leaf).
- Playwright on a flipped MockLab is `lp-oop.33`.
- Login used the local UI-QA seed user, not `.env.mocklab-agent-dev`.
