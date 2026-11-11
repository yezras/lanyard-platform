# Company Brain EC2 — agent rules

## Purpose

Reusable AWS EC2 provisioner for **customer Company Brain** Hermes hosts. Lives in **company-brain-deploy** (canonical client deployment surface). Not a customer-specific stack; not Core.

## Do

- Keep Terraform free of live secrets, real operator IPs, account IDs, and customer names (examples use RFC 5737 docs IPs).
- Prefer variables and placeholders (`UNCONFIGURED`, `203.0.113.10/32`) in docs.
- When changing resource tags or backup policy, keep alignment with EBS + DLM doctrine (not customer GitHub for vault).
- Pass artifact URL/version/SHA-256 variables; do not reintroduce git-clone of Core or client-core.
- Inject host bootstrap via `bootstrap_script_b64` (prefer `base64gzip(file(.../scripts/bootstrap-host.sh))`); install at `bootstrap_install_path` (default `/usr/local/sbin/company-brain-bootstrap`). Keep default empty so standalone module validate works.
- After structural changes, update this module’s `INDEX.md`, `references/deployment.md`, and root `INDEX.md` / `index.yaml`.
- Run `terraform init -backend=false && terraform validate` when `.tf` files change; run `bash scripts/smoke-bootstrap-inject.sh` when changing injection/user_data.
- Tailscale is optional secondary access (`enable_tailscale` default false). Auth keys must come from SSM/Secrets Manager references only — never long-lived keys in tfvars/user_data. Keep SSM primary and public SSH closed.

## Do not

- Commit `terraform.tfvars`, `tfplan`, or `*.tfstate`.
- Bake litigation- or client-specific tools into the default path.
- Open SSH to `0.0.0.0/0` (enforced by variable validation).
- Reintroduce mandatory SSH or unrestricted production egress (`protocol=-1` to `0.0.0.0/0`).
- Put portal relay secrets in this module — use `modules/customer-gateway-relay/`.
- Use floating branch refs (`main`) in module source examples.
- **Apply this module for `runtime_kind=daytona` tenants** (`lp-4nf`, plan §4.11). Daytona tenants get CP register + S3 vault prefix only; compute is lazy via Instance Orchestrator → Daytona API. Tenant template check `daytona_forbids_company_brain_ec2_template` fails closed. Runbook: `docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md`.
