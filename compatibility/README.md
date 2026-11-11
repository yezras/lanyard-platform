# Compatibility pins (schema_version 2)

Platform-owned design for **immutable** artifact coordinates used by deploy bootstrap and Terraform. Pins name release objects (tarball URL + SHA-256, or image repository + digest). They never float on git branches.

This directory is platform-native. Full deploy product code (validators, bootstrap, Terraform) lands under `deploy/` in later Beads; this tree holds the pin **document shape** and examples only.

Related:

- Backend runtime contract: [`contracts/backend-runtime-v1/`](../contracts/backend-runtime-v1/)
- **Backend compatibility matrix** (kind · version · contract · capabilities · conformance · deploy readiness): [`docs/architecture/backend-compatibility-matrix.md`](../docs/architecture/backend-compatibility-matrix.md)
- Phase 3 plan: [`docs/plans/0001-platform-monorepo-migration/phase-3-artifact-deploy-generalization.md`](../docs/plans/0001-platform-monorepo-migration/phase-3-artifact-deploy-generalization.md)
- **Upgrade / rollback runbook** (change pins, re-bootstrap, Hermes-Lanyard → Lanyard Agent swap, previous-pin rollback): [`docs/runbooks/backend-upgrade-rollback.md`](../docs/runbooks/backend-upgrade-rollback.md)
- ADR 0002 (external backends): [`docs/adr/0002-external-backend-products.md`](../docs/adr/0002-external-backend-products.md)
- ADR 0003 (runtime contract): [`docs/adr/0003-backend-runtime-v1-contract.md`](../docs/adr/0003-backend-runtime-v1-contract.md)

## Files

| Path | Purpose |
|------|---------|
| [`schema.json`](schema.json) | JSON Schema (draft-07) for **schema_version 2** pin documents |
| [`pins.example.yaml`](pins.example.yaml) | Placeholder-safe example (synthetic digests/hosts; safe in git) |
| [`pins.hermes-lanyard-staging.example.yaml`](pins.hermes-lanyard-staging.example.yaml) | Staging cutover HL pins (`lp-k7g.12.5`): published private-release coordinates as `backend.kind: hermes_lanyard` (no tokens) |
| [`translation-v1-to-v2.md`](translation-v1-to-v2.md) | Field map + worked example: legacy `hermes.*` → `backend.*` |
| This README | Design summary, block layout, non-goals |

Staging operator path (generic `BACKEND_*`): [`docs/runbooks/staging-hermes-lanyard-backend-pins.md`](../docs/runbooks/staging-hermes-lanyard-backend-pins.md) · fragments under [`deploy/examples/staging-hermes-lanyard/`](../deploy/examples/staging-hermes-lanyard/).

Offline pin validation (platform-side; deploy product not yet imported):

```bash
bash scripts/validate.sh
# check 2 runs scripts/validate-compatibility-pins.py

python3 scripts/validate-compatibility-pins.py
python3 scripts/validate-compatibility-pins.py path/to/operator-pins.yaml
```

The validator enforces `schema.json` (schema_version 2), accepts `s3://` and `https://` artifact URLs, rejects mutable refs (`main`/`master`/`latest`/bare branch-like), checks `backend.kind`, sha256 format, and contract majors. After deploy import, the same policy will also live under `deploy/scripts/validate-compatibility.sh`.

## Design: CompatibilityPinsV2

Top-level required blocks:

```text
schema_version: 2          # const 2 for this document shape
backend:                   # selected backend product (replaces hermes)
  kind / version / sha256 / url / contract
client_core:               # SEPARATE block — never nested under backend
  version / sha256 / url
portal:                    # Portal web tarball + service images
  web? / images
```

Optional top-level:

- `meta` — operator notes (description, created_at, notes)
- `artifact_attestation` — Ed25519 publisher key / require flag (SHA-256 still required)

### Why schema_version 2

Legacy company-brain-deploy pins (`schema_version: 1`) used a Hermes-only top-level key:

```yaml
hermes:
  version: ...
  sha256: ...
  url: ...
relay_contract:
  major: 1
```

That shape cannot express backend kind (Hermes-Lanyard vs Hermes upstream vs Lanyard Agent) or the full contract majors claimed by `manifest/backend.json`. Version 2:

1. Renames the runtime product pin to **`backend`**
2. Adds **`backend.kind`** (`hermes_upstream` | `hermes_lanyard` | `lanyard_agent`)
3. Moves relay major into **`backend.contract.relay`** and adds `runtime_layout` + `brain_rpc`
4. Keeps **`client_core`** as its own top-level artifact (install next to the backend, not as a backend subcomponent)
5. Leaves **`portal`** structurally unchanged from v1

### backend block

| Field | Required | Notes |
|-------|----------|--------|
| `kind` | yes | Must match tarball `manifest/backend.json` `kind` |
| `version` | yes | Immutable release label; not a git ref |
| `sha256` | yes | 64 hex or `sha256:` + 64 hex |
| `url` | yes | `s3://` or `https://` release object (prefer arch-labeled key) |
| `arch` | no* | Platform label: `linux-x86_64` (default product) \| `linux-aarch64` (optional arm pack). Maps to Terraform `backend_artifact_arch` / env `BACKEND_ARTIFACT_ARCH`. Product workflow may print `hermes.target_arch` / `hermes.arch`. |
| `contract.runtime_layout` | yes | Integer ≥ 1 |
| `contract.relay` | yes | Integer ≥ 1 (replaces v1 `relay_contract.major`) |
| `contract.brain_rpc` | yes | Integer ≥ 1 |
| `signature_b64` | no | Per-artifact Ed25519 signature |

\*Schema-optional so older pin files still validate, but **operators must set
`arch` intentionally** for customer hosts. Docs and mocklab examples default to
**`linux-x86_64`**. Do not invent a silent unlabeled S3 path once
arch-labeled objects exist (lp-2md).

Preferred long-term URL shape (illustrative; **arch segment required** for
native-wheel backends once labeled publish is live):

```text
s3://$BUCKET/backends/<kind-slug>/<version>/<arch>/backend.tar.gz
```

Hermes-Lanyard product publish layout (current hermes-lanyard workflow):

```text
s3://$BUCKET/hermes/<version>/linux-x86_64/hermes-<version>.tar.gz
s3://$BUCKET/hermes/<version>/linux-x86_64/hermes-<version>.sha256
s3://$BUCKET/hermes/<version>/linux-x86_64/hermes-<version>.meta
# optional arm only when packed/published:
s3://$BUCKET/hermes/<version>/linux-aarch64/…
```

Kind slug = `backend.kind` with underscores → hyphens (`hermes_lanyard` →
`hermes-lanyard`, `lanyard_agent` → `lanyard-agent`). **Non-backend** products
keep top-level prefixes (unchanged, **arch-neutral** for client-core seed):

```text
s3://$BUCKET/client-core/<version>/client-core.tar.gz
s3://$BUCKET/portal-web/<version>/portal-web.tar.gz
```

**Deprecated (do not use for new pins once labeled objects exist):**

```text
s3://$BUCKET/hermes/<version>/hermes-<version>.tar.gz   # unlabeled; arch-ambiguous
```

Full S3 prefix + OIDC publisher trust contract (Hermes-Lanyard dual-write from
legacy `hermes/`, Lanyard Agent publisher path, arch labels):
[`docs/architecture/deploy-artifact-landing-zones.md`](../docs/architecture/deploy-artifact-landing-zones.md).

Existing Hermes-Lanyard release URLs (GitHub Releases or legacy unlabeled
`s3://…/hermes/<version>/…`) may still validate during migration; after
arch-labeled publish, **repin** to the `…/<arch>/…` object and set `backend.arch`
to match. Translation does **not** invent arch for old unlabeled keys.

### client_core block (separate)

| Field | Required |
|-------|----------|
| `version` | yes |
| `sha256` | yes |
| `url` | yes |
| `signature_b64` | no |

**Invariant:** `client_core` is never a property of `backend`. Deploy installs client-core into the vault root regardless of which backend kind is selected. Swapping `backend.kind` must not change the client-core pin shape.

**Arch:** client-core is an **arch-neutral seed tarball** (vault content / packs).
It does **not** use a `linux-x86_64` path segment or `backend.arch`. If native
dependencies appear later, adopt the same labeling contract as backends.

### portal block

Unchanged from v1:

- Optional `portal.web` — static SPA tarball (`version`, `sha256`, `url`)
- Required `portal.images` — map of service key → `{ repository, digest, tag? }`
- Recommended image keys: `bff`, `relay`, `control-plane`

### Alignment with backend-runtime-v1

Pin `backend.kind`, `backend.version`, and `backend.contract.*` should agree with the installed tarball’s [`manifest/backend.json`](../contracts/backend-runtime-v1/artifact-manifest.schema.json). Deploy and conformance work will enforce that match; this design only defines the pin document.

## Translation from schema_version 1

See **[translation-v1-to-v2.md](translation-v1-to-v2.md)** for the field map and a full Hermes-Lanyard worked example (legacy `hermes` + `relay_contract` → `backend`).

Summary:

| v1 field | v2 field |
|----------|----------|
| `schema_version: 1` | `schema_version: 2` |
| *(absent)* | `backend.kind` (default `hermes_lanyard` for existing Hermes-Lanyard pins) |
| `hermes.version` | `backend.version` |
| `hermes.sha256` | `backend.sha256` |
| `hermes.url` | `backend.url` (prefer arch-labeled URL after lp-2md.2 publish) |
| `hermes.arch` / `hermes.target_arch` | `backend.arch` (`linux-x86_64` default product; optional `linux-aarch64`) |
| `hermes.signature_b64` | `backend.signature_b64` |
| `relay_contract.major` | `backend.contract.relay` (use ≥ 1) |
| *(absent)* | `backend.contract.runtime_layout` (default `1` for current deploys) |
| *(absent)* | `backend.contract.brain_rpc` (default `1` for current deploys) |
| `client_core.*` | `client_core.*` (unchanged, still top-level; arch-neutral) |
| `portal.*` | `portal.*` (unchanged) |
| `meta` / `artifact_attestation` | same keys |

**Removed top-level keys in v2:** `hermes`, `relay_contract`. Validators for schema_version 2 must reject them (no silent dual-shape). Migration tooling may accept v1 input and emit v2; pin files committed for new work must be v2-only.

## Non-goals (this bead)

- Importing company-brain-deploy product scripts or private pin files
- Runtime download / digest verification of pin URLs
- Terraform variable renames (`backend_artifact`, user_data) — later phase-3 Beads
- Nesting client-core under backend or merging portal into backend

## Operator rules (carry-forward)

- Versions must not be live git refs (`main`, `master`, `HEAD`, `develop`, `latest`, …)
- URLs must be `s3://` or `https://` release objects — not git remotes
- Never commit tokens, live account IDs, or customer-specific private pins in `pins.example.yaml`
- Private overlays: gitignored operator paths only
- Backend upgrades and kind swaps follow [`docs/runbooks/backend-upgrade-rollback.md`](../docs/runbooks/backend-upgrade-rollback.md): capture the live pin set, change only `backend.*`, re-bootstrap, verify provenance/systemd/Portal, and roll back by re-pinning the previous immutable coordinates (version trees under `/opt/company-brain-backend/versions/` are retained for fast rollback).
