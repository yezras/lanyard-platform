# Host / runtime hardening (Company Brain EC2)

**Issue:** cbd-zzx.15 · **Migration:** lp-k7g.10.4  
**Scope:** Deploy-owned runtime posture on the Company Brain host — unprivileged service user, systemd sandbox, filesystem modes, agent tool allowlists, SELinux notes.  
**Not in scope:** Backend product rewrites, Portal control-plane, customer vault content.

Greenfield unit is **`company-brain-backend.service`** (phase 3 scaffold). Imported
`hermes-gateway.service` remains a migration artifact (`--install-legacy-unit`).

## Goals

| Control | Target |
|---------|--------|
| Service identity | Dedicated Unix user **`company-brain`** (override `RUNTIME_USER`; not shared `ec2-user`) |
| Filesystem | Own **backend install** (`/opt/company-brain-backend`) + **`BACKEND_HOME`** + vault group RW |
| Process sandbox | systemd: `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `RestrictSUIDSGID`, … |
| Secrets | Mode **`0600`**, owned by service user under `$BACKEND_HOME/.env` |
| Agent tools | Allowlist seeds aligned with **admin** / **contributor** profiles |
| SELinux | Documented permissive vs enforcing on AL2023 |

## Components (this repo)

| Path | Role |
|------|------|
| `modules/company-brain-ec2/systemd/company-brain-backend.service` | Primary sandboxed unit (`User=company-brain`) |
| `modules/company-brain-ec2/systemd/company-brain-backend.service.d/sandbox.conf` | Drop-in mirror / override point |
| `modules/company-brain-ec2/systemd/hermes-gateway.service` | Legacy unit (migration; optional install) |
| `modules/company-brain-ec2/setup.sh` | Invokes hardening after post-seed helpers |
| `scripts/ensure-runtime-hardening.sh` | Create user, chown install+`BACKEND_HOME`, secrets 0600, install units, seed allowlists |
| `scripts/tool-allowlists/{admin,contributor}.json` | Agent tool policy seeds |
| `scripts/smoke-host-runtime-hardening.sh` | Offline unit + dry-run checks |
| `scripts/hermes-profiles/` | Capability RBAC seeds (complementary) |
| `scripts/omnibox/` + `scripts/ensure-omnibox.sh` | Mode A Omnibox: cage **tool children** (not gateway ExecStart); default off |
| `modules/company-brain-ec2/systemd/company-brain-backend.service.d/omnibox.conf` | `OMNIBOX_ENABLED` / `OMNIBOX_WRAPPER` / `OMNIBOX_CONFIG_DIR` env |

## Operator sequence

```bash
# 1. Bootstrap artifacts (as today)
sudo /usr/local/sbin/company-brain-bootstrap

# 2. Runtime hardening (from monorepo deploy/ checkout, or copy scripts + systemd/)
sudo bash scripts/ensure-runtime-hardening.sh
# or: modules/company-brain-ec2/setup.sh (calls ensure when present)

# 3. Merge non-secret GATEWAY_RELAY_* + secret into BACKEND_HOME env (0600):
sudo -u company-brain install -m 0600 /dev/null /var/lib/company-brain-backend/.env
sudo -u company-brain $EDITOR /var/lib/company-brain-backend/.env

# 4. Profiles under BACKEND_HOME (HERMES_HOME alias equals BACKEND_HOME for Hermes kinds):
sudo BACKEND_HOME=/var/lib/company-brain-backend \
  HERMES_HOME=/var/lib/company-brain-backend \
  bash scripts/ensure-hermes-profiles.sh --require

# 5. Optional: Omnibox Mode A host install (feature flag; default off)
# sudo ENABLE_OMNIBOX=1 bash scripts/ensure-omnibox.sh
# See references/runbooks/omnibox-mode-a.md — does not replace gateway ExecStart

# 6. Enable gateway when model + relay env are ready
sudo systemctl enable --now company-brain-backend
# or: sudo bash scripts/ensure-runtime-hardening.sh --enable-service
```

### Offline validation

```bash
bash scripts/ensure-runtime-hardening.sh --dry-run
bash scripts/smoke-host-runtime-hardening.sh
bash scripts/smoke-backend-systemd-unit.sh   # unit content / ReadWritePaths contract
bash scripts/smoke-omnibox.sh   # Mode A seeds + ensure dry-run (independent of enable flag)
```

Dry-run validates unit directives and tool allowlist seeds without root and without mutating the host.

## Service user and paths

| Item | Value |
|------|--------|
| User / group | `company-brain` / `company-brain` (override: `RUNTIME_USER`; migration: `hermes`) |
| Service account home | `/home/company-brain` |
| `BACKEND_HOME` | `/var/lib/company-brain-backend` (canonical runtime state) |
| `BACKEND_INSTALL_PATH` | `/opt/company-brain-backend/current` (active install; owned, not RW in unit) |
| `BACKEND_INSTALL_ROOT` | `/opt/company-brain-backend` |
| Hermes aliases | `HERMES_HOME=$BACKEND_HOME`, `HERMES_INSTALL_PATH=$BACKEND_INSTALL_PATH` (same literals) |
| Vault | `/opt/company-brain` (group `company-brain` RW; not world-accessible) |
| Secrets | `$BACKEND_HOME/.env` mode **0600** |
| Tool allowlists | `/etc/company-brain/tool-allowlists/` (+ mirror under `BACKEND_HOME`) |
| Profiles | `$BACKEND_HOME/profiles/{admin,contributor}.json` |

**Do not** run the long-lived gateway as `root` or as a shared interactive login (`ec2-user`) when avoidable. Operators may still use SSM as `ec2-user` / `ssm-user` for break-glass; the **service** stays `company-brain` (or `hermes` via migration drop-in).

### Secondary data volume

If vault lives on `/data`:

```ini
# /etc/systemd/system/company-brain-backend.service.d/data-volume.conf
[Service]
ReadWritePaths=/var/lib/company-brain-backend /opt/company-brain /home/company-brain /var/tmp /data
Environment=VAULT_ROOT=/data/vault
```

Then `systemctl daemon-reload && systemctl restart company-brain-backend`.

## systemd sandbox

Primary unit (`company-brain-backend.service`) sets (non-exhaustive):

- `User=company-brain` / `Group=company-brain`
- `NoNewPrivileges=true`
- `ProtectSystem=strict`
- `ProtectHome=true`
- `PrivateTmp=true`
- `PrivateDevices=true`
- `ProtectKernelTunables` / `ProtectKernelModules` / `ProtectControlGroups`
- `RestrictSUIDSGID=true`
- `RestrictRealtime=true`
- `LockPersonality=true`
- `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`
- `CapabilityBoundingSet=` (empty)
- `UMask=0077`
- `ReadWritePaths=` **`BACKEND_HOME`**, vault, service home, `/var/tmp` — **not** the install tree under `/opt/company-brain-backend`

`ExecStart` defaults to:

```text
/opt/company-brain-backend/current/bin/company-brain-backend gateway
```

If a tenant forces flat install layout, override with a drop-in — do not weaken sandbox directives to “make it work.” Design: `docs/architecture/deploy-backend-systemd-service.md` (monorepo) / `docs/backend-systemd-service.md`.

### Verify on host

```bash
systemctl cat company-brain-backend
systemd-analyze security company-brain-backend   # if available
ps -o user,pid,cmd -C company-brain-backend || pgrep -af company-brain-backend
```

Confirm the gateway process user is `company-brain` (or migration `hermes`), not `root`.

## Secrets permission policy

| File | Mode | Owner |
|------|------|--------|
| `/var/lib/company-brain-backend/.env` (`$BACKEND_HOME/.env`) | `0600` | `company-brain:company-brain` |
| Migration `/home/hermes/.hermes/.env` | `0600` | `hermes:hermes` |
| Operator `~/.hermes/.env` (legacy) | `0600` | operator user |

`ensure-runtime-hardening.sh` enforces 0600 on known secret paths. **Never** commit `.env` or relay secrets. Production: prefer SSM parameter fetch into the service env file (see `references/runbooks/relay-secret-lifecycle.md`).

## Agent tool allowlists

Seeds under `scripts/tool-allowlists/` align with profile capabilities:

| Profile | Allow (tools) | Deny (tools) |
|---------|---------------|--------------|
| **admin** | chat, vault_*, shell_exec, system_ops, profile_manage, gateway_config, beads*, model_config, … | (none by default) |
| **contributor** | chat, vault_read, vault_write, vault_search | shell_exec, system_ops, profile_manage, gateway_config, beads_admin, vault_delete, model_config |

These files are **deploy policy hooks**. Hermes product must load them (or equivalent) for enforcement at runtime; this repo seeds and documents the contract so tenants do not invent ad-hoc elevation.

Installed locations:

```text
/etc/company-brain/tool-allowlists/admin.json
/etc/company-brain/tool-allowlists/contributor.json
/var/lib/company-brain-backend/tool-allowlists/   # service-readable mirror under BACKEND_HOME
```

Related capability seeds: `scripts/hermes-profiles/` and `references/hermes-profile-rbac.md`.

## Omnibox Mode A (tool-child cage)

systemd + tool allowlists harden the **gateway process** and **which tools** may run. They do not OS-cage agent-spawned work (admin `shell_exec`, etc.).

**Omnibox Mode A** (optional, default **off**) wraps host-impacting tool **children** under bubblewrap (`bwrap_inrepo`) via `/usr/local/sbin/run-under-omnibox`:

| Control | Value |
|---------|--------|
| Terraform | `enable_omnibox` (default `false`) → user_data / bootstrap `ENABLE_OMNIBOX` |
| Gateway env | `OMNIBOX_ENABLED`, `OMNIBOX_WRAPPER`, `OMNIBOX_CONFIG_DIR` |
| Policies | `/etc/company-brain/omnibox/{admin,contributor}.yaml` |
| Break-glass | Set `OMNIBOX_ENABLED=0` in `/etc/company-brain/omnibox.env`, `daemon-reload`, restart gateway |

**Do not** bwrap the long-lived `company-brain-backend` (or legacy `hermes-gateway`) unit — only tool children. Residual **shared-kernel** risk (not microVM) is documented in `references/runbooks/omnibox-mode-a.md` and `references/threat-model-private-by-default.md`.

Operator enable / isolation verify / break-glass: **`references/runbooks/omnibox-mode-a.md`**. Spike tool lock: `references/runbooks/omnibox-mode-a-spike.md`.

## SELinux (Amazon Linux 2023)

AL2023 images may ship SELinux **disabled**, **permissive**, or **enforcing** depending on AMI hardening.

| Mode | Behavior | Deploy posture |
|------|----------|----------------|
| **disabled** | No MAC checks | Acceptable for early lab; production golden AMI should enable SELinux |
| **permissive** | Log denials, do not block | Good for introducing labeling without outages; review `/var/log/audit/audit.log` |
| **enforcing** | Block denials | Target for hardened golden AMI after policy validation |

### Operator checks

```bash
getenforce 2>/dev/null || echo "SELinux tools not installed"
sestatus 2>/dev/null || true
```

### Practical notes (AL2023)

1. **systemd sandbox first** — the unit directives above provide a strong baseline independent of SELinux.
2. **Enforcing + custom paths** — `/opt/company-brain-backend`, `/var/lib/company-brain-backend`, `/opt/company-brain`, and `/home/company-brain` may need `semanage fcontext` + `restorecon` if a confined domain is used. Out of the box, user-run services often stay in `unconfined_service_t` unless a custom policy module is shipped.
3. **No custom SELinux module in this repo (yet)** — shipping a full policy module is optional follow-on work; document denials rather than `setenforce 0` in production.
4. **Optional booleans** (only if a confined http/proxy domain is introduced later): prefer `semanage boolean -m` over permanent permissive domain. Common network-related booleans are AMI/policy-specific — verify with `getsebool -a` on the target image before documenting a hard dependency.
5. **Golden AMI** — prefer baking SELinux **enforcing** (or permissive with audit shipping) into the golden image (`references/runbooks/golden-ami-supply-chain.md`) so first boot is not a mode flip under production load.

If SELinux blocks the gateway after moving to enforcing:

```bash
# Diagnose (do not leave permissive permanently)
sudo ausearch -m avc -ts recent 2>/dev/null | tail
sudo sealert -a /var/log/audit/audit.log 2>/dev/null | head
# Temporary debug only:
# sudo setenforce 0
```

## Bootstrap vs setup size note

`scripts/bootstrap-host.sh` is **base64gzip-injected** into EC2 user_data (16 KiB limit). Heavy hardening lives in `ensure-runtime-hardening.sh` + `setup.sh` so the inject payload stays under budget. After bootstrap, always run hardening before treating the host as production-ready.

## Smoke / CI

```bash
bash -n scripts/ensure-runtime-hardening.sh
bash scripts/smoke-host-runtime-hardening.sh
bash scripts/smoke-hermes-profiles.sh   # complementary RBAC seeds
bash scripts/smoke-omnibox.sh           # Mode A Omnibox seeds + ensure dry-run
bash scripts/smoke-bootstrap-inject.sh  # ensure user_data size still green
```

## Related

- `references/hermes-profile-rbac.md` — admin/contributor capabilities
- `references/runbooks/omnibox-mode-a.md` — Omnibox Mode A enable / verify / break-glass
- `references/runbooks/omnibox-mode-a-spike.md` — tool choice lock (`bwrap_inrepo`)
- `references/threat-model-private-by-default.md` — shared-kernel residual risk
- `references/runbooks/relay-secret-lifecycle.md` — secret fetch into `.env`
- `references/runbooks/ssm-break-glass.md` — operator access (not service identity)
- `references/runbooks/controlled-egress.md` — network egress posture
- `modules/company-brain-ec2/references/deployment.md` — host lifecycle
