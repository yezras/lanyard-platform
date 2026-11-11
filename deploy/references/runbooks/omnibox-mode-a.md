# Runbook: Omnibox Mode A (operator enable / verify / break-glass)

**Status:** Deploy docs (infra/path ready; default **off** until staging pass)  
**Epic:** `cbd-o9s` (omnibox-hermes-mode-a)  
**Bead:** `cbd-o9s.13` (phase 7 docs)  
**Plan:** `references/plans/omnibox-hermes-mode-a/`  
**Spike decision (locked):** `references/runbooks/omnibox-mode-a-spike.md` — backend **`bwrap_inrepo`**  
**Scope:** Mode A only — OS-cage Hermes **tool children** (not the long-lived gateway). **No Mode B / Omnigent server.**

---

## What Mode A is

Company Brain already hardens the **gateway process** (user `hermes`, systemd sandbox, profile RBAC, tool allowlists). Mode A adds an **OS cage** around host-impacting agent tools (especially admin `shell_exec`) so that:

1. Gateway secrets (e.g. `/home/hermes/.hermes/.env`) are not readable inside the sandbox.
2. Network is default-deny (`bwrap --unshare-net` until selective egress render lands).
3. Only policy-granted paths (vault / workspace) are writable.

| Layer | Protects | Mechanism |
|-------|----------|-----------|
| systemd unit | Long-lived `hermes-gateway` | `User=hermes`, ProtectSystem, NoNewPrivileges, … |
| Hermes profiles + tool allowlists | Which tools a session may call | `scripts/hermes-profiles/`, `scripts/tool-allowlists/` |
| **Omnibox Mode A** | Tool **child** FS / net / env | `run-under-omnibox` → bubblewrap + policy YAML |

**Does not claim:** microVM isolation, production pen-test pass, or production default-on for new tenants. Shared-kernel residual risk is explicit below and in `references/threat-model-private-by-default.md`.

---

## Components (this repo)

| Path | Role |
|------|------|
| `scripts/omnibox/{admin,contributor}.yaml` | Declarative OmniboxPolicy seeds |
| `scripts/omnibox/run-under-omnibox.sh` | Wrapper CLI (source) |
| `scripts/omnibox/README.md` | Profile → policy mapping |
| `scripts/ensure-omnibox.sh` | Idempotent host install (`--dry-run` / `--require`) |
| `scripts/smoke-omnibox.sh` | Offline CI smoke |
| `modules/company-brain-ec2` `enable_omnibox` | Terraform flag (default **false**) |
| `modules/company-brain-ec2/systemd/hermes-gateway.service.d/omnibox.conf` | Gateway env: `OMNIBOX_*` |
| Host: `/etc/company-brain/omnibox/` | Installed policies |
| Host: `/usr/local/sbin/run-under-omnibox` | Installed wrapper (`OMNIBOX_WRAPPER`) |
| Host: `/var/lib/company-brain/omnibox/workspaces/{admin,contributor}/` | Scratch workspaces |
| Host: `/etc/company-brain/omnibox.env` | Live `OMNIBOX_ENABLED` override (EnvironmentFile) |

Hermes product pre-exec hook (when `OMNIBOX_ENABLED=1`, wrap `shell_exec` / similar): planned contract at `references/omnibox-mode-a-hermes-hook.md` (owned by phase 5 / `cbd-o9s.11` — do not invent product code here).

---

## Profile → policy

| Hermes profile | Omnibox policy | Vault FS grant shape | Shell expectation |
|----------------|----------------|----------------------|-------------------|
| `admin` | `/etc/company-brain/omnibox/admin.yaml` | Full `/opt/company-brain` RW (+ optional `--path-prefix` narrow) | `shell_exec` allowed by tool allowlist; runs under Omnibox when enabled |
| `contributor` | `/etc/company-brain/omnibox/contributor.yaml` | Vault only via `--path-prefix` (`path_prefixes_only`); no full vault | `shell_exec` **denied** by tool allowlist; Omnibox still stricter if any host tool path runs |

Both policies **never_grant** gateway secrets and credential stores (including `/home/hermes/.hermes/.env`). Network: `default: deny`, `unshare_net: true` (baseline). Credential env prefixes (`GATEWAY_*`, `AWS_*`, …) are scrubbed before `exec`.

See also: `references/hermes-profile-rbac.md`, `scripts/omnibox/README.md`.

---

## Enable (lab / staging)

Default is **off**. Do not set `enable_omnibox=true` for production tenants until phase 9 staging validation (`references/plans/omnibox-hermes-mode-a/phase-9-staging.md`) and operator sign-off.

### Terraform (preferred)

In tenant `terraform.tfvars` (never commit live values):

```hcl
enable_omnibox = true   # lab/staging only until phase 9
```

Then apply, SSM to the host, and ensure bootstrap has run:

```bash
sudo /usr/local/sbin/company-brain-bootstrap
# When ENABLE_OMNIBOX=1, bootstrap calls ensure-omnibox after profiles.
```

user_data seeds `/etc/company-brain/omnibox.env` and gateway EnvironmentFile from the flag. Gateway **ExecStart stays** `hermes gateway` — Omnibox does not replace the service binary.

### Manual host install (repair / lab without re-apply)

```bash
# From a checkout of company-brain-deploy on the host (or copy scripts/omnibox + ensure)
sudo ENABLE_OMNIBOX=1 bash scripts/ensure-omnibox.sh --require

# Confirm layout
ls -la /etc/company-brain/omnibox/
ls -la /usr/local/sbin/run-under-omnibox
ls -la /var/lib/company-brain/omnibox/workspaces/

# Turn feature on for the gateway process
printf 'OMNIBOX_ENABLED=1\nOMNIBOX_CONFIG_DIR=/etc/company-brain/omnibox\nOMNIBOX_WRAPPER=/usr/local/sbin/run-under-omnibox\n' \
  | sudo tee /etc/company-brain/omnibox.env
sudo systemctl daemon-reload
sudo systemctl restart hermes-gateway
```

### Env contract (gateway)

| Variable | Meaning |
|----------|---------|
| `OMNIBOX_ENABLED` | `0` \| `1` — feature flag for Hermes hook (wrapper does not require it to run manually) |
| `OMNIBOX_CONFIG_DIR` | Policy dir (default `/etc/company-brain/omnibox`) |
| `OMNIBOX_WRAPPER` | Path to wrapper (default `/usr/local/sbin/run-under-omnibox`) |
| `OMNIBOX_POLICY_DIR` | Optional wrapper override for policy directory |
| `OMNIBOX_BWRAP` | Optional path to `bwrap` |

Drop-in defaults (`omnibox.conf`): `OMNIBOX_ENABLED=0` until `omnibox.env` overrides.

---

## Break-glass (disable Omnibox)

Immediate disable without Terraform:

```bash
# 1. Force gateway feature off
printf 'OMNIBOX_ENABLED=0\nOMNIBOX_CONFIG_DIR=/etc/company-brain/omnibox\nOMNIBOX_WRAPPER=/usr/local/sbin/run-under-omnibox\n' \
  | sudo tee /etc/company-brain/omnibox.env

# 2. Reload unit and restart gateway
sudo systemctl daemon-reload
sudo systemctl restart hermes-gateway

# 3. Confirm
systemctl show hermes-gateway -p Environment -p EnvironmentFiles
grep OMNIBOX /etc/company-brain/omnibox.env
# Expect: OMNIBOX_ENABLED=0
```

Optional: leave policies and wrapper installed (harmless when flag is 0). To avoid bootstrap re-enabling on next run, set `enable_omnibox = false` in tfvars and re-apply, or ensure host `ENABLE_OMNIBOX=0` / pins match.

**Break-glass semantics:** With `OMNIBOX_ENABLED=0`, Hermes must not wrap tool children under Omnibox (pre-Omnibox behavior). Profile RBAC and tool allowlists still apply. systemd sandbox on the gateway process is unchanged.

---

## Isolation verify commands

Run on the Company Brain host after ensure. Prefer service user when possible.

### Offline (laptop / CI — no root)

```bash
bash scripts/smoke-omnibox.sh
bash scripts/ensure-omnibox.sh --dry-run
bash scripts/smoke-host-runtime-hardening.sh
bash scripts/smoke-hermes-profiles.sh
```

### Host layout

```bash
command -v bwrap && bwrap --version
test -x /usr/local/sbin/run-under-omnibox
test -f /etc/company-brain/omnibox/admin.yaml
test -f /etc/company-brain/omnibox/contributor.yaml
# Gateway env (flag)
systemctl cat hermes-gateway | grep -E 'OMNIBOX_|ExecStart'
# ExecStart must remain hermes gateway (not Omnigent)
```

### Wrapper CLI (manual isolation)

```bash
# Admin: granted vault/workspace writable; secrets path not readable; net denied
sudo -u hermes /usr/local/sbin/run-under-omnibox --profile admin -- \
  /bin/sh -c 'cat /home/hermes/.hermes/.env; echo secret_rc=$?'
# Expect: non-zero secret_rc (No such file or directory / not readable). Host .env must still exist outside the box.

sudo -u hermes /usr/local/sbin/run-under-omnibox --profile admin -- \
  /bin/sh -c 'echo ok > /var/lib/company-brain/omnibox/workspaces/admin/write-test && cat /var/lib/company-brain/omnibox/workspaces/admin/write-test'
# Expect: ok

sudo -u hermes /usr/local/sbin/run-under-omnibox --profile admin -- \
  /bin/sh -c 'curl -sS --max-time 2 https://example.com; echo curl_rc=$?'
# Expect: non-zero curl_rc (network unreachable / could not resolve) under unshare-net baseline

# Contributor: no full-vault default; shell not expected at Hermes layer.
# --path-prefix must be under the vault grant root (/opt/company-brain):
# use a vault-relative path (joined under the root) or an absolute path under it.
# Absolute /Projects/... is host-root absolute and fails closed before the probe.
sudo -u hermes /usr/local/sbin/run-under-omnibox --profile contributor \
  --path-prefix Projects/Example -- \
  /bin/sh -c 'cat /home/hermes/.hermes/.env; echo secret_rc=$?'
# Expect: secret_rc non-zero (or skip --path-prefix for a workspace-only secret probe)
```

Lab-only path remap (never production):

```bash
OMNIBOX_HOST_ROOT=/tmp/omnibox-lab /usr/local/sbin/run-under-omnibox --profile admin -- /bin/true
```

### Staging isolation table (phase 9 — record results)

| # | Check | Surface | Expected | Result / date |
|---|--------|---------|----------|---------------|
| 1 | Portal chat contributor | Portal web | Success; vault ACL holds | _pending phase 9_ |
| 2 | Portal chat admin | Portal web | Success | _pending phase 9_ |
| 3 | Admin shell cannot read `.env` | Gateway tool / wrapper | Non-zero; no secret content | _pending phase 9_ |
| 4 | Admin blocked egress | Inside Omnibox | curl/non-allowlisted host fails | _pending phase 9_ |
| 5 | Contributor shell | Gateway tool | Denied by tool allowlist | _pending phase 9_ |
| 6 | Break-glass `OMNIBOX_ENABLED=0` | Host env + restart | Pre-Omnibox tool behavior | _pending phase 9_ |
| 7 | Reboot | Host | Gateway + policies healthy | _pending phase 9_ |

Spike lab evidence (Ubuntu aarch64, not AL2023 production AMI): `references/runbooks/omnibox-mode-a-spike.md`.

---

## Residual risk (must read)

| Risk | Status |
|------|--------|
| **Shared kernel** | bubblewrap uses Linux user namespaces / mounts on the **same host kernel** as Hermes and other processes. A kernel privilege-escalation or userns escape can leave the cage. **This is not a microVM, Firecracker, or hardware-isolated sandbox.** |
| Selective L7 egress inside box | Baseline is full net unshare (deny all). Allowlisted model/relay/processor HTTPS is phase 6 (`render-egress-allowlist`); until then tools that need net must fail closed or run outside Omnibox by design. |
| Hermes hook | Deploy ships env + wrapper; product must honor `OMNIBOX_ENABLED` + `OMNIBOX_WRAPPER` for host-impacting tools (phase 5). Without the hook, manual `run-under-omnibox` still works; automatic `shell_exec` cage depends on product. |
| AL2023 / `User=hermes` staging | Spike was lab Ubuntu; phase 9 must re-verify as `hermes` on tenant AMI. |
| Production enable | `enable_omnibox` remains default **false** until staging table passes. |
| Pen-test / production cert | Omnibox does **not** satisfy independent pen-test or production security sign-off by itself. See `references/runbooks/penetration-test-and-signoff.md`, `references/production-security-signoff.md`. |

---

## Explicit non-claims

- Not Mode B (Omnigent session host / multi-device UI).
- Not microVM / E2B / Daytona / Modal.
- Not a substitute for Portal RBAC, relay G2 lifecycle, or account-level isolation.
- Not production-default or production-certified from docs/smokes alone.
- Does not bwrap the long-lived `hermes-gateway` process — only tool children.

---

## Offline smoke / CI

```bash
bash -n scripts/ensure-omnibox.sh
bash -n scripts/omnibox/run-under-omnibox.sh
bash scripts/smoke-omnibox.sh
bash scripts/ensure-omnibox.sh --dry-run
```

---

## Related

- Spike + tool lock: `references/runbooks/omnibox-mode-a-spike.md`
- Hermes hook contract (phase 5): `references/omnibox-mode-a-hermes-hook.md` (planned path)
- Host runtime hardening: `references/runbooks/host-runtime-hardening.md`
- Profile RBAC: `references/hermes-profile-rbac.md`
- Threat model (shared-kernel residual): `references/threat-model-private-by-default.md`
- Multi-phase plan: `references/plans/omnibox-hermes-mode-a/overview.md`
- Controlled egress (VPC-level): `references/runbooks/controlled-egress.md`
- SSM operator access: `references/runbooks/ssm-break-glass.md`
