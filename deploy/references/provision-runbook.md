# Provision runbook (semi-auto)

Control plane **registers** relay identity + credentials (lifecycle-first); ops applies Terraform from monorepo **`deploy/`** (imported company-brain-deploy product tree); host bootstrap seeds **client-core** from artifacts (no Core/git clone).

**This document is the `runtime_kind=ec2` path** (always-on company-brain host). For **`runtime_kind=daytona`** (lazy sandbox, no tenant EC2 TF, S3 vault prefix), use the Daytona provision runbook:

→ [`docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md`](../../docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md) (plan §4.11; offline design `lp-kng.2.10`; skip guard `lp-4nf`)

**Second tenant in prod (short stack, non-MockLab):** MockLab is UAT. Do not assemble a paying tenant from session memory.

→ [`docs/runbooks/provision-prod-tenant.md`](../../docs/runbooks/provision-prod-tenant.md) (`lp-oop.37.9`)

### Branch gate (plan §4.11 / `lp-4nf`)

| `runtime_kind` | Use this runbook? | Tenant TF (`templates/tenant` → `company-brain-ec2`) |
|----------------|-------------------|------------------------------------------------------|
| **`ec2`** (default) | **Yes** — §1–§7 below | Apply after CP register; `runtime_kind = "ec2"` in tfvars |
| **`daytona`** | **No** — use Daytona runbook | **Forbidden.** Do not copy/apply tenant template; `var.runtime_kind` validation requires `ec2` (hard plan error); check `daytona_forbids_company_brain_ec2_template` is secondary closed |

Do **not** run §2–§3 below for pure Daytona instances. Offline Daytona track: **no** `terraform apply` for tenant compute and **no** live Daytona create as part of design acceptance.

**Production relay secrets:** use **register → SSM/SM store → rotate → revoke**, not ad-hoc one-time paste as the primary model. Full lifecycle: `references/runbooks/relay-secret-lifecycle.md`.  
**Artifact pins:** `references/runbooks/pin-update.md` + `compatibility/`.  
**Staging secrets inventory (GitHub + AWS + Portal runtime):** `references/runbooks/staging-secrets-checklist.md`.

## 0. Prerequisites

- AWS account for data plane (Lanyard-hosted MVP or customer account role)
- Control plane API reachable (Portal)
- Ability to **create/read SSM SecureString** (or Secrets Manager) for the relay instance secret — **not** sealed into production tfvars/state
- Published **client-core** and **Hermes** artifacts with known SHA-256 — first private GH pins in `compatibility/pins.real-releases.yaml` (`artifacts/README.md`, `references/runbooks/pin-update.md`). Leave Portal-related pins `UNCONFIGURED` until digests exist
- For private GitHub HTTPS pins: host env **`GITHUB_TOKEN` or `GH_TOKEN`** at bootstrap (never commit tokens); prefer `s3://` + instance role when S3 mirror exists
- Pinned `relay_contract_major` for the Hermes relay connector
- Optional platform release landing zone applied (`environments/platform-staging`) so preferred `s3://` pin URLs and Portal ECR repos exist — **Portal digests may still be unpublished** (see `references/readiness-matrix.md`)
- Hardened remote state (`backend.tf.example`: encrypt, lock, no public access) — see `references/runbooks/relay-secret-lifecycle.md` §5

## 1. Control plane — tenant + register (production)

```http
POST /tenants
{ "tenant_slug": "<slug>", "display_name": "<Name>", "hosting_track": "lanyard_hosted" }

# Canonical G2 register (prefer over provision alias)
POST /tenants/:tenant_id/instances/register
→ {
    "instance_id": "...",
    "tenant_id": "...",
    "secret": "...",          // show once at register — store in SSM immediately; never commit
    "relay_tier": "shared",
    "relay_wss_url": "wss://relay.withlanyard.com",
    "relay_close_code_on_revoke": 4401
  }
```

`POST /tenants/:tenant_id/instances/provision` is a **compat alias** of register (same body). New automation should call **register**.

Later lifecycle (not “re-provision forever”):

| Action | Control-plane API | Deploy follow-up |
|--------|-------------------|------------------|
| **Rotate** | `POST /tenants/:id/instances/:instanceId/rotate` | Overwrite same SSM/SM name; host re-fetch; restart gateway |
| **Revoke one** | `POST /tenants/:id/instances/:instanceId/revoke` | Relay internal revoke → expect WS **4401**; delete cloud secret when done |
| **Revoke all / offboard** | `POST /tenants/:id/deprovision` | Same as revoke + TF destroy when contract ends |

Seed default roles **admin** / **contributor** with `hermes_profile` matching those names. Channel rows start as `pending_customer` except portal when relay is healthy.

### 1b. Store relay secret outside Terraform (production)

```bash
aws ssm put-parameter \
  --name "/company-brain/<slug>/gateway-relay-secret" \
  --type SecureString \
  --value '<secret from register>' \
  --overwrite
```

Do **not** set `relay_instance_secret` in production tfvars. Full register/rotate/revoke: `references/runbooks/relay-secret-lifecycle.md`.

## 2. Monorepo `deploy/` — Terraform

**Skip this entire section** when `runtime_kind=daytona` (see branch gate above / `lp-4nf`).

Work from the monorepo root (or `cd deploy` and use paths relative to the product tree).

```bash
# From monorepo root:
cp -a deploy/templates/tenant deploy/deployments/<tenant_slug>
cd deploy/deployments/<tenant_slug>
cp terraform.tfvars.example terraform.tfvars   # fill; do not commit
# runtime_kind must remain "ec2" (daytona fails closed on this template)
# set relay_wss_url + relay_instance_id from provision
# set relay_secret_source=ssm and relay_secret_ssm_parameter_name (not the secret value)
# set client_core_artifact_* and hermes_artifact_* (or backend_artifact_*) pins
# configure backend.tf from backend.tf.example (encrypt + lock)
terraform init
terraform plan
terraform apply
```

Module sources are **relative** inside `deploy/` (`../../modules/…` from `templates/tenant`
and `environments/platform-staging`). Do not use floating branch refs. Out-of-tree consumers
should pin `//deploy/modules/…` on the monorepo git URL.

Production defaults: `deployment_mode=production`, `relay_secret_source=ssm`, `write_hermes_env_file=false`. Instance role policy `portal_relay_secret_read` allows GetParameter on the named secret.

## 3. Host bootstrap

user_data installs the monorepo canonical script (`deploy/scripts/bootstrap-host.sh`, base64gzip-injected by the tenant template via `${path.module}/../../scripts/bootstrap-host.sh`) as **`/usr/local/sbin/company-brain-bootstrap`** and writes pins to `/etc/company-brain/artifact-pins.env`.

```bash
# Prefer SSM Session Manager (production SSH is off by default):
terraform output -raw ssm_start_session_command
# On host:
sudo /usr/local/sbin/company-brain-bootstrap
# optional packs (self-improve only if SOW):
sudo /usr/local/sbin/company-brain-bootstrap --packs gws,wacli
# or: terraform output -raw bootstrap_command
```

Production access, egress, and AMI: `references/runbooks/ssm-break-glass.md`, `controlled-egress.md`, `golden-ami-supply-chain.md`.

Bootstrap:

1. Load pins from `/etc/company-brain/artifact-pins.env` when present
2. Fail if any artifact pin is unconfigured
3. Download Hermes with instance role → verify SHA-256 → install **`/opt/hermes-lanyard`** (pin **hermes-lanyard** only — never raw Nous for customer hosts; see `references/runbooks/pin-update.md` § Customer host Hermes pin)
4. Download client-core → verify SHA-256 → extract **`/opt/company-brain` only if no `AGENTS.md`**
5. Write provenance under `.seed/`
6. Optional: `scripts/setup-local.sh` and packs from the seed
7. Runtime hardening: `sudo bash scripts/ensure-runtime-hardening.sh` (or `modules/company-brain-ec2/setup.sh`) — creates unprivileged **`hermes`** user, installs sandboxed `hermes-gateway.service`, secrets **0600**, tool allowlists (`references/runbooks/host-runtime-hardening.md`)
8. Operator merges **non-secret** `GATEWAY_RELAY_*` from `terraform output hermes_relay_env_public` into `/home/hermes/.hermes/.env` (preferred) or `~/.hermes/.env`
9. On host, fetch secret with instance role (`terraform output -raw host_secret_fetch_command`) and set `GATEWAY_RELAY_SECRET` **only on the host** (mode 600). Never copy secrets from Terraform state/tfvars in production.
10. Confirm Hermes profiles **admin** and **contributor** (`/home/hermes/.hermes/profiles/*.json` or operator home); repair with `HERMES_HOME=… scripts/ensure-hermes-profiles.sh --require`
11. `bd init --stealth` under vault if not present (git-free)
12. `sudo systemctl enable --now hermes-gateway` (or restart if already running) — unit **`hermes-gateway`** → **`/opt/hermes-lanyard/bin/hermes gateway`** (one binary family; no second gateway process)

**Post-bootstrap checklist (every tenant):** pins (hermes-lanyard) → bootstrap → relay env + secret → `systemctl enable --now hermes-gateway`. Optional **lab/mock only:** `scripts/seed-demo-vault.sh` + `scripts/seed-demo-hermes-projects.sh` — never on production customer vaults.

## 4. Portal smoke

1. Open `https://app.withlanyard.com/<tenant_slug>`
2. Sign in as tenant admin
3. Send “hello brain”
4. Confirm streaming reply

## 5. Channels

For each of Slack / Teams / Email / WhatsApp: collect credentials → Hermes gateway setup → set channel_status `configured`. Leave `pending_customer` until then.

## 6. Revoke / deprovision (lifecycle)

Prefer explicit lifecycle APIs; do not treat “paste a new secret forever” as production.

**Per-instance revoke:**

```http
POST /tenants/:id/instances/:instanceId/revoke
# Then product relay kill-switch when available:
POST {RELAY_URL}/internal/instances/{instance_id}/revoke
```

**Tenant offboard (all instances):**

```http
POST /tenants/:id/deprovision
```

Expect gateway WS close **4401**. Delete/disable SSM parameter or Secrets Manager secret. Disable path access. Retain EBS per retention policy; destroy TF when contract ends. See `references/runbooks/relay-secret-lifecycle.md` §3.

## 7. Validation (operator laptop)

```bash
bash -n scripts/bootstrap-host.sh
bash -n scripts/ensure-runtime-hardening.sh
bash -n scripts/smoke-bootstrap-extract.sh
bash -n scripts/smoke-bootstrap-inject.sh
bash -n scripts/smoke-host-runtime-hardening.sh
bash -n scripts/validate-compatibility.sh
bash -n scripts/smoke-product-artifact-iam.sh
bash -n scripts/verify-product-artifact-staging.sh
bash scripts/smoke-bootstrap-extract.sh
bash scripts/smoke-bootstrap-inject.sh
bash scripts/smoke-host-runtime-hardening.sh
bash scripts/validate-compatibility.sh
bash scripts/smoke-product-artifact-iam.sh
terraform fmt -check -recursive
for d in \
  modules/company-brain-ec2 \
  modules/customer-gateway-relay \
  modules/tier3-dedicated-relay \
  modules/product-artifact-infra \
  templates/tenant \
  environments/platform-staging
do
  (cd "$d" && terraform init -backend=false -input=false && terraform validate)
done
```

## Related runbooks

- `docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md` (**daytona branch:** CP register + S3 prefix; no tenant EC2 TF; lazy sandbox — offline design `lp-kng.2.10`)
- `docs/runbooks/provision-prod-tenant.md` (**second tenant in prod:** shared platform + Daytona; MockLab is UAT — `lp-oop.37.9`)
- `references/runbooks/relay-secret-lifecycle.md` (**production:** register/rotate/revoke + SSM/SM; lab inline labeled non-prod)
- `references/runbooks/pin-update.md` (compatibility pins after product publish; private pin path)
- `references/runbooks/product-artifact-staging-apply.md` (Phase 2 S3/ECR/OIDC staging apply; account gate + verify script)
- `references/runbooks/upgrade-rollback.md`
- `references/runbooks/dlm-restore-drill.md`
- `references/runbooks/track-a-b-e2e.md`
- `references/runbooks/production-security-gate.md` (G1/G2 fail-closed)
- `references/migration-phases.md` (Phase 2 = release foundation; Portal compute / RDS = later)
- `references/readiness-matrix.md` (exact product publish + security gates)
- `references/product-artifact-release-contract.md`
- `references/brain-rpc-contract.md` (G3.1 Portal↔Hermes customer-host RPC; vault/settings/projects wait on G3.2/G3.3)
