# mocklab — operator notes

Lab tenant for Portal + **Lanyard Agent** + vault UX (`https://app.withlanyard.com/mocklab`).

**Product agent path (2026-08):** Lanyard Agent only — same as local monorepo and
platform `main`. Live agent compute is **Daytona** (`runtime_kind=daytona`) with
LA baked into the agent-gateway snapshot (not Hermes on EC2).

| Surface | Product |
|---------|---------|
| Portal SPA / BFF / Relay / CP | Monorepo `portal/` (main) |
| Agent runtime | **Lanyard Agent** (`lanyard-agent` main tarball) |
| Agent host | Daytona sandbox via CP Instance Orchestrator |
| Hermes / hermes-lanyard | **Not product for mocklab** — do not re-pin |

LA pack pin: [`artifacts/daytona-pilot/la-main-pack/PIN.md`](../../../artifacts/daytona-pilot/la-main-pack/PIN.md)  
Bake notes: [`deploy/daytona/agent-gateway/repack-notes.md`](../../daytona/agent-gateway/repack-notes.md)

## Committed Terraform root (non-secret)

| File | Purpose |
|------|---------|
| `main.tf` | Isolation checks + `company-brain-ec2` + `customer-gateway-relay` + optional security observability |
| `variables.tf` | Tenant inputs including optional `backend_runtime_secrets_*` / `backend_model_*` |
| `outputs.tf` | Instance, SSM, relay, isolation, access-wiring outputs |
| `versions.tf` | Terraform ≥1.7, AWS/local providers; optional deploy-role assume |
| `backend.tf.example` | Remote state template — copy to private `backend.tf` (gitignored) |
| `providers.tf.example` | Dual-alias platform+tenant pattern (optional) |
| `terraform.tfvars.example` | Pins + **backend_runtime_secrets_arn** placeholder + multi-provider model defaults |
| `CUTOVER-backend-runtime-secrets.md` | Operator live cutover (API keys **+** OAuth + custom Meta + placeholder policy) |

Live `backend.tf`, `terraform.tfvars`, state, plans, and `.terraform/` stay **out of git** (`deploy/.gitignore`).

```bash
# From this directory (operator machine with AWS credentials):
cp backend.tf.example backend.tf          # fill bucket/key (private)
cp terraform.tfvars.example terraform.tfvars  # fill pins + secrets ARN (private)
terraform init
terraform validate
terraform plan
```

Offline monorepo check (no remote backend, no credentials required for validate):

```bash
cd deploy/deployments/mocklab
terraform init -backend=false -input=false
terraform validate
```

### Backend runtime secrets (plan 0002 / lp-645)

- Document ARN + non-secret model defaults in `terraform.tfvars.example` (includes
  `xai-oauth` / `openai-codex` / `meta` notes — non-secret only).
- Root variables accept private tfvars; **module pass-through** to `company-brain-ec2` is wired (`lp-645.4` / `lp-645.6`).
- Host materialize: `scripts/materialize-backend-secrets.py` (envelope schema under `contracts/backend-runtime-v1`).
- **Live cutover checklist (human-approved only):** [`CUTOVER-backend-runtime-secrets.md`](CUTOVER-backend-runtime-secrets.md)
  — Super Heavy OAuth, Codex OAuth, Meta custom, placeholder policy (`lp-645.8.6`).
- **Lifecycle runbook (create / rotate / revoke / clone):**
  [`docs/runbooks/backend-runtime-secrets.md`](../../../docs/runbooks/backend-runtime-secrets.md)
- **Lanyard Agent multi-provider (product for mocklab):**
  [`docs/architecture/lanyard-agent-multi-provider-secrets.md`](../../../docs/architecture/lanyard-agent-multi-provider-secrets.md)
- **Hermes multi-provider (legacy residual only — not mocklab product):**
  [`docs/architecture/hermes-multi-provider-secrets.md`](../../../docs/architecture/hermes-multi-provider-secrets.md)
- Never commit secret JSON, raw API keys, OAuth tokens, or live production ARNs.

#### Secrets verify (LA / platform)

Offline (from monorepo root, placeholders only):

```bash
python3 scripts/validate-secrets-envelope.py
bash deploy/scripts/smoke-materialize-backend-secrets.sh
# LA envelope example:
#   contracts/backend-runtime-v1/examples/secrets-envelope.lanyard-agent.json
```

Live MockLab agent is **Daytona + LA snapshot**, not `hermes-gateway` on EC2.
Do not restart `hermes-gateway` as the product path.

## Post-bootstrap checklist (product path)

**MockLab product agent = Lanyard Agent on Daytona** (not hermes-lanyard EC2).

| Step | Action | Expect |
|------|--------|--------|
| 1. Portal stack | Deploy BFF / Relay / CP / web from monorepo `main` | LA-era Portal (Agents UI, Brain RPC honesty) |
| 2. LA pack | Pack `lanyard-agent` main; bake agent-gateway image | `bin/company-brain-backend gateway` → LA |
| 3. Snapshot pin | Register Daytona snapshot; pin MockLab instance | `DAYTONA_DEFAULT_SNAPSHOT` / `agent_snapshot_id` real id |
| 4. CP instance | `runtime_kind=daytona`, vault prefix, wake inject | Chat cold wake → LA reply; vault after ensure-mounted |
| 5. Do **not** | Pin or bootstrap Hermes for mocklab | `hermes_artifact_*` stay `UNCONFIGURED` |

```bash
# LA pack pin (operator machine)
cat artifacts/daytona-pilot/la-main-pack/PIN.md
# Bake: deploy/daytona/agent-gateway/repack-notes.md
```

EC2 `company-brain-ec2` remains available for dual-run / other tenants; mocklab
product path does not use Hermes. Template checklist for non-mocklab tenants:
`templates/tenant/INDEX.md`.

## Optional: synthetic vault seed (phase 5 / `cbd-ukg.8`) — **mock/lab only**

client-core bootstrap leaves an empty spine. Demo content is **deploy-only** and **must not** be applied to production customer vaults:

```bash
# From monorepo root (copy to host if needed), after company-brain-bootstrap:
sudo bash scripts/seed-demo-vault.sh
# Default VAULT_ROOT=/opt/company-brain
# Content: artifacts/demo-vault/  (Projects/Legal, Projects/Operations, Knowledge, Acme_Demo)

# Offline check:
bash scripts/smoke-seed-demo-vault.sh
```

- Idempotent; use `--force` only to replace non-demo files.
- Refuses employee-vault-like paths.
- As root, sets `hermes` group RW on the vault (same idea as `ensure-runtime-hardening`).
- Plan: `references/plans/lanyard-hermes-gateway-and-mocklab-vault/phase-5-mock-vault-seed.md`

## MockLab Daytona S3 vault seed (`lp-zuh.9.5`) — **lab only**

After durable Mountpoint at `/mnt/vault` (`lp-zuh.9.4`), seed skills / AGENTS /
default Workspace project under the tenant S3 prefix so Vault UI + chat are not empty:

```bash
# Offline smoke (no AWS):
bash scripts/smoke-seed-mocklab-s3-vault.sh

# Live MockLab lab prefix (default tenant from lp-zuh.9.4 proof):
AWS_PROFILE=lanyard-main bash scripts/seed-mocklab-s3-vault.sh --use-mocklab-default

# Or explicit:
AWS_PROFILE=lanyard-main bash scripts/seed-mocklab-s3-vault.sh \
  --s3-uri s3://lanyard-mocklab-vault-123456789012/tenants/<tenant_id>/vault/
```

| Surface | Content |
|---------|---------|
| Gate | vault-root `AGENTS.md` (idempotent skip when present) |
| Skills | `skills/mocklab-research/SKILL.md`, `skills/note-taking/obsidian/` |
| Project path | `Projects/Workspace/` → intended `primary_path` `/mnt/vault/Projects/Workspace` |
| Chat read target | `Projects/Workspace/welcome.md` |
| Workflows root | `workflows/` (definition_roots) |
| Pack | `artifacts/mocklab-vault-seed/` |
| CP fixture | `@lanyard/control-plane` → `mockLabVaultSeedPack()` |

## Default agent project registry (`lp-zuh.10.7`) — **lab only**

Filesystem folders alone do not populate Brain RPC `projects.list`. Product defaults
register **Workspace** into `$BACKEND_HOME/projects.db` with vault `primary_path`
so Directory + chat working-directory stamp bind tools under `/mnt/vault/...`.

| Surface | Value |
|---------|--------|
| Default project | `Workspace` / `workspace` |
| `primary_path` | `/mnt/vault/Projects/Workspace` |
| Entrypoint | `ensure_default_projects` before gateway boot (re-seeds each cold start) |
| Helper | `/usr/local/lib/lanyard/seed-default-projects.py` |
| Operator | `bash deploy/scripts/seed-mocklab-agent-projects.sh` |
| Offline | `bash deploy/scripts/smoke-seed-mocklab-agent-projects.sh` |
| Evidence | `artifacts/daytona-pilot/lp-zuh.10.7-projects/` |

```bash
# Offline smoke (no AWS):
bash deploy/scripts/smoke-seed-mocklab-agent-projects.sh

# On guest (existing sandbox, before next snapshot bake) after vault seed:
BACKEND_HOME=/var/lib/company-brain-backend VAULT_ROOT=/mnt/vault \
  python3 /usr/local/lib/lanyard/seed-default-projects.py
# Or from monorepo tooling if script is copied in:
#   bash deploy/scripts/seed-mocklab-agent-projects.sh --list-only
```

**Working directory:** Portal stamps selected project `primary_path` as chat
`metadata.working_directory` / `project_vault_path`. Select Workspace in Directory
so agent tools run under the vault tree (not bare `/mnt/vault` or ephemeral
`$BACKEND_HOME/workspace`).

## Optional: Hermes projects + RBAC (phase 6 / `cbd-ukg.9`) — **mock/lab only**

Filesystem folders alone do not populate Hermes Directory. Register projects into the gateway runtime DB (**demo only**):

```bash
# On host (root) after vault seed; writes /home/hermes/.hermes/projects.db as user hermes
sudo bash scripts/seed-demo-hermes-projects.sh
# Verify:
sudo bash scripts/seed-demo-hermes-projects.sh --list-only
# Expect: legal → /opt/company-brain/Projects/Legal
#         operations → /opt/company-brain/Projects/Operations
```

**RBAC (MVP):** demo admin uses `hermes_profile=admin` with full vault (`path_prefixes` `/` or existing admin full access). Host profiles (`admin` / `contributor`) come from bootstrap; path prefixes are control-plane memberships — **not** edited from this deploy repo (no CP tokens in git). Optional contributor slice (`path_prefixes` `/Projects/Operations` ± `/Knowledge`) is documented in the phase-6 plan for operator-only CP update.

- Plan: `references/plans/lanyard-hermes-gateway-and-mocklab-vault/phase-6-projects-rbac.md`
- Profiles doctrine: `references/hermes-profile-rbac.md`

## Chat smoke formal close (`lp-t7q.5` / migrated `cbd-mta.8.8.1`)

Portal login + Hermes chat stream on this tenant is **formally closed** with a dated
sanitized pass (2026-07-26). Pack:

- **[`CHAT-SMOKE-CLOSE.md`](./CHAT-SMOKE-CLOSE.md)** — login OK, chat stream OK, host
  Hermes path (SSM logs sanitized), residual host panes **linked not claimed done**
- Offline guard: `bash deploy/scripts/smoke-mocklab-chat-smoke-close.sh`
- Post-proof note in the pack: later CP scale-to-zero / Hermes host stop can block
  live re-UIQA without invalidating the formal close evidence

Host-backed Directory / Vault / Settings and Omnibox remain **open** under sibling
`lp-t7q.*` beads — do not treat chat pass as pane E2E or G* matrix ready.

## Related

- **New-tenant off-shelf SOE checklist** (kitchen-sink config from live QA):
  [`artifacts/mocklab/live-qa/NEW-TENANT-CHECKLIST.md`](../../../artifacts/mocklab/live-qa/NEW-TENANT-CHECKLIST.md)
  (`lp-zuh.7.8` — required vs optional, failure modes, no secrets)
- **First real (non-MockLab) production tenant:** MockLab is UAT. Operator
  checklist: [`docs/runbooks/provision-prod-tenant.md`](../../../docs/runbooks/provision-prod-tenant.md)
  (`lp-oop.37.9`)
- **Short-stack harness deploy (`lp-oop.30`):** another Fargate task on existing `lanyard-platform-staging-portal-cp` (or lab compose). Guest/Relay stays default. No new AWS product. Runbook: [`references/runbooks/mocklab-short-stack-harness.md`](../../references/runbooks/mocklab-short-stack-harness.md)
- **Product path (mocklab):** LA + Daytona — see product table above; `artifacts/daytona-pilot/la-main-pack/PIN.md`
- Staging pilot snapshot pin: [`deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml`](../../daytona/agent-gateway/pins/staging-pilot.pins.yaml) (`product_backend: lanyard_agent`)
- Compatibility pins (Hermes residual marked legacy): [`deploy/compatibility/pins.real-releases.yaml`](../../compatibility/pins.real-releases.yaml)
- Backend runtime secrets plan: `docs/plans/0002-backend-runtime-secrets-aws-sm/`
- Backend runtime secrets runbook: [`docs/runbooks/backend-runtime-secrets.md`](../../../docs/runbooks/backend-runtime-secrets.md)
- Multi-provider matrix plan: `docs/plans/0002-backend-runtime-secrets-aws-sm/phase-6-multi-provider-secrets-matrix.md`
- Agent multi-provider (product): [`docs/architecture/lanyard-agent-multi-provider-secrets.md`](../../../docs/architecture/lanyard-agent-multi-provider-secrets.md)
- Hermes multi-provider (legacy residual): [`docs/architecture/hermes-multi-provider-secrets.md`](../../../docs/architecture/hermes-multi-provider-secrets.md)
- Encode for every tenant (phase 7): `references/plans/lanyard-hermes-gateway-and-mocklab-vault/phase-7-encode.md`
- Legacy Hermes EC2 pin / bootstrap (non-mocklab tenants): phase 3 plan + `references/runbooks/pin-update.md`
- Chat smoke formal close (historical Hermes host proof): [`CHAT-SMOKE-CLOSE.md`](./CHAT-SMOKE-CLOSE.md) (`lp-t7q.5`)
- Artifact contract: `artifacts/README.md` (demo-vault is **not** a release pin)
- Offline unit path guard: `bash scripts/smoke-host-runtime-hardening.sh`
- Offline chat-close guard: `bash scripts/smoke-mocklab-chat-smoke-close.sh`
- Generic tenant template: `templates/tenant/` (this root is the live mocklab working tree shape)
