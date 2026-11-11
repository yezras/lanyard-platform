# Beads issue map: Daytona sandboxes

**Root epic:** `lp-kng` — Daytona sandboxes: on-demand multi-tenant agent hosts  

**Offline track:** **`lp-kng.2` Offline piping** — [offline-piping.md](./offline-piping.md) — **DoD met** ([exit evidence](./offline-piping-exit-evidence.md))  

**Live gate (parked):** `lp-kng.1` — human prerequisites before Phase 0 / real AWS/Daytona  

**Plan notes:** Offline leaf work complete 2026-07-31. Exit evidence: [offline-piping-exit-evidence.md](./offline-piping-exit-evidence.md). Ready for Phase 0 only when `lp-kng.1` is filled.

## Hierarchy (offline-first)

### Root `lp-kng`

- `lp-kng.1` — Human prerequisites before draining Daytona epic (**parked**; live only)
- **`lp-kng.2` — Offline piping: contracts, fakes, stubs, docs (no live AWS/Daytona)** ← **start here**
  - `lp-e0j` — Phase 1: Contracts and data model
    - `lp-707` — Doc: identity model instance_id vs sandbox_id vs S3 vault prefix → [identity-model.md](./identity-model.md)
    - `lp-nye` — CP model: runtime_kind, sandbox_id, presence, snapshot, s3 prefix fields
    - `lp-eya` — Presence state machine types
    - `lp-biq` — CP internal API stubs: ensure-online, presence, signal-activity, stop → [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md)
    - `lp-k8n` — CP config schema (schema only; no real keys required) → [cp-daytona-config.md](./cp-daytona-config.md)
    - `lp-7v5` — Daytona client interface + fake for unit tests
    - `lp-vey` — Doc: gateway env contract for Daytona → [gateway-env-contract.md](./gateway-env-contract.md)
  - `lp-kng.2.1` — Offline: orchestrator ensure_online + singleflight on fake
  - `lp-kng.2.2` — Offline: presence store + signal-activity + idle reaper unit tests
  - `lp-kng.2.3` — Offline: webhook payload parse + presence map
  - `lp-kng.2.4` — Offline: S3 vault prefix layout design doc → [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md)
  - `lp-kng.2.5` — Offline: IAM scoped S3 mount policy draft → [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md) (JSON under [drafts/iam/](./drafts/iam/))
  - `lp-kng.2.6` — Offline: Dockerfile + entrypoint skeleton (no ECR)
  - `lp-kng.2.7` — Offline: agent_snapshot_id pin convention → [agent-snapshot-pin.md](./agent-snapshot-pin.md)
  - `lp-kng.2.8` — Offline: BFF chat ensure_online behind flag
  - `lp-kng.2.9` — Offline: brain_rpc + channel adapter stubs behind flag
  - `lp-kng.2.10` — Offline: provision runbook daytona branch → [provision-runbook-daytona.md](./provision-runbook-daytona.md)
  - `lp-kng.2.11` — Offline: runtime_kind dual-path plumbing
  - `lp-kng.2.12` — Offline piping: exit evidence summary → [offline-piping-exit-evidence.md](./offline-piping-exit-evidence.md)

### Live phases (later; not offline track)

- `lp-6tq` — Phase 0 spike (after `lp-kng.1`) — **CONDITIONAL GO** → [spike-ctu-go-no-go.md](./spike-ctu-go-no-go.md)
  - `lp-v2p` — Org/API/tier/egress smoke → [spike-v2p-org-access.md](./spike-v2p-org-access.md)
  - `lp-z1u` — Linux VM / custom agent-like image smoke → [spike-z1u-linux-vm-sandbox.md](./spike-z1u-linux-vm-sandbox.md) (VM gated on Tier1 `us`; container stand-in proven; pilot accepts container)
  - `lp-3en` — S3 vault prefix as `VAULT_ROOT` (Mountpoint) → [spike-3en-s3-vault-mount.md](./spike-3en-s3-vault-mount.md)
  - `lp-kx4` — Vault FUSE/S3 I/O patterns (list / 100 small reads / sequential write) → [spike-kx4-vault-io-patterns.md](./spike-kx4-vault-io-patterns.md)
  - `lp-bnd` — Wake latencies (create / start-stopped / archive restore) → [spike-bnd-wake-latencies.md](./spike-bnd-wake-latencies.md)
  - `lp-4dk` — Long-lived WSS to test Relay → [spike-4dk-wss-relay.md](./spike-4dk-wss-relay.md) (mock hold ≥5 min + reconnect; real Relay DNS blocked under staging hold)
  - `lp-4l5` — Inject gateway relay secret for in-process WSS → [spike-4l5-gateway-secret-inject.md](./spike-4l5-gateway-secret-inject.md) (create-time `env` + file drop; mock WSS auth; real Relay DNS residual)
  - `lp-ctu` — Spike go/no-go report → [spike-ctu-go-no-go.md](./spike-ctu-go-no-go.md) (**CONDITIONAL GO** for managed Daytona pilot)
- Phase 0 residuals (from `lp-ctu`):
  - **`lp-kng.3`** Relay DNS restore / lab path → [residual-kng.3-relay-dns.md](./residual-kng.3-relay-dns.md) (live restore blocked by OPERATOR HOLD; runbook + diagnosis shipped)
  - `lp-pec.1` secret redaction
  - `lp-eto.1` vault many-small I/O → [vault-io-pilot-decision.md](./vault-io-pilot-decision.md) (sparse/packed GO; many-small without cache NO-GO; guest cache deferred)
  - `lp-kng.4` optional linux-vm re-prove
- `lp-4xa` — Phase 2 image/snapshot (live ECR/snapshot)
  - `lp-e9l` Dockerfile; `lp-wu1` CI ECR → [agent-gateway-ecr-push.md](./agent-gateway-ecr-push.md); `lp-1wa` snapshot pin → [agent-snapshot-live-pin.md](./agent-snapshot-live-pin.md); `lp-i7s` safe bump runbook → [agent-snapshot-bump-runbook.md](./agent-snapshot-bump-runbook.md)
- `lp-eto` — Phase 3 vault apply (`lp-eto.1` many-small I/O residual → [vault-io-pilot-decision.md](./vault-io-pilot-decision.md))
  - `lp-0fq` — Design S3 vault bucket layout + encryption/bucket policy (no public ACL) → [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) + [drafts/s3/](./drafts/s3/)
  - `lp-t86` — IAM scoped credentials policy per-tenant prefix → [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md) + [drafts/iam/](./drafts/iam/) + `deploy/scripts/smoke-sandbox-vault-mount-iam.sh`
  - `lp-jt5` — Helper: create tenant vault prefix on provision
  - `lp-d26` — Provision pilot/lab S3 vault bucket (do not destroy mocklab) → [pilot-lab-s3-vault-bucket.md](./pilot-lab-s3-vault-bucket.md)
  - `lp-hjo` — Orchestrator create/start params for S3 mount at `VAULT_ROOT`
  - `lp-zmg` — Vault S3 retain vs GC on deprovision (default retain pilot) → [vault-s3-retain-vs-gc.md](./vault-s3-retain-vs-gc.md)
  - `lp-9o6` — Optional seed bootstrap (after `lp-jt5`)
- `lp-pec` — Phase 4 real SDK orchestrator (`lp-pec.1` redact create/GET env; `lp-77d` wake latency / start failures / concurrent metrics → [sandbox-orchestrator-metrics.md](./sandbox-orchestrator-metrics.md))
- `lp-mci` — Phase 5 platform wake live
- `lp-w9a` — Phase 6 provision live
- `lp-0pr` — Phase 7 dual-run migration
  - `lp-gu2` — Per-tenant feature flag `runtime_kind` dual-run → [dual-run-runtime-kind.md](./dual-run-runtime-kind.md)
  - `lp-3ux` — Tool/runbook: copy vault EC2 → S3 for pilot tenant → [vault-ec2-to-s3-copy.md](./vault-ec2-to-s3-copy.md) + `deploy/scripts/copy-vault-ec2-to-s3.sh`
  - `lp-6h8` — Cutover checklist: flip tenant to daytona keep instance credentials → [cutover-ec2-to-daytona.md](./cutover-ec2-to-daytona.md) + `deploy/scripts/smoke-cutover-ec2-to-daytona.sh`
  - `lp-ky7` — Rollback: flip tenant back to EC2; stop sandbox
  - `lp-u00` — Decommission EC2 for migrated pilot tenants
- `lp-3a1` — Phase 8 hardening
- `lp-ccp` — Production network allowlist (Relay, model APIs, registries) → [production-network-allowlist.md](./production-network-allowlist.md)
- `lp-m2z` — Security review: VM isolation, secrets, egress, cross-tenant S3 → [security-review-vm-secrets-egress-s3.md](./security-review-vm-secrets-egress-s3.md)
  - `lp-3a1.1` — Residual: bind `s3_vault_prefix` override to `tenant_id` + validate on ensure_online
  - `lp-ccp` — Production network allowlist (egress)
- `lp-id2` — Phase 9 BYOC (deferred)
- `lp-zuh` — Phase 10 proof
  - `lp-zuh.14` — Phase 10 / MockLab residual closeout
    - **`lp-zuh.14.1`** — Cost report: Daytona vCPU-hours vs prior EC2 estimate → **[cost-report-daytona-vs-ec2.md](./cost-report-daytona-vs-ec2.md)** + [`artifacts/daytona-pilot/cost-report/`](../../../artifacts/daytona-pilot/cost-report/) (supersedes `lp-iy2`)
    - `lp-zuh.14.2` — Cold boot proof (qh2 closeout)
    - `lp-zuh.14.3` — LA MCP product surface

### Pilot residual: model keys vs admin UI (`lp-kng.7`)

- **`lp-kng.7`** — Epic: model/connector admin vs wake-inject (Settings honesty)
  - **`lp-kng.7.1`** — Doc decision: pilot model keys (SM inject) vs platform admin UI → **[pilot-model-keys-sm-inject-decision.md](./pilot-model-keys-sm-inject-decision.md)** (inject-only pilot SoT; ops admin UI + LA `models.*` deferred; **needs human**)
  - **`lp-kng.7.2`** — LA/Portal: Settings honesty when `models.*` / `model_selector` unsupported (read-only Models list; no dead Set active). Depends on `lp-kng.7.1`; **chose honesty** over implementing `models.list` for pilot (see decision §4.3.1)

## After offline DoD

```bash
bd show lp-kng.2.12
bd show lp-kng.1     # human gate — fill before Phase 0
# bd show lp-6tq     # Phase 0 spike only after lp-kng.1
bd show lp-kng.7.1   # pilot model keys decision (SM inject)
```

Offline DoD is met ([exit evidence](./offline-piping-exit-evidence.md)). Do not beads-execute full live `lp-kng` until `lp-kng.1`.
