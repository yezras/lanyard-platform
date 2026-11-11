# company-brain-deploy

Private **canonical client deployment** repository for Lanyard Company Brain.

Employee vault content and reusable brain architecture live in Core. **This repo owns everything required to provision and operate customer data-plane hosts** without depending on Core at deploy time. Historical assets migrated from Core `infra/`; deploy paths must not require Core.

## Layout

| Path | Purpose |
|------|---------|
| `modules/company-brain-ec2/` | Hermes host: EC2, encrypted EBS, DLM snapshots (opt-in cross-region copy / DR-account share, default off), status alarm, optional host log shipping/SSM IAM, optional Tailscale secondary access, artifact-aware user_data |
| `modules/customer-gateway-relay/` | Wire `GATEWAY_RELAY_*` from control-plane provision (egress-only WSS); production secrets via SSM/SM refs only |
| `modules/tier3-dedicated-relay/` | Tier 3 dedicated relay: public ALB + private Fargate (compose portal-relay-service), per-tenant hostname/WSS, optional DNS/WAF; **infra_ready**, not auto-applied / not production-certified |
| `modules/product-artifact-infra/` | Phase 2: private S3 artifact bucket (hermes/ + client-core/ + portal-web/, versioning + Object Lock), Portal ECR (immutable tags), optional GHA OIDC publisher roles |
| `modules/chat-corpus-infra/` | L10 chat corpus: dedicated private S3 (tenants/{tid}/chat-corpus/v1/), SSE/KMS, lifecycle TTL, writer Put + reader export IAM, Deny vault paths (`lp-gkh.3`) |
| `modules/sandbox-vault-mount-iam/` | Daytona sandbox vault Mountpoint: shared base role + CP task AssumeRole + per-tenant session policy template (`lp-zuh.9.1`); no long-lived keys |
| `modules/harness-exec-iam/` | Shared Fargate harness ECS **exec** role: `GetSecretValue` on `harness-service-token`, `harness-litellm`, `daytona` (`lp-oop.38.20`); not auto-applied |
| `deployments/lab-sandbox-vault-mount-iam/` | Lab apply root for sandbox-vault-mount-iam against mocklab vault bucket (`lp-zuh.9.1`) |
| `modules/control-plane-rds/` | G4.3: private encrypted RDS Postgres for control plane; Secrets Manager `CONTROL_PLANE_DATABASE_URL`; **infra_ready**, not auto-applied |
| `modules/platform-vpc/` | P0: two-AZ public/private platform VPC for Portal compute; NAT and/or VPC endpoints (ECR/Logs/SM/SSM/S3); **infra_ready**, not auto-applied |
| `modules/portal-static-edge/` | G8.1: CloudFront OAC + private S3; optional BFF origin with **dual** ordered behaviors `/*/api/*` (path-first) + bare `/api/*` (apex public discovery); path-first SPA; **infra_ready**, not auto-applied |
| `modules/portal-valkey/` | P1 shared state: private encrypted ElastiCache Valkey; Secrets Manager `REDIS_URL` (TLS); BFF/relay consume via `secrets` map (`redis_url_secret_arn`); **infra_ready**, not production certified; G5/G6 still blocked |
| `modules/portal-dns-tls/` | Portal DNS/TLS: Route53 aliases + ACM (us-east-1 CloudFront cert, regional BFF/relay certs); consume existing zone/certs; **infra_ready**, not auto-applied |
| `modules/portal-waf/` | Portal WAF: WAFv2 WebACL for CloudFront (us-east-1) + regional public BFF/relay ALBs; CommonRuleSet + KnownBadInputs + optional rate-based; **infra_ready**, not auto-applied |
| `modules/customer-account-access/` | Track B: customer-account assume-role + ExternalId + artifact read scope; **infra_ready**, not auto-applied |
| `modules/account-factory/` | Track A: Lanyard-hosted account-per-tenant factory **contract** (CT/AFT request, SCP JSON, optional in-account baseline); **infra_ready**, not auto-applied; no live Organizations API |
| `modules/portal-bff-service/` | G8.2: public BFF ALB + Fargate; image **digest** pin; `/health`; `REDIS_URL` via secrets map; desired_count=1 until G5 |
| `modules/portal-relay-service/` | G8.2: public relay ALB + Fargate; digest pin; `/health`; `REDIS_URL` via secrets map (bus/jti/leases); desired_count=1 until G6 |
| `modules/portal-control-plane-service/` | G8.2: **internal** ALB + Fargate only (G1); digest pin; `/health`; never public |
| `modules/security-observability/` | Tenant-scoped VPC Flow Logs, security SNS, GuardDuty findings→SNS bridge; snapshot-age SNS/tag interface |
| `templates/tenant/` | Copy to `deployments/<tenant_slug>/` for a new brain; optional provider assume_role (`deploy_role_arn` / ExternalId), Track A/B backend notes, artifact cross-account modes |
| `environments/platform-staging/` | Composed platform root: VPC + artifacts + RDS + BFF/relay/CP + static edge (+ optional Valkey + DNS/TLS); end-to-end SG/secret/pin/CP URL wiring; **infra_ready**, examples only — not production-applied |
| `environments/platform-staging/` | Platform staging compose root: VPC + artifacts + RDS + BFF/relay/CP + static edge (+ optional Valkey); **infra_ready**, examples only |
| `templates/tenant/` | Copy to `deployments/<tenant_slug>/` for a new brain |
| `environments/platform-staging/` | Platform staging compose root: VPC + artifacts + RDS + BFF/relay/CP + static edge (+ optional Valkey); end-to-end SG/secret/pin/CP URL wiring; **infra_ready**, examples only |
| `environments/platform-staging/` | Platform staging compose root: VPC + artifacts + RDS + BFF/relay/CP + static edge (+ optional Valkey + DNS/TLS + WAF); **infra_ready**, examples only |
| `deployments/_example-tenant/` | Documentation-only example (placeholders; no live state) |
| `dev/lab-shared-compose-ds/` | Lab-only ONLYOFFICE Document Server Compose (`lab-shared-compose-ds`, lp-5q6.25); JWT; fixture data only — **not** production TF |
| `dev/mocklab-short-stack-harness/` | Lab-only short-stack harness compose / host runner (`lp-oop.30`); optional Fargate example on **existing** CP cluster — **not** a new AWS product |
| `dev/localhost-muse-spark/` | Local Muse Spark via `createEnvLiteLlmTurnRunner` (`lp-k5c4.17`); `LITELLM_BASE_URL=https://api.meta.ai` (no `/v1`); not a Portal BFF gateway |
| `modules/staging-document-server/` | Staging shared ONLYOFFICE Document Server (`staging-platform-shared-ds`, lp-5q6.34); public Docs ALB + Fargate; SM JWT; **infra_ready**, not auto-applied |
| `scripts/smoke-lab-onlyoffice-compose.sh` | Offline smoke for lab Document Server compose/runbook (+ optional `LIVE=1` api.js) |
| `scripts/smoke-mocklab-short-stack-harness.sh` | Offline smoke for MockLab short-stack harness runbook + lab compose (`lp-oop.30`; no AWS apply) |
| `scripts/smoke-harness-exec-iam.sh` | Offline smoke: harness exec GetSecretValue catalog + task secrets[] + BFF extra ARNs (`lp-oop.38.20`; no AWS apply) |
| `scripts/smoke-mocklab-replace-echo-harness-la.sh` | Offline smoke for echo → LA harness pin + optional LiteLLM runner bind (`lp-oop.37.4`; no AWS apply; live reply still echo) |
| `references/runbooks/mocklab-replace-echo-harness-la.md` | Operator path to replace live echo Fargate with LA `createHarnessTurnServer` (`lp-oop.37.4`; no apply from this bead) |
| `scripts/prove-mocklab-short-stack-no-tool-turn.sh` | Live no-tool turn: BFF → real LA harness (`lp-oop.31`). Relay not on the hop. No AWS apply |
| `scripts/smoke-mocklab-short-stack-no-tool-turn.sh` | Offline smoke for `lp-oop.31` evidence + prove script (no secrets, Relay-zero) |
| `scripts/prove-mocklab-short-stack-no-tool-ui.sh` | Browser no-tool turn on local harness-path BFF (`lp-oop.36`). Screenshots `artifacts/ui/lp-oop.36/`. No AWS apply |
| `scripts/smoke-mocklab-short-stack-no-tool-ui.sh` | Offline smoke for `lp-oop.36` UI prove/runner files |
| `scripts/prove-mocklab-short-stack-harness-ui.sh` | Playwright send/stream/vault-tree on local harness path (`lp-oop.33`). Screenshots `artifacts/ui/lp-oop.33/`. No AWS apply |
| `scripts/smoke-mocklab-short-stack-harness-ui.sh` | Offline smoke for `lp-oop.33` UI prove/runner files |
| `scripts/prove-mocklab-short-stack-invariants.sh` | Script 0015 overview invariants + lab tool exec (`lp-oop.32`); does not flip live snapshot |
| `scripts/smoke-mocklab-short-stack-invariants.sh` | Offline smoke for lp-oop.32 evidence + live-snapshot hold (no AWS) |
| `scripts/prove-mocklab-short-stack-kitchen-sink.sh` | Kitchen-sink re-QA on local harness-path BFF (`lp-oop.34`). Guest path stays default relay. No AWS apply |
| `scripts/smoke-mocklab-short-stack-kitchen-sink.sh` | Offline smoke for `lp-oop.34` kitchen-sink prove/runner files |
| `scripts/smoke-mocklab-short-stack-relay-retire.sh` | Offline smoke for `lp-oop.35` Daytona harness hop has no `deliverInbound`; EC2/guest stay Relay |
| `scripts/archive-unused-daytona-sandboxes.py` | Recurring unused Daytona sandbox archive (`lp-oop.37.7`); dry-run default; keeps CP-bound `sandbox_id` |
| `scripts/smoke-archive-unused-daytona-sandboxes.sh` | Offline smoke for unused-sandbox keep-set + dry-run + `--apply` refuse (no live Daytona) |
| `scripts/smoke-staging-document-server.sh` | Offline smoke for staging Document Server module + platform-staging wiring (lp-5q6.34) |
| `references/runbooks/staging-document-server.md` | Staging DS operator runbook: topology, secrets, reachability, health, rollback |
| `references/runbooks/lab-onlyoffice-document-server.md` | Lab DS operator runbook: resources, ports, env, DS→BFF reachability, teardown |
| `scripts/bootstrap-host.sh` | Canonical bootstrap (artifact download/verify/install); injected onto hosts |
| `litellm/` | Lanyard Agent LiteLLM multi-slot seed (`config.yaml`, `env.secrets.example`) + OAuth/clientside auth docs (lp-645.8.5) |
| `scripts/map-oauth-to-litellm.py` | Offline OAuthStore → LiteLLM model map (no live keys; lp-645.8.5) |
| `scripts/smoke-litellm-multi-slot.sh` | Offline smoke: LiteLLM slots, env placeholders, oauth map, agent envelope |
| `scripts/smoke-localhost-muse-spark-provider.sh` | Offline smoke: Muse Spark LiteLLM contract, no `metaComplete`, no BFF Meta fetch (`lp-k5c4.17`) |
| `scripts/prove-localhost-muse-spark-turn.sh` | One `message_send` via `createEnvLiteLlmTurnRunner`; mock default, `LIVE=1` hits Muse Spark |
| `scripts/seed-demo-vault.sh` | Lab/mocklab synthetic vault seed (deploy-only; `artifacts/demo-vault/`; default `/opt/company-brain`) |
| `scripts/smoke-seed-demo-vault.sh` | Offline smoke: employee-vault refuse, idempotent seed, `--force` restore |
| `scripts/seed-mocklab-s3-vault.sh` | MockLab Daytona S3 vault seed (skills/AGENTS/Projects/workflows/config.yaml; local or `s3://…/vault/`; `lp-zuh.9.5` / `lp-oop.38.18`) |
| `scripts/smoke-seed-mocklab-s3-vault.sh` | Offline smoke for MockLab S3 vault seed (AGENTS.md gate, fill-missing kitchen-sink, force, employee-vault refuse) |
| `scripts/materialize-mocklab-harness-backend-home.sh` | Copy kitchen-sink `config.yaml` + skills/workflows into harness `BACKEND_HOME` (`lp-oop.38.18`) |
| `scripts/check-mocklab-kitchen-sink-config.py` | Prove kitchen-sink flags + non-empty skills/workflows inventory |
| `scripts/smoke-mocklab-harness-backend-home.sh` | Offline proof: harness `BACKEND_HOME` snapshot is not empty; guest has no lanyard-agent tree |
| `scripts/seed-demo-hermes-projects.sh` | Lab/mocklab: register Hermes `legal` + `operations` into `$HERMES_HOME/projects.db` (idempotent; run as root → hermes) |
| `scripts/seed-mocklab-agent-projects.sh` | MockLab LA: seed `$BACKEND_HOME/projects.db` Workspace → `/mnt/vault/Projects/Workspace` (`lp-zuh.10.7`) |
| `scripts/smoke-seed-mocklab-agent-projects.sh` | Offline smoke for MockLab agent projects.db seed |
| `scripts/ensure-hermes-profiles.sh` | Host RBAC: write/verify admin + contributor profile seeds |
| `scripts/ensure-runtime-hardening.sh` | Unprivileged `company-brain` user, own backend install + `BACKEND_HOME`, `company-brain-backend` unit, secrets 0600, tool allowlists |
| `scripts/hermes-profiles/` | Seed templates (`admin.json`, `contributor.json`) for capability boundaries |
| `scripts/tool-allowlists/` | Agent tool allowlist seeds (admin / contributor) |
| `scripts/omnibox/` | Mode A Omnibox: policy seeds + `run-under-omnibox` + argv builder + egress render (bwrap_inrepo; no Omnigent server) |
| `scripts/omnibox/run-under-omnibox.sh` | Wrapper CLI: profile + path_prefix → bubblewrap; install target `/usr/local/sbin/run-under-omnibox` (`OMNIBOX_WRAPPER`) |
| `scripts/omnibox/build-shell-exec-argv.py` | Phase 5: session profile + tool → wrapper argv; `--self-test` (contributor → `--profile contributor`) |
| `scripts/omnibox/render-egress-allowlist.sh` | Phase 6: dry-run-safe runtime egress allowlist under `/etc/company-brain/omnibox/runtime/` |
| `scripts/ensure-omnibox.sh` | Idempotent host install: bubblewrap, policies → `/etc/company-brain/omnibox/`, wrapper, hook registry, argv builder, workspaces; `--dry-run` / `--require`; `ENABLE_OMNIBOX` / `OMNIBOX_REQUIRED` |
| `scripts/smoke-omnibox.sh` | Offline Omnibox smoke: seeds, contributor `.env` never_grant, ensure dry-run, phase-5 argv/profile contract, fail-closed if seeds missing |
| `scripts/smoke-bootstrap-extract.sh` | Local smoke: tar.gz/zip/tar extract via opaque `.artifact` names |
| `scripts/smoke-bootstrap-inject.sh` | Local smoke: base64gzip → user_data → `/usr/local/sbin/company-brain-bootstrap` |
| `scripts/smoke-artifact-attestation.sh` | Offline smoke: Ed25519 accept/reject + REQUIRE_ARTIFACT_ATTESTATION fail-closed |
| `scripts/smoke-hermes-profiles.sh` | Offline smoke: profile seeds + contributor elevation blocked |
| `scripts/smoke-host-runtime-hardening.sh` | Offline smoke: unit sandbox directives + dry-run user/secrets path |
| `scripts/validate-compatibility.sh` | Offline validator for compatibility pin manifests |
| `scripts/validate-production-gates.sh` | Fail-closed honesty check: G1/G2/G3 production security + live proofs residual (`lp-t7q.7`) + isolation docs + sign-off/pen-test honesty (no false ready) |
| `scripts/smoke-readiness-live-proofs-residual.sh` | Offline residual ledger honesty for G1.4/G1a/G2/G3 (pass/fail/blocked); staging harness fail-closed; no ready without evidence (`lp-t7q.7`) |
| `scripts/policy-as-code-security.sh` | Offline policy-as-code: public IP, egress, SSH, URL schemes, IMDS, S3 TLS, secrets defaults, Tier 3 infra_ready honesty, snapshot BPA, DLM DR copy defaults off, **no public control-plane ALB (G1.3)** |
| `scripts/smoke-tier3-dedicated-relay.sh` | Offline smoke: Tier 3 compose portal-relay-service, digest pin, private tasks, optional DNS/WAF, honesty gates |
| `scripts/smoke-dlm-dr-snapshot-copy.sh` | Offline smoke: opt-in DLM cross-region / DR-account share fail-closed defaults + encryption + RPO/RTO docs |
| `scripts/security-acceptance-checklist.sh` | Offline private-by-default acceptance checklist (LOCAL); staging items in security-e2e-acceptance runbook |
| `scripts/smoke-product-artifact-iam.sh` | Offline IAM trust/prefix + Object Lock guardrails for product-artifact-infra |
| `scripts/smoke-chat-corpus-infra.sh` | Offline layout/IAM/lifecycle/vault-deny guardrails for chat-corpus-infra (`lp-gkh.3`) |
| `scripts/smoke-sandbox-vault-mount-iam.sh` | Offline (+ optional live) IAM isolation for sandbox vault mount drafts + TF module (`lp-t86` / `lp-zuh.9.1`) |
| `scripts/verify-product-artifact-staging.sh` | Live post-apply verifier (S3/ECR/OIDC + denied-prefix simulation); env-driven; operator-only |
| `scripts/smoke-control-plane-rds.sh` | Offline smoke: control-plane-rds private posture + Secrets Manager URL contract |
| `scripts/smoke-platform-vpc.sh` | Offline smoke: platform-vpc two-AZ public/private topology, private IP reject, NAT/endpoint egress contract |
| `scripts/smoke-portal-valkey.sh` | Offline smoke: portal-valkey private TLS + at-rest encryption + Secrets Manager REDIS_URL |
| `scripts/smoke-portal-dns-tls.sh` | Offline smoke: portal-dns-tls us-east-1 CloudFront ACM + regional ALB certs + Route53 aliases |
| `scripts/smoke-portal-waf.sh` | Offline smoke: portal-waf CloudFront + regional ALB WebACLs (managed rules + rate-based) |
| `scripts/smoke-customer-account-access.sh` | Offline smoke: Track B ExternalId, no long-lived keys, artifact prefix scope |
| `scripts/smoke-account-factory.sh` | Offline smoke: account-factory request contract, SCP JSON, baseline roles, no org API |
| `scripts/smoke-tenant-template-wiring.sh` | Offline smoke: templates/tenant assume_role / ExternalId / backend / artifact wiring to Track A+B modules |
| `scripts/smoke-portal-compute.sh` | Offline smoke: G8 static edge OAC + BFF/relay/CP digest pins, `/health`, private CP ALB |
| `scripts/smoke-platform-staging-compose.sh` | Offline smoke: platform-staging compose + end-to-end wiring (SGs, ECR pins, secret ARNs, CONTROL_PLANE_URL, outputs, validate) |
| `scripts/smoke-pilot-cost-profile.sh` | Offline smoke: pilot cost-profile defaults (Single-AZ small RDS, optional Valkey/WAF/DNS-TLS off, Valkey 1-node enable-path) |
| `scripts/smoke-controlled-egress.sh` | Offline smoke: controlled egress, SSM-first access, golden AMI contracts |
| `scripts/check-snapshot-age.sh` | Operator: DLM snapshot age check + optional CloudWatch metric for age alarm |
| `scripts/restore-from-snapshot.sh` | Operator: volume/AMI restore from snapshot (dry-run default; SSM-first) |
| `compatibility/` | Pin schema + **placeholder-safe** example + `pins.real-releases.yaml` (first real Hermes/client-core private GH pins; Portal still placeholder) |
| `references/runbooks/portal-bare-api-edge-routing.md` | **lp-b87** ship handoff: dual CF API patterns (`/*/api/*` + bare `/api/*` → BFF); private tfvars apply + CloudFront deploy wait + verify curls; live staging **not** fixed until operator applies |
| `references/runbooks/portal-valkey-g5-enable.md` | G5 Valkey enable path (compose or private root); pilot often off; dual-BFF live proof **deferred** with reason (`lp-t7q.8`); module **infra_ready** ≠ production cert |
| `references/runbooks/readiness-live-proofs-residual.md` | G1.4/G1a/G2/G3 live proof residual ledger (pass/fail/blocked); monorepo smokes never flip ready (`lp-t7q.7` / `cbd-mta.6.*`) |
| `references/runbooks/pin-update.md` | Operator pin update after product publish; private pin validation path; **hermes-lanyard only** on customer hosts (never raw Nous); unit `hermes-gateway` → `/opt/hermes-lanyard/bin/hermes gateway` |
| `references/provision-runbook.md` | Control plane register → Terraform → bootstrap (lifecycle-first) |
| `references/hermes-profile-rbac.md` | Portal roles ↔ Hermes profiles; host enforce path (not docs-only) |
| `references/runbooks/` | Upgrade/rollback, **pin-update**, **product-artifact-staging-apply (Phase 2)**, **portal-compute-staging-apply (G8)**, **platform-staging-compose (composed root apply/rollback)**, **lab-onlyoffice-document-server (lab DS compose, lp-5q6.25)**, **staging-secrets-checklist**, DLM restore (RTO/RPO + quarterly drill), Track A/B E2E, **account-factory (lanyard_hosted CT/AFT)**, **track-b-customer-account-access**, tenant template Track A/B wiring, **relay secret lifecycle (register/rotate/revoke)**, production gate, tenant isolation, **SSM break-glass**, **Tailscale secondary access**, **controlled egress**, **golden AMI**, **security alert triage**, **data-processor onboarding**, **host runtime hardening**, **omnibox Mode A (enable/verify/break-glass)**, **omnibox Mode A spike (tool choice locked: bwrap_inrepo)**, **security E2E LOCAL/STAGING**, **pen-test and sign-off process** |
| `references/runbooks/omnibox-mode-a.md` | Mode A Omnibox operator runbook: enable, isolation verify, `OMNIBOX_ENABLED=0` break-glass; residual shared-kernel risk (not microVM) |
| `references/runbooks/omnibox-mode-a-spike.md` | Mode A Omnibox phase-0 spike: pass/fail isolation table; tool choice `bwrap_inrepo`; no Mode B |
| `references/omnibox-mode-a-hermes-hook.md` | Mode A phase 5: Hermes shell/host-tool hook contract (`OMNIBOX_*` → `run-under-omnibox`); residual product PR |
| `references/plans/omnibox-hermes-mode-a/` | Multi-phase plan for Omnibox Mode A on Company Brain (Hermes tool cage; epic cbd-o9s) |
| `references/runbooks/platform-staging-compose.md` | Composed platform root: backend, secrets, apply, rollback, CI offline gates; **infra_ready** honesty |
| `references/runbooks/mocklab-short-stack-harness.md` | MockLab short-stack harness on existing ECS cluster (`lp-oop.30`); lab compose alternative; no new AWS product |
| `references/runbooks/mocklab-replace-echo-harness-la.md` | Echo → LA `createHarnessTurnServer` on the existing Fargate harness (`lp-oop.37.4`); PR 242 MERGED / live `:3`; real-reply still echo until runner bind |
| `references/runbooks/staging-secrets-checklist.md` | Staging GitHub/AWS/runtime secrets checklist (names only; no live values) |
| `scripts/check-staging-secrets-checklist.sh` | Offline validator for staging secrets checklist presence + wiring |
| `references/threat-model-private-by-default.md` | STRIDE threat model for deploy surface, host, relay, artifacts, multi-tenant isolation, supply chain |
| `references/production-security-signoff.md` | Production security sign-off template — status **NOT SIGNED** until external pen test or written residual-risk acceptance |
| `references/approved-data-processors.md` | Catalog of approved data processors + data categories (models, Portal, email/CRM, S3, AWS APIs) |
| `references/templates/client-data-handling-policy.md` | Per-client egress/retention/DLP/zero-retention policy template |
| `references/security-observability.md` | Tenant vs account observability checklist (VPC Flow Logs / host logs / SNS vs account CloudTrail+GuardDuty) |
| `references/migration-phases.md` | Milestone map; G0 topology freeze; Phase 2 foundation vs gated product/RDS/compute |
| `references/readiness-matrix.md` | Source-of-truth blockers + production security gates (G1/G2/G3 fail-closed); live residual ledger link; links backend kind matrix |
| [`docs/architecture/backend-compatibility-matrix.md`](../docs/architecture/backend-compatibility-matrix.md) | **Backend** compatibility matrix: kind, version, contract majors, capabilities, conformance, deploy readiness (`lp-k7g.11.7`) |
| `references/tenant-isolation-decision.md` | Account/VPC/KMS/logs isolation model for hosting tracks |
| `references/product-artifact-release-contract.md` | S3/ECR/OIDC release contract (Hermes, client-core, portal-web static + Portal backend images) for deploy pins |
| `references/brain-rpc-contract.md` | G3.1 brain RPC authority (methods, auth, errors); G3 matrix still **blocked** until G3.4 staging E2E (handlers + Portal slice in product) |
| `references/deployment-resource-registry.md` | cbd-mta.3.3: central tenant deployment/resource registry + audit boundary (not tfstate; not vault bodies; cites Brain RPC) |
| `artifacts/README.md` | Pin/artifact contract (URL, version, SHA-256, optional Ed25519 attestation) |
| `artifacts/demo-vault/` | Synthetic mocklab vault tree (not a release pin; apply via `seed-demo-vault.sh`) |
| `artifacts/mocklab-vault-seed/` | MockLab Daytona S3 vault seed (AGENTS.md + skills + Projects/Workspace; apply via `seed-mocklab-s3-vault.sh`; `lp-zuh.9.5`) |
| `.github/workflows/ci.yml` | Shell smoke, compatibility, production gates, policy-as-code security, acceptance checklist, terraform fmt/validate |
| `AGENTS.md` | Rules for agents and operators editing this repo |
| `index.yaml` | Machine-readable map of this repository |

## Quick start (new tenant)

```bash
cp -a templates/tenant deployments/<tenant_slug>
cd deployments/<tenant_slug>
cp terraform.tfvars.example terraform.tfvars   # fill placeholders; do not commit
# Set relay_wss_url + relay_instance_id from control-plane register; store secret in SSM (not tfvars)
# Set relay_secret_ssm_parameter_name; see references/runbooks/relay-secret-lifecycle.md (register/rotate/revoke)
# Set artifact URL/version/SHA256 for client-core and Hermes (hermes-lanyard only — never raw Nous)
# (compatibility/pins.real-releases.yaml; references/runbooks/pin-update.md § Customer host Hermes pin)
# Private GitHub HTTPS pins need GITHUB_TOKEN/GH_TOKEN on the host — never commit tokens
# Track A/B: optional deploy_role_arn (+ Track B ExternalId); backend.tf from backend.tf.example
# (account-factory / customer-account-access outputs — references/runbooks/account-factory.md,
#  track-b-customer-account-access.md; offline: bash scripts/smoke-tenant-template-wiring.sh)
terraform init
terraform plan
terraform apply
# Prefer SSM (terraform output -raw ssm_start_session_command), then:
# export GITHUB_TOKEN=…   # only if using private GH release URLs
sudo /usr/local/sbin/company-brain-bootstrap   # installs /opt/hermes-lanyard; or: terraform output -raw bootstrap_command
# On host: fetch GATEWAY_RELAY_SECRET via instance role → /home/hermes/.hermes/.env
# sudo systemctl enable --now hermes-gateway   # ExecStart=/opt/hermes-lanyard/bin/hermes gateway
# Optional mock/lab only: scripts/seed-demo-vault.sh + seed-demo-hermes-projects.sh (not production)
```

Portal path: `https://app.withlanyard.com/<tenant_slug>` (path-based entry).

## Portal production topology gate

G0 freezes the target topology before product or Terraform runtime work:

- `@lanyard/web` is a static artifact served through private S3 + CloudFront OAC, not a required runtime container.
- `/<tenant_slug>/api/*` (path-first) and bare `/api/*` (apex public discovery, e.g. org resolve) both route to the public BFF via CloudFront ordered behaviors; tenant subdomains are legacy compatibility only.
- The control plane stays private and must not attach directly to a public ALB.
- The relay stays separate from the BFF and preserves customer-host outbound WSS.
- Vault/settings/projects production support requires brain RPC on the customer EC2 (contract: `references/brain-rpc-contract.md`; G3 still **blocked** until G3.4 staging E2E).
- Control-plane RDS module is **infra_ready** (`modules/control-plane-rds/`) after product Postgres; **apply** remains operator-owned (not from example tfvars).
- Deployment/resource registry contract is documented (`references/deployment-resource-registry.md`, cbd-mta.3.3); product tables live in Portal CP — not a substitute for live RDS apply or G1 proof.
- Portal Valkey shared-state module is **infra_ready** (`modules/portal-valkey/`) — private SG ingress, TLS + at-rest encryption, Secrets Manager `REDIS_URL`; BFF/relay wire via `secrets["REDIS_URL"].value_from = module.portal_valkey.redis_url_secret_arn` (JSON key `REDIS_URL`); **not** production-certified; G5/G6 remain product/staging gated. Optional on `environments/platform-staging` (`enable_portal_valkey`; default off); apply remains operator-owned.
- Portal compute modules are **infra_ready** (`modules/portal-static-edge`, `portal-bff-service`, `portal-relay-service`, `portal-control-plane-service`) — digest pins, `/health`, private CP ALB, generic SM/SSM secrets (incl. Valkey `REDIS_URL`); **not** production-certified without staging evidence + G1/G2/G7. Staging apply: `references/runbooks/portal-compute-staging-apply.md` and composed-root `references/runbooks/platform-staging-compose.md`. BFF/relay `desired_count` stays 1 until G5/G6.

**Production security (fail-closed):** G1 (private control-plane), G2 (relay credential lifecycle), and G3 (Brain RPC host ops) remain **blocked** until operator-recorded staging proof — product PRs/runbooks/monorepo smokes alone do not clear the matrix. Live pass/fail/blocked ledger: `references/runbooks/readiness-live-proofs-residual.md` (`lp-t7q.7`). Customer-gateway-relay is **wiring only** — not production relay security. Staging harness links: `references/readiness-matrix.md` § Staging proof harness; operator procedures: `references/runbooks/security-e2e-acceptance.md`. Validate: `bash scripts/validate-production-gates.sh` and `bash scripts/smoke-readiness-live-proofs-residual.sh`.

**Tenant isolation:** Production onboarding follows `references/tenant-isolation-decision.md` (`customer_account` account boundary; `lanyard_hosted` account-per-tenant target or interim VPC+KMS+logs+DLM with unique `project_name`).

## Platform staging (central platform compose)

Composes product-artifact-infra, platform-vpc, control-plane-rds, portal BFF/relay/control-plane (internal), portal-static-edge, and optional portal-valkey + portal-dns-tls. Status: **infra_ready** — not production-applied; CI validates offline only (no apply).

Operator procedure (backend, secrets, apply, rollback): `references/runbooks/platform-staging-compose.md`.

```bash
cd environments/platform-staging
# Validates without credentials / backend:
terraform init -backend=false -input=false && terraform validate
bash ../../scripts/smoke-platform-staging-compose.sh
bash ../../scripts/smoke-pilot-cost-profile.sh
# Before apply: copy backend.tf.example → backend.tf, terraform.tfvars.example → terraform.tfvars,
# replace artifact/static bucket REPLACE suffixes, real image digests from private pins,
# optionally enable OIDC with existing provider ARN, enable_portal_valkey, enable_portal_dns_tls.
```

## Doctrine (non-negotiable)

| Topic | Rule |
|-------|------|
| Core | Employee-vault mirror only — zero client-deployment dependency |
| Bootstrap | Artifact contract only — no git-clone of Core/client-core |
| Versions | Immutable labels + SHA-256 — never live git branches as artifacts |
| Portal images | Repository + digest pins — never tag-only / `:latest` sole pin |
| Vault durability | Encrypted EBS + DLM daily snapshots; not customer GitHub |
| Portal | Egress-only relay WSS; no inbound portal ports on the brain host |
| Roles | Default **admin** and **contributor** Hermes profiles (bootstrap-enforced seeds) |
| Artifact URLs | **https://** or **s3://** only — `http://` / `ws://` rejected |
| Relay URLs | **https://** or **wss://** only |
| Secrets | Live tfvars/state/secrets stay out of git |
| Module pins | Relative paths in-repo, or tag/commit — never floating `main` |
| OIDC | Require existing provider ARN; do not create a duplicate provider |

## Validation

```bash
# Shell (local; shellcheck optional — CI installs it)
bash -n scripts/bootstrap-host.sh
bash -n scripts/ensure-hermes-profiles.sh
bash -n scripts/ensure-runtime-hardening.sh
bash -n scripts/omnibox/run-under-omnibox.sh
bash -n scripts/ensure-omnibox.sh
bash -n scripts/smoke-omnibox.sh
bash -n scripts/smoke-bootstrap-extract.sh
bash -n scripts/smoke-bootstrap-inject.sh
bash -n scripts/smoke-artifact-attestation.sh
bash -n scripts/smoke-hermes-profiles.sh
bash -n scripts/smoke-host-runtime-hardening.sh
bash -n scripts/validate-compatibility.sh
bash -n scripts/validate-production-gates.sh
bash -n scripts/policy-as-code-security.sh
bash -n scripts/security-acceptance-checklist.sh
bash -n scripts/smoke-product-artifact-iam.sh
bash -n scripts/smoke-chat-corpus-infra.sh
bash -n scripts/smoke-control-plane-rds.sh
bash -n scripts/smoke-portal-compute.sh
bash -n scripts/smoke-platform-vpc.sh
bash -n scripts/smoke-platform-staging-compose.sh
bash -n scripts/smoke-pilot-cost-profile.sh
bash -n scripts/smoke-portal-valkey.sh
bash -n scripts/smoke-portal-dns-tls.sh
bash -n scripts/smoke-portal-waf.sh
bash -n scripts/smoke-controlled-egress.sh
bash -n scripts/smoke-customer-account-access.sh
bash -n scripts/smoke-account-factory.sh
bash -n scripts/smoke-tenant-template-wiring.sh
bash -n scripts/smoke-mocklab-short-stack-harness.sh
bash -n scripts/smoke-harness-exec-iam.sh
bash -n scripts/smoke-mocklab-replace-echo-harness-la.sh
bash -n scripts/prove-mocklab-short-stack-no-tool-turn.sh
bash -n scripts/smoke-mocklab-short-stack-no-tool-turn.sh
bash -n scripts/prove-mocklab-short-stack-no-tool-ui.sh
bash -n scripts/smoke-mocklab-short-stack-no-tool-ui.sh
bash -n scripts/prove-mocklab-short-stack-harness-ui.sh
bash -n scripts/smoke-mocklab-short-stack-harness-ui.sh
bash -n scripts/prove-mocklab-short-stack-kitchen-sink.sh
bash -n scripts/smoke-mocklab-short-stack-kitchen-sink.sh
bash -n scripts/smoke-mocklab-short-stack-relay-retire.sh
bash -n modules/company-brain-ec2/setup.sh
bash -n modules/company-brain-ec2/scripts/tailscale-enroll.sh
bash scripts/smoke-omnibox.sh
bash scripts/ensure-omnibox.sh --dry-run
bash scripts/smoke-bootstrap-extract.sh
bash scripts/smoke-bootstrap-inject.sh
bash scripts/smoke-artifact-attestation.sh
bash scripts/smoke-hermes-profiles.sh
bash scripts/smoke-host-runtime-hardening.sh
bash scripts/validate-compatibility.sh
bash scripts/validate-production-gates.sh
bash scripts/policy-as-code-security.sh
bash scripts/security-acceptance-checklist.sh
bash scripts/smoke-product-artifact-iam.sh
bash scripts/smoke-chat-corpus-infra.sh
bash scripts/smoke-control-plane-rds.sh
bash scripts/smoke-portal-compute.sh
bash scripts/smoke-platform-vpc.sh
bash scripts/smoke-platform-staging-compose.sh
bash scripts/smoke-pilot-cost-profile.sh
bash scripts/smoke-portal-valkey.sh
bash scripts/smoke-portal-dns-tls.sh
bash scripts/smoke-portal-waf.sh
bash scripts/smoke-controlled-egress.sh
bash scripts/smoke-customer-account-access.sh
bash scripts/smoke-account-factory.sh
bash scripts/smoke-tenant-template-wiring.sh
bash scripts/smoke-tier3-dedicated-relay.sh
bash scripts/smoke-mocklab-short-stack-harness.sh
bash scripts/smoke-harness-exec-iam.sh
bash scripts/smoke-mocklab-replace-echo-harness-la.sh
bash scripts/smoke-mocklab-short-stack-no-tool-turn.sh
bash scripts/smoke-mocklab-short-stack-kitchen-sink.sh
bash scripts/smoke-mocklab-short-stack-relay-retire.sh

# Format + validate staging/example roots + bootstrap smokes (lp-k7g.10.6)
bash scripts/validate-staging-roots.sh

# Or manually:
# terraform fmt -check -recursive
# for d in modules/* templates/tenant environments/platform-staging; do
#   … see scripts/validate-staging-roots.sh / .github/workflows/ci.yml
# done
```

## Migration phases

See `references/migration-phases.md` and `references/readiness-matrix.md`.

| Phase | Status |
|-------|--------|
| Milestone 1 — client data-plane baseline | Complete |
| Phase 2 — product release foundation (S3/ECR/OIDC contracts) | This milestone |
| Portal static edge / cloud compute | **infra_ready** (modules) — apply operator-owned; not production-certified without staging + G1/G2/G7 |
| Control-plane RDS / Postgres | **infra_ready** (module) — product G4.1/G4.2 done; apply operator-owned; not production-claimed |
| Production relay/control-plane security | **Gated / blocked** — G1 + G2; wiring modules are not production security |
| Product publishing workflows | **Gated** — product repos (Portal Dockerfiles, Hermes Lanyard artifact, client-core release CI) |

## Out of scope

- Portal application and control-plane implementation (separate Portal repo)
- Employee vault / Core content
- Real customer tfvars, state backends, and account wiring (private operator copies only)
- Claiming product images/tarballs are published when readiness matrix says blocked
