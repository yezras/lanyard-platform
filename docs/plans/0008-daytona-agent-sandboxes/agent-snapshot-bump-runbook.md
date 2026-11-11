# Runbook: bump agent snapshot version safely (`lp-i7s`)

**Status:** Operator runbook (secret-free). Live register requires ECR publish (`lp-wu1`) + Daytona org key from SM.  
**Primary bead:** `lp-i7s`  
**Depends on:** `lp-1wa` (create from digest + pin convention)  
**Related:** [agent-snapshot-live-pin.md](./agent-snapshot-live-pin.md), [agent-snapshot-pin.md](./agent-snapshot-pin.md), [agent-gateway-ecr-push.md](./agent-gateway-ecr-push.md), [cp-daytona-config.md](./cp-daytona-config.md)

## Goals

Safe **build → push → snapshot → pin → roll-forward**, plus **rollback pin**, for the Daytona agent-gateway image (Bucket A / §4.3 prebake):

1. Produce a new **immutable** agent-gateway image digest (never invent digests).  
2. Register a new Daytona **container** snapshot from that digest.  
3. Pin the new snapshot id into CP **without outage** (canary → platform default).  
4. Rollback = re-pin previous snapshot id (no mid-incident snapshot delete).  
5. Verify each stage with explicit checks before advancing.

**Design policy (§4.3):** Agent does **not** own sandbox lifecycle. Product CLIs are prebaked in the snapshot once per release. Tenant config/secrets stay outside the image (S3 vault + wake inject). Entrypoint = wait mount + start gateway only (no install-on-boot).

## Preconditions

| Check | Notes |
|-------|--------|
| Image build green | `bash deploy/daytona/agent-gateway/build-local.sh --run-smoke` and/or CI workflow |
| ECR publish ready | Repo exists; OIDC vars set; **not** invent digests — see [agent-gateway-ecr-push.md](./agent-gateway-ecr-push.md) |
| Daytona key | SM `lanyard/staging/portal/daytona` only (`DAYTONA_API_KEY`, `DAYTONA_ORG_ID`, `DAYTONA_REGION`) — never echo values |
| Isolation | Pilot = **`container`** (do not use `linux-vm` until runners exist) |
| Budget | Thrifty — optional single smoke sandbox with short auto-stop / `autoDeleteInterval=0` then stop; no thrash |
| Current pin known | Record **current** `DAYTONA_DEFAULT_SNAPSHOT` (and any instance overrides) **before** changing anything |
| Staging hold | If OPERATOR HOLD is active, live AWS/ECR may be blocked — still run offline verification + dry-run path |
| Daytona ECR registry auth | Stored org registry passwords are 12h ECR tokens — refresh **before every snapshot roll** (see below) |

### Record current pin (before any change)

```bash
# Platform default (env / SSM non-SecureString — value is inventory, not secret)
echo "current_default=${DAYTONA_DEFAULT_SNAPSHOT:-<unset>}"

# Committed pin fragment (staging/pilot)
grep -E 'daytona_default_snapshot|previous_daytona|status' \
  deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml

# Optional: list org snapshots (auth from SM; never print the key)
# GET ${DAYTONA_API_BASE:-https://app.daytona.io/api}/snapshots
```

Write down:

| Field | Old value (fill before bump) |
|-------|------------------------------|
| `DAYTONA_DEFAULT_SNAPSHOT` | |
| `previous_daytona_default_snapshot` (if any) | |
| Canary instance id(s) | |
| Target new version tag | `agent-gateway-vX.Y.Z` |

### Refresh Daytona ECR pull credentials (`lp-j2wq`) — before every snapshot roll

The Daytona org has **three** registry entries all named `aws-ecr-us-east-1`
(different ids, same URL `https://123456789012.dkr.ecr.us-east-1.amazonaws.com`,
username `AWS`). This duplication is **observed inventory — do not delete** any
of them. Each entry's stored password is an AWS ECR authorization token that
**expires after 12h**, so snapshot creation fails with:

```text
denied: Your authorization token has expired
```

(surfaced in the snapshot `errorReason` after a failed Step 3 register).

**When to refresh:** before every snapshot roll (Steps 2–3), and immediately
whenever the expiry error above appears.

**Automated (preferred):**

```bash
export AWS_PROFILE=lanyard-main AWS_DEFAULT_REGION=us-east-1

# Dry-run first (default): lists matching entries, PATCHes nothing
bash deploy/daytona/agent-gateway/refresh-daytona-ecr-auth.sh --from-sm

# Live: mints a fresh token and PATCHes every entry matching the ECR host
bash deploy/daytona/agent-gateway/refresh-daytona-ecr-auth.sh --from-sm --apply
```

**Manual PATCH (equivalent):**

```bash
FRESH_TOKEN="$(aws ecr get-login-password --region us-east-1)"
# GET /docker-registry lists entries; PATCH each one whose url matches our ECR host:
curl -X PATCH "https://app.daytona.io/api/docker-registry/${id}" \
  -H "Authorization: Bearer ${DAYTONA_API_KEY}" \
  -H "X-Daytona-Organization-ID: ${DAYTONA_ORG_ID}" \
  -H "Content-Type: application/json" \
  -d '{"name":"aws-ecr-us-east-1","url":"https://123456789012.dkr.ecr.us-east-1.amazonaws.com","username":"AWS","password":"'"${FRESH_TOKEN}"'","project":"ecr"}'
unset FRESH_TOKEN
```

The PATCH requires the **full body** (`name`, `url`, `username`, plus the new
`password`; `project` as stored) or it returns 400.

**Verification:**

| # | Check | Pass criteria |
|---|--------|----------------|
| E1 | Dry-run | Script lists all 3 `aws-ecr-us-east-1` entries; exit 0; no tokens printed |
| E2 | Apply | Every matching entry PATCHed OK; exit 0 |
| E3 | Secret hygiene | No API key / ECR token in output, shell history intent, beads, or docs |
| E4 | Prove | Snapshot register (Step 3) no longer reports expired-token denial |

**Secret hygiene rules:** load `DAYTONA_API_KEY` (+ org id) from SM
`lanyard/staging/portal/daytona` only; never echo the API key, the fresh ECR
token, or any registry password into logs, docs, or beads.

---

## End-to-end flow (checklist)

```text
[1] Build + smoke (local and/or CI build-only)
        ↓ verify: smoke exit 0; optional local_image_id
[2] Push immutable tag → ECR digest artifact (mode=publish)
        ↓ verify: image.digest + pin_ref non-null; no placeholders
[3] Register Daytona snapshot from digest
        ↓ verify: snapshot_id/name active in org; print-pin looks right
[4] Canary pin (one instance override only)
        ↓ verify: ensure_online that instance; gateway healthy
[5] Roll platform default + update pin docs
        ↓ verify: new default resolves; non-canary wakes; soak
[6] Rollback path (if needed) OR cleanup after soak
```

---

## Step 1 — Build (local proof + CI)

### 1a. Local (always available)

```bash
bash deploy/daytona/agent-gateway/build-local.sh --run-smoke
```

### Verification — build

| # | Check | Pass criteria |
|---|--------|----------------|
| B1 | Local smoke | Script exit 0; entrypoint smoke does not require live Daytona/ECR |
| B2 | Dockerfile path | Image built from `deploy/daytona/agent-gateway/Dockerfile` (`linux/amd64`) |
| B3 | No secrets in image | No provider keys / `DAYTONA_API_KEY` / vault bytes baked in (see gateway-env-contract) |

### 1b. CI build-only (PR / main)

Workflow: [`.github/workflows/agent-gateway-image.yml`](../../../.github/workflows/agent-gateway-image.yml)

- PR/main path filters → **build-only** (never invents registry digests).  
- Artifact may include `local_image_id` + pin **template** only.

### Verification — CI build-only

| # | Check | Pass criteria |
|---|--------|----------------|
| B4 | Job green | Workflow succeeds |
| B5 | Mode | `mode=build-only` when vars missing or non-publish ref |
| B6 | No fake digest | `registry_digest` is null / template placeholders remain — **do not** treat as publish |

---

## Step 2 — Push (immutable version → ECR)

Prefer a **version tag** (never `main` / `latest` as sole authority):

```bash
# From a clean, reviewed commit on main (or release branch policy):
git tag agent-gateway-vX.Y.Z
git push origin agent-gateway-vX.Y.Z

# Or: Actions → "Agent gateway image" → workflow_dispatch with version=vX.Y.Z
```

Download artifact `agent-gateway-<version>` (or `agent-gateway-digests-vX.Y.Z.json`).

### Verification — publish artifact

| # | Check | Pass criteria |
|---|--------|----------------|
| P1 | Mode | `mode: publish` |
| P2 | Digest | `image.digest` = `sha256:` + 64 hex |
| P3 | Pin ref | `image.pin_ref` = `<registry>/<repo>@sha256:<64 hex>` |
| P4 | Reject templates | No `sha256:<64-hex-from-ecr-publish>` placeholders; `registry_digest` not null |
| P5 | Version | Tag matches intended release (`vX.Y.Z` / `agent-gateway-vX.Y.Z`) |
| P6 | Platform | `platform: linux/amd64` |
| P7 | Immutability | Tag is not `latest` / `main` / `HEAD` alone |

**Stop here** if publish is blocked (missing OIDC vars, no ECR repo, OPERATOR HOLD). Do not invent digests or invent Daytona snapshot ids. Staging pin may remain `pending:agent-gateway-ecr` per [agent-snapshot-live-pin.md](./agent-snapshot-live-pin.md).

### Dry-run (no API) when unblocked later

```bash
bash deploy/daytona/agent-gateway/create-snapshot-from-digest.sh \
  --digest-file /path/to/agent-gateway-digests-vX.Y.Z.json \
  --name "lanyard-agent-gateway-vX.Y.Z" \
  --class container \
  --dry-run
```

| # | Check | Pass criteria |
|---|--------|----------------|
| P8 | Dry-run | Script parses publish artifact; prints request body; exit 0; no POST |

---

## Step 3 — Register Daytona snapshot from digest

Load SM (never echo the key):

```bash
export AWS_PROFILE=lanyard-main AWS_DEFAULT_REGION=us-east-1
# Load DAYTONA_API_KEY, DAYTONA_ORG_ID, DAYTONA_REGION from secret name
#   lanyard/staging/portal/daytona  (do not print values)

bash deploy/daytona/agent-gateway/create-snapshot-from-digest.sh \
  --name "lanyard-agent-gateway-vX.Y.Z" \
  --digest-file /path/to/agent-gateway-digests-vX.Y.Z.json \
  --class container \
  --print-pin

# Equivalent explicit image ref:
# bash deploy/daytona/agent-gateway/create-snapshot-from-digest.sh \
#   --name "lanyard-agent-gateway-vX.Y.Z" \
#   --image-name "<registry>/<prefix>/daytona/agent-gateway:vX.Y.Z" \
#   --class container \
#   --print-pin
```

> **Note (lp-84dl, Aug 2026):** Daytona runners reject digest-pinned image refs
> (`repo@sha256:…`) with `invalid reference format`. The script therefore sends
> the immutable version tag (`repo:tag`) from the publish artifact by default;
> use `--ref-style digest` only as an explicit opt-in for future Daytona
> versions. The digest remains the audit record in the pins YAML.

Record outputs (script prints `snapshot_id=…`, `snapshot_name=…`):

| Field | Where to store |
|-------|----------------|
| Snapshot **uuid** | Prefer for `DAYTONA_DEFAULT_SNAPSHOT` if API returns stable uuid |
| Snapshot **name** | Inventory / create-from-snapshot name field |
| Source `pin_ref` | pins YAML for audit trail |
| Isolation class | `container` |
| Previous default | `previous_daytona_default_snapshot` in pins YAML (keep ≥1 prior) |

**Do not** delete the previous org snapshot until the new pin has soaked.

### Verification — snapshot register

| # | Check | Pass criteria |
|---|--------|----------------|
| S1 | Script exit | Exit 0; prints `snapshot_id` and/or `snapshot_name` |
| S2 | Class | `sandbox_class=container` (not linux-vm for pilot) |
| S3 | Image binding | Snapshot `image_name` / request used digest pin_ref, not floating `latest` |
| S4 | Org inventory | `GET /snapshots` lists the new name; state active/ready (or vendor equivalent) |
| S5 | Print-pin | YAML snippet has non-empty `daytona_default_snapshot`; `status: active`; ECR digest filled |
| S6 | Secret hygiene | No API key in script output, git, beads, or PR body |

Optional thrifty smoke (not required if canary uses real pilot instance):

- Create **one** sandbox from the new snapshot name/id; `target: us`; short auto-stop.  
- Confirm process starts (entrypoint wait+gateway path).  
- Stop / delete the smoke sandbox promptly.

---

## Step 4 — Canary pin (one instance; platform default unchanged)

**Resolution order** ([agent-snapshot-pin.md](./agent-snapshot-pin.md)):

1. Instance `gateway_instances.agent_snapshot_id` if set  
2. Else `DAYTONA_DEFAULT_SNAPSHOT`  
3. Else fail closed (no implicit `latest`)

### Procedure

1. Leave platform `DAYTONA_DEFAULT_SNAPSHOT` on the **previous** pin.  
2. Set `gateway_instances.agent_snapshot_id` for **one** staging/pilot instance to the **new** snapshot id (or stable name).  
3. Call `ensure_online` for **that instance only** (internal orchestrator API).  
4. Exercise a minimal wake path: vault mount path + inject + gateway start (see [gateway-env-contract.md](./gateway-env-contract.md)).  
5. If fail: clear instance override (`null` → inherits previous default). **Do not** flip platform default.

### Verification — canary

| # | Check | Pass criteria |
|---|--------|----------------|
| C1 | Platform default untouched | Other instances still resolve to **old** pin |
| C2 | Instance override | Canary row `agent_snapshot_id` = new snapshot id |
| C3 | Resolve helper | `resolveAgentSnapshotId(config, canary.agent_snapshot_id)` → new pin |
| C4 | ensure_online | Canary reaches expected presence / online without create error |
| C5 | Gateway | Guest process up; WSS/relay path per env (or mock path under hold) |
| C6 | No blast radius | Non-canary instances not recreated on new snapshot |
| C7 | Failure path | On canary failure, override cleared; platform default still old pin |

**Stop and fix** (image or snapshot) before Step 5 if canary fails. Prefer publishing a **new** version over retagging.

---

## Step 5 — Roll platform default (roll-forward)

When canary is healthy for the agreed soak window (ops judgment; keep thrifty):

1. Set `DAYTONA_DEFAULT_SNAPSHOT` (env / SSM **non-SecureString**) to the new snapshot id.  
2. Clear successful canary overrides (or leave for extra soak).  
3. Update committed pin fragment + live pin table:  
   - [`deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml`](../../../deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml)  
   - [agent-snapshot-live-pin.md](./agent-snapshot-live-pin.md) staging/pilot table  
4. Set `previous_daytona_default_snapshot` to the **old** pin for one release (rollback aid).  
5. Set pin `status: active` (leave `pending-ecr-publish` only when still blocked).

Example pin fragment fields after roll-forward (illustrative — use real ids from Step 3):

```yaml
agent_snapshot:
  env: staging-pilot
  status: active
  isolation_class: container
  daytona_default_snapshot: "<new-snapshot-uuid-or-name>"
  daytona_snapshot_name: "lanyard-agent-gateway-vX.Y.Z"
  daytona_snapshot_id: "<new-snapshot-uuid>"
  previous_daytona_default_snapshot: "<old-snapshot-uuid-or-name>"
  ecr:
    pin_ref: "<registry>/<prefix>/daytona/agent-gateway@sha256:<64 hex>"
    digest: "sha256:<64 hex>"
    tag: "vX.Y.Z"
```

### Verification — roll-forward

| # | Check | Pass criteria |
|---|--------|----------------|
| R1 | Platform env | `DAYTONA_DEFAULT_SNAPSHOT` equals new snapshot id/name |
| R2 | Resolve default | Instance with `agent_snapshot_id=null` resolves to new pin |
| R3 | ensure_online (second instance) | Non-canary (or cleared canary) wakes on new pin |
| R4 | Pin docs | pins YAML + live-pin table match live env (secret-free) |
| R5 | Previous retained | `previous_daytona_default_snapshot` set; old Daytona snapshot **not** deleted |
| R6 | Fail-closed | Empty pin still rejected; no floating `latest` as product pin |

### Multi-tenant roll-forward notes

| Pattern | Guidance |
|---------|----------|
| Platform default | Preferred steady state: all instances inherit new pin |
| Per-instance holdback | Leave a noisy tenant on old pin via `agent_snapshot_id` until they soak |
| Dual-run EC2 | `runtime_kind=ec2` path does not use Daytona snapshot pin; leave unchanged |
| Prod | Do not promote production pin without deliberate canary in that env |

### CP force-new-deployment + secret material (lp-zuh.10.11 / lp-oop.37.6)

`INSTANCE_SECRET_MATERIAL_PATH=/tmp/…` on Fargate is **ephemeral**. A
force-new-deployment wipes it; remaining `guest_gateway` wakes fail
`missing_secret_material`. Vault/Directory on `VaultPlane=cp_s3` and
`tool_only` harness creates do **not** read that store.

**Durable path (lp-oop.37.6):** same AES-256-GCM envelope in Secrets Manager
(`INSTANCE_SECRET_MATERIAL_SM_SECRET_ID` + KEY). Unset PATH. Runbook:
[instance-secret-material.md](../../runbooks/instance-secret-material.md).
Live prove of force-new-deployment without rotate is **pending** until ops
creates the SM secret and switches env.

Until live SM is on:

1. `POST /tenants/{tid}/instances/{iid}/rotate` (service token) — re-seeds material + Relay push  
2. `POST /internal/instances/{iid}/ensure-online` — cold create on the new pin  
3. Re-run portal UIQA / vault probe

Do **not** treat this as a bad snapshot pin until rotate + cold ensure_online has been tried.
Evidence: `artifacts/mocklab/live-qa/lp-zuh.10.11/EVIDENCE.md`.

### Daytona org disk limit (30 GiB) — orphan sandboxes (lp-zuh.11.7)

Stopped sandboxes still count against the org **disk** quota until archived.
Kill/recreate without archive (relay never-connect) + `autoDeleteInterval=-1`
can fill 30 GiB with ~10×3 GiB MockLab sandboxes → create fails:

`Total disk limit exceeded. Maximum allowed: 30GiB`.

**Ops recovery (no secrets in logs):** do **not** archive every sandbox —
that deletes the bound MockLab / tenant `sandbox_id` after a normal idle stop.
Use the keep-set job (`lp-oop.37.7`):

```bash
export AWS_PROFILE=lanyard-main
# Dry-run default. Load bound ids from CP registry dump or --keep-id.
python3 deploy/scripts/archive-unused-daytona-sandboxes.py \
  --cp-instances-json /tmp/cp-gateway-instances.json
# After the plan shows keep <bound-id> and would_archive only unused:
python3 deploy/scripts/archive-unused-daytona-sandboxes.py \
  --cp-instances-json /tmp/cp-gateway-instances.json \
  --apply
```

Runbook: [daytona-sandbox-archive-hygiene.md](../../runbooks/daytona-sandbox-archive-hygiene.md).

CP harden: `waitRelayConnectedOrRecreate` archives after stop on the kill path
(so recreates free disk). Recurring unused-box GC is the ops job above, not
full GC on every cold create.

After free disk, if cold entrypoint still dies with post-mount not-writable on
an **old** snapshot, re-bake/pin so image includes the `lp-zuh.11.2` post-mount
writable wait (already on main `entrypoint.sh`).


---

## Step 6 — Rollback

Rollback is **pin swap only**. Do not require image rebuild for emergency recovery if a prior snapshot remains registered.

| Situation | Action | Verify |
|-----------|--------|--------|
| Bad canary | Set instance `agent_snapshot_id` to old id **or** `null` | ensure_online on canary uses previous pin; others unaffected |
| Bad platform default | Restore previous `DAYTONA_DEFAULT_SNAPSHOT` immediately | New ensures use old pin; update pins YAML `daytona_default_snapshot` back |
| Bad image (no good prior snapshot) | Publish a **new** version from a known-good git SHA; register new snapshot; canary again | Never retag mutable `latest` over a bad digest as sole fix |
| Partial roll | Holdback bad tenants on old pin via instance override while default stays new (or reverse) | Resolution order matches intent |

### Verification — rollback

| # | Check | Pass criteria |
|---|--------|----------------|
| RB1 | Pin restored | `DAYTONA_DEFAULT_SNAPSHOT` (or instance override) equals last known good |
| RB2 | Wake | ensure_online succeeds on restored pin |
| RB3 | Inventory | Prior snapshot still present in org (rollback never deletes mid-incident) |
| RB4 | Docs | pins YAML `daytona_default_snapshot` / `previous_*` updated to match reality |

Rollback **never** requires deleting Daytona snapshots during an incident.

---

## Step 7 — Cleanup (after soak only)

- Keep **N ≥ 1** previous org snapshots for emergency re-pin.  
- Delete older org snapshots only when unused and budget/clutter requires.  
- Never delete general Daytona snapshots (`daytonaio/sandbox:*`).  
- Optionally clear canary overrides after platform default is stable.

### Verification — cleanup

| # | Check | Pass criteria |
|---|--------|----------------|
| CL1 | Retain prior | At least one previous good snapshot still listable |
| CL2 | No orphan canaries | Unintended instance overrides cleared or documented |
| CL3 | Docs | Live pin table and pins YAML still accurate |

---

## Forbidden

| Do not | Why |
|--------|-----|
| Pin floating `latest` / `main` alone | Non-reproducible wakes |
| Commit `DAYTONA_API_KEY` or SM payloads | Secret leak |
| Use ECR digest as sole CP pin | Orchestrator create-from-snapshot needs **Daytona snapshot id** |
| Invent digests when CI is build-only | Lying about publish |
| Flip platform default before canary | Blast radius |
| Delete previous snapshot mid-incident | Removes rollback target |
| Create `linux-vm` class for this org/region today | No runners in `us` ([spike-z1u](./spike-z1u-linux-vm-sandbox.md)) |
| Install-on-boot / mutate guest to “fix” image | Violates §4.3 prebake; ship a new snapshot instead |

---

## Quick reference

### Scripts and files

| Path | Role |
|------|------|
| `deploy/daytona/agent-gateway/build-local.sh` | Local build + smoke |
| `.github/workflows/agent-gateway-image.yml` | CI build / publish |
| `deploy/daytona/agent-gateway/create-snapshot-from-digest.sh` | Register snapshot (`--dry-run`, `--print-pin`) |
| `deploy/daytona/agent-gateway/refresh-daytona-ecr-auth.sh` | Refresh stored ECR registry tokens (`--from-sm`, `--apply`) |
| `deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml` | Committed pin fragment (secret-free) |
| `portal/.../daytona-config.ts` | `resolveAgentSnapshotId`, fail-closed load |

### Daytona API (ops)

| Call | Notes |
|------|--------|
| `GET /snapshots` | List general + org; confirm new name active |
| `POST /snapshots` | `{ "name", "imageName", "sandboxClass": "container" }` |
| Create sandbox | Prefer snapshot name/id; thrifty auto-stop for smoke only |
| Auth | `Authorization: Bearer …` + `X-Daytona-Organization-ID` from SM |

### CP pin fields

| Layer | Field | Lifetime |
|-------|-------|----------|
| Platform | `DAYTONA_DEFAULT_SNAPSHOT` | Per env; rotated on agent image release |
| Instance | `gateway_instances.agent_snapshot_id` | Canary / holdback; null = inherit |
| Resolved | `resolveAgentSnapshotId(...)` | Used only at create-from-snapshot |

---

## Blocked path (publish not ready)

When ECR vars / repo / hold prevent publish:

| Stage | Expected |
|-------|----------|
| CI | `mode=build-only`; template artifact only |
| Snapshot create | **Do not run** product register without real digest |
| CP pin | Keep `pending:agent-gateway-ecr` or `offline:agent-default` |
| This runbook | Steps 1 + dry-run of Step 3 only; document blocked path in live-pin table |

Unblock checklist lives in [agent-snapshot-live-pin.md](./agent-snapshot-live-pin.md).

---

## Acceptance (`lp-i7s`)

| Criterion | Met? | Evidence |
|-----------|------|----------|
| Operator runbook: build → push → snapshot → pin → roll-forward | **Yes** | Steps 1–5 |
| Rollback pin | **Yes** | Step 6 |
| Runbook under plan (or docs/runbooks) | **Yes** | This file under `docs/plans/0008-daytona-agent-sandboxes/` |
| Verification steps | **Yes** | Tables B*, P*, S*, C*, R*, RB*, CL* per stage |
| Secret-free; no invented digests | **Yes** | Forbidden + blocked path |
| Aligns with §4.3 guest/prebake | **Yes** | Goals + Forbidden install-on-boot |

## Links

| Doc | Role |
|-----|------|
| [overview.md §4.3](./overview.md) | Guest + prebake policy |
| [agent-gateway-ecr-push.md](./agent-gateway-ecr-push.md) | CI → ECR digest (`lp-wu1`) |
| [agent-snapshot-live-pin.md](./agent-snapshot-live-pin.md) | Live pin / blocked path (`lp-1wa`) |
| [agent-snapshot-pin.md](./agent-snapshot-pin.md) | Schema + resolve order |
| [cp-daytona-config.md](./cp-daytona-config.md) | Platform config load |
| [gateway-env-contract.md](./gateway-env-contract.md) | Wake env (not baked in image) |
| [provision-runbook-daytona.md](./provision-runbook-daytona.md) | Tenant provision (Daytona branch) |
