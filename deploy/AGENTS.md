# AGENTS.md — company-brain-deploy

## Purpose

This repository is the **canonical client deployment surface** for Lanyard Company Brain hosts.

- **Own here:** Terraform modules (EC2/EBS/DLM, customer gateway relay, Tier 3 dedicated relay, product artifact infra), tenant + platform-staging templates, artifact-based bootstrap, operator runbooks, pin/artifact documentation, compatibility manifests, CI, per-tenant deployment working trees.
- **Do not own here:** Portal application/control-plane source, employee-vault content, or live customer secrets/state in git.
- The authoritative **employee vault** for operators is `/home/operator/Lanyard`. This deployment repository must have **zero employee-vault dependency** — never reintroduce an employee-vault clone, path, or module source for customer boxes.

## Do

1. Keep examples and docs free of live secrets, real account IDs, customer vault content, and non-RFC-5737 operator IPs.
2. Pin artifacts by **URL + version + SHA-256**. Fail clearly when artifact variables are unconfigured placeholders. Never use a live git branch (`main`, `master`, `HEAD`, …) as a version. Portal images pin by **repository + digest**.
3. Prefer **relative module sources** within this monorepo (`../../modules/...`). External examples must pin a tag/commit — **no floating `main`/`ref=main`**.
4. Preserve doctrine: egress-only portal relay posture, roles **admin** / **contributor**, encrypted EBS + DLM daily snapshots, no customer git workflow for vault content.
5. After layout or contract changes, update root `INDEX.md`, `index.yaml`, and the relevant module/template indexes.
6. Run static validation before finishing structural work (local; shellcheck is optional and CI-only if not installed):
   - `bash -n scripts/bootstrap-host.sh` (and other shell scripts)
   - `bash scripts/smoke-bootstrap-extract.sh` when changing bootstrap extract/download logic
   - `bash scripts/smoke-bootstrap-inject.sh` when changing bootstrap injection / user_data install path
   - `bash scripts/validate-compatibility.sh` when changing pin schema or example
   - `bash scripts/smoke-product-artifact-iam.sh` when changing product-artifact-infra IAM/OIDC/S3/ECR contracts
   - `bash -n scripts/verify-product-artifact-staging.sh` when changing the live post-apply product-artifact verifier (live AWS run is operator-only; not CI)
   - `bash scripts/smoke-control-plane-rds.sh` when changing control-plane-rds private posture / secrets contract
   - `bash scripts/smoke-platform-vpc.sh` when changing platform-vpc topology / private IP / NAT / endpoint contracts
   - `bash scripts/smoke-portal-valkey.sh` when changing portal-valkey private posture / REDIS_URL secrets contract
   - `bash scripts/smoke-portal-dns-tls.sh` when changing portal-dns-tls ACM / Route53 / us-east-1 provider contracts
   - `bash scripts/smoke-portal-waf.sh` when changing portal-waf CloudFront/regional WebACL / managed-rules contracts
   - `bash scripts/smoke-customer-account-access.sh` when changing Track B customer-account-access IAM/trust contracts
   - `bash scripts/smoke-account-factory.sh` when changing Lanyard-hosted account-factory / SCP contract / baseline resources
   - `bash scripts/smoke-tenant-template-wiring.sh` when changing templates/tenant assume_role / ExternalId / backend / Track A-B wiring
   - `bash scripts/smoke-portal-compute.sh` when changing portal static edge / BFF / relay / control-plane service modules
   - `bash scripts/smoke-platform-staging-compose.sh` when changing environments/platform-staging compose
   - `bash scripts/smoke-pilot-cost-profile.sh` when changing platform-staging pilot cost defaults (RDS size/multi-AZ, Valkey/WAF/DNS-TLS enable defaults)
   - `bash scripts/smoke-dlm-dr-snapshot-copy.sh` when changing DLM cross-region copy / DR-account share flags on company-brain-ec2
   - `bash scripts/smoke-tier3-dedicated-relay.sh` when changing modules/tier3-dedicated-relay (compose, DNS/WAF, honesty)
   - `bash scripts/smoke-lab-onlyoffice-compose.sh` when changing `dev/lab-shared-compose-ds/` or lab ONLYOFFICE Document Server runbook (lp-5q6.25; optional `LIVE=1` for api.js)
   - `bash scripts/smoke-mocklab-short-stack-harness.sh` when changing `dev/mocklab-short-stack-harness/` or the MockLab short-stack harness runbook (lp-oop.30)
   - `bash scripts/smoke-harness-exec-iam.sh` when changing harness exec IAM (`modules/harness-exec-iam/`, BFF `execution_extra_secret_arns`, or the harness task-definition example; `lp-oop.38.20`; no terraform apply)
   - `bash scripts/smoke-mocklab-harness-backend-home.sh` when changing MockLab kitchen-sink `config.yaml` / harness `BACKEND_HOME` seed (`lp-oop.38.18`)
   - `bash scripts/smoke-mocklab-replace-echo-harness-la.sh` when changing the LA harness image recipe / `mocklab-replace-echo-harness-la` runbook (lp-oop.37.4; no live flip)
   - `bash scripts/smoke-localhost-muse-spark-provider.sh` when changing localhost Muse Spark LiteLLM bind (`lp-k5c4.17`; no Meta fetch in BFF; `LIVE=1` prove is operator-only)
   - `bash scripts/smoke-mocklab-short-stack-no-tool-turn.sh` when changing `lp-oop.31` no-tool turn evidence or prove script (live prove is `prove-mocklab-short-stack-no-tool-turn.sh`)
   - `bash scripts/smoke-mocklab-short-stack-no-tool-ui.sh` when changing `lp-oop.36` UI prove/runner (live prove is `prove-mocklab-short-stack-no-tool-ui.sh`)
   - `bash scripts/smoke-mocklab-short-stack-harness-ui.sh` when changing `lp-oop.33` harness-path Playwright prove/runner (live prove is `prove-mocklab-short-stack-harness-ui.sh`)
   - `bash scripts/smoke-mocklab-short-stack-invariants.sh` when changing the short-stack invariant script or `artifacts/mocklab/short-stack/` evidence (lp-oop.32; does not flip live snapshot)
   - `bash scripts/smoke-mocklab-short-stack-kitchen-sink.sh` when changing `lp-oop.34` kitchen-sink prove/runner (live prove is `prove-mocklab-short-stack-kitchen-sink.sh`)
   - `bash scripts/smoke-mocklab-short-stack-relay-retire.sh` when changing `lp-oop.35` Relay-retire docs/types (Daytona harness hop; no live flip)
   - `bash scripts/smoke-archive-unused-daytona-sandboxes.sh` when changing unused-sandbox archive hygiene (`lp-oop.37.7`; dry-run default; keep bound `sandbox_id`; no live Daytona)
   - `bash scripts/smoke-staging-document-server.sh` when changing `modules/staging-document-server/`, staging DS runbook, or platform-staging Document Server wiring (lp-5q6.34)
   - `bash scripts/policy-as-code-security.sh` when changing private-by-default network/SSH/egress/IMDS/S3/secrets/Tier3/snapshot/RDS/Portal-compute contracts
   - `bash scripts/security-acceptance-checklist.sh` when changing security acceptance or production-gate honesty docs
   - `bash scripts/check-staging-secrets-checklist.sh` when changing staging secrets checklist or its cross-links
   - `bash scripts/validate-production-gates.sh` when changing readiness/sign-off claims (fail-closed)
  - `bash scripts/smoke-readiness-live-proofs-residual.sh` when changing G1.4/G1a/G2/G3 live residual ledger or matrix honesty (`lp-t7q.7`)
   - `terraform fmt -check -recursive` (or `terraform fmt -recursive`)
   - `terraform init -backend=false && terraform validate` per module / template / environment where dependencies permit
7. Label unfinished Portal **compute apply**, control-plane **RDS apply**, product-artifact **staging apply**, and **product publishing** as gated migration work (`references/migration-phases.md`, `references/readiness-matrix.md`) — do not claim RDS, product-artifact landing zones, or G8 compute is production-applied/certified from examples alone. Phase 2 **release foundation** (S3/ECR/OIDC), P0 `modules/platform-vpc`, G4.3 `modules/control-plane-rds`, and G8 `modules/portal-*` are **infra_ready**; live apply is operator-owned (`references/runbooks/product-artifact-staging-apply.md`, `references/runbooks/portal-compute-staging-apply.md`).

## Do not

- Commit `terraform.tfvars`, `*.tfstate`, plans, deploy keys, relay secrets, or customer data.
- Git-clone employee-vault or client-core onto customer hosts for bootstrap; use the **artifact contract** (`artifacts/README.md`, `scripts/bootstrap-host.sh`).
- Open SSH to `0.0.0.0/0` (enforced in the EC2 module).
- Invent AWS resource IDs, account numbers, or live CIDRs in examples.
- Pull Portal control-plane or app code into this repo — wire **provision outputs** and **image digests** only.
- Modify files under employee-vault trees from deployment work.
- Require employee-vault module sources, clone URLs, or repo paths on any deploy path.
- Create a second GitHub OIDC provider in Terraform when one already exists — pass `github_oidc_provider_arn` into `modules/product-artifact-infra`.
- Claim control-plane RDS is production-applied or **ready** from placeholder tfvars alone (`modules/control-plane-rds` is **infra_ready**; product uses `CONTROL_PLANE_DATABASE_URL`).
- Claim G8 Portal compute is production-certified or matrix **ready** from module presence alone (`modules/portal-*` are **infra_ready**; control plane must stay on an **internal** ALB only).
- Attach the control plane to a public ALB (`modules/portal-control-plane-service` hard-rejects `internal=false`).

## Bootstrap contract (summary)

1. Tenant root injects canonical `scripts/bootstrap-host.sh` into the EC2 module as **base64gzip** (`bootstrap_script_b64`).
2. user_data installs it root-owned at **`/usr/local/sbin/company-brain-bootstrap`** and writes artifact pins to `/etc/company-brain/artifact-pins.env`.
3. Operator runs `sudo /usr/local/sbin/company-brain-bootstrap` (loads pins automatically).
4. Instance role downloads Hermes + client-core artifacts.
5. Verify SHA-256 for each artifact; optionally verify Ed25519 signatures (required when `REQUIRE_ARTIFACT_ATTESTATION=1`).
6. Install Hermes first into `/opt/hermes-lanyard`.
7. Extract client-core into `/opt/company-brain` **only if** that path has no existing `AGENTS.md`.
8. Write provenance under `/opt/company-brain/.seed/` (includes attestation status + signing pubkey fingerprint when verified).

Details: `artifacts/README.md`, `scripts/bootstrap-host.sh`, `references/provision-runbook.md`.

## Product artifact release foundation (Phase 2)

- Module: `modules/product-artifact-infra` — private versioned S3 with Object Lock (Hermes + client-core + portal-web prefixes), immutable-tag ECR (Portal `web` / `bff` / `relay` / `control-plane`), optional OIDC publisher roles (Portal writes `portal-web/` + ECR).
- Staging root: `environments/platform-staging` — composes product-artifact-infra, platform-vpc, control-plane-rds, portal BFF/relay/control-plane (internal), portal-static-edge, optional portal-valkey and portal-dns-tls; relative module sources; `backend.tf.example` + `terraform.tfvars.example` only; validates without credentials; **infra_ready**, not apply-ready until placeholders are replaced. Apply/rollback: `references/runbooks/platform-staging-compose.md`.
- Staging root: `environments/platform-staging` — composes product-artifact-infra, platform-vpc, control-plane-rds, portal BFF/relay/control-plane (internal), portal-static-edge, optional portal-valkey, portal-dns-tls, and portal-waf; relative module sources; `backend.tf.example` + `terraform.tfvars.example` only; validates without credentials; **infra_ready**, not apply-ready until placeholders are replaced.
- Contract + gates: `references/product-artifact-release-contract.md`, `references/readiness-matrix.md`.

## Compatibility pins

Portal image digests, Hermes version/SHA/URL, client-core version/SHA/URL, and relay contract major are documented under `compatibility/` and validated by `scripts/validate-compatibility.sh`.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
