# Log retention TTL and access policy (G2b.1)

| Field | Value |
|-------|--------|
| **Status** | Active product + ops policy |
| **Date** | 2026-07-12 |
| **Bead** | `cbd-hhj.5.1` (G2b.1) |
| **Parent** | `cbd-hhj.5` — Payload log / retention controls (relay + control plane) |
| **Follow-up** | `cbd-hhj.5.2` — enforce no vault payload dump to shared debug sinks by default |
| **Scope** | Portal **relay**, **control-plane**, and **BFF** logs; alignment with data-plane host logging |

No secrets, account IDs, or customer vault content appear in this document.

## Purpose

Define **what** is retained, **how long**, and **who** may access Portal product logs so production claims are honest and per-client data-handling policies can fill concrete TTLs.

This policy is the product-side answer for readiness gate **G2b** (payload log / retention). Host CloudWatch defaults remain deploy-owned; product defaults here must not contradict them.

## Doctrine

1. **Metadata over payloads.** Prefer request IDs, tenant IDs, instance IDs, HTTP status, and durations. Do **not** log vault file bodies, chat message bodies, or relay frame payloads to shared sinks by default.
2. **Fail closed for export.** Interaction export / long-term Lanyard body storage defaults **off** (`interaction_export_enabled: false`, `retention_mode: "none"` — control-plane retention API).
3. **No shared multi-tenant debug buckets for vault dumps.** Forbidden (aligns with client data-handling template DLP section).
4. **Show-once secrets never in logs.** Register/rotate plaintext secrets are operator-handled; audit metadata must not include secret material.
5. **Partition by tenant where logs are tenant-scoped.** Platform Portal logs may be multi-tenant; access is still least-privilege ops only.

## Log classes and TTL

| Class ID | What is stored | Default TTL | Sink (typical) | Notes |
|----------|----------------|-------------|----------------|-------|
| **L1** Application operational | stdout/stderr structured or line logs from BFF, relay, control-plane: boot, health, HTTP route, WS connect/disconnect, error stacks **without** request bodies | **30 days** | Platform CloudWatch / container log driver | No vault content; redact `Authorization`, cookies, `x-*-token`, secrets |
| **L2** Control-plane audit | `audit_log` rows: action, actor, tenant_id, metadata **without** message bodies or secrets | **90 days** | Control-plane durable store (SQLite today; Postgres under G4) | Actions e.g. `instance.provisioned`, `instance.rotated`, `instance.revoked`, `user.registered` |
| **L3** Relay chat ring buffer | Short process-local outbound history for SSE hydrate | **Process lifetime only** (not a retention archive) | Relay memory | Not a compliance store; lost on restart |
| **L4** BFF chat hydrate | Thread metadata + history events in BFF memory, or optional durable SQLite via `CHAT_STORE_PATH` | **Process lifetime** when in-memory; durable = until thread delete / file wipe; **cap 2000 events/thread** (not time TTL) | BFF process / host-local `chat.db` (`0600`, cleartext — volume encryption only) | Message bodies on disk when durable; **not** encryption-at-rest in-app (lp-p37.13). Separate from ops log shipping |
| **L5** Interaction export | Optional long-term interaction records when ops enables export | **Off by default**; when on, TTL = client policy (min **30 days**, max per contract) | Product export path only (not shared debug) | Gated by `GET/PATCH /internal/tenants/:id/retention`; **metadata-only** — never message bodies |
| **L6** Data-plane host logs | auth/sudo, hermes logs, company-brain logs — **no vault dump default** | **30 days** (deploy `host_log_retention_days` default) | Customer-account CloudWatch `/company-brain/<project>/host` | Deploy module; product policy aligns |
| **L7** SSM session logs | Break-glass session transcripts when enabled | **90 days** (deploy `ssm_session_logs_retention_days` default) | Customer-account CW and/or S3 | See deploy SSM break-glass runbook |
| **L8** VPC Flow Logs | 5-tuple / metadata | **30 days** (deploy `flow_logs_retention_days` default) | Customer-account CW or S3 | Optional security-observability module |
| **L9** Debug / support dumps | Ad-hoc packet or vault extracts | **Not retained by default**; if created, **≤ 7 days** then delete | Private operator workstation or ticket attachment — **never** shared multi-tenant bucket | Requires explicit ops approval; G2b.2 hardens product defaults |

### Product defaults (Portal services)

| Service | Default log content | Forbidden by default |
|---------|---------------------|----------------------|
| **control-plane** | Audit actions + request errors; internal validate results as pass/fail + reason code | Plaintext instance secrets; password hashes; vault paths content |
| **relay** | Connect/auth outcome, close code (e.g. 4401), session counts, delivery errors | Chat/tool payloads to CloudWatch; vault file bytes |
| **bff** | Auth success/fail (user id / tenant), route status, CSRF failures | Cookie values; OAuth codes; vault file bodies; full chat POST bodies |

Structured field allowlist for shared sinks (L1):

- `timestamp`, `level`, `service`, `request_id`
- `tenant_id` / `tenant_slug` (when known)
- `user_id` (when authenticated; not email in high-volume paths if avoidable)
- `instance_id` (gateway), `route`, `status`, `duration_ms`, `error_code`

### TTL overrides

- **Shorter** TTLs always allowed for privacy-sensitive tenants.
- **Longer** than table defaults requires written client acceptance in the per-client data-handling policy (private copy) and platform ops approval.
- Legal hold: suspend deletion only under documented legal process; scope to affected tenant identifiers.

## Access control (who can access)

| Audience | L1 app logs | L2 audit | L3–L4 process state | L5 export | L6–L8 data plane | L9 debug |
|----------|-------------|---------|---------------------|-----------|------------------|----------|
| **Customer tenant admins** | No (platform) | No direct | Via product UI only (chat/history) | No | Own account logs if customer-hosted; else via agreed report | No |
| **Lanyard platform on-call** | Yes (break-glass / duty) | Yes (private CP / ops path) | Only via product or explicit debug | Only if export enabled + need-to-know | Via customer-approved assume-role / SSM | Time-boxed |
| **Lanyard eng (non-duty)** | Staging yes; prod via ticket | Prod via ticket | Staging only by default | No | No | No |
| **Automated exporters** | Metrics only | None unless audit pipeline approved | None | Only when `interaction_export_enabled` | None | None |
| **Third-party processors** | No raw logs unless listed in approved processors + client policy | No | No | No | Only if processor ID approved | No |

### Access mechanisms

| Path | Control |
|------|---------|
| Platform Portal log groups | IAM least privilege; no public buckets; encryption at rest |
| Control-plane admin/audit APIs | Private network (G1); `INTERNAL_OPS_TOKEN` / future service credentials — never browser-exposed |
| Relay internal HTTP | `RELAY_INTERNAL_TOKEN`; not on public internet |
| Data-plane host / SSM logs | Customer account IAM; Lanyard break-glass per SSM runbook |
| Production support | Ticket + time-bounded role; log access itself should be attributable |

### Audit of access

Prefer CloudTrail / AWS access logs for sink reads where available. Operator use of internal tokens must not be shared in chat; rotate on suspected leak (see relay credential lifecycle runbook for gateway secrets; treat ops tokens similarly).

## Alignment with client data-handling policy

Per-client template (deploy repo):

[`references/templates/client-data-handling-policy.md`](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/templates/client-data-handling-policy.md)

### How to fill §4 Retention from this policy

| Template row | Product default to copy |
|--------------|-------------------------|
| CloudWatch host logs | **30 days**; ops break-glass; no vault dump default |
| VPC Flow Logs | **30 days** when enabled |
| Portal relay / control-plane logs | **L1 = 30 days**, **L2 audit = 90 days**; access = product + ops (this document). **G2b.1 defines this row** — no longer “blocked until defined” for TTL/access *policy*; enforcement of payload redaction is G2b.2 |
| Model provider | Out of band; zero-retention contracts per processor catalog |
| SSM session logs (if listed under processors / stores) | **90 days** when enabled |

Also align:

- [`references/approved-data-processors.md`](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/approved-data-processors.md) — `aws-logs-kms-sts` for host log shipping; Portal logs are platform-side unless customer-hosted Portal.
- [`references/security-observability.md`](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/security-observability.md) — host log shipping paths.
- DLP: “Shared multi-tenant debug buckets for vault dumps — **Forbidden**” remains mandatory.

### Product hooks already present

| Hook | Location | Policy link |
|------|----------|-------------|
| Tenant retention snapshot | `GET/PATCH /internal/tenants/:id/retention` | L5 export gate + L10 `chat_corpus_*` fields (`lp-gkh.6`) |
| Relay export gate | `packages/relay/src/retention.ts` → `shouldPersistInteraction` | Default false (L5 only) |
| BFF corpus gate | `packages/bff/src/chat-corpus.ts` → `shouldWriteChatCorpus` | Default false (L10; fail closed) |
| BFF corpus capture | `packages/bff/src/chat-corpus-capture.ts` → buffer + SSE tee write | Fail-open for chat; metric `chat_corpus_write_failed` |
| CP audit model | `audit_log` — metadata only | L2 |
| Interaction export default | `retention_mode: "none"` | L5 off |
| Chat corpus default | `chat_corpus_enabled: false`, `chat_corpus_retention_days: null` | L10 off; 90d effective when enabled |

Ops enablement (CP flags): [docs/plans/0011-tenant-chat-corpus/ops-enablement-runbook.md](../../../docs/plans/0011-tenant-chat-corpus/ops-enablement-runbook.md).  
Full operator lifecycle (enable → verify → training export → disable): [docs/plans/0011-tenant-chat-corpus/operator-enablement-training-export-runbook.md](../../../docs/plans/0011-tenant-chat-corpus/operator-enablement-training-export-runbook.md) (`lp-gkh.10`).

## Operator checklist

```text
[ ] Platform log groups for bff/relay/control-plane: retention_in_days = 30 (or stricter)
[ ] No log subscription ships raw body fields to a shared debug bucket
[ ] INTERNAL_OPS_TOKEN / RELAY_INTERNAL_TOKEN not in application logs
[ ] interaction_export_enabled remains false unless client policy + ops enablement
[ ] Per-client data-handling §4 filled with TTLs from this doc
[ ] G2b.2 tracked for product enforcement of vault payload redaction
```

## Out of scope / honesty

- **G2b.2** implements product enforcement (default no vault dump to shared sinks). This document is **policy**, not the code change.
- Chat durability on disk (`CHAT_STORE_PATH`) is opt-in; L4 above reflects the durable-file posture (lp-p37.13). Time-based TTL still not implemented — wipe file or delete threads.
- Local secret file modes and cleanup: monorepo `docs/runbooks/local-secret-hygiene.md`.
- This policy does **not** by itself flip readiness-matrix G2b to ready; G2b needs policy **and** enforcement evidence.

## References

- Control plane retention API: `packages/control-plane/README.md`
- Relay retention gate: `packages/relay/src/retention.ts`
- Production security gate checklist (deploy): `references/runbooks/production-security-gate.md`
- Threat model: deploy `references/threat-model-private-by-default.md` (G2b row)
