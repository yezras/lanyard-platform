# Agent snapshot pin convention (`lp-kng.2.7`)

**Status:** Offline convention + CP config field. **Live pin track:** [agent-snapshot-live-pin.md](./agent-snapshot-live-pin.md) (`lp-1wa`; blocked path + placeholder until ECR publish).  
**Bead:** `lp-kng.2.7`  
**Parent:** `lp-kng.2` (Offline piping)  
**Depends on:** [cp-daytona-config.md](./cp-daytona-config.md) (`lp-k8n`), [identity-model.md](./identity-model.md) (`lp-707`)  
**Code:** `portal/packages/control-plane/src/daytona-config.ts`  
**Live follow-on (image pipeline):** Phase 2 epic `lp-4xa` — [agent-snapshot-live-pin.md](./agent-snapshot-live-pin.md), [agent-snapshot-bump-runbook.md](./agent-snapshot-bump-runbook.md)

## Purpose

Define how Control Plane **pins** the agent image/snapshot used on Daytona
create-from-snapshot:

1. **Schema fields** (platform default + per-instance override)
2. **Offline placeholder values** that are valid strings until a real Daytona
   snapshot exists
3. **Resolution order** for wake (`ensure_online`)
4. **Forward links** to the live image/snapshot pipeline (Phase 2)

This is design + schema convention only. Offline track does **not** register
snapshots with Daytona, push ECR, or call paid APIs.

## Schema fields (documented)

| Layer | Field / env | Type | Owner | Lifetime |
|-------|-------------|------|-------|----------|
| **Platform default** | `DAYTONA_DEFAULT_SNAPSHOT` → `DaytonaConfig.defaultSnapshotId` | non-secret string | Platform deploy / env / SSM (non-SecureString ok) | Per env (dev/lab/staging/prod); rotated on agent image release |
| **Per-instance pin** | `gateway_instances.agent_snapshot_id` | `string \| null`, max 256 | Provision / ops / canary | Until superseded; null = inherit platform default |
| **Resolved pin** | `resolveAgentSnapshotId(config, instance.agent_snapshot_id)` | `string \| null` | Orchestrator at wake | Used only for create-from-snapshot; not Relay identity |

Related CP catalog (full env table): [cp-daytona-config.md](./cp-daytona-config.md).

| Constraint | Rule |
|------------|------|
| Secret? | **No** — snapshot ids are inventory pins, not credentials |
| Logged? | May log the pin string (ops). Never log `DAYTONA_API_KEY`. |
| Tenant-visible? | **No** requirement to expose to tenants; platform ops field |
| Guest agent? | Agent does **not** receive Daytona snapshot APIs; optional diagnostic env only (gateway-env-contract) |
| Empty when enabled? | Fail closed: when `DAYTONA_ENABLED` and non-test env, `DAYTONA_DEFAULT_SNAPSHOT` is required (`lp-k8n`) |

### CP types (normative meanings)

```ts
// Platform config (lp-k8n / lp-kng.2.7)
type DaytonaConfig = {
  // ...
  /** Platform default when instance.agent_snapshot_id is null. */
  defaultSnapshotId: string;
};

// Instance row (lp-nye)
type GatewayInstance = {
  // ...
  /** Per-instance override pin; null → use DAYTONA_DEFAULT_SNAPSHOT. */
  agent_snapshot_id: string | null;
};
```

Structural validation (registry / HTTP):

- Non-empty after trim when set
- Max length **256**
- Opaque string (no path traversal, no newline control chars preferred)

## Resolution order (wake)

Normative for Instance Orchestrator create-from-snapshot:

1. If `gateway_instances.agent_snapshot_id` is non-empty (trimmed) → **use it**
2. Else if `DAYTONA_DEFAULT_SNAPSHOT` / `defaultSnapshotId` is non-empty → **use it**
3. Else → **null** → orchestrator **must fail closed** before Daytona create  
   (no implicit “latest” pull in product path)

Code helper: `resolveAgentSnapshotId(config, instanceSnapshotId)`.

```text
ensure_online(instance_id)
  → resolveAgentSnapshotId(platformConfig, row.agent_snapshot_id)
  → if null: error (config incomplete)
  → DaytonaClient.create({ snapshotId: pin, ... })
```

## Offline placeholder values (ok for offline)

**Rule:** Until Phase 2 registers a real Daytona snapshot (`lp-1wa`), the pin
**may be any non-empty fake string**. Offline unit tests and fakes must not
require a live snapshot id.

### Canonical offline placeholder

| Use | Value | Notes |
|-----|-------|-------|
| Platform default (recommended offline) | `offline:agent-default` | Constant `OFFLINE_AGENT_SNAPSHOT_PLACEHOLDER` in CP |
| Per-instance canary / test override | `offline:agent-<label>` | e.g. `offline:agent-canary` |
| Legacy test fixtures | `snap-agent-v1`, `snap-agent-offline-v1` | Still valid offline; prefer `offline:` prefix going forward |

`offline:` prefix is a **Lanyard convention**, not a Daytona wire format. Fake
Daytona client accepts the string as-is; real create will only work after a
matching snapshot is registered in the org.

### Per-env pin table (placeholder until live)

| Env | `DAYTONA_DEFAULT_SNAPSHOT` (offline) | Live (after `lp-4xa` / `lp-1wa`) |
|-----|--------------------------------------|----------------------------------|
| Local / unit tests | `offline:agent-default` or test-specific | N/A (fake client) |
| Lab / mock | `offline:agent-default` | Real Daytona snapshot id for lab image |
| Staging / pilot | `offline:agent-default` or **`pending:agent-gateway-ecr`** | Live id after ECR publish + snapshot register — see [agent-snapshot-live-pin.md](./agent-snapshot-live-pin.md) |
| Production | **not** set live without real pin | Pin from production snapshot create |

**Live pin status (`lp-1wa`):** ECR still **build-only** (no registry digest). Staging/pilot committed placeholder is `pending:agent-gateway-ecr` in [`deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml`](../../../deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml). Do not invent digests or snapshot ids.

Deploy may dual-write the same pin string into:

1. Task/env `DAYTONA_DEFAULT_SNAPSHOT` (platform default)
2. Optional per-tenant/instance `agent_snapshot_id` for canary rollback

### What is **not** a pin

| Value | Why rejected as product pin |
|-------|-----------------------------|
| Empty / whitespace | Fail closed at resolve |
| `latest` / `stable` floating tags as sole product id | Non-reproducible wake; prefer immutable snapshot id after Phase 2 |
| ECR image digest alone | Digest is **input** to snapshot create (`lp-1wa`); CP pins the **Daytona snapshot id** after register |
| `sandbox_id` / `instance_id` | Different identity lifetimes (identity-model.md) |

## Live pin shape (forward-looking)

Phase 2 will produce a real Daytona snapshot id from image digest. Offline does
not lock the vendor id grammar beyond:

- Opaque non-empty string ≤ 256 chars
- Prefer immutable ids issued by Daytona register (not mutable tags)

When live pins exist, **replace** offline placeholders in that env’s config.
Canary: set `agent_snapshot_id` on one instance to the new pin; keep platform
default on the previous pin until roll-forward (`lp-i7s`).

## Links to image pipeline (later)

Offline convention ends here. **Live** build → push → snapshot → pin:

| Bead | Role |
|------|------|
| **`lp-4xa`** | Phase 2 epic: Agent image and snapshot pipeline |
| `lp-e9l` | Dockerfile: agent gateway image for Daytona Linux VM |
| `lp-kng.2.6` | Offline Dockerfile + entrypoint skeleton (no ECR) — [`deploy/daytona/agent-gateway/`](../../../deploy/daytona/agent-gateway/) |
| `lp-wu1` | CI: build agent image and push digest to ECR → [agent-gateway-ecr-push.md](./agent-gateway-ecr-push.md) |
| `lp-b7w` | Entrypoint: wait for vault mount, start gateway foreground |
| **`lp-1wa`** | Create Daytona snapshot from image digest and **pin id** (feeds CP) |
| **`lp-i7s`** | Runbook: bump agent snapshot version safely (pin roll-forward / rollback) |

Related design:

- Guest / prebake (Bucket A = snapshot image): [overview.md](./overview.md) §4.3
- Env parity for agent process: [gateway-env-contract.md](./gateway-env-contract.md)
- Platform config load: [cp-daytona-config.md](./cp-daytona-config.md)
- Identity of pin vs sandbox vs vault: [identity-model.md](./identity-model.md)

## Out of scope (this bead — offline convention only)

- Real Daytona snapshot create / org API — **live:** [agent-snapshot-live-pin.md](./agent-snapshot-live-pin.md) (`lp-1wa`)
- ECR push (`lp-wu1`)
- Terraform / SSM parameter apply for prod pins
- Warm pool optimizations (`lp-6bg`)
- Changing EC2 `runtime_kind` path

## Acceptance evidence

- [x] Schema field documented (this file + `DAYTONA_DEFAULT_SNAPSHOT` / `agent_snapshot_id`)
- [x] Placeholder value ok for offline (`offline:agent-default` + fake client)
- [x] Links to image pipeline later (`lp-4xa`, `lp-1wa`, `lp-i7s`, …)
- [x] Live pin / blocked path documented on `lp-1wa` ([agent-snapshot-live-pin.md](./agent-snapshot-live-pin.md))
