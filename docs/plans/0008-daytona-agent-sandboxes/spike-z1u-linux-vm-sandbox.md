# Spike notes: `lp-z1u` — Linux VM sandbox from custom agent-like image

**Bead:** `lp-z1u`  
**Epic:** Phase 0 `lp-6tq` (parent under `lp-kng`)  
**Date:** 2026-08-04  
**Status:** **Closed under Phase 0 AC1 waiver** — best-available **container** class proven from custom agent-like snapshot; process exec OK; cleanup empty. Linux VM residual tracked for `lp-ctu` / runner enablement.

Related: prior org/API smoke [`spike-v2p-org-access.md`](./spike-v2p-org-access.md) (`lp-v2p`), overview [overview.md](./overview.md), product image pipeline Phase 2 (`lp-4xa`).

---

## 1. Goal

Prove managed Daytona can start a **Linux VM isolation class** sandbox from a custom image/snapshot (minimal stand-in OK), run a process inside, record `sandbox_id`, and clean up thriftily under the **$10** hard cap.

---

## 2. API discovery (create / class / snapshot)

| Surface | Path / field | Notes |
|---------|--------------|--------|
| API base | `https://app.daytona.io/api` | Same as `lp-v2p` |
| Auth | `Authorization: Bearer <DAYTONA_API_KEY>` + `X-Daytona-Organization-ID` | SM: `lanyard/staging/portal/daytona` (name only) |
| List snapshots | `GET /snapshots` | Returns general + org snapshots; includes `sandboxClass` |
| Create snapshot | `POST /snapshots` | Body: `name`, `imageName`, `sandboxClass` (`container` \| `linux-vm`), cpu/mem/disk |
| Create sandbox | `POST /sandbox` | Prefer `snapshot` name; optional `target`, `domainAllowList`, auto stop/delete |
| Toolbox exec | `POST https://proxy.app.daytona.io/toolbox/{sandboxId}/process/execute` | Bearer + org headers; returns `exitCode` + `result` |
| Regions | `GET /regions` | Org sees **`us` only** (shared) |

Docs: [Sandboxes / VM sandboxes](https://www.daytona.io/docs/en/sandboxes), [Process execution](https://www.daytona.io/docs/en/process-code-execution).

### Documented Linux VM path (Daytona)

- Default VM snapshots: `daytona-vm-small` / `medium` / `large`, `daytona-vm` — class **`linux-vm`**.
- Custom VM: create snapshot with `sandboxClass: "linux-vm"` + base `imageName`, then create sandbox from that snapshot name.
- VM sandboxes require existing VM snapshots (no dynamic image build for VM class).

---

## 3. Linux VM attempts — **gated for this org/region**

Org: `5b45bf51-5792-4f75-a54a-ffa6c4752d6e` (Tier 1; `DAYTONA_REGION=US`).  
General VM snapshots appear in `GET /snapshots` with `sandboxClass: linux-vm` and **`regionIds: []`**.

| Attempt (UTC) | Request | HTTP | Result |
|---------------|---------|------|--------|
| 2026-08-04T13:32:03Z | `POST /sandbox` `snapshot=daytona-vm-small` `target=us` | **400** | `Snapshot daytona-vm-small is not available in region us` |
| 2026-08-04T13:32:16Z | `POST /sandbox` `sandboxClass=linux-vm` only (no snapshot) | **200** | Created **container** (class field **ignored** without a VM snapshot); ephemeral cleanup done |
| 2026-08-04T13:32:51Z | All of `daytona-vm`, `daytona-vm-small`, `daytona-vm-medium`, `daytona-vm-ubuntu-xxl` × targets `us` and `eu` | **400** | Each: `not available in region {us\|eu}` |
| 2026-08-04T13:32:52Z | `POST /snapshots` custom `sandboxClass=linux-vm` `imageName=ubuntu:22.04` | **400** | **`No runners are configured in region 'us' for sandbox class 'linux-vm'. Try a different region or sandbox class.`** |

**Conclusion:** Linux VM isolation is **not runnable today** on this org’s available region(s). Evidence points to **missing `linux-vm` runners in `us`** (and EU target also unavailable for general VM snapshots), not a missing API field. Not a pure “container-only API” gap — the API exposes `sandboxClass` and lists VM snapshots, but **capacity/tier/SKU placement blocks create**.

**Product risk (flag for go/no-go `lp-ctu` / Phase 0):** Overview locks isolation = Linux VM from day one. Until Daytona enables `linux-vm` runners (or higher tier / region SKU) for org `5b45bf51-…`, product cannot meet that isolation decision on managed Daytona in `us`. Escalate with Daytona support or plan tier/region change; do not assume Tier 1 US has VMs.

---

## 4. Best-available path proven (container + custom agent-like snapshot)

Minimal stand-in for Phase 2 agent image: **org snapshot** from public image `ubuntu:22.04`, class **container**.

| Step | UTC timestamp | HTTP | Notes |
|------|---------------|------|--------|
| List sandboxes (pre) | ~2026-08-04T13:33:19Z | **200** | Empty after earlier accidental cleanup |
| Create snapshot `lanyard-lp-z1u-agent-like` | 2026-08-04T13:33:20Z | **200** | `imageName=ubuntu:22.04`, `sandboxClass=container`, `regionIds=["us"]`, state → `active` within ~5s |
| Snapshot id | — | — | `b439142c-f1a5-47be-9753-1bcabe0d584c` |
| Create sandbox | 2026-08-04T13:33:25Z | **200** | `snapshot=lanyard-lp-z1u-agent-like`, `target=us`, `domainAllowList=relay.withlanyard.com`, `autoStopInterval=1`, `autoDeleteInterval=0`, labels `lanyard_spike=lp-z1u` |
| **sandbox_id** | — | — | **`29a6b661-69cf-40c9-a106-75c93a4cce63`** |
| Isolation class (actual) | — | — | **`container`** (desired `linux-vm` unavailable) |
| Image / snapshot used | — | — | Snapshot **`lanyard-lp-z1u-agent-like`** ← `ubuntu:22.04` |
| State | 2026-08-04T13:33:38Z | **200** | `started` |
| Process exec | 2026-08-04T13:33:38Z | **200** | Toolbox `POST …/process/execute` — see §5 |
| Stop (ephemeral) | 2026-08-04T13:34:03Z | **200** | `autoDeleteInterval=0` → destroy on stop |
| Delete (explicit) | 2026-08-04T13:34:05Z | **404** | Already gone (expected) |
| List after cleanup | 2026-08-04T13:34:07Z | **200** | `count=0`, id not present |
| Delete org snapshot | 2026-08-04T13:34:08Z / 13:34:36Z | **200** then gone | By snapshot UUID; org custom list empty |

Also cleaned: accidental container `61357937-b79a-4c30-be2a-1a7f069f3812` from the `sandboxClass`-only create probe.

---

## 5. Process-in-sandbox proof

```http
POST https://proxy.app.daytona.io/toolbox/29a6b661-69cf-40c9-a106-75c93a4cce63/process/execute
Authorization: Bearer <key>
X-Daytona-Organization-ID: <org>
Content-Type: application/json

{"command":"echo hello-from-lp-z1u && uname -a && cat /etc/os-release | head -3","timeout":30}
```

**Response (redacted structure only):**

- `exitCode`: **0**
- `result` includes:
  - `hello-from-lp-z1u`
  - `Linux 29a6b661-69cf-40c9-a106-75c93a4cce63 … x86_64 …`
  - `PRETTY_NAME="Ubuntu 22.04.5 LTS"` / `VERSION_ID="22.04"`

Code-run (`python3`) returned exit 127 on bare Ubuntu (no Python) — expected for this stand-in; shell exec is sufficient for this spike.

---

## 6. Acceptance mapping

| Criterion | Met? | Evidence |
|-----------|------|----------|
| 1. Linux VM isolation class | **Waived for Phase 0** (see §6.1) | VM create blocked: no `linux-vm` runners in `us`; best-available **container** from custom snapshot proven |
| 2. Process runs inside sandbox | **Yes** | Exec exit 0, `hello-from-lp-z1u`, Ubuntu 22.04 |
| 3. `sandbox_id` in spike report | **Yes** | `29a6b661-69cf-40c9-a106-75c93a4cce63` |
| 4. Cleanup; no API key in git | **Yes** | List empty; snapshot deleted; key only via SM, never committed |

### 6.1 Formal Phase 0 AC1 waiver (human decision 2026-08-04)

**Decision:** Accept **container** as best-available isolation for remaining Phase 0 spikes on this org/region. Do **not** block `lp-3en` / `lp-4dk` / `lp-bnd` on Linux VM runners.

**Rationale:** API exposes `sandboxClass=linux-vm` and lists general VM snapshots, but create fails with no `linux-vm` runners in `us` (EU targets also unavailable). Custom agent-like snapshot + process exec + thrifty cleanup are proven on **container**. Isolation = Linux VM remains a **product lock** for pilot go/no-go, not a hard stop on Phase 0 plumbing spikes.

**Residual owner:** `lp-ctu` (spike go/no-go report) must restate Linux VM gate; escalate Daytona support / tier / region if pilot requires VM isolation before dual-run. Optional follow-up bead if product wants a dedicated re-prove when runners exist.

**What this does *not* waive:** Production pilot acceptance of container-only isolation; Phase 2 agent image pipeline; S3/WSS/latency spikes still required.

---

## 7. Residual risks / next

| Risk | Owner / next |
|------|----------------|
| **Linux VM unavailable** on Tier 1 / region `us` | Product go/no-go (`lp-ctu`); Daytona support / tier / region enablement |
| Product agent image still Phase 2 | `lp-4xa` / snapshot pin live register |
| WSS to Relay under Tier 1 | `lp-4dk` (domainAllowList accepted again; not proven as egress) |
| Latency / S3 mount / etc. | `lp-bnd`, `lp-3en`, … |
| $10 hard cap | Keep spikes thrifty; one sandbox; stop/delete immediately |

**Unblocks:** downstream Phase 0 leaves (`lp-3en`, `lp-4dk`, `lp-bnd`) may proceed on **container + snapshot create/exec** patterns; VM residual stays open for `lp-ctu`.

---

## 8. Repro (operators — no secrets in history)

```bash
export AWS_PROFILE=lanyard-main AWS_DEFAULT_REGION=us-east-1
# Load DAYTONA_* from SM lanyard/staging/portal/daytona (do not echo key)
# GET  /snapshots — note sandboxClass on general VM names
# POST /snapshots { name, imageName: ubuntu:22.04, sandboxClass: container }  # agent-like stand-in
# POST /sandbox   { snapshot: <name>, target: us, autoDeleteInterval: 0, ... }
# POST https://proxy.app.daytona.io/toolbox/{id}/process/execute  { command: "echo hello" }
# POST /sandbox/{id}/stop  (ephemeral deletes)
# DELETE /snapshots/{snapshotUuid}
# Expect POST /snapshots with sandboxClass linux-vm → 400 no runners in us (as of this spike)
```
