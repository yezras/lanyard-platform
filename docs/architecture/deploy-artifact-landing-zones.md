# Artifact landing zones and OIDC publisher trust

Bead: `lp-k7g.7.6` (phase 3). Parent epic: `lp-k7g.7`.

This document is the **platform-side S3 prefix and GitHub Actions OIDC publisher
contract** for multiple backend product families. It generalizes the Hermes-only
landing zone in `company-brain-deploy` `modules/product-artifact-infra` without
changing client-core or portal-web coordinates.

`company-brain-deploy` is **imported** under [`deploy/`](../../deploy/) (`lp-k7g.10.1`).
Live module HCL plus landing-zone stubs (`*.tf.example`) live under
[`deploy/modules/product-artifact-infra/`](../../deploy/modules/product-artifact-infra/).

## Source of truth today (`deploy/`)

Monorepo paths:

| Surface | Path | Hermes-era fields |
| --- | --- | --- |
| Artifact bucket + Object Lock | `deploy/modules/product-artifact-infra/s3.tf` | Single private versioned bucket |
| Prefix locals | `deploy/modules/product-artifact-infra/main.tf` | `hermes/` · `client-core/` · `portal-web/` |
| Prefix variable | `deploy/modules/product-artifact-infra/variables.tf` → `artifact_prefixes` | Keys: `hermes`, `client_core`, `portal_web` |
| OIDC roles | `deploy/modules/product-artifact-infra/iam_oidc.tf` | Roles `portal`, `hermes`, `client_core` |
| Publisher map default | `variables.tf` → `publisher_repos` | `hermes` → `s3_write_prefix_keys = ["hermes"]` |
| URL templates | `outputs.tf` | `hermes_artifact_url_template`, `client_core_*`, `portal_web_*` |
| Release contract | `deploy/references/product-artifact-release-contract.md` | Hermes + client-core dual path; portal-web static |
| Hermes publish workflow | `LanyardBrain/hermes-lanyard` → `release-lanyard-artifact.yml` | Uploads `s3://$BUCKET/hermes/<version>/…` |
| Offline IAM smoke | `deploy/scripts/smoke-product-artifact-iam.sh` | Asserts hermes/ · client-core/ · portal-web/ |

**Unchanged in this bead:** `client-core/` and `portal-web/` object prefixes, and
their OIDC publisher roles (`client_core`, `portal`). Backend families move under
a shared `backends/` tree.

## Goal

Support **multiple backend artifact families** in one platform bucket while:

1. Keeping **Hermes-Lanyard publisher trust** working (same GitHub repo, tag OIDC
   subjects, least-privilege S3 write).
2. Documenting a first-class **Lanyard Agent** publisher path.
3. Leaving **client-core** and **portal-web** prefixes exactly as today.
4. Aligning preferred pin URLs with CompatibilityPinsV2
   ([`compatibility/README.md`](../../compatibility/README.md),
   [`pins.example.yaml`](../../compatibility/pins.example.yaml)).

## Kind → S3 prefix (backend artifact prefix strategy)

Backend kinds are enum values in pins / `manifest/backend.json`
(`hermes_upstream` \| `hermes_lanyard` \| `lanyard_agent`). Object keys use a
**kind slug**: underscore → hyphen.

| `backend.kind` | Kind slug | Canonical S3 prefix | Publisher role key |
| --- | --- | --- | --- |
| `hermes_lanyard` | `hermes-lanyard` | `backends/hermes-lanyard/` | `hermes_lanyard` (alias: `hermes`) |
| `lanyard_agent` | `lanyard-agent` | `backends/lanyard-agent/` | `lanyard_agent` |
| `hermes_upstream` | `hermes-upstream` | `backends/hermes-upstream/` | *(optional; only if a trusted publisher is configured)* |

### Object shape (backends)

Native-wheel backends (Hermes-Lanyard runtime) are **arch-labeled**. Preferred
shape once labeled publish is live (`lp-2md`):

```text
s3://$BUCKET/backends/<kind-slug>/<version>/<arch>/<filename>.tar.gz
```

| Arch label | When to pin |
| --- | --- |
| `linux-x86_64` | **Default product** (mocklab, typical `t3.*` EC2). |
| `linux-aarch64` | Optional secondary object only when packed/published on arm. |

Preferred filename for new pins: `backend.tar.gz` (kind-neutral). Product
repos may still emit product-named archives (e.g. `hermes-<version>.tar.gz`);
the pin `url` always points at the real object key. SHA-256 of the tarball
bytes remains mandatory. Operators also set `backend.arch` /
`backend_artifact_arch` to match the path segment (no silent default to an
unlabeled key once labeled objects exist).

Illustrative coordinates:

```text
s3://$BUCKET/backends/hermes-lanyard/v0.1.0-g7h2/linux-x86_64/backend.tar.gz
s3://$BUCKET/backends/lanyard-agent/v0.1.0/linux-x86_64/backend.tar.gz
s3://$BUCKET/backends/hermes-upstream/v1.2.3/linux-x86_64/backend.tar.gz
# optional arm secondary:
s3://$BUCKET/backends/hermes-lanyard/v0.1.0-g7h2/linux-aarch64/backend.tar.gz
```

Hermes product publish (current hermes-lanyard workflow; same arch segment):

```text
s3://$BUCKET/hermes/<version>/linux-x86_64/hermes-<version>.tar.gz
s3://$BUCKET/hermes/<version>/linux-x86_64/hermes-<version>.sha256
s3://$BUCKET/hermes/<version>/linux-x86_64/hermes-<version>.meta
```

### Non-backend prefixes (**unchanged**)

| Product | Prefix (default) | Pin fields | Publisher role |
| --- | --- | --- | --- |
| client-core | `client-core/` | `client_core.url` / version / sha256 | `client_core` |
| Portal static web | `portal-web/` | `portal.web.url` / version / sha256 | `portal` (+ ECR push) |

```text
s3://$BUCKET/client-core/<version>/client-core.tar.gz
s3://$BUCKET/portal-web/<version>/portal-web.tar.gz
```

**client-core** is an **arch-neutral seed tarball** (vault content). It does not
use a `linux-x86_64` path segment or `backend.arch`. Do **not** nest client-core
or portal-web under `backends/`. Backend kind/arch swaps must not change those
coordinates ([compatibility pins](../../compatibility/README.md)).

### Full bucket layout (target)

```text
s3://$BUCKET/
  backends/
    hermes-lanyard/<version>/linux-x86_64/…
    hermes-lanyard/<version>/linux-aarch64/…   # optional
    lanyard-agent/<version>/linux-x86_64/…
    hermes-upstream/<version>/linux-x86_64/…   # optional family
  client-core/<version>/…                      # UNCHANGED (arch-neutral)
  portal-web/<version>/…                       # UNCHANGED
  hermes/<version>/linux-x86_64/…              # product dual-write / migration
  hermes/<version>/hermes-<version>.*          # DEPRECATED unlabeled
```

## Migration: `hermes/` → `backends/hermes-lanyard/`

### Legacy prefix (temporary)

**Canonical product publish (arch-labeled):**

```text
s3://$BUCKET/hermes/<version>/linux-x86_64/hermes-<version>.tar.gz
```

**DEPRECATED unlabeled keys** (arch-ambiguous; incident: aarch64 wheels on x86_64):

```text
s3://$BUCKET/hermes/<version>/hermes-<version>.tar.gz
```

(see hermes-lanyard `release-lanyard-artifact.yml` and product-artifact-infra defaults).

Legacy unlabeled objects may still resolve during migration, but **new pins must
use the arch-labeled key** and set `backend.arch` / `backend_artifact_arch`
intentionally. Do not auto-delete old objects; repin consumers first
([`translation-v1-to-v2.md`](../../compatibility/translation-v1-to-v2.md)).

### Dual-write window (recommended)

During the migration window for Hermes-Lanyard:

| Step | Behavior |
| --- | --- |
| 1. Infra | Expand Hermes publisher S3 write to **both** `hermes/` and `backends/hermes-lanyard/` |
| 2. Product workflow | Prefer upload to `backends/hermes-lanyard/<version>/…`; optionally mirror the same SHA under `hermes/<version>/…` until all tenant pins migrate |
| 3. Pins | New pins use `backends/hermes-lanyard/…`; existing `hermes/…` pins keep working |
| 4. Cutover | After tenants point at `backends/…`, drop dual-write and remove default `hermes/` prefix key from new environments |

Never delete locked Object Lock versions early; leave legacy keys to retention /
lifecycle.

### Terraform prefix map (target shape)

Today (`artifact_prefixes` object keys):

```hcl
artifact_prefixes = {
  hermes      = "hermes/"
  client_core = "client-core/"
  portal_web  = "portal-web/"
}
```

Target (additive keys; **do not rename** `client_core` / `portal_web`):

```hcl
artifact_prefixes = {
  # Backend families (kind slug under backends/)
  hermes_lanyard  = "backends/hermes-lanyard/"
  lanyard_agent   = "backends/lanyard-agent/"
  hermes_upstream = "backends/hermes-upstream/" # optional family

  # Unchanged non-backend products
  client_core = "client-core/"
  portal_web  = "portal-web/"

  # TEMPORARY legacy alias — same bytes path family as hermes_lanyard
  hermes = "hermes/"
}
```

Implementation options when merging into imported product-artifact-infra:

1. **Preferred:** replace scalar `hermes` default with `hermes_lanyard` default
   `backends/hermes-lanyard/`, keep optional `hermes` key for dual-write IAM only.
2. **Minimal churn:** keep `hermes` variable key but set its default string to
   `backends/hermes-lanyard/` — **not recommended** because object key ≠ IAM key
   name and Lanyard Agent needs a second backend prefix anyway.

URL template outputs should gain kind-aware names:

| Output (target) | Template |
| --- | --- |
| `backend_artifact_url_template` | `s3://$BUCKET/backends/<KIND_SLUG>/<VERSION>/<ARCH>/<FILENAME>` |
| `hermes_lanyard_artifact_url_template` | `s3://$BUCKET/backends/hermes-lanyard/<VERSION>/<ARCH>/<FILENAME>` |
| `lanyard_agent_artifact_url_template` | `s3://$BUCKET/backends/lanyard-agent/<VERSION>/<ARCH>/<FILENAME>` |
| `hermes_artifact_url_template` | Prefer arch-labeled: `s3://$BUCKET/hermes/<VERSION>/<ARCH>/<FILENAME>`; unlabeled `…/hermes/<VERSION>/<FILENAME>` is **DEPRECATED** |
| `client_core_artifact_url_template` | **UNCHANGED** (arch-neutral; no `<ARCH>` segment) |
| `portal_web_artifact_url_template` | **UNCHANGED** |

Default `<ARCH>` for mocklab and docs examples: **`linux-x86_64`**.

## OIDC publisher trust

### Shared rules (unchanged)

From product-artifact-infra (still apply):

1. **Existing OIDC provider only** — `github_oidc_provider_arn` points at an
   already-created `token.actions.githubusercontent.com` provider. Module never
   creates `aws_iam_openid_connect_provider`.
2. **Default subjects: release tags only** —
   `repo:${github_org}/${repository}:ref:refs/tags/*`. Never default to
   `refs/heads/main` or `master`.
3. **Least privilege S3** — `GetBucketLocation` bucket-scoped without `s3:prefix`;
   `ListBucket` / `ListBucketVersions` prefix-conditioned; object writes
   `Resource = arn:…:bucket/$prefix*`.
4. **Optional VPCE restriction** auto-exempts publisher roles so GitHub Actions
   is not locked out of the public S3 API path.

### Hermes-Lanyard (**still works**)

| Field | Value |
| --- | --- |
| GitHub product authority | `LanyardBrain/hermes-lanyard` (not the archived public fork, not Nous upstream) |
| Default OIDC `sub` | `repo:LanyardBrain/hermes-lanyard:ref:refs/tags/*` |
| Role key (stable) | Prefer `hermes_lanyard`; keep `hermes` as **accept-only alias** for one migration window so existing role name `${name_prefix}-gha-hermes` and workflow vars (`AWS_ROLE_ARN`) keep working |
| S3 write prefixes (migration) | `backends/hermes-lanyard/` **and** temporary `hermes/` |
| S3 write prefixes (steady state) | `backends/hermes-lanyard/` only |
| ECR | none |

Example `publisher_repos` entry (target):

```hcl
hermes_lanyard = {
  repository           = "hermes-lanyard"
  subjects             = [] # → tags only via module default
  s3_write_prefix_keys = ["hermes_lanyard", "hermes"] # drop "hermes" after cutover
  ecr_push_services    = []
}

# TEMPORARY alias role (only if operators still bind AWS_ROLE_ARN to *-gha-hermes):
# Either keep key "hermes" with the same repository + dual prefixes, or leave a
# single role and update product workflow vars once.
```

**Acceptance note:** “Hermes-Lanyard publisher trust still works” means:

- Tag-only OIDC trust to `LanyardBrain/hermes-lanyard` remains the default.
- The publisher role can still `PutObject` under a Hermes-Lanyard prefix
  (`backends/hermes-lanyard/` and/or legacy `hermes/` during dual-write).
- Existing workflow contract (OIDC `id-token: write`, `AWS_ROLE_ARN`, bucket
  variable, immutable `v*` tags) does not require a different auth model.
- client-core and portal publishers are unaffected.

### Lanyard Agent (new path)

| Field | Value |
| --- | --- |
| GitHub product authority | `LanyardBrain/lanyard-agent` (external backend product; [ADR 0002](../adr/0002-external-backend-products.md)) |
| Default OIDC `sub` | `repo:LanyardBrain/lanyard-agent:ref:refs/tags/*` |
| Role key | `lanyard_agent` → IAM name `${name_prefix}-gha-lanyard_agent` |
| S3 write prefixes | `backends/lanyard-agent/` **only** |
| ECR | none |
| Pin fields | `backend.kind: lanyard_agent` + `backend.url` / version / sha256 / contract |

Example:

```hcl
lanyard_agent = {
  repository           = "lanyard-agent"
  subjects             = []
  s3_write_prefix_keys = ["lanyard_agent"]
  ecr_push_services    = []
}
```

Product workflow (lives in `lanyard-agent`, not this monorepo) should:

1. Trigger on immutable tags `v*` only.
2. Assume the `lanyard_agent` OIDC role (`id-token: write`).
3. Upload `s3://$BUCKET/backends/lanyard-agent/<version>/backend.tar.gz` (+ `.sha256` sidecar if used).
4. Emit pin fields for operators (`backend.kind`, `url`, `version`, `sha256`).

Platform does **not** vendor agent source; it only trusts the publisher identity
and pins the resulting object ([ADR 0002](../adr/0002-external-backend-products.md)).

### client-core and portal (**unchanged**)

| Role key | Trust (default) | S3 | ECR |
| --- | --- | --- | --- |
| `client_core` | `repo:LanyardBrain/client-core:ref:refs/tags/*` | `client-core/` only | none |
| `portal` | `repo:LanyardBrain/Portal:ref:refs/tags/*` | `portal-web/` only | `web`, `bff`, `relay`, `control-plane` |

Prefix strings and default `s3_write_prefix_keys` for these two roles must not
change as part of backend generalization.

### Full target `publisher_repos` map

```hcl
publisher_repos = {
  portal = {
    repository           = "Portal"
    s3_write_prefix_keys = ["portal_web"]
    ecr_push_services    = ["web", "bff", "relay", "control-plane"]
  }
  client_core = {
    repository           = "client-core"
    s3_write_prefix_keys = ["client_core"]
    ecr_push_services    = []
  }
  hermes_lanyard = {
    repository           = "hermes-lanyard"
    s3_write_prefix_keys = ["hermes_lanyard", "hermes"] # hermes temporary
    ecr_push_services    = []
  }
  lanyard_agent = {
    repository           = "lanyard-agent"
    s3_write_prefix_keys = ["lanyard_agent"]
    ecr_push_services    = []
  }
}
```

Validation allow-list for `s3_write_prefix_keys` must expand from
`{hermes, client_core, portal_web}` to include `hermes_lanyard`, `lanyard_agent`,
and optional `hermes_upstream` (plus temporary `hermes`).

## Pin ↔ landing zone map

| Pins v2 field | Preferred S3 URL shape |
| --- | --- |
| `backend` (`kind=hermes_lanyard`, `arch=linux-x86_64`) | `s3://$BUCKET/backends/hermes-lanyard/<version>/linux-x86_64/…` or product `hermes/<version>/linux-x86_64/…` |
| `backend` (`kind=lanyard_agent`, `arch=…`) | `s3://$BUCKET/backends/lanyard-agent/<version>/<arch>/…` |
| `backend` (`kind=hermes_upstream`, `arch=…`) | `s3://$BUCKET/backends/hermes-upstream/<version>/<arch>/…` |
| `backend.arch` | `linux-x86_64` (default product) \| `linux-aarch64` (optional arm); maps to `backend_artifact_arch` / `BACKEND_ARTIFACT_ARCH` |
| `client_core` | `s3://$BUCKET/client-core/<version>/…` (**unchanged**, arch-neutral) |
| `portal.web` | `s3://$BUCKET/portal-web/<version>/portal-web.tar.gz` (**unchanged**) |

HTTPS GitHub Release URLs remain allowed by the pin validator during migration
(`https://` or `s3://` only). Prefer S3 + instance-role download for brain hosts.
When HTTPS lacks an arch path segment, still set `backend.arch` and verify
in-tarball `TARGET_ARCH` (bootstrap fail-closed: `lp-2md.3`).

Terraform tenant pins use generic
`backend_artifact_url` / `version` / `sha256` / `kind` / **`backend_artifact_arch`**
([deploy-backend-artifact-variables.md](deploy-backend-artifact-variables.md)).

## Bucket controls (carry-forward)

Unchanged from product-artifact-infra:

- Versioning enabled; **Object Lock** at bucket creation; default GOVERNANCE/90d
- Public access blocked; BucketOwnerEnforced; TLS-only bucket policy
- Optional VPCE restriction with publisher auto-exempt
- SSE-S3 default; optional customer-managed KMS (grant publishers + brain-host readers)

## Merge plan when `deploy/` is imported (phase 6 + follow-on)

1. Import `company-brain-deploy` → `deploy/` (Bead `lp-k7g.10.x`).
2. Update `modules/product-artifact-infra`:
   - Expand `artifact_prefixes` / `prefix_by_key` for backend families.
   - Expand `publisher_repos` defaults + validation allow-list.
   - Add backend URL template outputs; mark `hermes_*` templates temporary.
   - Extend offline `scripts/smoke-product-artifact-iam.sh` for new prefixes and
     denied-prefix simulation (`lanyard_agent` cannot write `client-core/`, etc.).
3. Update `references/product-artifact-release-contract.md` to match this doc.
4. Dual-write Hermes-Lanyard publish workflow; migrate pins; then drop `hermes/`.
5. Add Lanyard Agent release workflow OIDC upload (product repo) using the new role.

Scaffolding in this monorepo (pre-import):

| Path | Role |
| --- | --- |
| This document | Canonical design |
| [`deploy/docs/artifact-landing-zones.md`](../../deploy/docs/artifact-landing-zones.md) | Short pointer |
| [`deploy/modules/product-artifact-infra/`](../../deploy/modules/product-artifact-infra/) | Example prefixes + publisher map + merge notes |
| [`deploy/scripts/smoke-artifact-landing-zones.sh`](../../deploy/scripts/smoke-artifact-landing-zones.sh) | Offline contract checks |

## Acceptance (lp-k7g.7.6)

| Criterion | Evidence |
| --- | --- |
| Backend artifact prefix strategy exists | This doc § Kind → S3 prefix; example layout under `backends/<kind-slug>/` |
| Hermes-Lanyard publisher trust still works | § OIDC publisher trust → Hermes-Lanyard (tag subjects, dual-write `hermes/` + `backends/hermes-lanyard/`) |
| Lanyard Agent publisher path is documented | § Lanyard Agent (repo, role key, `backends/lanyard-agent/`, pin fields) |
| client-core and portal prefixes remain unchanged | § Non-backend prefixes; `client-core/` and `portal-web/` not under `backends/` |

## Related docs

- [Phase 3 plan](../plans/0001-platform-monorepo-migration/phase-3-artifact-deploy-generalization.md)
- [Compatibility pins v2](../../compatibility/README.md)
- [Backend artifact Terraform variables](deploy-backend-artifact-variables.md)
- [Bootstrap backend install](deploy-bootstrap-backend-install.md)
- [ADR 0002 external backends](../adr/0002-external-backend-products.md)
- company-brain-deploy (external until import): `modules/product-artifact-infra/`,
  `references/product-artifact-release-contract.md`
