# Office bridge observability (open / save / callback / pane)

**Bead:** `lp-5q6.33`  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Threat baseline:** [portal-office-document-bridge-threat-notes.md](portal-office-document-bridge-threat-notes.md) §5.11  
**Redaction:** [portal/docs/policies/log-redaction.md](../../portal/docs/policies/log-redaction.md)

> **Rule:** Metrics and logs help operators distinguish integration failures **without** becoming a data leak. Prefer IDs and codes over paths. Never emit file body, JWT, download token, callback nonce, or raw vault content.

---

## 1. Metric catalog

Stable event names (in-process counters today; Prometheus names if/when exported):

| Event | When | Outcome / labels (enum only) |
| --- | --- | --- |
| `office_config_mint` | BFF mints editor config + JWT (`lp-5q6.26`) | `outcome` = success \| denied \| error |
| `office_download` | Signed download GET (`lp-5q6.22`) | `outcome`, `reason` (deny code) |
| `office_editor_load` | Web host loads Document Server `api.js` / iframe (`lp-5q6.27`) | `outcome`, optional `error_code` |
| `office_callback` | ONLYOFFICE callback POST (`lp-5q6.23`) | `code` (body.code), `onlyoffice_status` |
| `office_write` | Implied by callback save path | success / conflict / error totals |
| `office_pane` | Chat document pane open / load / error | `kind`, `error_code` |

**Forbidden labels:** path, filename, user display name, email, token fragments, JWT, URL query strings, base64 body, vault path strings when policy requires hash-only.

**Allowed labels / dimensions:** `tenant_id` (optional in multi-tenant series), `file_type` (docx/xlsx/…), `mode` (view/edit), `outcome`, `error_code`, `operator_class`, `size_bucket`, `onlyoffice_status` (integer 1–7).

### Size buckets

Exact `size_bytes` may appear in **L1 logs** (threat notes: byte length optional). Metric **labels** should use buckets:

| Bucket | Range |
| --- | --- |
| `empty` | 0 |
| `lt_1kb` | &lt; 1 KiB |
| `1kb_64kb` | &lt; 64 KiB |
| `64kb_1mb` | &lt; 1 MiB |
| `1mb_10mb` | &lt; 10 MiB |
| `10mb_50mb` | &lt; 50 MiB |
| `gte_50mb` | ≥ 50 MiB |
| `unknown` | missing / non-finite |

Implementation: `officeSizeBucket()` in `portal/packages/bff/src/office/metrics.ts`.

---

## 2. Safe log fields

Every Office log line should prefer this envelope (via `buildOfficeSafeLogFields`):

| Field | Required | Notes |
| --- | --- | --- |
| `event` | yes | Metric event name |
| `tenant_id` | when known | Tenant isolation |
| `office_session_id` | when known | Opaque Office session id (not `session_id` — G2b redacts cookie session ids) |
| `request_id` | when known | Correlation (HTTP or open id) |
| `route` | recommended | e.g. `/api/office/callback` |
| `status` | recommended | HTTP status or domain status |
| `latency_ms` | recommended | Integer ms |
| `size_bucket` | when size known | See §1 |
| `size_bytes` | optional | Exact length OK on L1; not a metric label |
| `error_code` | on failure | Stable deny / write code |
| `operator_class` | on failure | See §3 |
| `outcome` | recommended | success / denied / error / conflict / … |
| `file_type` | optional | Session-bound enum |
| `mode` | optional | view \| edit |
| `onlyoffice_status` | callback | 1–7 |
| `idempotent_replay` | callback | boolean |

**Never log:** `token`, `download_token`, `nonce`, `callback_nonce`, `jwt`, `editor_jwt`, `authorization`, `body`, `content`, `file_bytes`, `vault_content`, `url` / `callback_url` / `download_url` with secrets (use `redactOfficeDownloadUrl` / `redactOfficeCallbackUrl` if a host must be recorded).

Redaction defense-in-depth: `@lanyard/shared` `redactForLog` secret/payload patterns include Office keys (`download_token`, `callback_nonce`, `editor_jwt`, `jwt`, `changesurl`, …). Unit tests in `packages/shared/src/logging/redact.test.ts`.

---

## 3. Operator error classes

Acceptance requires operators can distinguish at least:

| Class | Meaning | Typical codes |
| --- | --- | --- |
| `document_server_unreachable` | BFF could not fetch assembled file from DS | `fetch_failed` |
| `bff_callback_rejected` | Auth / SSRF / payload / lifecycle gate failed before or without host write | `invalid_nonce`, `missing_nonce`, `bad_url`, `invalid_payload`, `write_forbidden`, … |
| `host_write_conflict` | Host CAS / revision mismatch | `write_conflict`, `conflict` |
| `unsupported_type` | File type / path extension not Office-family | `unsupported_file_type`, `path_type_mismatch` |

Adjacent classes (same classifier):

| Class | Typical codes |
| --- | --- |
| `auth_denied` | Download token missing/invalid, tenant/mode/lifecycle deny |
| `session_unavailable` | not_found, expired, closed, missing_file |
| `oversized` | oversized, payload_too_large |
| `write_failed` | write_failed, write_unavailable, save_error |
| `ok` / `ignored` / `duplicate` | Happy / no-op / retry paths |

Implementation: `classifyOfficeError` / `classifyOfficeDownloadReason` in `metrics.ts`.

### Support triage cheatsheet

```text
Callback returns error:1 + code=fetch_failed
  → Document Server unreachable or DS fetch failed (operator_class=document_server_unreachable)
  → Check DS health, allowlist hosts, network path BFF→DS

Callback returns error:1 + code=invalid_nonce|missing_nonce|bad_url|…
  → BFF rejected callback (operator_class=bff_callback_rejected)
  → Check session TTL, nonce binding, BFF_OFFICE_DOCUMENT_SERVER_HOSTS

Callback returns error:0 + code=conflict (or save_status=conflict)
  → Host write conflict (operator_class=host_write_conflict)
  → Another writer advanced revision; reopen pane / new Office session

Download returns 403 + code=unsupported_file_type
  → Unsupported type (operator_class=unsupported_type)
  → Only Office-family types on signed download
```

---

## 4. Code map

| Surface | Path |
| --- | --- |
| Counters + classifiers + log builders | `portal/packages/bff/src/office/metrics.ts` |
| Download / callback HTTP wiring | `portal/packages/bff/src/app.ts` (Office routes) |
| URL redactors | `download.ts` `redactOfficeDownloadUrl`, `callback.ts` `redactOfficeCallbackUrl` |
| Shared redaction | `portal/packages/shared/src/logging/redact.ts` |
| Pane client counters | `portal/packages/web/src/features/chat/documentPane/paneMetrics.ts` |
| Unit tests | `portal/packages/bff/test/office-metrics.test.ts`, `packages/shared/.../redact.test.ts`, `documentPane/paneMetrics.test.ts` |

### Config mint and editor load (not yet routed)

`recordConfigMint` and `recordEditorLoad` exist so `lp-5q6.26` / `lp-5q6.27` can attach without inventing new names. Until those routes ship, counters stay at zero; the catalog and redaction rules still apply.

---

## 5. Acceptance checklist (`lp-5q6.33`)

| Criterion | Evidence |
| --- | --- |
| Metrics cover config mint, download, editor load, callback status, write success, conflict, error | Catalog §1 + `OfficeMetrics` methods + tests |
| Logs include correlation IDs, session IDs, status, latency, size bucket, error code | §2 + app.ts download/callback logs |
| Logs never include body / JWT / download token / callback token / vault content | §2 + redaction patterns + tests |
| Redaction tests extended for Office fields | `redact.test.ts` Office suite |
| Operators distinguish DS unreachable / BFF reject / host conflict / unsupported type | §3 + classifier tests |

---

## 6. Revision history

| Date | Change |
| --- | --- |
| 2026-07-24 | Initial catalog for `lp-5q6.33` |
