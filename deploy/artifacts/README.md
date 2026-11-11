# Artifact contract

Company Brain hosts **do not git-clone Core or client-core**. Bootstrap uses pinned release artifacts only.

## Pins (required)

| Variable | Meaning |
|----------|---------|
| `client_core_artifact_url` | **https://** or **s3://** URL of the client-core tarball (`http://` rejected) |
| `client_core_artifact_version` | Version label (e.g. `v0.1.0`) — **not** a git branch |
| `client_core_artifact_sha256` | 64-char hex SHA-256 of the tarball |
| `hermes_artifact_url` | **https://** or **s3://** URL of the Hermes Lanyard runtime tarball (`http://` rejected) |
| `hermes_artifact_version` | Version label |
| `hermes_artifact_sha256` | 64-char hex SHA-256 of the tarball |
| `relay_contract_major` | Major of the Hermes relay connector contract (e.g. `1`) |

Unconfigured values (`UNCONFIGURED`, empty, or `REPLACE_ME`) cause `scripts/bootstrap-host.sh` to **exit 2** with a clear error.

## Signed attestation (optional in lab; required in production)

SHA-256 remains **required** for integrity. On top of that, bootstrap can verify an **Ed25519** signature over the raw artifact bytes with OpenSSL (`pkeyutl -rawin`) so the host checks **publisher authenticity**, not only content hash.

| Variable | Meaning |
|----------|---------|
| `HERMES_ARTIFACT_SIGNATURE_B64` | Base64 of the 64-byte raw Ed25519 signature over the Hermes tarball bytes |
| `CLIENT_CORE_ARTIFACT_SIGNATURE_B64` | Same for client-core |
| `ARTIFACT_SIGNING_PUBKEY_B64` | Base64 of the PEM public key (`BEGIN PUBLIC KEY`) used to verify both artifacts |
| `ARTIFACT_SIGNING_PUBKEY_FILE` | Path to PEM public key on the host (alternative to `*_B64`) |
| `ARTIFACT_SIGNING_PUBKEY` | PEM text or path (smoke / operator override) |
| `ARTIFACT_SIGNING_IDENTITY` | Optional label recorded in provenance (e.g. release key name) |
| `REQUIRE_ARTIFACT_ATTESTATION` | `1` = fail-closed if signature or pubkey is missing |

**Policy:**

| Mode | Behavior |
|------|----------|
| Lab (default) | Signature pins unset → attestation **skipped**; SHA-256 still enforced |
| Signature pin set | Verify Ed25519; missing/wrong pubkey or bad sig → **exit 6** |
| `REQUIRE_ARTIFACT_ATTESTATION=1` | Signature + pubkey required for each artifact; fail-closed → **exit 6** |

Production deploys **should** set `REQUIRE_ARTIFACT_ATTESTATION=1` and pin signatures + the release public key (append to `/etc/company-brain/artifact-pins.env` or export before bootstrap). Example keys must never be production keys; generate ephemeral keys only in smoke tests (`scripts/smoke-artifact-attestation.sh`).

**Publish / sign (operator offline):**

```bash
# Generate a long-lived release key offline (store private key in HSM/secret store — not git)
openssl genpkey -algorithm Ed25519 -out artifact-signing-ed25519.pem
openssl pkey -in artifact-signing-ed25519.pem -pubout -out artifact-signing-ed25519.pub

# Sign a published tarball (raw bytes)
openssl pkeyutl -sign -inkey artifact-signing-ed25519.pem \
  -out hermes-v0.1.0.tar.gz.sig -rawin -in hermes-v0.1.0.tar.gz
base64 -w0 hermes-v0.1.0.tar.gz.sig > hermes-v0.1.0.tar.gz.sig.b64
base64 -w0 artifact-signing-ed25519.pub   # → ARTIFACT_SIGNING_PUBKEY_B64
```

**Bootstrap exit codes (attestation):**

| Code | Meaning |
|------|---------|
| 4 | SHA-256 mismatch |
| 6 | Attestation missing/invalid (require mode, bad signature, wrong key) |

**Rejected at bootstrap / validation:**

- Live git refs as versions (`main`, `master`, `HEAD`, `develop`, `latest`, …)
- Git remotes / source-tree URLs (e.g. `*.git`, `git@…`, GitHub `tree/`/`blob/` paths)
- Insecure schemes: **`http://`**, **`ws://`**, and other non-artifact transports

Artifacts must be immutable release objects over **`s3://`** or **`https://`** only. Relay URLs (customer-gateway-relay) require **`https://`** or **`wss://`**.

For a single operator-held pin file covering Portal **image digests** plus Hermes/client-core/relay major, see `compatibility/` and `scripts/validate-compatibility.sh`.

## Install order

1. Download + verify **Hermes** artifact (SHA-256, then optional Ed25519).
2. Install into **`/opt/hermes-lanyard`**.
3. Download + verify **client-core** artifact (SHA-256, then optional Ed25519).
4. Extract into **`/opt/company-brain` only if `AGENTS.md` is absent** (preserve live vaults).
5. Write provenance under **`/opt/company-brain/.seed/`** (and Hermes `.seed/`), including attestation status and signing pubkey fingerprint when verified.

## Lab demo vault (not a release pin)

Synthetic content for mocklab / lab UX lives under **`artifacts/demo-vault/`** and is applied **post-bootstrap** with `scripts/seed-demo-vault.sh` (default `VAULT_ROOT=/opt/company-brain`). It is **not** part of the client-core tarball and must not be confused with pinned Hermes/client-core artifacts. See `artifacts/demo-vault/README.md` and phase-5 plan under `references/plans/lanyard-hermes-gateway-and-mocklab-vault/`.

**MockLab Daytona S3 vault** (`lp-zuh.9.5` / `lp-oop.38.18`): durable skills / AGENTS / Projects / kitchen-sink `config.yaml` under the tenant prefix live in **`artifacts/mocklab-vault-seed/`**, applied with `scripts/seed-mocklab-s3-vault.sh` (local dir or `s3://lanyard-mocklab-vault-…/tenants/{id}/vault/`). Harness `BACKEND_HOME` is the same document. Offline smoke: `scripts/smoke-seed-mocklab-s3-vault.sh` and `scripts/smoke-mocklab-harness-backend-home.sh`.

## Provenance files

After a successful seed:

```text
/opt/company-brain/.seed/
  provenance.env          # url, version, sha256, attestation_*, signing_*, relay_contract_major, seeded_at
  client-core-version
  hermes-version
  relay-contract-major
  seeded-at

/opt/hermes-lanyard/.seed/
  provenance.env          # includes attestation_status, attestation_alg=ed25519, signing_pubkey_sha256
```

When attestation runs, provenance records `attestation_status=verified|skipped`, `attestation_alg=ed25519`, `signing_pubkey_sha256=<hex>` (SHA-256 of DER SPKI), and optional `signing_identity`.

## Instance credentials (dual download path)

| Pin scheme | Auth at download time | Notes |
|------------|----------------------|--------|
| **`s3://`** (preferred for production) | EC2 instance role (`artifact_s3_bucket_arns`) | Platform product-artifact bucket prefixes `hermes/`, `client-core/` |
| **`https://` public or pre-signed** | None (or signature in URL) | Do not bake long-lived access keys into user_data |
| **`https://` private GitHub Release** | **`GITHUB_TOKEN` or `GH_TOKEN` env** | First private releases (see `compatibility/pins.real-releases.yaml`). Bootstrap resolves browser `…/releases/download/…` URLs via the GitHub API asset endpoint (`Accept: application/octet-stream`). **Never commit tokens** — inject via SSM/Secrets Manager/host env at deploy time |

Private GitHub browser download URLs often **404** without the API + token path; `scripts/bootstrap-host.sh` handles that when a token is present. Prefer migrating pins to **`s3://`** once OIDC publish lands objects under the platform bucket.

## Formats

Supported archives: `.tar.gz` / `.tgz` / `.tar` / `.zip`. A single top-level directory is flattened on extract.

Downloads are stored under a generic `.artifact` name. `scripts/bootstrap-host.sh` resolves format from the **pin URL path** (query strings and fragments ignored), then falls back to **content magic bytes**. Unrecognized content fails closed after SHA-256 verification.

## This directory

Do **not** commit real tarballs or customer seeds into git. Publish artifacts to the private artifact registry (S3 or equivalent). This `artifacts/` tree holds documentation only (`README.md`).

## Platform release landing zone (Phase 2)

Deploy-owned S3 bucket + prefixes are defined by `modules/product-artifact-infra` and applied from `environments/platform-staging` (after operators replace placeholders). The bucket uses versioning plus Object Lock (default GOVERNANCE retention) so release object versions are not deletable during the retention window.

| Product | Default prefix | Pin fields |
|---------|----------------|------------|
| Hermes Lanyard runtime | `hermes/<version>/…` | `hermes_artifact_url` / version / sha256 |
| client-core seed | `client-core/<version>/…` | `client_core_artifact_url` / version / sha256 |

Portal **image digests** land in ECR repositories created by the same module (`web`, `bff`, `relay`, `control-plane`) and are recorded under `compatibility/` — not as brain-host bootstrap tarballs.

**Publish honesty:** first Hermes (`v0.1.0-g7h2`) and client-core (`v0.1.0-g7c2`) private GitHub release pins are documented in `compatibility/pins.real-releases.yaml`. Portal ECR digests and platform S3 mirrors may still be unpublished. Infra can exist before every artifact family has a real pin. See `references/readiness-matrix.md` and `references/product-artifact-release-contract.md`.

## Operator checklist

```bash
# Compute digest when publishing a release
sha256sum client-core-v0.1.0.tar.gz

# On host after terraform apply (script installed by user_data):
# Pins are in /etc/company-brain/artifact-pins.env and loaded automatically.
sudo /usr/local/sbin/company-brain-bootstrap
```

The host executable is the monorepo canonical `scripts/bootstrap-host.sh`, injected via Terraform `base64gzip` (`bootstrap_script_b64`) and installed root-owned at `/usr/local/sbin/company-brain-bootstrap`.

## Related

- `scripts/bootstrap-host.sh`
- `scripts/smoke-bootstrap-inject.sh`
- `scripts/smoke-artifact-attestation.sh` (offline accept/reject for Ed25519 pins)
- `templates/tenant/main.tf` (injects bootstrap)
- `modules/company-brain-ec2/`
- `modules/product-artifact-infra/`
- `environments/platform-staging/`
- `compatibility/`
- `references/provision-runbook.md`
- `references/product-artifact-release-contract.md`
- `references/readiness-matrix.md`
