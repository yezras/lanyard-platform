# Phase 3: Re-pin mocklab and re-bootstrap Hermes

**Bead:** `cbd-ukg.6`  
**Depends on:** `cbd-ukg.5` (DONE — pack/publish `v0.1.0-g7h3`)  
**Status:** see execution record at end of this file

## Goal

Mocklab host runs the approved hermes-lanyard install under `/opt/hermes-lanyard` with provenance matching the phase-2 pin, and `hermes-gateway` active.

## Exact pin coordinates (from cbd-ukg.5 / `compatibility/pins.real-releases.yaml`)

| Field | Value |
|-------|--------|
| Version | `v0.1.0-g7h3` |
| SHA-256 | `a372580396e170436c22e44a61fbcdf8d2c7cf4f5d328694bb5afdf279904db9` |
| HTTPS (private GH release) | `https://github.com/LanyardBrain/hermes-lanyard/releases/download/v0.1.0-g7h3/hermes-v0.1.0-g7h3.tar.gz` |
| S3 (preferred when mirrored) | `s3://lanyard-product-artifacts-staging-123456789012/hermes/v0.1.0-g7h3/hermes-v0.1.0-g7h3.tar.gz` |

**HCL (private `terraform.tfvars` — gitignored; do not invent alternate SHAs):**

```hcl
hermes_artifact_url     = "s3://lanyard-product-artifacts-staging-123456789012/hermes/v0.1.0-g7h3/hermes-v0.1.0-g7h3.tar.gz"
# Or HTTPS (needs GITHUB_TOKEN/GH_TOKEN on host for private release):
# hermes_artifact_url   = "https://github.com/LanyardBrain/hermes-lanyard/releases/download/v0.1.0-g7h3/hermes-v0.1.0-g7h3.tar.gz"
hermes_artifact_version = "v0.1.0-g7h3"
hermes_artifact_sha256  = "a372580396e170436c22e44a61fbcdf8d2c7cf4f5d328694bb5afdf279904db9"
```

Example comments (safe to commit): `deployments/mocklab/terraform.tfvars.example` and SoT `compatibility/pins.real-releases.yaml`.

### Pre-flight (operators)

1. Confirm release assets: `gh release view v0.1.0-g7h3 -R LanyardBrain/hermes-lanyard`
2. If using S3, confirm object SHA matches pin (do **not** trust a prefix that exists with a wrong body):

   ```bash
   aws s3 cp s3://lanyard-product-artifacts-staging-123456789012/hermes/v0.1.0-g7h3/hermes-v0.1.0-g7h3.tar.gz - \
     | sha256sum
   # expect a372580396e170436c22e44a61fbcdf8d2c7cf4f5d328694bb5afdf279904db9
   ```

3. AWS identity must reach **mocklab account** `123456789012` (profile `lanyard-main` on this operator machine). Default profile `litigationagent-terraform` / account `210987654321` gets **403** on mocklab tfstate and cannot SSM the host.

## Operator checklist (mocklab + default for any new tenant)

`user_data` writes `/etc/company-brain/artifact-pins.env` only at instance **create**. Module sets `user_data_replace_on_change = false` and `lifecycle.ignore_changes = [ami, user_data, …]`, so **terraform apply alone does not refresh pins on a live host**. Always update pins on the instance (or pass bootstrap CLI flags) after changing tfvars.

1. **Pin in private tfvars** (gitignored) — hermes URL/version/SHA only; leave client-core / vault alone for this phase.
2. **`terraform apply`** (optional but recommended for state/outputs consistency):

   ```bash
   cd deployments/mocklab
   export AWS_PROFILE=lanyard-main   # account 123456789012
   terraform init
   terraform plan -out=tfplan-repin
   terraform apply tfplan-repin
   ```

   Expect no instance replacement for pin-only changes. Outputs `artifact_pins` should show g7h3.

3. **Refresh host pin file** (SSM Session Manager preferred):

   ```bash
   INSTANCE_ID=$(terraform output -raw instance_id)  # or known mocklab id
   aws ssm start-session --target "$INSTANCE_ID"
   ```

   On host:

   ```bash
   sudo tee /etc/company-brain/artifact-pins.env >/dev/null <<'PINS'
   CLIENT_CORE_ARTIFACT_URL=s3://lanyard-product-artifacts-staging-123456789012/client-core/v0.1.0-g7c2/client-core-v0.1.0-g7c2.tar.gz
   CLIENT_CORE_ARTIFACT_VERSION=v0.1.0-g7c2
   CLIENT_CORE_ARTIFACT_SHA256=ef21c313525afdca9902c40814293bbe924f428c219d93cf80398941c1f181e1
   HERMES_ARTIFACT_URL=s3://lanyard-product-artifacts-staging-123456789012/hermes/v0.1.0-g7h3/hermes-v0.1.0-g7h3.tar.gz
   HERMES_ARTIFACT_VERSION=v0.1.0-g7h3
   HERMES_ARTIFACT_SHA256=a372580396e170436c22e44a61fbcdf8d2c7cf4f5d328694bb5afdf279904db9
   RELAY_CONTRACT_MAJOR=1
   PINS
   sudo chmod 644 /etc/company-brain/artifact-pins.env
   ```

   (Keep existing client-core lines if already correct; only hermes lines must change for this wave.)

4. **Bootstrap** (Hermes always re-installs; vault seed skipped if `/opt/company-brain/AGENTS.md` exists — **do not reseed vault**; phase 5):

   ```bash
   sudo /usr/local/sbin/company-brain-bootstrap
   ```

5. **Provenance** — must match pin:

   ```bash
   cat /opt/hermes-lanyard/.seed/provenance.env
   # version=v0.1.0-g7h3
   # sha256=a372580396e170436c22e44a61fbcdf8d2c7cf4f5d328694bb5afdf279904db9
   ```

6. **Relay env intact** (secret mode 600; do not print secret values):

   ```bash
   sudo -u hermes test -f /home/hermes/.hermes/.env
   sudo -u hermes stat -c '%a' /home/hermes/.hermes/.env   # expect 600
   sudo -u hermes grep -E '^GATEWAY_RELAY_' /home/hermes/.hermes/.env | cut -d= -f1
   ```

7. **Restart gateway** (unit name **unchanged**: `hermes-gateway`):

   ```bash
   sudo systemctl enable hermes-gateway
   sudo systemctl restart hermes-gateway
   systemctl is-active hermes-gateway
   systemctl show hermes-gateway -p ExecStart --value
   # expect path under /opt/hermes-lanyard/bin/hermes … gateway
   ```

### New tenant default

Same pin + bootstrap path: configure artifact pins in tenant `terraform.tfvars` (from `templates/tenant` / `deployments/mocklab` example comments), apply, run `sudo /usr/local/sbin/company-brain-bootstrap`, enable/restart `hermes-gateway`. Template Hermes install path remains `/opt/hermes-lanyard`.

## Non-goals

- Changing unit name or ExecStart unless product entrypoint actually changed
- Replacing `/opt/company-brain` content (phase 5)
- Closing host acceptance without host evidence

## Verification

- `systemctl is-active hermes-gateway` → `active`
- Provenance `version` + `sha256` match pin table above
- ExecStart still `/opt/hermes-lanyard/bin/hermes gateway` (or equivalent under that install path)

## Acceptance

- [x] Pin applied in tfvars (example + private)
- [x] Host provenance matches pin SHA/version
- [x] Gateway unit active after restart

## Execution record (cbd-ukg.6)

_Filled by implementer 2026-07-19; sanitize — no secrets, no customer vault content._

| Step | Result | Notes |
|------|--------|-------|
| AWS profile for mocklab | **ok** | `AWS_PROFILE=lanyard-main` → account `123456789012` (`lanyard-portal-terraform`). Default `litigationagent-terraform` / `210987654321` cannot reach mocklab tfstate/host. |
| S3 object SHA vs pin | **fixed then ok** | Prefix already had a **wrong** body (`5949dfa2…`). Re-uploaded GH release tarball; current object SHA = pin `a3725803…`. |
| Private tfvars hermes pin | **ok** | Live gitignored `deployments/mocklab/terraform.tfvars` → g7h3 s3://… (not committed). |
| Example pin comments | **ok** | `deployments/mocklab/terraform.tfvars.example` comments → g7h3 + S3 shape note. |
| terraform apply | **ok** | Output-only change (`artifact_pins` / `hermes_artifact_version`); no instance replace (`user_data` ignored). Instance `i-08655012ee8702842`. |
| Host pins.env refresh | **ok** | SSM wrote `/etc/company-brain/artifact-pins.env` hermes → g7h3. |
| Bootstrap | **ok** | SHA-256 OK; vault skip (`AGENTS.md` present); Hermes re-extract. |
| Provenance match | **pass** | `version=v0.1.0-g7h3`, `sha256=a372580396e170436c22e44a61fbcdf8d2c7cf4f5d328694bb5afdf279904db9`, `installed_at=2026-07-19T18:00:33Z`. |
| hermes-gateway active | **pass** | After fix: install dir was pack `0700` → unit user `hermes` got `203/EXEC`. `chmod 755` on `/opt/hermes-lanyard` + restart → `active (running)`. Unit name unchanged. Relay env keys present; `.env` mode `600`. |
| Bootstrap script hardening | **ok** | `scripts/bootstrap-host.sh` now `chmod 755` install path + hermes binary after rsync so re-bootstrap does not brick the unit. |
| Ready for review | **yes** | Host acceptance met with `lanyard-main`. |

### Sanitized host evidence

```
# provenance
version=v0.1.0-g7h3
url=s3://lanyard-product-artifacts-staging-123456789012/hermes/v0.1.0-g7h3/hermes-v0.1.0-g7h3.tar.gz
sha256=a372580396e170436c22e44a61fbcdf8d2c7cf4f5d328694bb5afdf279904db9

# unit
Active: active (running)
ExecStart=/opt/hermes-lanyard/bin/hermes gateway
Main PID running under .venv python hermes gateway

# relay keys present (values not logged)
GATEWAY_RELAY_URL GATEWAY_RELAY_ID GATEWAY_RELAY_INSTANCE_ID GATEWAY_RELAY_PLATFORMS GATEWAY_RELAY_SECRET
```

### Residual

- Host may still log non-fatal `config.yaml` load warnings at gateway start (pre-existing; not an `is-active` failure).
- Delete wrong historical S3 versions under the g7h3 key if operators want a single retained object (Object Lock governance).
- Mirror/publish path: ensure future packs do not leave install root `0700` (bootstrap now compensates).
