# Deploy: generic backend systemd service

Bead: `lp-k7g.7.5` (phase 3). Parent epic: `lp-k7g.7`.

This document generalizes the host gateway unit from Hermes-specific
`hermes-gateway.service` assumptions to a **backend-kind-agnostic** unit:

```text
company-brain-backend.service
  ExecStart=…/bin/company-brain-backend gateway
```

`company-brain-deploy` is **imported** under [`deploy/`](../../deploy/) (`lp-k7g.10.1`).
The generic unit and drop-ins live under
[`deploy/modules/company-brain-ec2/systemd/`](../../deploy/modules/company-brain-ec2/systemd/)
alongside the product `hermes-gateway.service` (prefer generic unit in later phase-6 beads).

**Baseline today** (in-tree under `deploy/`):

| Surface | Path |
| --- | --- |
| Unit (product) | `deploy/modules/company-brain-ec2/systemd/hermes-gateway.service` |
| Unit (generic scaffold) | `deploy/modules/company-brain-ec2/systemd/company-brain-backend.service` |
| Sandbox drop-in | `…/hermes-gateway.service.d/sandbox.conf` (and generic service.d) |
| Omnibox drop-in | `…/hermes-gateway.service.d/omnibox.conf` |
| Hardening runbook | `deploy/references/runbooks/host-runtime-hardening.md` |
| Install script | `deploy/scripts/ensure-runtime-hardening.sh` |

Related:

- Install root / `current` symlink: [deploy-bootstrap-backend-install.md](deploy-bootstrap-backend-install.md)
- Runtime home layout: [contracts/backend-runtime-v1/filesystem-layout.md](../../contracts/backend-runtime-v1/filesystem-layout.md)
- Artifact entrypoint contract: [backend-runtime-contract.md](backend-runtime-contract.md)

---

## Goals

1. **Stable entrypoint** — long-lived process is always
   `bin/company-brain-backend gateway` under the active install tree
   (`/opt/company-brain-backend/current/…` after `lp-k7g.7.4`).
2. **Backend-neutral env files** — secret and non-secret `EnvironmentFile=`
   paths are expressed relative to platform names (`BACKEND_HOME`,
   `/etc/company-brain/…`), not Hermes-only homes.
3. **Hermes aliases only as compatibility** — `HERMES_HOME` /
   `HERMES_INSTALL_PATH` may be set **equal** to platform paths for
   Hermes-compatible kinds; they are not the primary contract.
4. **Writable paths match runtime layout** — under
   `ProtectSystem=strict` / `ProtectHome=true`, `ReadWritePaths=` covers
   `BACKEND_HOME` (layout tree), `VAULT_ROOT`, and tmp — not Hermes-private
   install trees as the only home.

---

## Install root vs runtime home (recap)

| Name | Role | Typical path |
| --- | --- | --- |
| `BACKEND_INSTALL_ROOT` | Unpacked product binaries | `/opt/company-brain-backend` |
| `current` | Active version symlink | `/opt/company-brain-backend/current` |
| `BACKEND_HOME` | Runtime state home (`config.yaml`, profiles, sessions, logs, …) | `/var/lib/company-brain-backend` (greenfield) |
| `VAULT_ROOT` | Company-brain vault (client-core seed + live content) | `/opt/company-brain` |

The unit **executes** from the install tree and **writes** under `BACKEND_HOME`
and `VAULT_ROOT`. Do not use the install root as `BACKEND_HOME`.

---

## Unit design

### Identity

| Field | Platform value | Notes |
| --- | --- | --- |
| Unit name | `company-brain-backend.service` | Replaces `hermes-gateway.service` as the public unit |
| Description | Company Brain backend gateway | Kind-agnostic wording |
| `User=` / `Group=` | `company-brain` / `company-brain` | Deploy-owned service account; not shared interactive login |
| `Type=` | `simple` | Long-lived gateway process |
| `SyslogIdentifier=` | `company-brain-backend` | Journal filter name |

**Migration:** existing hosts may keep Unix user `hermes` via a drop-in
(`User=hermes`) until operators re-home state. The **unit name** and
**entrypoint** still move to the generic forms. Optional temporary symlink
or alias unit `hermes-gateway.service` → `company-brain-backend.service` is
allowed during the migration window only (not required by the scaffold).

### ExecStart (normative)

```ini
ExecStart=/opt/company-brain-backend/current/bin/company-brain-backend gateway
```

| Rule | Detail |
| --- | --- |
| Binary | Always the contract entrypoint `bin/company-brain-backend` |
| Subcommand | Always `gateway` |
| Path | Prefer `/opt/company-brain-backend/current/…` so version flips do not require unit edits |
| Kind-private CLIs | Backend products may still ship `bin/hermes` etc.; **systemd must not** call them |

If a tenant forces flat install layout (`BACKEND_INSTALL_LAYOUT=flat`), operators
may override `ExecStart=` via drop-in to the flat prefix; greenfield stays on
the versioned `current` path.

### Environment variables

systemd does **not** expand one `Environment=` value into another. Set
**identical literal paths** for alias pairs (do not write
`HERMES_HOME=$BACKEND_HOME` expecting shell expansion).

#### Platform-owned (always)

| Variable | Example default | Purpose |
| --- | --- | --- |
| `BACKEND_KIND` | `hermes_lanyard` | Product family (`hermes_upstream` \| `hermes_lanyard` \| `lanyard_agent`) |
| `BACKEND_HOME` | `/var/lib/company-brain-backend` | Canonical runtime home (layout contract) |
| `BACKEND_INSTALL_PATH` | `/opt/company-brain-backend/current` | Active install tree (artifact root) |
| `VAULT_ROOT` | `/opt/company-brain` | Vault root (not under `BACKEND_HOME`) |
| `HOME` | `/home/company-brain` | Service account home (distinct from `BACKEND_HOME` when state is under `/var/lib`) |

Optional platform keys (usually from env files, not hard-coded in the unit):
`GATEWAY_RELAY_URL`, `GATEWAY_RELAY_ID`, `GATEWAY_RELAY_SECRET`,
`GATEWAY_RELAY_INSTANCE_ID`, `BRAIN_TENANT_ID`, `BRAIN_RPC_ENABLED`,
`BRAIN_PROFILES_DIR`, `RELAY_CONTRACT_MAJOR`, `BRAIN_RPC_CONTRACT_MAJOR`,
`COMPANY_BRAIN_VAULT_ROOT` (legacy vault alias).

#### Hermes-compatible aliases (only for Hermes kinds)

| Variable | Must equal | When |
| --- | --- | --- |
| `HERMES_HOME` | `BACKEND_HOME` (same absolute path) | `hermes_lanyard` / `hermes_upstream` |
| `HERMES_INSTALL_PATH` | `BACKEND_INSTALL_PATH` (active install tree) | Hermes kinds that still read install path |

For `lanyard_agent`, leave `HERMES_HOME` / `HERMES_INSTALL_PATH` **unset**
unless dual-run tooling needs them; if set, same equality rule as the layout
contract.

### EnvironmentFile paths (backend-neutral)

| File | Required | Purpose |
| --- | --- | --- |
| `$BACKEND_HOME/.env` | Recommended | Operator/service secrets (relay secret, model keys). Mode **0600**, service-user owned |
| `/etc/company-brain/backend.env` | Optional | Non-secret or host-wide platform overrides (kind, vault path, relay URL) |
| `/etc/company-brain/omnibox.env` | Optional (drop-in) | Omnibox Mode A flag (does **not** change `ExecStart`) |

In the unit file the path must be **literal** (no variable expansion):

```ini
EnvironmentFile=-/var/lib/company-brain-backend/.env
EnvironmentFile=-/etc/company-brain/backend.env
```

The leading `-` means “optional if missing” (same as baseline Hermes unit).

**Do not** use Hermes-only paths as the primary env file location:

| Legacy (Hermes baseline) | Generic replacement |
| --- | --- |
| `/home/hermes/.hermes/.env` | `$BACKEND_HOME/.env` → e.g. `/var/lib/company-brain-backend/.env` |
| *(none)* | `/etc/company-brain/backend.env` for platform-wide non-secrets |

Hermes migration hosts that still keep state at `/home/hermes/.hermes` set:

```ini
Environment=BACKEND_HOME=/home/hermes/.hermes
Environment=HERMES_HOME=/home/hermes/.hermes
EnvironmentFile=-/home/hermes/.hermes/.env
```

via a drop-in — that path is then still “`$BACKEND_HOME/.env`”, not a
Hermes-only convention.

### WorkingDirectory

Prefer `WorkingDirectory=` = `BACKEND_HOME` (literal same path) so relative
paths resolve inside the runtime layout. Vault content is addressed only via
`VAULT_ROOT`, not by chdir into the vault.

### Sandbox / least privilege

Preserve the baseline sandbox posture from `hermes-gateway.service`
(`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp`,
`RestrictSUIDSGID`, network allowed for model APIs + relay WSS, empty
capability set, `UMask=0077`).

### ReadWritePaths (layout-aligned)

Under `ProtectSystem=strict` / `ProtectHome=true`, only listed paths are
writable. Map them to the [filesystem layout](../../contracts/backend-runtime-v1/filesystem-layout.md):

| Path | Why writable |
| --- | --- |
| `BACKEND_HOME` | Entire contract tree: `config.yaml`, `projects.db`, `profiles/`, `skills/`, `cron/`, `logs/`, `sessions/`, `workspace/` (+ backend-private siblings such as `.env`) |
| `VAULT_ROOT` | Vault reads/writes via agent tools and Brain RPC |
| `/var/tmp` | Scratch under `PrivateTmp` / shared temp |
| Service `HOME` (if used for SSH keys / XDG) | Only if `HOME` is outside `BACKEND_HOME` |

**Install tree:** prefer **not** granting write to
`/opt/company-brain-backend` (binaries under `current` should stay immutable).
If a Hermes-compatible backend still mutates files next to the install
(baseline granted `/opt/hermes-lanyard`), add that path only via a
**kind-specific drop-in**, not the generic unit.

Secondary vault volume example:

```ini
# /etc/systemd/system/company-brain-backend.service.d/data-volume.conf
[Service]
ReadWritePaths=/var/lib/company-brain-backend /opt/company-brain /home/company-brain /var/tmp /data
Environment=VAULT_ROOT=/data/vault
```

### Restart policy

```ini
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
```

Same as baseline gateway unit.

---

## Drop-ins

| Drop-in | Role |
| --- | --- |
| `company-brain-backend.service.d/sandbox.conf` | Documented override point; mirrors primary sandbox knobs |
| `company-brain-backend.service.d/omnibox.conf` | Omnibox Mode A env only — **never** changes `ExecStart` |
| Tenant/site drop-ins | Extra `ReadWritePaths`, alternate `BACKEND_HOME`, user remaps |

Omnibox remains “cage tool children, not the gateway process” (same Mode A
contract as baseline `omnibox.conf`).

---

## Mapping from `hermes-gateway.service`

| Hermes baseline | Generic unit |
| --- | --- |
| Unit `hermes-gateway.service` | `company-brain-backend.service` |
| `User=hermes` | `User=company-brain` (migration: keep `hermes` via drop-in) |
| `Environment=HERMES_HOME=…` as primary | `BACKEND_HOME=…` primary; `HERMES_HOME` equal alias only |
| `Environment=HERMES_INSTALL_PATH=/opt/hermes-lanyard` | `BACKEND_INSTALL_PATH=/opt/company-brain-backend/current` (+ `HERMES_INSTALL_PATH` alias) |
| `EnvironmentFile=-/home/hermes/.hermes/.env` | `EnvironmentFile=-$BACKEND_HOME/.env` (literal path) |
| `ExecStart=/opt/hermes-lanyard/bin/hermes gateway` | `ExecStart=/opt/company-brain-backend/current/bin/company-brain-backend gateway` |
| `ReadWritePaths=… /opt/hermes-lanyard /home/hermes …` | `ReadWritePaths=` `BACKEND_HOME` + `VAULT_ROOT` + tmp (+ home if needed) |
| `SyslogIdentifier=hermes-gateway` | `SyslogIdentifier=company-brain-backend` |
| Omnibox / sandbox drop-ins under `hermes-gateway.service.d/` | Same pattern under `company-brain-backend.service.d/` |

---

## Bootstrap / hardening merge notes (phase 6)

Implemented in **`lp-k7g.10.4`** after deploy import (`lp-k7g.10.1`):

1. Install the generic unit from
   `deploy/modules/company-brain-ec2/systemd/company-brain-backend.service`.
2. `ensure-runtime-hardening.sh` / `setup.sh` enable **`company-brain-backend`**
   (legacy `hermes-gateway` via `--install-legacy-unit` only).
3. Create service user `company-brain` (or `RUNTIME_USER=hermes` until cutover),
   `mkdir -p` + chown `BACKEND_HOME` layout dirs
   (`profiles`, `skills`, `cron`, `logs`, `sessions`, `workspace`), and own
   backend install root `/opt/company-brain-backend`.
4. Seed secrets into `$BACKEND_HOME/.env` mode 0600.
5. Keep Omnibox drop-in `ExecStart`-neutral.
6. Remove temporary `hermes-gateway` alias only after Portal control-plane and
   runbooks call the new unit name.

---

## Scaffold paths

| Path | Role |
| --- | --- |
| [`deploy/modules/company-brain-ec2/systemd/company-brain-backend.service`](../../deploy/modules/company-brain-ec2/systemd/company-brain-backend.service) | Generic unit |
| [`deploy/modules/company-brain-ec2/systemd/company-brain-backend.service.d/sandbox.conf`](../../deploy/modules/company-brain-ec2/systemd/company-brain-backend.service.d/sandbox.conf) | Sandbox drop-in |
| [`deploy/modules/company-brain-ec2/systemd/company-brain-backend.service.d/omnibox.conf`](../../deploy/modules/company-brain-ec2/systemd/company-brain-backend.service.d/omnibox.conf) | Omnibox Mode A env drop-in |
| [`deploy/docs/backend-systemd-service.md`](../../deploy/docs/backend-systemd-service.md) | Short pointer from `deploy/` |
| [`deploy/scripts/smoke-backend-systemd-unit.sh`](../../deploy/scripts/smoke-backend-systemd-unit.sh) | Offline unit content checks |

---

## Acceptance (lp-k7g.7.5)

| Criterion | Evidence |
| --- | --- |
| Service uses `bin/company-brain-backend gateway` | `ExecStart=…/bin/company-brain-backend gateway` in unit + design § ExecStart |
| Env file paths are backend-neutral | `EnvironmentFile` under `BACKEND_HOME` / `/etc/company-brain/`; no primary Hermes-only path |
| Hermes aliases only as compatibility env vars | `HERMES_HOME` / `HERMES_INSTALL_PATH` set equal to platform paths; documented as aliases |
| Writable paths match runtime layout | `ReadWritePaths` includes `BACKEND_HOME` (+ vault + tmp); install tree not required RW |

---

## Related documents

- [Phase 3 plan](../plans/0001-platform-monorepo-migration/phase-3-artifact-deploy-generalization.md)
- [Bootstrap install paths + provenance](deploy-bootstrap-backend-install.md)
- [Backend runtime contract](backend-runtime-contract.md)
- [Filesystem layout (`BACKEND_HOME`)](../../contracts/backend-runtime-v1/filesystem-layout.md)
- [Deploy Terraform backend_artifact variables](deploy-backend-artifact-variables.md)
