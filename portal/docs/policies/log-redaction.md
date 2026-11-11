# Log redaction and debug payload gate (G2b.2)

| Field | Value |
|-------|--------|
| **Status** | Enforced in product code |
| **Date** | 2026-07-12 |
| **Bead** | `cbd-hhj.5.2` (G2b.2) |
| **Parent** | `cbd-hhj.5` — Payload log / retention controls |
| **Policy sibling** | [log-retention-and-access.md](./log-retention-and-access.md) (G2b.1) when merged |

No secrets, account IDs, or customer vault content appear in this document.

## Purpose

Enforce **no vault file bodies, chat bodies, or secrets** on shared log sinks (CloudWatch / container drivers) by default. Operator debug that includes payloads must be **explicit and gated**.

## Product enforcement

Shared library: `@lanyard/shared` → `createLogger` / `redactForLog` / `redactAuditMetadata`.

| Service | Where |
|---------|--------|
| **bff** | Boot logs, unhandled `onError`, chat/history warnings |
| **relay** | Boot + start failure |
| **control-plane** | Boot, unhandled `onError`, **audit_log metadata** always redacted |

### Default (shared sinks / L1)

- Structured JSON lines: `timestamp`, `level`, `service`, `message`, plus safe metadata.
- **Always redacted:** keys matching secrets (`password`, `token`, `authorization`, `cookie`, `api_key`, `secret`, ops/service tokens, …).
- **Office bridge secrets (lp-5q6.33):** also always redacted — `download_token`, `callback_nonce`, `nonce`, `jwt`, `editor_jwt`, `onlyoffice_token`, and similar token-shaped keys.
- **Redacted by default:** payload keys (`body`, `content`, `vault_content`, `file_bytes`, `request_body`, `message`, …).
- **Office bridge payloads (lp-5q6.33):** also redacted by default — `callback_url`, `download_url`, `changesurl`, `document_url`, `assembled_url` (use dedicated redact helpers if a host must be logged).
- Binary buffers never dumped as bytes — only length + redaction marker.
- Vault file **bodies** must not be passed into log fields at all; if they are, redaction strips them.
- Office operator logs use `office_session_id` + `error_code` + `size_bucket` (see [portal-office-observability.md](../../../docs/architecture/portal-office-observability.md)).

### Debug payloads (L9-style, gated)

| Env var | Values that enable | Default |
|---------|-------------------|---------|
| `PORTAL_DEBUG_PAYLOADS` | `true` / `1` / `yes` / `on` | **off** |
| `LOG_DEBUG_PAYLOADS` | same (alias) | **off** |

When enabled:

- Non-secret payload fields may appear in log fields (still truncated).
- **Secrets remain redacted** (never fail open).
- Intended for **local/staging or time-boxed support** on a private operator path — **not** multi-tenant shared debug buckets.
- Do **not** leave enabled in production shared log groups.

### Log level

| Env | Default | Notes |
|-----|---------|--------|
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |

`debug` level only increases verbosity of **allowed** fields; it does **not** by itself enable payload dumps. Payload dumps require `PORTAL_DEBUG_PAYLOADS`.

## Operator checklist

```text
[ ] Production: PORTAL_DEBUG_PAYLOADS unset/false on bff, relay, control-plane
[ ] Production: no log subscription rewrites raw body fields into a shared bucket
[ ] Support dumps: private workstation / ticket only; delete within ≤ 7 days (G2b.1 L9)
[ ] After support: confirm env gate off; rotate any tokens that may have been pasted
```

## Tests

Unit coverage lives in `packages/shared/src/logging/redact.test.ts`:

- Default redaction strips vault/body secrets from serialized log lines.
- Debug gate allows non-secret payloads but still redacts secrets.
- `redactAuditMetadata` never retains secrets/payloads for durable audit rows.

```bash
pnpm --filter @lanyard/shared test
```

## Out of scope

- Hermes data-plane host logs (deploy policy + hermes-lanyard only if needed — never public hermes-agent).
- Interaction export retention (gated separately via control-plane retention API / relay `shouldPersistInteraction`).
- Changing client data-handling TTLs (G2b.1).
