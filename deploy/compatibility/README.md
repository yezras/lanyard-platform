# Compatibility pins

Operators pin **immutable** coordinates for Portal images, Hermes runtime, client-core seed, and the relay connector contract major. Deploy paths never float on git branches.

**Operator procedure:** `references/runbooks/pin-update.md`  
**Release coordinates:** `references/product-artifact-release-contract.md`  
**Gate honesty:** `references/readiness-matrix.md` (G7 product publish)  
**Backend compatibility matrix** (kind · version · contract · capabilities · conformance · deploy readiness): [`docs/architecture/backend-compatibility-matrix.md`](../../docs/architecture/backend-compatibility-matrix.md) — default pin family is Hermes-Lanyard (`hermes_lanyard`); see matrix before selecting `lanyard_agent` or `hermes_upstream`

## Files

| Path | Purpose |
|------|---------|
| `schema.json` | JSON Schema (draft-07) for pin manifests |
| `pins.example.yaml` | Documented example with **placeholder-only** digests/SHAs (safe in git) |
| `pins.real-releases.yaml` | First **real** Hermes + client-core private GitHub release pins (coordinates only; no tokens). Portal digests still placeholders |
| `../scripts/validate-compatibility.sh` | Deterministic offline validator |
| `../references/runbooks/pin-update.md` | Operator steps: collect → private pin → validate → tenant tfvars |

`pins.example.yaml` is for **schema CI and documentation only**. Never replace it with live account IDs or customer coordinates.

`pins.real-releases.yaml` is committed in this **private** deploy repo as the first published Hermes/client-core coordinates (private GitHub Release HTTPS URLs + SHA-256). It contains **no tokens**. Downloading private release assets requires `GITHUB_TOKEN` or `GH_TOKEN` at bootstrap time (env / SSM / Secrets Manager — never git). Portal image digests in that file remain synthetic until ECR publish. Operator-specific or account-tied pin files stay gitignored (`pins.yaml`, `pins.local.yaml`, `pins.private.yaml`, `*-live.yaml`).

## Required fields

- **portal.images.\*.repository** — image repository (no tag-only pins)
- **portal.images.\*.digest** — `sha256:` + 64 hex chars
- **hermes.version** / **hermes.sha256** / **hermes.url** (optional **hermes.signature_b64**)
- **client_core.version** / **client_core.sha256** / **client_core.url** (optional **client_core.signature_b64**)
- **artifact_attestation** (optional) — `alg: ed25519`, `signing_pubkey_b64`, `signing_identity`, `require`
- **relay_contract.major** — non-negative integer

Recommended Portal image keys (align with `modules/product-artifact-infra` ECR services):

- `web`, `bff`, `relay`, `control-plane`

Versions must **not** be live git refs (`main`, `master`, `HEAD`, `develop`, `latest`, …).

URLs must be `s3://` or **`https://`** release objects — not git remotes (`http://` / `ws://` rejected).

## Usage

```bash
# Validate the example (always present in git; placeholder-safe)
bash scripts/validate-compatibility.sh compatibility/pins.example.yaml

# Validate first real Hermes/client-core private-release pins (Portal still placeholder)
bash scripts/validate-compatibility.sh compatibility/pins.real-releases.yaml

# Validate an operator pin file (keep account-specific live pins out of git)
bash scripts/validate-compatibility.sh /path/to/pins.yaml
```

### Private pin path (after first real product publish)

1. Confirm published objects / digests (do **not** invent SHA-256 or digests):
   - **Preferred production:** `s3://$BUCKET/hermes/<version>/…` and `client-core/<version>/…` (instance role)
   - **First private releases (G7.H2/C2):** HTTPS GitHub Release URLs in `pins.real-releases.yaml` (need `GITHUB_TOKEN`/`GH_TOKEN` at download time)
   - Portal: ECR digests when image-release publishes
2. Start from `compatibility/pins.real-releases.yaml` (Hermes/client-core) or `pins.example.yaml`; copy to a private ops path for account-specific Portal digests.
3. `bash scripts/validate-compatibility.sh /path/to/private-pins.yaml`
4. Map `hermes.*` / `client_core.*` / `relay_contract.major` into tenant `terraform.tfvars` artifact variables.
5. For private GitHub HTTPS pins, ensure the host env has `GITHUB_TOKEN` or `GH_TOKEN` (never commit; SSM/Secrets Manager recommended).
6. `terraform apply` → `sudo /usr/local/sbin/company-brain-bootstrap` → check `/opt/*/.seed/provenance.env`.

Full checklist: `references/runbooks/pin-update.md`.

**Honesty:** Hermes + client-core now have first real private-release coordinates. Portal digests and platform S3 mirrors may still be unpublished — leave those slots placeholder / `UNCONFIGURED` until real publishes. See readiness matrix **G7** rows.

## Release infrastructure (Phase 2)

Deploy-owned landing zones for pins:

| Artifact | Infra | Prefix / repo |
|----------|-------|---------------|
| Hermes tarball | S3 product bucket | `hermes/<version>/…` |
| client-core tarball | S3 product bucket | `client-core/<version>/…` |
| Portal static web | S3 product bucket | `portal-web/<version>/…` |
| Portal backend images | ECR (immutable tags) | `<name_prefix>/portal/{web,bff,relay,control-plane}` |

Module: `modules/product-artifact-infra/`. Staging root: `environments/platform-staging/`.

**Publishing honesty:** first Hermes/client-core private GitHub release pins are in `pins.real-releases.yaml`. Platform S3 mirrors and Portal ECR digests may still be gated. Do not invent pins. See `references/readiness-matrix.md` and `references/product-artifact-release-contract.md`.

## Out of scope here

- Product build/publish CI implementation (Portal, hermes-lanyard, client-core repos)
- Portal ECS/service deployment modules
- Control-plane RDS live apply (product Postgres uses `CONTROL_PLANE_DATABASE_URL`; deploy module `modules/control-plane-rds` is **infra_ready**, not auto-applied)
- Attaching the control plane to a **public ALB** (forbidden; G1 — see `scripts/policy-as-code-security.sh`)
