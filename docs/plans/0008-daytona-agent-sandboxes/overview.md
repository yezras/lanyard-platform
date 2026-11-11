# Plan: Daytona sandboxes for multi-tenant Company Brain

**Status:** Decisions locked; **offline piping DoD met** (`lp-kng.2` / `lp-kng.2.12`). Human gate `lp-kng.1` closed. Phase 0 spikes complete — **go/no-go: CONDITIONAL GO** ([spike-ctu-go-no-go.md](./spike-ctu-go-no-go.md), `lp-ctu`).  
**Beads epic:** `lp-kng` — map: [issue-map.md](./issue-map.md)  
**Offline track:** [offline-piping.md](./offline-piping.md) — exit evidence: [offline-piping-exit-evidence.md](./offline-piping-exit-evidence.md)

**Locked decisions:**

1. Vault = Lanyard S3 Mountpoint (V1b)  
2. Isolation = Linux VM from day one (**pilot waiver:** container acceptable for managed Daytona pilot — see [go/no-go](./spike-ctu-go-no-go.md); linux-vm optional hardening)  
3. Idle grace = 10 min (cost-first stop when inactive; `lp-kng.8`; override `IDLE_REAPER_GRACE_MS`)  
4. Orchestrator = Lanyard Control Plane (client of Daytona managed CP)  
5. Phase 1 product path = managed Daytona only (BYOC deferred)  
6. Wake latency = as fast as possible (snapshots / warm paths)  
7. Agent is a **guest**: product CLIs prebaked in snapshot; tenant config/secrets outside image; no install-on-boot  
8. **Deploy split:** platform TF stays; daytona tenants skip EC2 TF; sandboxes are orchestrator API (lazy), not per-tenant TF  

## Active work mode

| Track | Epic | Live AWS / Daytona? |
|-------|------|---------------------|
| **Offline piping** | `lp-kng.2` | **No** — DoD met ([exit evidence](./offline-piping-exit-evidence.md)) |
| Human gate (live) | `lp-kng.1` | **Closed** 2026-08-03 |
| Phase 0 spike | `lp-6tq` | **Complete** — **CONDITIONAL GO** ([spike-ctu-go-no-go.md](./spike-ctu-go-no-go.md)) |
| Phase 1+ live | `lp-4xa` … | Unblocked under go/no-go conditions |

**Next:** implement Phases 1+ under **CONDITIONAL GO** conditions (container pilot OK; restore Relay DNS before dual-run WSS proof; orchestrator redaction; sparse vault I/O). Offline complete — do not re-open offline leaves for live work.

## Design anchors (summary)

### Identity model (§2.3)

Permanent product identity vs ephemeral compute vs durable vault storage. Full normative doc:

→ **[identity-model.md](./identity-model.md)** (`lp-707`)

| Identifier | Lifetime | Owner | Used for |
|------------|----------|-------|----------|
| `instance_id` | Permanent until revoke | Control Plane | Relay auth, Brain RPC, BFF routing |
| `sandbox_id` | Ephemeral (wake cycle) | Daytona; tracked by CP orchestrator | start/stop/status only — **not** auth |
| `s3_vault_prefix` | Durable until offboard | Platform S3; recorded in CP | Mountpoint vault root across stop/start |

Do not use `sandbox_id` as Relay identity. Do not derive vault durability from sandbox-local disk. Provision with `runtime_kind=daytona` mints `instance_id` + prefix and leaves `sandbox_id` null until first `ensure_online`.

**Prefix layout + bucket envelope:** [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) (`lp-kng.2.4` offline lock · `lp-0fq` Phase 3 encryption/bucket policy) — default `tenants/{tenant_id}/vault/`; no public ACL. **Lab pilot bucket ensure (`lp-d26`):** [pilot-lab-s3-vault-bucket.md](./pilot-lab-s3-vault-bucket.md) — `lanyard-mocklab-vault-123456789012` exists; do not destroy; respect OPERATOR HOLD for full staging.

**Multi-scope (plan 0010 / epic `lp-zoh`):** optional `scope=tenant|user` instances and dual vault prefixes (`vault/shared/` + `users/{uid}/vault/`). Decision draft: [decision-identity-and-vault-scope.md](../0010-multi-scope-sandbox-vault/decision-identity-and-vault-scope.md) (`lp-zoh.1`). Does not change `instance_id` permanence or guest model.

### Agent guest + prebake (§4.3)

- Agent does not create/stop sandboxes or call Daytona.  
- **Bucket A:** snapshot image (agent + product CLIs) once per release.  
- **Bucket B:** S3 vault (tenant files/config).  
- **Bucket C:** wake inject (Relay secrets, mount material).  
- Entrypoint: wait mount → inject env → start gateway. **No** package installs on boot.

Agent gateway image (Bucket A, local `docker build` / Phase 2): **[`deploy/daytona/agent-gateway/`](../../../deploy/daytona/agent-gateway/)** — production-oriented Dockerfile + prebaked product CLIs (`lp-e9l`); entrypoint wait-vault + foreground gateway (`lp-b7w`); offline skeleton was `lp-kng.2.6`. CI → ECR digest: **[agent-gateway-ecr-push.md](./agent-gateway-ecr-push.md)** (`lp-wu1`; build-only when lab creds missing).

Gateway process env (parity names with EC2): **[gateway-env-contract.md](./gateway-env-contract.md)** (`lp-vey`) — `GATEWAY_RELAY_*`, `VAULT_ROOT`, layout vars; agent stays host-agnostic.

CP managed-Daytona config (platform only): **[cp-daytona-config.md](./cp-daytona-config.md)** (`lp-k8n`) — `DAYTONA_API_KEY`, org, region, default snapshot, tenant allowlist; flag default off; fail closed when enabled without keys. Production sandbox egress (`DAYTONA_DOMAIN_ALLOWLIST` → create `domainAllowList`): **[production-network-allowlist.md](./production-network-allowlist.md)** (`lp-ccp`).

Agent snapshot pin (`agent_snapshot_id` / `DAYTONA_DEFAULT_SNAPSHOT`): **[agent-snapshot-pin.md](./agent-snapshot-pin.md)** (`lp-kng.2.7`) — offline placeholder ok; **live pin / blocked path:** [agent-snapshot-live-pin.md](./agent-snapshot-live-pin.md) (`lp-1wa`); **safe bump runbook** (build→push→snapshot→pin→roll-forward/rollback + verification): [agent-snapshot-bump-runbook.md](./agent-snapshot-bump-runbook.md) (`lp-i7s`).

CP internal orchestrator API stubs: **[cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md)** (`lp-biq`) — ensure-online / presence / signal-activity / stop; 501 until fake/live bodies.
### Deploy split (§4.11)

- **Platform** (Portal/BFF/CP/Relay): still Terraform, always on.  
- **Tenant durable:** CP register + S3 prefix (no company-brain EC2 for `runtime_kind=daytona`).  
- **Compute:** Instance Orchestrator → Daytona API, **lazy** on first `ensure_online` (`lp-3up`: provision leaves `sandbox_id` null; first wake creates + mounts vault prefix; no tenant Daytona/TF for compute).  
- Tenants never deploy sandboxes or get Daytona keys.

**Dual-run (`lp-gu2`):** path is the **per-instance** field `runtime_kind` (`ec2` \| `daytona`), not a global-only cutover. Some tenants stay on EC2 while others use Daytona in the same env; set at register or via registry PATCH. Operator note: [dual-run-runtime-kind.md](./dual-run-runtime-kind.md). **Vault EC2 → S3 copy for pilot (`lp-3ux`):** [vault-ec2-to-s3-copy.md](./vault-ec2-to-s3-copy.md) + `deploy/scripts/copy-vault-ec2-to-s3.sh` (freeze one-writer, checksum/count verify, offline dry-run fixtures). **Cutover flip keep credentials (`lp-6h8`):** [cutover-ec2-to-daytona.md](./cutover-ec2-to-daytona.md) + offline smoke `deploy/scripts/smoke-cutover-ec2-to-daytona.sh` (live pilot residual).

**Operator runbook (offline design):** [provision-runbook-daytona.md](./provision-runbook-daytona.md) (`lp-kng.2.10`) — contrast with EC2 [`deploy/references/provision-runbook.md`](../../../deploy/references/provision-runbook.md). No tenant EC2 TF apply and no live Daytona create on the offline track. **Skip guard (`lp-4nf`):** `deploy/templates/tenant` variable `runtime_kind` + check `runtime_kind validation (ec2 only) + check daytona_forbids_company_brain_ec2_template` fails closed for `daytona`; do not instantiate `modules/company-brain-ec2` for daytona instance rows.

### Human prerequisites for live (§14 / `lp-kng.1`)

Daytona org + API key location + billing; AWS lab S3; Relay WSS for test instance; later ECR + CP secret path + go/no-go owner. **Not required for `lp-kng.2`.** Gate closed 2026-08-03.

**Phase 0 go/no-go (canonical):** **[spike-ctu-go-no-go.md](./spike-ctu-go-no-go.md)** (`lp-ctu`) — **CONDITIONAL GO** for managed Daytona pilot; container isolation accepted 2026-08-04; residuals: Relay DNS restore, orchestrator secret redaction, vault many-small-file cache/redesign; linux-vm optional.

**Vault I/O pilot decision (`lp-eto.1`):** **[vault-io-pilot-decision.md](./vault-io-pilot-decision.md)** — sparse/packed Mountpoint I/O **GO** for pilot; many-small-file without guest cache **NO-GO**; no POSIX append (write-temp + replace); optional guest cache **deferred** (not a pilot gate). Evidence: [spike-kx4](./spike-kx4-vault-io-patterns.md) + [go/no-go](./spike-ctu-go-no-go.md).

**Phase 8 security review (`lp-m2z`):** **[security-review-vm-secrets-egress-s3.md](./security-review-vm-secrets-egress-s3.md)** — VM isolation waiver, IAM prefix scope, webhook HMAC, secret material store, redaction, dual-run, domain allowlist residual (`lp-ccp`), mid-turn; no guest cross-tenant vault path under default provision; residual `lp-3a1.1` (prefix override binding).

**Relay DNS residual (`lp-kng.3`):** **[residual-kng.3-relay-dns.md](./residual-kng.3-relay-dns.md)** — live `relay.withlanyard.com` still DNS-dead under OPERATOR HOLD; lab path + Route53/ELB diagnosis + local compose draft; thrifty Daytona re-prove checklist blocked until public host healthy. Hold: [`deploy/environments/platform-staging/OPERATOR-HOLD-LOCALHOST-ONLY.md`](../../../deploy/environments/platform-staging/OPERATOR-HOLD-LOCALHOST-ONLY.md).

**Pilot model keys residual (`lp-kng.7` / `lp-kng.7.1`):** **[pilot-model-keys-sm-inject-decision.md](./pilot-model-keys-sm-inject-decision.md)** — pilot SoT is **platform SM + CP wake inject** for provider keys; multi-tenant platform admin UI **not live**; Settings honesty / optional LA `models.*` follow-on (`lp-kng.7.2`). **Needs human** before production key-admin productization.

Phase 0 spike notes: **[spike-v2p-org-access.md](./spike-v2p-org-access.md)** (`lp-v2p`); **[spike-z1u-linux-vm-sandbox.md](./spike-z1u-linux-vm-sandbox.md)** (`lp-z1u`) — container + agent-like snapshot proven; linux-vm runners not available in `us` (not a pilot gate); **[spike-3en-s3-vault-mount.md](./spike-3en-s3-vault-mount.md)** (`lp-3en`); **[spike-kx4-vault-io-patterns.md](./spike-kx4-vault-io-patterns.md)** (`lp-kx4`); **[spike-bnd-wake-latencies.md](./spike-bnd-wake-latencies.md)** (`lp-bnd`); **[spike-4dk-wss-relay.md](./spike-4dk-wss-relay.md)** (`lp-4dk`); **[spike-4l5-gateway-secret-inject.md](./spike-4l5-gateway-secret-inject.md)** (`lp-4l5`).

## Implementation phases (live, after offline + gate)

0 Spike → 1 Contracts (also under offline) → 2 Image → 3 Vault apply → 4 Orchestrator live SDK → 5 Wake integration live → 6 Provision live → 7 Dual-run → 8 Hardening → 9 BYOC deferred → 10 Proof.

### Phase 10 cost report (`lp-zuh.14.1`)

Pilot tenant-compute comparison (2 h/day active Daytona vs always-on `t3.medium` EC2): **[cost-report-daytona-vs-ec2.md](./cost-report-daytona-vs-ec2.md)** — evidence [`artifacts/daytona-pilot/cost-report/`](../../../artifacts/daytona-pilot/cost-report/). Confirms thrift depends on idle stop (`lp-8sn` / reaper) and ops visibility (`lp-kva`). Supersedes tracking for `lp-iy2`.

## Beads

| Layer | ID |
|-------|-----|
| Root | `lp-kng` |
| Offline piping | **`lp-kng.2`** |
| Human gate | `lp-kng.1` |
| Phase 1 | `lp-e0j` (child of offline) |

Full leaf map: [issue-map.md](./issue-map.md). Offline DoD: [offline-piping.md](./offline-piping.md).
