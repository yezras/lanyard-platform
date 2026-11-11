# Live agent snapshot pin (`lp-1wa`)

**Status:** **Blocked path documented** — no registry digest yet from `lp-wu1` publish; staging/pilot pin remains a secret-free placeholder until ECR push is unblocked.  
**Bead:** `lp-1wa`  
**Parent:** `lp-4xa` (Phase 2: Agent image and snapshot pipeline)  
**Depends on:** `lp-wu1` (CI → ECR digest), `lp-b7w` (entrypoint), `lp-e9l` (Dockerfile)  
**Convention (schema / resolve order):** [agent-snapshot-pin.md](./agent-snapshot-pin.md)  
**ECR publish:** [agent-gateway-ecr-push.md](./agent-gateway-ecr-push.md)  
**Version bump runbook:** [agent-snapshot-bump-runbook.md](./agent-snapshot-bump-runbook.md) (`lp-i7s` — build→push→snapshot→pin→roll-forward/rollback + verification)  
**Operator script:** [`deploy/daytona/agent-gateway/create-snapshot-from-digest.sh`](../../../deploy/daytona/agent-gateway/create-snapshot-from-digest.sh)

## Purpose

Register a Daytona **org snapshot** from an **immutable ECR image digest**, then pin the resulting **Daytona snapshot id** (not the ECR digest alone) into Control Plane:

| Layer | Field | Role |
|-------|-------|------|
| Input | ECR `image.digest` / `pin_ref` from CI artifact | Snapshot create (`imageName`) |
| Output | Daytona snapshot **name** and/or **uuid** | Platform `DAYTONA_DEFAULT_SNAPSHOT` / instance `agent_snapshot_id` |
| Isolation (pilot) | `sandboxClass: container` | linux-vm optional later (`lp-ctu` residual); pilot OK on container ([spike-z1u](./spike-z1u-linux-vm-sandbox.md), human decision 2026-08-04) |

## Current evidence (2026-08-05)

### ECR digest (`lp-wu1`)

| Item | Value |
|------|--------|
| Workflow | [`.github/workflows/agent-gateway-image.yml`](../../../.github/workflows/agent-gateway-image.yml) |
| Latest main run (post-`#255`) | `mode=build-only` — **no registry digest invented** |
| Artifact | `agent-gateway-sha-3c1cbf33581f` (run `30964908586`) |
| `local_image_id` | `sha256:4c1e74ea8fd296ee8a11f75c296604d27242cd9f00312da6de92cca038fddd89` (CI local proof only) |
| `registry_digest` | **`null`** |
| `image.digest` | **missing** (publish path not taken) |
| ECR repo `…/daytona/agent-gateway` | **not present** in account `123456789012` us-east-1 listing at pin time |
| Root cause | Missing GitHub Actions vars and/or OIDC role + ECR repo (see operator checklist in agent-gateway-ecr-push.md); staging OPERATOR HOLD may further delay live AWS |

**Rule:** Do **not** invent an ECR digest or invent a Daytona snapshot id. CP continues to use offline-safe placeholders until publish + register complete.

### Daytona org (thrifty probe — secret-free)

| Item | Value |
|------|--------|
| Org id (public) | `5b45bf51-5792-4f75-a54a-ffa6c4752d6e` |
| API base | `https://app.daytona.io/api` |
| SM secret **name only** | `lanyard/staging/portal/daytona` |
| AWS profile / region | `lanyard-main` / `us-east-1` |
| Key material | Loaded only via SM at operator runtime — **never** committed, never pasted into beads/PRs/docs |
| Snapshot create this bead | **Not executed** for product image (no digests to pin; avoids thriftless thrash) |
| Prior container class proof | [spike-z1u](./spike-z1u-linux-vm-sandbox.md) — custom snapshot + process exec OK on **container** |
| Org custom agent-gateway snapshot | **None** registered for product image as of this pin |

## Staging / pilot pin table (secret-free)

| Env | `DAYTONA_DEFAULT_SNAPSHOT` | Source | Ready for live create-from-snapshot? |
|-----|----------------------------|--------|--------------------------------------|
| Unit / fake client | `offline:agent-default` | `OFFLINE_AGENT_SNAPSHOT_PLACEHOLDER` in CP | N/A (fake) |
| Lab / mock (offline) | `offline:agent-default` | same | No real Daytona |
| **Staging / pilot (now)** | **`pending:agent-gateway-ecr`** | **Placeholder until live register** | **No** — fail closed if `DAYTONA_ENABLED` with this pin against real API |
| Staging / pilot (after unblock) | `<Daytona snapshot uuid or stable name>` | Output of `create-snapshot-from-digest.sh` | Yes |
| Production | **unset** until deliberate promote | Same runbook + canary | No floating tags |

### Pin fragment (committed template — fill after live register)

File: [`deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml`](../../../deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml)

```yaml
# Secret-free. Never put API keys here.
agent_snapshot:
  env: staging-pilot
  status: pending-ecr-publish   # -> active after live register
  daytona_default_snapshot: "pending:agent-gateway-ecr"
  # After register, replace with immutable Daytona id, e.g.:
  # daytona_default_snapshot: "a1b2c3d4-...."
  # daytona_snapshot_name: "lanyard-agent-gateway-v0.1.0"
  ecr:
    pin_ref: null               # set to registry/...@sha256:... after publish
    digest: null
    tag: null
  isolation_class: container    # pilot OK (linux-vm optional hardening)
  bead: lp-1wa
```

### What operators set when unblocked

1. CI publish artifact → `image.pin_ref` / `image.digest`
2. Run create script → Daytona snapshot **id** + **name**
3. Replace placeholder:
   - Platform env / SSM (non-SecureString): `DAYTONA_DEFAULT_SNAPSHOT=<snapshot-id-or-name>`
   - Optional canary: `gateway_instances.agent_snapshot_id` for one instance
4. Dual-write pin string into deploy docs only (this table + pins YAML) — **not** into agent guest env as a credential

## Resolution (unchanged)

Normative resolve remains [agent-snapshot-pin.md](./agent-snapshot-pin.md):

1. Instance `agent_snapshot_id` if set  
2. Else `DAYTONA_DEFAULT_SNAPSHOT`  
3. Else fail closed (no implicit `latest`)

**Product pin = Daytona snapshot id/name.** ECR digest is **input** to snapshot create only.

## Thrift / safety

| Rule | Practice |
|------|----------|
| $10 hard cap | No throwaway sandboxes required for this pin bead when digest missing |
| SM only | `lanyard/staging/portal/daytona` for API key — never git |
| Container class | Pilot OK; do not create `linux-vm` snapshots (no runners in `us`) |
| No secrets in pin docs | Snapshot ids are inventory pins, not credentials |
| No invented digests | Mirror `lp-wu1` blocked path |

## Acceptance (`lp-1wa`)

| Criterion | Met? | Evidence |
|-----------|------|----------|
| 1. Snapshot id in org **or** blocked path + placeholder | **Yes (blocked path)** | ECR `registry_digest=null`; pin `pending:agent-gateway-ecr`; script ready for live register |
| 2. Pin documented for staging/pilot (secret-free) | **Yes** | This file + `pins/staging-pilot.pins.yaml` |
| 3. Runbook for version bump | **Yes** | Seed linked; full operator runbook + verification owned by `lp-i7s` → [agent-snapshot-bump-runbook.md](./agent-snapshot-bump-runbook.md) |
| 4. Thrifty; SM name only; no keys committed | **Yes** | No live create; SM name only |
| 5. Container class OK for pilot | **Yes** | Documented; matches `lp-z1u` / pilot isolation decision |

## Unblock checklist (operators)

1. Create ECR repo `${ECR_NAME_PREFIX}/daytona/agent-gateway` (immutable tags preferred).  
2. Wire GitHub OIDC role + vars (`AWS_ROLE_ARN` / `AGENT_GATEWAY_AWS_ROLE_ARN`, `AWS_REGION`, `ECR_NAME_PREFIX`) per [agent-gateway-ecr-push.md](./agent-gateway-ecr-push.md).  
3. Publish via tag `agent-gateway-vX.Y.Z` or `workflow_dispatch` with immutable version.  
4. Download artifact → confirm `mode=publish` and non-null `image.digest`.  
5. `bash deploy/daytona/agent-gateway/create-snapshot-from-digest.sh --digest-file …`  
6. Update `pins/staging-pilot.pins.yaml` + this table with real snapshot id.  
7. Set `DAYTONA_DEFAULT_SNAPSHOT` for staging CP (non-secret).  
8. Canary one instance, then roll platform default ([bump runbook](./agent-snapshot-bump-runbook.md)).

## Out of scope

- Inventing ECR digests or AWS account apply (OPERATOR HOLD / missing vars)  
- linux-vm snapshot create (no runners)  
- Live CP env apply / Terraform for production pins  
- Automated multi-tenant mass pin flip (operator canary remains manual per [bump runbook](./agent-snapshot-bump-runbook.md) `lp-i7s`)  
- Sibling control-plane SDK/webhook work (`lp-012`, `lp-04r`)
