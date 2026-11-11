# Agent gateway image (Daytona) — production-oriented

**Beads:** `lp-e9l` (Dockerfile / product CLI prebake), `lp-b7w` (entrypoint: wait vault + start gateway), `lp-zuh.9.3` (mount-s3/fuse prebake + snapshot pin), `lp-zuh.10.2` (MemPalace CLI prebake), `lp-zuh.6` (ensure_vault_mount), `lp-oop.21` (tool-only Dockerfile target), `lp-oop.22` (smoke: no lanyard-agent tree), `lp-oop.23` (lab pin artifact, not live MockLab), `lp-vqr0.12` (T8: gateway not gated on post-mount writable)  
**Phase:** 2 image pipeline (`lp-4xa`) · MockLab vault program (`lp-zuh.9`) · kitchen-sink residuals (`lp-zuh.10`)  
**Plan:** [overview §4.3](../../../docs/plans/0008-daytona-agent-sandboxes/overview.md) (agent guest + prebake)  
**Env contract:** [gateway-env-contract.md](../../../docs/plans/0008-daytona-agent-sandboxes/gateway-env-contract.md) (`lp-vey`)  
**CI / ECR:** [agent-gateway-ecr-push.md](../../../docs/plans/0008-daytona-agent-sandboxes/agent-gateway-ecr-push.md) (`lp-wu1`)  
**Snapshot pin:** [agent-snapshot-live-pin.md](../../../docs/plans/0008-daytona-agent-sandboxes/agent-snapshot-live-pin.md) (`lp-1wa`) · bump runbook [agent-snapshot-bump-runbook.md](../../../docs/plans/0008-daytona-agent-sandboxes/agent-snapshot-bump-runbook.md)

## Purpose

**Bucket A** image for on-demand Daytona sandboxes (pilot isolation = **container**):

| Layer | Contents |
|-------|----------|
| Prebake | Product CLIs (git, curl, jq, python3, …) + **mount-s3 1.23.0 + fuse/fusermount** + **mempalace 3.7.0** + agent runtime path |
| Entrypoint (`lp-b7w` / `lp-zuh.6`) | ensure_vault_mount → wait `VAULT_ROOT` → refresh Bucket C env → kitchen-sink seed → `exec` gateway |
| Not in image | Tenant vault data, Relay secrets, provider keys, Daytona org keys |

**No** package installs on boot (plan §4.3). ECR publish is workflow [agent-gateway-image.yml](../../../.github/workflows/agent-gateway-image.yml) (`lp-wu1`).

### Platforms

| Platform | Use |
|----------|-----|
| `linux/amd64` | Daytona container snapshots (default pilot) |
| `linux/arm64` | Fargate / multi-arch product builds (`PLATFORM=linux/arm64`) |

`install-mount-s3.sh` maps `amd64→x86_64` and `arm64→arm64` release paths on `s3.amazonaws.com/mountpoint-s3-release`.  
`install-mempalace.sh` installs a pinned PyPI release into `/opt/mempalace` and links `mempalace` on `PATH` (`/usr/local/bin`).

## Layout

```text
deploy/daytona/agent-gateway/
  Dockerfile              # multi-arch Bucket A image (lp-e9l / lp-zuh.9.3 / lp-zuh.10.2)
                          # stages: toolbox → tool-only (lp-oop.21) → agent-gateway (default)
  entrypoint.sh           # lp-b7w + ensure_vault_mount + kitchen-sink seed; tool-only idle
  install-agent-runtime.sh  # build-time optional tarball extract (agent-gateway only)
  install-mount-s3.sh     # build-time pinned mount-s3 + fuse (lp-zuh.9.3)
  install-mempalace.sh    # build-time pinned MemPalace CLI (lp-zuh.10.2)
  fake-gateway.sh         # stub bin/company-brain-backend for local proof
  agent-release/          # optional drop zone for release *.tar.gz (not committed)
  build-local.sh          # docker build --platform linux/amd64|arm64 + verify
                          # --tool-only → Dockerfile target tool-only
  smoke-entrypoint.sh     # bash smoke without Docker (lp-b7w / lp-zuh.9.3 / lp-zuh.10.2 ACs)
  smoke-no-lanyard-agent-tree.sh  # lp-oop.22: fail-closed if lanyard-agent tree present
  pins/staging-pilot.pins.yaml  # live DAYTONA_DEFAULT_SNAPSHOT pin (do not rewrite for tool-only)
  README.md               # this file
  .dockerignore
```

Lab pin (not live MockLab): [`artifacts/lab/short-stack/tool-only.pins.yaml`](../../../artifacts/lab/short-stack/tool-only.pins.yaml) (`lp-oop.23`).

## Entrypoint contract (`lp-b7w` + mount)

Guest process supervisor only — **no install-on-boot**:

```text
1. ensure_vault_mount (lp-zuh.6 / lp-vqr0.12)
   - already Mountpoint → no-op (writable or pending; pending is not a dead sandbox)
   - else when S3_VAULT_PREFIX + bucket + AWS_* present → mount-s3 (prebaked binary)
   - fail closed when full vault inject present and mount-s3 itself fails; optional only when inject incomplete (`lp-zuh.9.4`)
   - post-mount not-writable does **not** wait or die (T8). Flag: `$BACKEND_HOME/.lanyard-vault-write-state` (`writable` | `pending`)
2. Wait until VAULT_ROOT is a readable directory
   - optional LANYARD_ENTRY_VAULT_READY_FILE marker under the root
   - LANYARD_ENTRY_VAULT_WAIT_SEC timeout (default 60s) → non-zero fail
   - writable is **not** this wait (lp-vqr0.12). File tools wait on `vault_writable`. This does not fix `lp-puzc`.
3. Ensure required parity env is present (wake inject / Bucket C)
4. Refresh $BACKEND_HOME/gateway.env (mode 0600; secret values never logged)
5. Seed kitchen-sink $BACKEND_HOME/config.yaml when missing (lp-qh2 / lp-zuh.4/5)
6. Seed default Workspace into `$BACKEND_HOME/projects.db` with
   `primary_path` under vault (`/mnt/vault/Projects/Workspace`) — **lp-zuh.10.7**
   (before gateway boot so LA `seedDefaultProject` no-ops on non-empty store)
7. exec company-brain-backend gateway in foreground
   - gateway death = container/VM exit status (non-zero if gateway ≠ 0)
   - tini is PID 1 (signal forward / reap); entrypoint replaces itself via exec
```

### Required process env (parity names)

| Variable | Role |
|----------|------|
| `VAULT_ROOT` | Mounted vault path (Bucket B result) |
| `BACKEND_HOME` | Ephemeral runtime home |
| `GATEWAY_RELAY_URL` | Relay WSS |
| `GATEWAY_RELAY_ID` | Permanent instance id |
| `GATEWAY_RELAY_INSTANCE_ID` | Permanent instance id |
| `GATEWAY_RELAY_SECRET` | Long-lived secret (**wake inject only**) |

### Entrypoint helpers (`LANYARD_ENTRY_*` — stripped before gateway exec)

| Variable | Default | Purpose |
|----------|---------|---------|
| `LANYARD_ENTRY_VAULT_WAIT_SEC` | `60` | Fail closed if vault not ready (readable / marker). Not a writable wait. |
| `LANYARD_ENTRY_VAULT_POLL_SEC` | `1` | Poll interval while waiting |
| `LANYARD_ENTRY_VAULT_READY_FILE` | empty | Optional marker under `VAULT_ROOT` |
| `LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC` | `0` | **Not a gateway boot gate** (lp-vqr0.12 / T8). Default is not 1200. A positive live inject is logged and ignored so exec is not delayed. Mountpoint first-write is `lp-puzc`. |
| `LANYARD_ENTRY_GATEWAY_BIN` | `$BACKEND_INSTALL_PATH/bin/company-brain-backend` | Override binary path |
| `LANYARD_ENTRY_ENV_FILE` | `$BACKEND_HOME/gateway.env` | Bucket C env materialization; empty skips write |
| `LANYARD_ENTRY_SANDBOX_ID` | unset | If set, must **not** equal Relay instance id |
| `LANYARD_ENTRY_ALLOW_PACKAGE_INSTALL` | unset | Always forbidden if set to `1` |
| `LANYARD_ENTRY_FORCE_SEED_CONFIG` | unset | When `1`, re-seed kitchen-sink `$BACKEND_HOME/config.yaml` even if present (lab only) |
| `LANYARD_ENTRY_SEED_MCP` | unset | When `1`, merge lab-only `mcp_servers.lab_echo` (lp-zuh.10.6 / lp-zuh.14.3). **Requires** MCP-capable LA pin; default off so older pins never brick wake |
| `LANYARD_ENTRY_SKIP_SEED_PROJECTS` | unset | When `1`, skip default `projects.db` Workspace seed (lp-zuh.10.7) |
| `LANYARD_ENTRY_SEED_PROJECTS_PY` | `/usr/local/lib/lanyard/seed-default-projects.py` | Override path to projects seed helper |
| `LANYARD_ENTRY_VAULT_MOUNT_OPTIONAL` | auto: `0` when prefix+bucket+AWS_* present; else `1` | When `0`, fail closed if Mountpoint cannot be established (`lp-zuh.9.4`) |
| `LANYARD_ENTRY_VAULT_UID` / `_GID` | unset | Optional `--uid` / `--gid` for mount-s3 |
| `S3_VAULT_PREFIX` + `LANYARD_VAULT_BUCKET` | wake inject | Required with `AWS_*` for entrypoint `mount-s3` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | wake inject | Short-lived STS for Mountpoint (never baked) |

### MockLab kitchen-sink agent config (`lp-zuh.4`)

When `$BACKEND_HOME/config.yaml` is missing (or force-seed is set), the entrypoint
writes a **kitchen-sink** LA config so MockLab can exercise every agent-YAML
surface the Zod schema accepts:

| Surface | Seed value |
|---------|------------|
| Inference | Poolside `poolside/laguna-s-2.1` via `POOLSIDE_API_KEY` |
| `tools.catalog_search` | `enabled: true` (builtins + `search_tool` + `use_tool`) |
| `subagents` | `enabled: true`, unlimited concurrent, shared cwd |
| `workflow` | `enabled: true`, budget 128, **`state_dir` / definitions under vault** |
| `cron` | `enabled: true`, **`state_dir` under vault** |
| `mempalace` | `enabled: true`, **`path` under vault** (search-only write policy) |
| `skills.disabled` | `[]` (all discovered skills on) |
| `skills_roots` | `/mnt/vault/skills` |
| `shell_approval` | `mode: off` (lab only — isolated sandbox) |
| `pairing` | `mode: open` |

**Default projects / working directory (`lp-zuh.10.7`):**

| Surface | Value |
|---------|--------|
| Seed helper | `/usr/local/lib/lanyard/seed-default-projects.py` (also `deploy/scripts/seed-mocklab-agent-projects.sh`) |
| Default project | `Workspace` / slug `workspace` |
| `primary_path` | `/mnt/vault/Projects/Workspace` (under vault, not `$BACKEND_HOME/workspace`) |
| Source of truth doc | vault `.seed/default-projects.json` when present (from `lp-zuh.9.5` pack) |
| Chat / tools cwd | Portal stamps selected project `primary_path` as `metadata.working_directory` |
| Offline smoke | `bash deploy/scripts/smoke-seed-mocklab-agent-projects.sh` |

On cold Daytona start, entrypoint writes `$BACKEND_HOME/projects.db` **before** gateway
boot so LA's built-in `seedDefaultProject` (which defaults to ephemeral
`$BACKEND_HOME/workspace`) finds a non-empty store and no-ops. Selecting Workspace
in Directory binds chat tools to the vault tree.

**Durable vs process-local (`lp-zuh.5`):**

| On `VAULT_ROOT` (`/mnt/vault` → S3) | On `BACKEND_HOME` (ephemeral) |
|------------------------------------|-------------------------------|
| skills, workflow state + defs, cron jobs, mempalace, Workspace files | session sqlite, `gateway.env`, logs, **projects.db** (re-seeded each cold start) |

Durable mkdir under `VAULT_ROOT` still needs the agent uid to write (Mountpoint +
scoped AWS creds, or host disk). Gateway **boot** does not wait for that write
(lp-vqr0.12 / T8). An empty root-owned stub still yields `mkdir: permission denied`
on file tools (the `/mnt/vault/workflows` error). That is `vault_writable` /
`lp-puzc`, not a dead sandbox. Product mount path: [spike-3en](../../../docs/plans/0008-daytona-agent-sandboxes/spike-3en-s3-vault-mount.md).

**Not agent YAML by default (platform / residual):**

- **MCP servers (`lp-zuh.10.6` / `lp-zuh.14.3` / `lp-vw3`)** — LA product
  surface lands under `lp-zuh.14.3` (Zod `mcp_servers` + stdio client). Default
  kitchen-sink seed still **omits** MCP so older pins never brick. Path:
  - Lab binary: `/opt/lanyard/lab-mcp/lab_echo_server.py` (secret-free stdio echo)
  - Fragment: `/usr/local/lib/lanyard/kitchen-sink-mcp.fragment.yaml`
  - Optional wake: `LANYARD_ENTRY_SEED_MCP=1` merges fragment after an
    MCP-capable LA pin (otherwise gateway parse fails closed on older pins)
  - Normative path: [mcp-product-surface-mocklab.md](../../../docs/plans/0008-daytona-agent-sandboxes/mcp-product-surface-mocklab.md)
  - Residual: [artifacts/mocklab/live-qa/residuals/mcp/](../../../artifacts/mocklab/live-qa/residuals/mcp/)
- **OnlyOffice** — staging Document Server + BFF `BFF_OFFICE_*` + web
  `VITE_ONLYOFFICE_*` (not `config.yaml`). DS is always-on residual for
  platform-staging separate from SPA build flags. MockLab GO path + residual:
  [onlyoffice-mocklab-go-path.md](../../../docs/plans/0008-daytona-agent-sandboxes/onlyoffice-mocklab-go-path.md),
  [residuals/onlyoffice/](../../../artifacts/mocklab/live-qa/residuals/onlyoffice/)
  (`lp-zuh.10.3`). Lab writeback: `BFF_OFFICE_VAULT_EDIT=true`.
- **MemPalace CLI** — prebaked at image build (`lp-zuh.10.2`, pin **3.7.0** via
  `install-mempalace.sh`). Kitchen-sink config seeds `mempalace.enabled: true` and
  `path: /mnt/vault/mempalace` so guest ready can report `enabled+ok` when the vault
  path exists (no boot-time `pip`/`uv`). Live snapshot re-pin after ECR publish:
  [agent-snapshot-bump-runbook.md](../../../docs/plans/0008-daytona-agent-sandboxes/agent-snapshot-bump-runbook.md).
- **Real S3 vault mount** — image now prebakes `mount-s3` + `fusermount` (`lp-zuh.9.3`).
  Live R/W still needs CP STS wake inject (`lp-zuh.9.2`) + IAM (`lp-zuh.9.1`); proof is
  `lp-zuh.9.4`.

### Acceptance (`lp-b7w`)

- [x] Vault not ready → wait with timeout then fail
- [x] Gateway death exits container/VM process non-zero (`exec` propagates status)
- [x] Entrypoint does **not** package-install product CLIs (plan §4.3 anti-pattern)
- [x] Only writes/refreshes injected gateway env (Bucket C file) then starts gateway
- [x] Documented in this README (+ plan pointers)

Prove offline (no Docker required):

```bash
bash deploy/daytona/agent-gateway/smoke-entrypoint.sh
```

### Acceptance (`lp-vqr0.12` / T8)

- [x] After a successful `mount-s3`, exec proceeds without waiting `LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC`
- [x] Not writable after mount is `pending`, not `die` (sandbox is not dead)
- [x] Default post-mount wait is `0`, not `1200`
- [x] This does **not** claim `lp-puzc` fixed

## Build (local proof)

From monorepo root:

```bash
bash deploy/daytona/agent-gateway/build-local.sh --run-smoke
```

### Tool-only target (`lp-oop.21` / plan 0015 phase 6)

Short-stack guest: git / python3 / jq / mount-s3 / mempalace, **no**
`AGENT_TARBALL` and no `/opt/company-brain-backend/current/lanyard-agent` tree.

| Item | Behavior |
|------|----------|
| Dockerfile target | `tool-only` |
| Default `docker build` (no `--target`) | still `agent-gateway` (LAST stage) |
| `AGENT_TARBALL` / `agent-release/` | **skipped** — not copied, `install-agent-runtime.sh` not run |
| Entrypoint | `LANYARD_IMAGE_KIND=tool-only`: vault wait, then idle (`sleep infinity`). No `GATEWAY_RELAY_*` |
| `DAYTONA_DEFAULT_SNAPSHOT` | **untouched** |
| MockLab `agent_snapshot_id` | **untouched** |
| `pins/staging-pilot.pins.yaml` | **untouched** (live pin stays the full agent-gateway snapshot) |

```bash
bash deploy/daytona/agent-gateway/build-local.sh --tool-only
# optional: --run-smoke (vault wait, then `true`; no Relay env)

docker build --target tool-only --platform linux/amd64 \
  -t lanyard/agent-gateway:tool-only-local \
  -f deploy/daytona/agent-gateway/Dockerfile \
  deploy/daytona/agent-gateway
```

Lab pin artifact (not live MockLab): [`artifacts/lab/short-stack/tool-only.pins.yaml`](../../../artifacts/lab/short-stack/tool-only.pins.yaml)
and [`NOTES.md`](../../../artifacts/lab/short-stack/NOTES.md) (`lp-oop.23`).

### Smoke: no `lanyard-agent` tree (`lp-oop.22`)

Fail-closed check for `/opt/company-brain-backend/current/lanyard-agent`.
Any present tree (directory, file, or symlink) is **non-zero**. Default
mode is an offline fixture proof (no Docker).

```bash
# Offline: dirty fixture → non-zero; clean fixture → 0
bash deploy/daytona/agent-gateway/smoke-no-lanyard-agent-tree.sh

# Filesystem install path (live guest or extracted root)
bash deploy/daytona/agent-gateway/smoke-no-lanyard-agent-tree.sh \
  --root /opt/company-brain-backend/current

# Built image (tool-only must PASS; full agent-gateway bake must FAIL)
bash deploy/daytona/agent-gateway/smoke-no-lanyard-agent-tree.sh \
  --image lanyard/agent-gateway:tool-only-local
```

`build-local.sh --tool-only` runs the `--image` check after the build.

Or raw Docker (default = agent-gateway):

```bash
docker build --platform linux/amd64 \
  -t lanyard/agent-gateway:local \
  -f deploy/daytona/agent-gateway/Dockerfile \
  deploy/daytona/agent-gateway

# arm64 (Fargate / multi-arch)
PLATFORM=linux/arm64 IMAGE_TAG=lanyard/agent-gateway:local-arm64 \
  bash deploy/daytona/agent-gateway/build-local.sh
```

Local proof does not require `docker push`. CI publishes digests when lab variables exist; otherwise build-only + pin template (see `lp-wu1` doc).

### Mount-s3 prebake verification (`lp-zuh.9.3`)

```bash
docker run --rm --platform linux/amd64 --entrypoint /bin/bash lanyard/agent-gateway:local -lc \
  'mount-s3 --version; command -v fusermount'
```

### MemPalace CLI prebake verification (`lp-zuh.10.2`)

```bash
# Offline (no Docker): asserts Dockerfile/install script contract
bash deploy/daytona/agent-gateway/smoke-entrypoint.sh

# Image: mempalace on PATH for root and brain (uid 990)
docker run --rm --platform linux/amd64 --entrypoint /bin/bash lanyard/agent-gateway:local -lc \
  'command -v mempalace; mempalace --version'
docker run --rm --platform linux/amd64 --user 990:990 --entrypoint /bin/bash lanyard/agent-gateway:local -lc \
  'command -v mempalace; mempalace --version'

# Kitchen-sink path remains under vault (search-only write policy in v1)
# mempalace:
#   enabled: true
#   path: /mnt/vault/mempalace
```

Expect `mount-s3 1.23.0`, a path for `fusermount`, and `mempalace` **3.7.0** on PATH
(for both root and brain uid 990). Cold sandboxes must have these without install-on-boot.

### Optional real agent tarball (Lanyard Agent product)

Backend agent source remains external. **Product agent is Lanyard Agent** (not Hermes).

Accepted layouts at image bake (`install-agent-runtime.sh`):

1. **Lanyard Agent product** (`scripts/release-artifact.sh` → `lanyard-agent-*.tar.gz`) — preferred. Installer runs `pnpm install` and writes `bin/company-brain-backend` → `node apps/gateway/dist/main.js`.
2. **backend-runtime-v1** tree with `bin/company-brain-backend` already present.

Steps:

1. Pack from `lanyard-agent` main — see [repack-notes.md](./repack-notes.md) and `artifacts/daytona-pilot/la-main-pack/PIN.md`.
2. Place the `.tar.gz` under `agent-release/` (gitignored), or pass `--build-arg AGENT_TARBALL=name.tar.gz`.
3. Build `linux/amd64` (Node 22 is prebaked in the Dockerfile for LA install).

Without a tarball, the image keeps the **stub** gateway so local build and entrypoint smoke still prove the image contract.

## Entrypoint smoke (no Docker)

```bash
bash deploy/daytona/agent-gateway/smoke-entrypoint.sh
```

Covers: vault timeout, gateway non-zero death propagation, Bucket C env file mode/content, missing env fail-closed, sandbox_id rejection, no package-install.

## Local run smoke (Docker)

```bash
mkdir -p /tmp/vault-smoke
touch /tmp/vault-smoke/.vault-ready

docker run --rm --platform linux/amd64 \
  -e VAULT_ROOT=/mnt/vault \
  -e BACKEND_HOME=/var/lib/company-brain-backend \
  -e GATEWAY_RELAY_URL=wss://relay.example/ws \
  -e GATEWAY_RELAY_ID=inst_local \
  -e GATEWAY_RELAY_INSTANCE_ID=inst_local \
  -e GATEWAY_RELAY_SECRET=local-not-a-real-secret \
  -e LANYARD_ENTRY_VAULT_READY_FILE=.vault-ready \
  -e LANYARD_FAKE_GATEWAY_SLEEP_SEC=0 \
  -v /tmp/vault-smoke:/mnt/vault:ro \
  lanyard/agent-gateway:local
```

Non-zero gateway death (stub):

```bash
docker run --rm --platform linux/amd64 \
  -e VAULT_ROOT=/mnt/vault \
  -e BACKEND_HOME=/var/lib/company-brain-backend \
  -e GATEWAY_RELAY_URL=wss://relay.example/ws \
  -e GATEWAY_RELAY_ID=inst_local \
  -e GATEWAY_RELAY_INSTANCE_ID=inst_local \
  -e GATEWAY_RELAY_SECRET=local-not-a-real-secret \
  -e LANYARD_ENTRY_VAULT_READY_FILE=.vault-ready \
  -e LANYARD_FAKE_GATEWAY_SLEEP_SEC=0 \
  -e LANYARD_FAKE_GATEWAY_EXIT_CODE=42 \
  -v /tmp/vault-smoke:/mnt/vault:ro \
  lanyard/agent-gateway:local
# expect: container exit code 42
```

## Product CLI prebake (Bucket A)

Installed at **image build** time (not entrypoint):

| CLI / runtime | Role |
|---------------|------|
| `git` | Clone / vault skill SCM |
| `curl` + `ca-certificates` | HTTPS |
| `jq` | JSON tooling |
| `python3` | Script / agent helpers (no pip-on-boot) |
| `openssh-client` | git+ssh skills |
| `unzip` / `tar` / `gzip` / `xz-utils` | Archives |
| `bash` / `coreutils` / `findutils` / `procps` | Shell + process basics |
| `tini` | PID 1 |
| `company-brain-backend` | Agent runtime (stub or release tarball) |

Extend the Dockerfile `apt-get install` list when product tools require more host CLIs. **Never** install them from `entrypoint.sh`.

## Secrets policy

| In image? | Material |
|-----------|----------|
| **No** | `GATEWAY_RELAY_SECRET`, provider API keys, tenant vault bytes, Daytona org keys |
| **Yes (paths only)** | Default `VAULT_ROOT`, `BACKEND_HOME`, `BACKEND_INSTALL_PATH` |
| **Wake inject (Bucket C)** | Relay URL/id/secret, mount creds, provider keys as needed |
| **Vault mount (Bucket B)** | Tenant durable files under `s3_vault_prefix` |

Never commit contents of `.env.mocklab-agent-dev` or live secrets into this tree.

## CI → ECR (`lp-wu1`)

| Path | Role |
|------|------|
| [`.github/workflows/agent-gateway-image.yml`](../../../.github/workflows/agent-gateway-image.yml) | Build `linux/amd64`; push digest when lab vars exist |
| [agent-gateway-ecr-push.md](../../../docs/plans/0008-daytona-agent-sandboxes/agent-gateway-ecr-push.md) | Modes, artifact shape, least-privilege IAM, blocked path |

```bash
# Local build proof (no AWS)
bash deploy/daytona/agent-gateway/build-local.sh --run-smoke

# CI: workflow_dispatch with immutable version, or tag agent-gateway-vX.Y.Z
# Requires: AWS_ROLE_ARN (or AGENT_GATEWAY_AWS_ROLE_ARN), AWS_REGION, ECR_NAME_PREFIX
```

When lab credentials are missing, the workflow still **builds** and uploads a pin **template** (no invented digests). Downstream snapshot pin: `lp-1wa`.

## Daytona snapshot pin (`lp-1wa`)

| Path | Role |
|------|------|
| [agent-snapshot-live-pin.md](../../../docs/plans/0008-daytona-agent-sandboxes/agent-snapshot-live-pin.md) | Staging/pilot pin table; blocked path when ECR digest missing |
| [agent-snapshot-bump-runbook.md](../../../docs/plans/0008-daytona-agent-sandboxes/agent-snapshot-bump-runbook.md) | `lp-i7s` version bump: build→push→snapshot→pin→roll-forward/rollback + verification |
| [`create-snapshot-from-digest.sh`](./create-snapshot-from-digest.sh) | Operator: `POST /snapshots` from publish artifact (SM auth; never commit keys) |
| [`pins/staging-pilot.pins.yaml`](./pins/staging-pilot.pins.yaml) | Secret-free pin fragment (`pending:agent-gateway-ecr` until live) |

```bash
# After CI mode=publish artifact exists — load DAYTONA_* from SM (do not echo key):
bash deploy/daytona/agent-gateway/create-snapshot-from-digest.sh \
  --digest-file /path/to/agent-gateway-digests-vX.Y.Z.json \
  --name "lanyard-agent-gateway-vX.Y.Z" \
  --class container \
  --print-pin
```

Pilot isolation class is **container** (pilot OK). Do not invent digests or snapshot ids.

## Acceptance (`lp-e9l` image)

- [x] Dockerfile builds locally (`linux/amd64`) via `build-local.sh`
- [x] Image includes agent runtime path + product CLIs prebaked (not install-on-boot)
- [x] Image runs entrypoint that starts gateway process
- [x] No secrets baked into image
- [x] README + Dockerfile cite plan §4.3
