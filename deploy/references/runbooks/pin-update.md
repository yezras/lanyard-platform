# Runbook: Update compatibility / artifact pins

**Status:** Operator procedure (offline-friendly)  
**Purpose:** Refresh Portal image digests and Hermes / client-core tarball pins after a product release without inventing digests or committing secrets.  
**Source of truth for coordinates:** `references/product-artifact-release-contract.md`  
**Gate honesty:** `references/readiness-matrix.md` (G7 **partial**: Hermes/client-core first private GH pins exist; Portal digests + S3 mirrors may still be blocked)  
**Backend kind readiness (which kinds may be pinned, contract majors, conformance):** [`docs/architecture/backend-compatibility-matrix.md`](../../../docs/architecture/backend-compatibility-matrix.md) — production customer hosts stay on **`hermes_lanyard`**; raw Nous is forbidden; Lanyard Agent stays blocked until matrix flip  
**Schema + examples:** `compatibility/` (`pins.example.yaml` synthetic; `pins.real-releases.yaml` first real Hermes/client-core coordinates — no tokens)

---

## Fail-closed rules

| Rule | Operator action |
|------|-----------------|
| No invented digests/SHAs | Only pin coordinates published by product release workflows (GitHub Releases, S3 objects + `.sha256` sidecars, ECR digests) |
| Example pins stay synthetic | Never replace `compatibility/pins.example.yaml` with live account IDs or customer data |
| Real-release pin file | `compatibility/pins.real-releases.yaml` may hold published product coordinates (no tokens); account-specific overlays stay gitignored |
| Never commit tokens | Private GitHub download uses **`GITHUB_TOKEN` / `GH_TOKEN` from env only** — never pin files, tfvars, or git |
| Versions are immutable | Reject `main` / `master` / `HEAD` / `develop` / `latest` as version labels |
| URL schemes | Artifacts: **`s3://`** or **`https://`** only. Relay: **`https://`** or **`wss://`** only |
| G7 not cleared by docs alone | Hermes/client-core pins ≠ full G7 ready (Portal digests + staging still required) — check readiness matrix |

---

## When to run this runbook

1. Hermes Lanyard release published an immutable tarball + SHA-256 (private GitHub Release and/or `s3://…/hermes/<version>/…`).
2. client-core release published an immutable tarball + SHA-256 (private GitHub Release and/or `s3://…/client-core/<version>/…`).
3. Portal image-release published immutable tags + digests to ECR (`bff`, `relay`, `control-plane`; optional `web` compatibility slot).
4. Portal static web (when product publishes) landed under `portal-web/<version>/…` (future pin fields).

If the needed product family has **not** published successfully, leave that family at `UNCONFIGURED` / placeholders. Do not fabricate SHA-256 or digests to “unblock” bootstrap.

**Current honesty (first private releases):**

| Family | Status | Pin source |
|--------|--------|------------|
| Hermes | **Published** private GH release `v0.1.0-g7h2` | `compatibility/pins.real-releases.yaml` |
| client-core | **Published** private GH release `v0.1.0-g7c2` | `compatibility/pins.real-releases.yaml` |
| Portal images / static web | **Not** pinned with real digests yet | placeholders / `UNCONFIGURED` |
| Platform S3 mirror | Optional next step | prefer `s3://` + instance role when OIDC publish lands |

```bash
# Product repos: release tags + assets (private: needs gh auth / GITHUB_TOKEN)
#   gh release view v0.1.0-g7h2 -R LanyardBrain/hermes-lanyard
#   gh release view v0.1.0-g7c2 -R LanyardBrain/client-core
# Platform account (when mirrored): s3://$ARTIFACT_BUCKET/hermes|client-core/<version>/
# ECR: image digests for portal services (when backend images publish)
```

---

## Pin file layout

| Surface | Fields | Notes |
|---------|--------|-------|
| Hermes | `hermes.version`, `hermes.sha256`, `hermes.url` | Optional `hermes.signature_b64` |
| client-core | `client_core.version`, `client_core.sha256`, `client_core.url` | Optional `client_core.signature_b64` |
| Portal images | `portal.images.<svc>.repository` + `digest` (+ optional `tag`) | Digest is deploy authority; never tag-only |
| Relay contract | `relay_contract.major` | Integer major of Hermes relay connector |
| Attestation | `artifact_attestation.*` | Optional in lab; production should `require: true` |

Object shapes (from release contract) — **dual path**:

| Artifact | Preferred production | First private releases (G7.H2/C2) |
|----------|---------------------|-----------------------------------|
| Hermes | `s3://$BUCKET/hermes/<version>/….tar.gz` | `https://github.com/LanyardBrain/hermes-lanyard/releases/download/<tag>/….tar.gz` |
| client-core | `s3://$BUCKET/client-core/<version>/….tar.gz` | `https://github.com/LanyardBrain/client-core/releases/download/<tag>/….tar.gz` |
| SHA sidecar (when published) | same key + `.sha256` | release asset `*.sha256` |
| Portal ECR | `<account>.dkr.ecr.<region>.amazonaws.com/<name_prefix>/portal/<svc>@sha256:…` | (still unpublished) |

**Private GitHub HTTPS auth:** set `GITHUB_TOKEN` or `GH_TOKEN` on the host (or operator workstation) before bootstrap. Tokens are **never** written into pin YAML, user_data git sources, or this repository. Bootstrap uses the GitHub API asset endpoint for private repos (browser download URLs often 404).

Tenant Terraform variables map 1:1 for host bootstrap:

| Pin field | Terraform / env |
|-----------|-----------------|
| `hermes.*` | `hermes_artifact_url` / `_version` / `_sha256` (+ signature env vars) |
| `client_core.*` | `client_core_artifact_url` / `_version` / `_sha256` |
| `relay_contract.major` | `relay_contract_major` |

Details: `artifacts/README.md`, `scripts/bootstrap-host.sh`.

---

## Customer host Hermes pin (hermes-lanyard only)

**Doctrine for every tenant (mocklab and production):** pin and install **Lanyard** Hermes — never raw upstream Nous on a customer host.

| Rule | Detail |
|------|--------|
| Product artifact | **`LanyardBrain/hermes-lanyard`** releases (or the platform S3 mirror under `hermes/<version>/…` built from that tree) |
| Never pin for customer hosts | Raw **`NousResearch/hermes-agent`** release tarballs, upstream docker images, or ad-hoc “stock Hermes” builds without portal/jti surface |
| Install path | Always **`/opt/hermes-lanyard`** (`hermes_install_path`; bootstrap provenance under `/opt/hermes-lanyard/.seed/`) |
| Systemd unit | **One** unit: **`hermes-gateway`** |
| ExecStart | **`/opt/hermes-lanyard/bin/hermes gateway`** — same CLI family; **no second gateway binary** or alternate unit name |
| After pin change | `terraform apply` (if pins in user_data) → `sudo /usr/local/sbin/company-brain-bootstrap` → merge relay env if needed → `sudo systemctl restart hermes-gateway` |

```bash
# On host after bootstrap / pin bump
cat /opt/hermes-lanyard/.seed/provenance.env   # version + sha256 match pin
systemctl cat hermes-gateway | grep -E '^ExecStart='
# Expect: ExecStart=/opt/hermes-lanyard/bin/hermes gateway
sudo systemctl restart hermes-gateway
sudo systemctl is-active hermes-gateway
```

**Demo vault / Hermes projects seed** (`scripts/seed-demo-vault.sh`, `scripts/seed-demo-hermes-projects.sh`) is **optional and mock/lab-only**. Do **not** run demo seeds on production customer vaults. Production content comes from the customer (or empty client-core spine), not synthetic demo trees.

Operator sequence for any new tenant: pin hermes-lanyard → bootstrap → relay env + secret → enable/restart **`hermes-gateway`**. Lab UX extras stay optional. Full host path: `references/provision-runbook.md`. Plan: `references/plans/lanyard-hermes-gateway-and-mocklab-vault/`.

Offline guard (unit template): `bash scripts/smoke-host-runtime-hardening.sh` asserts `ExecStart` contains `/opt/hermes-lanyard/bin/hermes`.

---

## Steps (operator)

### 1. Start from a committed template (do not invent SHAs)

```bash
# First real Hermes/client-core pins (Portal still placeholder):
cp compatibility/pins.real-releases.yaml "$HOME/ops/company-brain/pins-$(date +%Y%m%d).yaml"

# Or synthetic schema template:
# cp compatibility/pins.example.yaml "$HOME/ops/company-brain/pins-$(date +%Y%m%d).yaml"
```

Keep `pins.example.yaml` synthetic for schema CI. `pins.real-releases.yaml` may be updated when new immutable product coordinates publish (still **no tokens**).

### 2. Collect published coordinates

**Hermes / client-core — private GitHub Release (first pins):**

```bash
# Requires gh auth or GITHUB_TOKEN with repo read on private product repos
gh release view v0.1.0-g7h2 -R LanyardBrain/hermes-lanyard
gh release view v0.1.0-g7c2 -R LanyardBrain/client-core
# Coordinates already recorded in compatibility/pins.real-releases.yaml
# Verify SHA offline after download (bootstrap also verifies):
#   GITHUB_TOKEN=$(gh auth token)  # never commit
#   # download via bootstrap or API asset endpoint; then:
#   sha256sum hermes-v0.1.0-g7h2.tar.gz client-core-v0.1.0-g7c2.tar.gz
```

**Hermes / client-core — platform S3 (preferred when mirrored):**

```bash
BUCKET="<platform-artifact-bucket>"   # from platform-staging / product-artifact-infra outputs
VERSION="<immutable-tag>"            # e.g. v0.1.0 — never main/latest

# List published objects (example)
aws s3 ls "s3://${BUCKET}/hermes/${VERSION}/"
aws s3 ls "s3://${BUCKET}/client-core/${VERSION}/"

# Prefer publisher-written .sha256 sidecar when present; else:
aws s3 cp "s3://${BUCKET}/hermes/${VERSION}/<tarball>" /tmp/hermes.tgz
sha256sum /tmp/hermes.tgz
```

**Portal images (ECR):**

```bash
# Digest is authoritative (example query shape — replace registry/repo)
aws ecr describe-images \
  --repository-name '<name_prefix>/portal/bff' \
  --image-ids imageTag='<immutable-tag>' \
  --query 'imageDetails[0].imageDigest' --output text
```

Record `repository` (without tag) + `digest` (`sha256:` + 64 hex) for each of `web` (compat), `bff`, `relay`, `control-plane` as published.

**Optional Ed25519:** if the release pipeline attaches signatures, pin `signature_b64` per artifact and `artifact_attestation.signing_pubkey_b64` / `require: true` for production. See `artifacts/README.md`.

### 3. Edit the private pin file

Replace every placeholder:

- `example.dkr.ecr.example.amazonaws.com/…` → real ECR repository URLs
- `sha256:0000…` / `aaaa…` / `bbbb…` → real digests / SHAs
- `s3://example-artifacts-bucket/…` → real `s3://` or private GitHub HTTPS release URLs
- `v0.0.0-example` → real immutable version labels

Do **not** put tokens, deploy keys, or customer secrets in the pin file. Account-specific overlays stay private / gitignored.

### 4. Validate offline

```bash
# Schema + security checks (from company-brain-deploy root)
bash scripts/validate-compatibility.sh "$HOME/ops/company-brain/pins-YYYYMMDD.yaml"

# Committed templates must still pass
bash scripts/validate-compatibility.sh compatibility/pins.example.yaml
bash scripts/validate-compatibility.sh compatibility/pins.real-releases.yaml
```

On failure: fix URL scheme, version label, digest format, or missing required keys — do not weaken the validator.

### 5. Wire tenant deploy

Copy pin values into the tenant private `terraform.tfvars` (never commit):

```hcl
# Preferred when S3 mirror exists:
# hermes_artifact_url = "s3://…/hermes/vX.Y.Z/…"
# First private GitHub releases (need GITHUB_TOKEN/GH_TOKEN on host at bootstrap):
hermes_artifact_url      = "https://github.com/LanyardBrain/hermes-lanyard/releases/download/v0.1.0-g7h2/hermes-v0.1.0-g7h2.tar.gz"
hermes_artifact_version  = "v0.1.0-g7h2"
hermes_artifact_sha256   = "046f9987b10ae6f19a0e1e74bf2e68e5ce8ddeb853dee6a50211bc5cdffa71f4"
client_core_artifact_url     = "https://github.com/LanyardBrain/client-core/releases/download/v0.1.0-g7c2/client-core-v0.1.0-g7c2.tar.gz"
client_core_artifact_version = "v0.1.0-g7c2"
client_core_artifact_sha256  = "ef21c313525afdca9902c40814293bbe924f428c219d93cf80398941c1f181e1"
relay_contract_major     = 1
```

Optional production attestation env / user_data pins: `REQUIRE_ARTIFACT_ATTESTATION=1`, signature + pubkey fields per `artifacts/README.md`.

For private GitHub pins, inject download credentials **outside** Terraform state when possible (SSM SecureString → host env `GITHUB_TOKEN` before bootstrap). Never commit the token.

```bash
cd deployments/<tenant_slug>
terraform plan   # confirm pin diffs only as expected
terraform apply
# Host (private GH pins):
#   export GITHUB_TOKEN=…   # from SSM / Secrets Manager — not git
sudo /usr/local/sbin/company-brain-bootstrap
```

### 6. Verify host provenance

```bash
# On host after bootstrap
cat /opt/hermes-lanyard/.seed/provenance.env
cat /opt/company-brain/.seed/provenance.env
# Expect matching version + sha256; attestation_status=verified when signatures required
```

### 7. Production security honesty (still required)

Pin updates do **not** clear G1/G2. Before production security claims:

```bash
bash scripts/validate-production-gates.sh
bash scripts/policy-as-code-security.sh
```

See `references/runbooks/production-security-gate.md`.

---

## Private pin validation path (summary)

```text
product publish
  ├─ private GitHub Release (first Hermes/client-core pins)
  └─ OIDC → S3/ECR (preferred production landing zone)
        ↓
compatibility/pins.real-releases.yaml  (coordinates only; committed private deploy repo)
  and/or operator pins.yaml            (gitignored account overlays)
        ↓
bash scripts/validate-compatibility.sh /path/to/pins.yaml
        ↓
tenant terraform.tfvars artifact_*  (private working tree; no tokens)
        ↓
user_data → /etc/company-brain/artifact-pins.env
  + GITHUB_TOKEN/GH_TOKEN from env/SSM when using private GH HTTPS pins
        ↓
sudo company-brain-bootstrap  (download + SHA-256 + optional Ed25519)
```

Landing zone: `modules/product-artifact-infra` + `environments/platform-staging` (S3 path).  
Consumer bootstrap: `scripts/bootstrap-host.sh` (s3:// **or** https:// dual path).

---

## What stays in git

| Path | Role |
|------|------|
| `compatibility/schema.json` | Structural contract |
| `compatibility/pins.example.yaml` | **Placeholder-only** example for CI |
| `compatibility/pins.real-releases.yaml` | First real Hermes/client-core private-release coordinates (no tokens; Portal still placeholder) |
| `compatibility/README.md` | Field reference |
| `scripts/validate-compatibility.sh` | Offline validator |
| This runbook | Operator procedure |

| Never in git |
|--------------|
| `GITHUB_TOKEN` / `GH_TOKEN` / deploy keys / release private signing keys |
| Customer tfvars, state, relay secrets |
| Account-specific live pin overlays (`pins.yaml`, `pins.local.yaml`, `pins.private.yaml`, `*-live.yaml`) |

---

## Related

- `references/product-artifact-release-contract.md` — S3/ECR/OIDC coordinates
- `references/readiness-matrix.md` — G7 publish gates; operator sequence when gates clear
- `artifacts/README.md` — bootstrap pin variables + attestation
- `references/provision-runbook.md` — full tenant provision path
- `references/runbooks/upgrade-rollback.md` — host upgrade after pin change
- `modules/product-artifact-infra/` — deploy-owned landing zones
- `modules/company-brain-ec2/systemd/hermes-gateway.service` — unit template (ExecStart hermes-lanyard path)
- `templates/tenant/INDEX.md` — post-bootstrap checklist for every tenant
- `references/plans/lanyard-hermes-gateway-and-mocklab-vault/phase-7-encode.md` — encode path for all tenants
