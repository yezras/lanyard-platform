# Gateway env contract: EC2 parity for Daytona sandboxes

**Plan section:** companion to §4.3 (agent guest / prebake / config placement) and §2.3 (identity)  
**Bead:** `lp-vey`  
**Parent:** `lp-e0j` (Phase 1) under offline piping `lp-kng.2`  
**Related:** [overview.md](./overview.md), [identity-model.md](./identity-model.md), [offline-piping.md](./offline-piping.md)  
**Platform env catalog (existing):** [backend-runtime-contract.md](../../architecture/backend-runtime-contract.md), [filesystem-layout.md](../../../contracts/backend-runtime-v1/filesystem-layout.md), [deploy-backend-systemd-service.md](../../architecture/deploy-backend-systemd-service.md)  
**Follow-ons:** `lp-kng.2.6` (Dockerfile + entrypoint skeleton), `lp-kng.2.4` (S3 vault prefix layout), `lp-kng.2.5` (IAM mount policy)

## Purpose

Document the **process environment** the Company Brain gateway sees when compute is:

| Path | `runtime_kind` | How env is applied today / target |
|------|----------------|-----------------------------------|
| Always-on host | `ec2` | systemd unit + `EnvironmentFile` on the EC2 host |
| On-demand sandbox | `daytona` | Wake inject by Instance Orchestrator / sandbox entrypoint |

**Normative rule:** prefer **identical env names** on both paths. The agent binary must not branch on host type. Daytona lifecycle knowledge stays in the Control Plane orchestrator, not in the guest gateway.

This doc is offline design only — no live AWS, Daytona create, or ECR push.

## Host-agnostic agent (plan §4.3)

The gateway process is a **guest** on whatever compute the platform supplies:

| Must | Must not |
|------|----------|
| Read platform env names (`GATEWAY_RELAY_*`, `VAULT_ROOT`, …) | Create, stop, or list Daytona sandboxes |
| Dial Relay WSS with `instance_id` credentials | Call Daytona APIs or hold `DAYTONA_API_KEY` |
| Use `VAULT_ROOT` for vault I/O (mounted or host disk) | Treat `sandbox_id` as Relay / Brain RPC identity |
| Start after vault path is ready | Package-install product CLIs on boot |
| Stay ignorant of `runtime_kind` | Require Daytona-only env names to function |

**Entrypoint contract (Daytona):** wait for vault mount → ensure required env is present → `company-brain-backend gateway` (or pin-equivalent). **No** install-on-boot. Product CLIs live in the snapshot (Bucket A); tenant files/config in S3 vault (Bucket B); Relay secrets + mount material at wake (Bucket C). See overview §4.3.

Config placement buckets:

```text
Bucket A  snapshot image     agent binary + product CLIs (once per release)
Bucket B  S3 vault           tenant files / durable config under s3_vault_prefix
Bucket C  wake inject        GATEWAY_RELAY_* secrets, mount credentials, path env
```

The guest only **consumes** A+B+C results. It does not own lifecycle of B or C.

## Platform-owned env names (parity set)

These names are already platform-owned for EC2 / backend-runtime-v1. **Daytona injects the same names.** Values may differ by path; names must not.

### Relay identity (auth)

| Variable | Required at gateway start | Meaning | Value source (both paths) |
|----------|---------------------------|---------|---------------------------|
| `GATEWAY_RELAY_URL` | yes | Relay WSS base URL | Platform relay endpoint for the environment |
| `GATEWAY_RELAY_ID` | yes* | Gateway id presented to Relay (hello / token mint) | CP register; same as product gateway id |
| `GATEWAY_RELAY_INSTANCE_ID` | yes* | Permanent product `instance_id` | CP `gateway_instances.instance_id` — **survives** stop/start |
| `GATEWAY_RELAY_SECRET` | yes | Long-lived instance secret (HMAC / upgrade token) | CP register/rotate; show-once then secret store → wake inject |

\*Implementations historically treat `GATEWAY_RELAY_ID` and `GATEWAY_RELAY_INSTANCE_ID` as the permanent gateway identity; deploy should set both to the same CP `instance_id` unless a documented dual-id migration requires otherwise. **Never** set either to Daytona `sandbox_id`.

### Vault and runtime layout

| Variable | Required | Meaning | EC2 typical value | Daytona typical value |
|----------|----------|---------|-------------------|------------------------|
| `VAULT_ROOT` | yes (prod) | Absolute local path to vault tree | `/opt/company-brain` (host disk) | Mountpoint path of `s3_vault_prefix` — **default `/mnt/vault`** (entrypoint + orchestrator `lp-hjo` / `DEFAULT_DAYTONA_VAULT_ROOT`); override only if image/entrypoint agree |
| `COMPANY_BRAIN_VAULT_ROOT` | no | Legacy alias for `VAULT_ROOT` | same as EC2 today | Prefer unset; if set, **equal** to `VAULT_ROOT` |
| `BACKEND_HOME` | yes | Runtime home (config, profiles, logs, …) | e.g. `/var/lib/company-brain-backend` | Ephemeral sandbox disk path in image/layout (not durable vault) |
| `BACKEND_KIND` | yes | `hermes_lanyard` \| `lanyard_agent` \| `hermes_upstream` | pin / TF | Same — from snapshot pin / orchestrator |
| `BACKEND_INSTALL_PATH` | recommended | Active install tree | e.g. `/opt/company-brain-backend/current` | Path inside snapshot image |
| `BRAIN_TENANT_ID` | recommended | Tenant stamp for logs / ACL context | CP tenant | Same CP tenant |
| `BRAIN_RPC_ENABLED` | as product | Feature gate | deploy default | Same default as EC2 pin |
| `BRAIN_PROFILES_DIR` | optional | Override profiles path | usually unset → `$BACKEND_HOME/profiles` | same resolution order |
| `RELAY_CONTRACT_MAJOR` | optional | Contract major pin | deploy | same |
| `BRAIN_RPC_CONTRACT_MAJOR` | optional | Brain RPC major pin | deploy | same |

Hermes-compatible aliases (`HERMES_HOME` = `BACKEND_HOME`, `HERMES_INSTALL_PATH` = install tree) follow the existing layout contract for Hermes kinds only. They are **not** Daytona-specific.

### Secrets beyond Relay

Model / provider keys (`OPENAI_API_KEY`, `XAI_API_KEY`, …) use the existing secrets envelope / materialize path ([backend-runtime-secrets](../../architecture/backend-runtime-secrets.md)). On Daytona:

- Prefer materializing into the **same env names** at wake (Bucket C) or into files under `BACKEND_HOME` with modes matching EC2.
- Do **not** invent Daytona-only key names for the agent process.

## Diff table: EC2 vs Daytona env

### Names the agent process must see (parity)

| Concern | `runtime_kind=ec2` | `runtime_kind=daytona` | Name parity |
|---------|--------------------|------------------------|-------------|
| Relay WSS URL | `GATEWAY_RELAY_URL` | `GATEWAY_RELAY_URL` | **same name** |
| Gateway / instance id | `GATEWAY_RELAY_ID` / `GATEWAY_RELAY_INSTANCE_ID` | **same** = permanent `instance_id` | **same names** |
| Relay secret | `GATEWAY_RELAY_SECRET` | `GATEWAY_RELAY_SECRET` (wake inject each start) | **same name** |
| Vault path | `VAULT_ROOT` (host disk) | `VAULT_ROOT` (Mountpoint of durable prefix) | **same name** |
| Runtime home | `BACKEND_HOME` | `BACKEND_HOME` (ephemeral sandbox FS) | **same name** |
| Backend kind / install | `BACKEND_KIND`, `BACKEND_INSTALL_PATH` | same from snapshot pin | **same names** |
| Tenant stamp | `BRAIN_TENANT_ID` | `BRAIN_TENANT_ID` | **same name** |
| Provider keys | secrets envelope env keys | same keys at inject | **same names** |

### What differs (injection / durability — not agent API)

| Concern | `runtime_kind=ec2` | `runtime_kind=daytona` |
|---------|--------------------|------------------------|
| Who writes env | Tenant TF + bootstrap + systemd `EnvironmentFile` | Instance Orchestrator + sandbox entrypoint at **wake** |
| When secrets appear | Host bootstrap / rotate on sticky host | **Every** create/start (Bucket C); host is ephemeral |
| Vault bytes location | Local disk under `VAULT_ROOT` | S3 under `s3_vault_prefix`; **local** path still `VAULT_ROOT` |
| Durable across stop | Host disk + always-on process | `instance_id` + `s3_vault_prefix` only; sandbox disk discarded |
| Compute handle in env? | Must **not** put `ec2_instance_id` in agent auth env | Must **not** put `sandbox_id` in agent auth env |
| Idle stop | N/A (always-on) | Sandbox stops; env gone until next wake inject |
| Product CLIs | Host install / bootstrap | Prebaked in snapshot (no apt/pip on boot) |

### Daytona-only material (orchestrator / entrypoint — not agent product contract)

These may exist **around** the guest for mount and lifecycle. They are **not** required by the agent binary and must not replace parity names.

| Variable / material | Audience | Purpose | Agent may read? |
|---------------------|----------|---------|-----------------|
| `DAYTONA_API_KEY` / org keys | Control Plane only | Daytona managed API | **No** — never inject into guest |
| `sandbox_id` (CP / orchestrator state) | Orchestrator | start/stop/status | **No** as identity; optional ops log only |
| `S3_VAULT_PREFIX` or mount args | Entrypoint / Mountpoint helper | Bind durable prefix before gateway start | Prefer **not** required by agent; agent uses `VAULT_ROOT` only. Orchestrator create (`lp-hjo`) sets `S3_VAULT_PREFIX` + optional `LANYARD_VAULT_BUCKET` alongside `VAULT_ROOT` so helpers can run `mount-s3` without reading CP state. |
| Short-lived AWS creds for Mountpoint | Entrypoint / mount helper | Scope IAM to prefix (`lp-kng.2.5` / `lp-zuh.9.1`); mint+inject at wake (`lp-zuh.9.2`) | Only if agent also needs direct S3; default is mount-then-local FS. See **Vault Mountpoint STS env (lp-zuh.9.2)** below. |
| `AGENT_SNAPSHOT_ID` / image pin | Orchestrator create-from-snapshot | Release pin ([agent-snapshot-pin.md](./agent-snapshot-pin.md) `lp-kng.2.7`) | **No** for auth |

### Vault Mountpoint STS env (`lp-zuh.9.2`)

When `s3_vault_prefix` + platform vault bucket are known, Control Plane cold-create assumes the shared base role (`SANDBOX_VAULT_MOUNT_ROLE_ARN`, TF module `sandbox-vault-mount-iam`) with a **session policy** locked to `tenants/{tenant_id}/vault/` and injects guest env for `mount-s3` ([entrypoint.sh](../../../deploy/daytona/agent-gateway/entrypoint.sh) `ensure_vault_mount`):

| Guest env | Secret? | Source | Notes |
|-----------|---------|--------|-------|
| `AWS_ACCESS_KEY_ID` | **Yes** | STS AssumeRole | Never log value; redaction via `daytona-env-redact` |
| `AWS_SECRET_ACCESS_KEY` | **Yes** | STS AssumeRole | Never log value |
| `AWS_SESSION_TOKEN` | **Yes** | STS AssumeRole | Required for assumed-role sessions |
| `AWS_REGION` / `AWS_DEFAULT_REGION` | No | CP `AWS_REGION` (default `us-east-1`) | mount-s3 `--region` |
| `LANYARD_VAULT_BUCKET` (or `S3_VAULT_BUCKET`) | No | CP `S3_VAULT_BUCKET` | Bare bucket name |
| `S3_VAULT_PREFIX` | No | CP `s3_vault_prefix` | Trailing slash; tenant-bound |
| `VAULT_ROOT` | No | Default `/mnt/vault` | Absolute guest path; must match mount target |

**TTL / rotation:** STS `DurationSeconds` **900–3600** (product default **3600** / 1h). Re-issue on **every cold create** (`ensure_online` path that runs `buildCreateParams`). Warm start-from-stopped reuses create-time env (Daytona has no post-create env PATCH). Fail closed if AssumeRole fails when vault prefix + bucket are configured and the STS issuer is wired.

**CP process env (non-secret names):** `SANDBOX_VAULT_MOUNT_ROLE_ARN`, optional `SANDBOX_VAULT_MOUNT_EXTERNAL_ID`, optional `SANDBOX_VAULT_MOUNT_DURATION_SECONDS`, `S3_VAULT_BUCKET`, `AWS_REGION`. Implementation: `portal/packages/control-plane/src/sandbox-vault-mount-sts.ts`. IAM SoT: [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md), module `deploy/modules/sandbox-vault-mount-iam/`.

If an entrypoint script needs helper vars, prefix them clearly (e.g. `LANYARD_ENTRY_*`) and strip or leave unused by the gateway process. Do not overload `GATEWAY_RELAY_*` with sandbox metadata.

## Inject sequence (Daytona wake)

Conceptual order for `ensure_online` (orchestrator + entrypoint; agent stays passive):

```text
1. Resolve CP row by instance_id
   → GATEWAY_RELAY_URL, GATEWAY_RELAY_ID, GATEWAY_RELAY_INSTANCE_ID
   → secret material for GATEWAY_RELAY_SECRET
   → s3_vault_prefix, agent_snapshot_id, BACKEND_KIND pin
2. Daytona create/start from snapshot → sandbox_id (orchestrator only)
   → cold create injects Bucket C env including optional STS AWS_* (lp-zuh.9.2)
3. Mount s3_vault_prefix → local path P (entrypoint mount-s3 using AWS_* + prefix)
4. Export / write env for guest:
     VAULT_ROOT=P
     S3_VAULT_PREFIX=…  LANYARD_VAULT_BUCKET=…
     AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN (STS; short TTL)
     AWS_REGION / AWS_DEFAULT_REGION
     GATEWAY_RELAY_URL=…
     GATEWAY_RELAY_ID=<instance_id>
     GATEWAY_RELAY_INSTANCE_ID=<instance_id>
     GATEWAY_RELAY_SECRET=…
     BACKEND_HOME=…  BACKEND_KIND=…  BRAIN_TENANT_ID=…
     (+ provider keys as needed)
5. Wait until VAULT_ROOT is mounted and readable
6. exec company-brain-backend gateway
7. Agent dials Relay as instance_id → presence online
```

Idle stop clears compute and guest env; **re-inject** on next wake with the **same** `instance_id` and vault prefix.

## Anti-patterns

| Anti-pattern | Why it fails |
|--------------|--------------|
| `GATEWAY_RELAY_INSTANCE_ID=sandbox_id` | Breaks Relay auth across stop/recreate; violates identity model |
| Different env names on Daytona (`DAYTONA_RELAY_URL`, …) | Forces agent forks; dual-run EC2↔Daytona fails |
| Baking `GATEWAY_RELAY_SECRET` into snapshot image | Cross-tenant leak; rotation requires image rebuild |
| Baking tenant vault into image | Cross-tenant data; violates Bucket B durability |
| Agent calls Daytona on missing vault | Breaks guest model; needs org keys in tenant runtime |
| Install CLIs in entrypoint | Violates §4.3 prebake; slow/flaky wake |
| Putting only S3 URI in `VAULT_ROOT` without mount | Agent expects filesystem layout under vault root |
| POSIX append / in-place open-for-write on Mountpoint `VAULT_ROOT` | Mountpoint rejects append; use **write-temp + replace** ([vault-io-pilot-decision.md](./vault-io-pilot-decision.md) `lp-eto.1`) |
| Many-small-file loops on Mountpoint as if local SSD | Sparse/packed I/O only for pilot; guest cache deferred ([vault-io-pilot-decision.md](./vault-io-pilot-decision.md)) |

## Relationship to backend-runtime-v1

This doc does **not** replace [filesystem-layout.md](../../../contracts/backend-runtime-v1/filesystem-layout.md) or the architecture env list. It states:

1. Daytona **inherits** those platform-owned names.
2. Injection path changes (wake vs systemd); **contract names do not**.
3. Entrypoint / orchestrator helpers are out of band for the agent product API.

Offline skeleton that implements wait-mount + start: **`lp-kng.2.6`** (depends on this doc).

**Skeleton paths (local only, no ECR):**

| Path | Role |
|------|------|
| [`deploy/daytona/agent-gateway/Dockerfile`](../../../deploy/daytona/agent-gateway/Dockerfile) | Bucket A image (`lp-e9l`): linux/amd64, product CLI prebake, optional agent tarball |
| [`deploy/daytona/agent-gateway/entrypoint.sh`](../../../deploy/daytona/agent-gateway/entrypoint.sh) | `lp-b7w`: wait `VAULT_ROOT` (timeout→fail) → refresh Bucket C env file → `exec company-brain-backend gateway` (death → non-zero) |
| [`deploy/daytona/agent-gateway/README.md`](../../../deploy/daytona/agent-gateway/README.md) | Build/smoke notes; entrypoint contract (`lp-b7w`); secrets policy; follow-on `lp-wu1` |
| [`deploy/daytona/agent-gateway/build-local.sh`](../../../deploy/daytona/agent-gateway/build-local.sh) | Local `docker build --platform linux/amd64` proof (no ECR) |
| [`deploy/daytona/agent-gateway/smoke-entrypoint.sh`](../../../deploy/daytona/agent-gateway/smoke-entrypoint.sh) | Bash smoke without Docker |

## Out of scope here

- Exact Mountpoint flags and IAM JSON (→ [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md) / `lp-kng.2.5` draft; live apply Phase 3)
- S3 key tree under prefix (→ `lp-kng.2.4`)
- ECR push + Daytona snapshot pin (→ `lp-wu1` / `lp-1wa`; image lives at `deploy/daytona/agent-gateway/` via `lp-e9l`)
- Live secret store paths / SM ARNs (→ provision / human gate later)
- Changing Hermes or Lanyard Agent source to read new names (not required if parity holds)

## Acceptance evidence (`lp-vey`)

- [x] Contract doc in plan: this file under `docs/plans/0008-daytona-agent-sandboxes/`
- [x] Diff table EC2 vs Daytona env: **Diff table: EC2 vs Daytona env** above
- [x] Agent host-agnostic / no Daytona lifecycle knowledge: **Host-agnostic agent (plan §4.3)** above
