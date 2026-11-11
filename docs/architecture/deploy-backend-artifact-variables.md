# Deploy Terraform: `hermes_artifact_*` → `backend_artifact_*`

Bead: `lp-k7g.7.3` (phase 3). Parent epic: `lp-k7g.7`.

This document is the **platform-side Terraform variable contract** for backend artifacts.
`company-brain-deploy` is **imported** under [`deploy/`](../../deploy/) (`lp-k7g.10.1`).
Additive `backend_artifact_*.tf` interfaces coexist with product `hermes_*` names
(`lp-k7g.10.2` path rewire); user_data dual-write is `lp-k7g.10.3`.

Pins v2 already use a generic `backend.*` block ([`compatibility/schema.json`](../../compatibility/schema.json), [translation](../../compatibility/translation-v1-to-v2.md)). Terraform variables must match that vocabulary so tenant tfvars and user_data pins stay aligned with pin files.

## Source of truth today (`deploy/`)

Monorepo paths (product tree + scaffolds):

| Surface | Path | Hermes-named fields |
| --- | --- | --- |
| EC2 module variables | `deploy/modules/company-brain-ec2/variables.tf` | `hermes_artifact_url`, `hermes_artifact_version`, `hermes_artifact_sha256`, `relay_contract_major`, `hermes_install_path` |
| EC2 backend_* interface | `deploy/modules/company-brain-ec2/backend_artifact_*.tf` | New `backend_artifact_*` + locals |
| EC2 user_data template | `deploy/modules/company-brain-ec2/user_data.sh.tftpl` | Writes primary `BACKEND_*` + temporary `HERMES_*` dual-write into `/etc/company-brain/artifact-pins.env` (`lp-k7g.10.3`) |
| EC2 module templatefile | `deploy/modules/company-brain-ec2/main.tf` (`aws_instance.hermes`) | Passes `local.effective_backend_*` into the template |
| EC2 outputs | `deploy/modules/company-brain-ec2/outputs.tf` → `artifact_pins` | Primary `backend_*` + temporary `hermes_*` / `relay_contract_major` (same effective values) |
| Tenant template variables | `deploy/templates/tenant/variables.tf` | Same `hermes_artifact_*` + `relay_contract_major` |
| Tenant → module wiring | `deploy/templates/tenant/main.tf` | Relative `../../modules/…`; passes hermes vars into `module.company_brain` |
| Tenant outputs / tfvars example | `deploy/templates/tenant/outputs.tf`, `terraform.tfvars.example` | `hermes_artifact_version`, example pins |
| Mocklab / product-artifact-infra | `deploy/deployments/mocklab/*`, `deploy/modules/product-artifact-infra/outputs.tf` | `hermes_artifact_*`, `hermes_artifact_url_template` |

**Unchanged in this bead:** `client_core_artifact_url` / `_version` / `_sha256` remain separate (client-core is not a backend).

## Target variable names

### Primary (required for real deploys)

| New Terraform variable | Type | Maps from pins v2 | Legacy (temporary) |
| --- | --- | --- | --- |
| `backend_artifact_url` | `string` | `backend.url` | `hermes_artifact_url` |
| `backend_artifact_version` | `string` | `backend.version` | `hermes_artifact_version` |
| `backend_artifact_sha256` | `string` | `backend.sha256` | `hermes_artifact_sha256` |
| `backend_artifact_kind` | `string` | `backend.kind` | *(none — new)*; default `hermes_lanyard` for existing tenants |
| `backend_artifact_arch` | `string` | `backend.arch` | product `hermes.target_arch` / `hermes.arch`; default **`linux-x86_64`** (optional `linux-aarch64`) |
| `backend_contract_runtime_layout` | `number` | `backend.contract.runtime_layout` | *(none — new)*; default `1` |
| `backend_contract_relay` | `number` | `backend.contract.relay` | `relay_contract_major` (string → number) |
| `backend_contract_brain_rpc` | `number` | `backend.contract.brain_rpc` | *(none — new)*; default `1` |
| `backend_install_path` | `string` | install profile / path | `hermes_install_path` |

### Validation rules (match pin validator)

- **URL schemes:** `https://` or `s3://` only (plus sentinel `UNCONFIGURED` / `REPLACE_ME` for unconfigured stacks). Reject `http://`.
- **Version:** immutable label (e.g. `v0.1.0-g7h2`). Do not accept `main` / `master` / `latest` / bare branch-like tokens (policy lives primarily in pin validator; TF can document).
- **sha256:** 64 hex (optional `sha256:` prefix normalized by bootstrap, not Terraform).
- **kind enum:** `hermes_upstream` \| `hermes_lanyard` \| `lanyard_agent` (same as pins v2 / `backend-runtime-v1`).
- **arch enum:** `linux-x86_64` (default product / mocklab) \| `linux-aarch64` (optional arm pack). Set intentionally; pin URL should include the same segment once labeled objects exist.
- **contract majors:** integers ≥ 1.

### Optional (parity with pins / bootstrap)

| Variable | Purpose |
| --- | --- |
| `backend_artifact_signature_b64` | Optional Ed25519 signature over tarball bytes (`backend.signature_b64`) |
| `backend_install_path` | Prefer root `/opt/company-brain-backend` (versioned layout + `current` symlink; see `lp-k7g.7.4` / [deploy-bootstrap-backend-install.md](deploy-bootstrap-backend-install.md)) |

## Temporary legacy aliases

**Policy:** legacy names remain **accept-only** for one migration window so existing private tfvars and operator runbooks do not break on import. They are **not** the long-term public surface.

| Legacy variable | Temporary role | Removal target |
| --- | --- | --- |
| `hermes_artifact_url` | Alias → `backend_artifact_url` when new var is null / unset | After all tenant tfvars and mocklab pins use `backend_artifact_*` |
| `hermes_artifact_version` | Alias → `backend_artifact_version` | same |
| `hermes_artifact_sha256` | Alias → `backend_artifact_sha256` | same |
| `relay_contract_major` | Alias → `backend_contract_relay` (string coerced to number) | same |
| `hermes_install_path` | Alias → `backend_install_path` | Bootstrap generalization (`lp-k7g.7.4`) |
| Outputs `hermes_*` / `relay_contract_major` | Dual-write alongside `backend_*` outputs | After consumers read new names |
| user_data `HERMES_ARTIFACT_*` / `RELAY_CONTRACT_MAJOR` | Dual-write with `BACKEND_ARTIFACT_*` / `BACKEND_CONTRACT_*` | After bootstrap reads `BACKEND_*` only (`lp-k7g.7.4`) |

### Resolution order (module locals)

```text
effective_backend_artifact_url =
  coalesce(non-null backend_artifact_url, hermes_artifact_url, "UNCONFIGURED")

effective_backend_contract_relay =
  coalesce(backend_contract_relay, tonumber(relay_contract_major), 1)
```

Rules:

1. If **both** new and legacy are set to non-sentinel values and **differ**, **fail plan** (check block) so operators cannot accidentally pin two backends.
2. If only legacy is set, emit a **warning** (Terraform `precondition` message or documented ops note) that the alias is temporary.
3. New-name-only stacks never need legacy variables.

Stub implementation: [`deploy/modules/company-brain-ec2/backend_artifact_locals.tf`](../../deploy/modules/company-brain-ec2/backend_artifact_locals.tf).

## user_data / artifact-pins.env contract

**Implemented** (`lp-k7g.10.3`): dual-write during migration.

```bash
# client-core (unchanged)
CLIENT_CORE_ARTIFACT_URL=...
CLIENT_CORE_ARTIFACT_VERSION=...
CLIENT_CORE_ARTIFACT_SHA256=...
# Primary (new)
BACKEND_ARTIFACT_URL=...
BACKEND_ARTIFACT_VERSION=...
BACKEND_ARTIFACT_SHA256=...
BACKEND_ARTIFACT_KIND=...
BACKEND_ARTIFACT_ARCH=...   # linux-x86_64 default; linux-aarch64 optional
BACKEND_CONTRACT_RUNTIME_LAYOUT=...
BACKEND_CONTRACT_RELAY=...
BACKEND_CONTRACT_BRAIN_RPC=...
BACKEND_INSTALL_PATH=...
# Temporary legacy aliases (same values; remove after bootstrap cutover)
HERMES_ARTIFACT_URL=...
HERMES_ARTIFACT_VERSION=...
HERMES_ARTIFACT_SHA256=...
HERMES_ARTIFACT_ARCH=...
RELAY_CONTRACT_MAJOR=...
HERMES_INSTALL_PATH=...
```

Canonical template: [`deploy/modules/company-brain-ec2/user_data.sh.tftpl`](../../deploy/modules/company-brain-ec2/user_data.sh.tftpl).
Checklist fragment: [`deploy/modules/company-brain-ec2/user_data_backend_pins.fragment.tftpl`](../../deploy/modules/company-brain-ec2/user_data_backend_pins.fragment.tftpl).

`templatefile(...)` args must pass **effective** locals (not raw legacy-only vars) — wired in `main.tf`.

## Tenant template wiring

Operators set pins on the tenant root (or private tfvars). The tenant module passes them into `company-brain-ec2`:

```hcl
module "company_brain" {
  source = "../../modules/company-brain-ec2"
  # ...
  backend_artifact_url     = var.backend_artifact_url
  backend_artifact_version = var.backend_artifact_version
  backend_artifact_sha256  = var.backend_artifact_sha256
  backend_artifact_kind    = var.backend_artifact_kind
  backend_artifact_arch    = var.backend_artifact_arch  # default linux-x86_64
  backend_contract_runtime_layout = var.backend_contract_runtime_layout
  backend_contract_relay          = var.backend_contract_relay
  backend_contract_brain_rpc      = var.backend_contract_brain_rpc
  backend_install_path            = var.backend_install_path

  # Temporary: only if still present on tenant variables
  hermes_artifact_url     = var.hermes_artifact_url
  hermes_artifact_version = var.hermes_artifact_version
  hermes_artifact_sha256  = var.hermes_artifact_sha256
  relay_contract_major    = var.relay_contract_major
  hermes_install_path     = var.hermes_install_path

  # client-core is arch-neutral (separate seed tarball; no backend_artifact_arch)
  client_core_artifact_url     = var.client_core_artifact_url
  client_core_artifact_version = var.client_core_artifact_version
  client_core_artifact_sha256  = var.client_core_artifact_sha256
}
```

Example stubs:

- [`deploy/templates/tenant/backend_artifact_variables.tf`](../../deploy/templates/tenant/backend_artifact_variables.tf)
- [`deploy/templates/tenant/backend_artifact_module_args.tf.example`](../../deploy/templates/tenant/backend_artifact_module_args.tf.example)
- [`deploy/templates/tenant/backend_artifact_outputs.tf`](../../deploy/templates/tenant/backend_artifact_outputs.tf)
- [`deploy/templates/tenant/terraform.tfvars.backend_artifact.example`](../../deploy/templates/tenant/terraform.tfvars.backend_artifact.example)

## Mapping from CompatibilityPinsV2

| Pins v2 field | Terraform variable | user_data env |
| --- | --- | --- |
| `backend.url` | `backend_artifact_url` | `BACKEND_ARTIFACT_URL` |
| `backend.version` | `backend_artifact_version` | `BACKEND_ARTIFACT_VERSION` |
| `backend.sha256` | `backend_artifact_sha256` | `BACKEND_ARTIFACT_SHA256` |
| `backend.kind` | `backend_artifact_kind` | `BACKEND_ARTIFACT_KIND` |
| `backend.arch` | `backend_artifact_arch` (default `linux-x86_64`) | `BACKEND_ARTIFACT_ARCH` (+ temporary `HERMES_ARTIFACT_ARCH`) |
| `backend.contract.runtime_layout` | `backend_contract_runtime_layout` | `BACKEND_CONTRACT_RUNTIME_LAYOUT` |
| `backend.contract.relay` | `backend_contract_relay` | `BACKEND_CONTRACT_RELAY` |
| `backend.contract.brain_rpc` | `backend_contract_brain_rpc` | `BACKEND_CONTRACT_BRAIN_RPC` |
| `backend.signature_b64` | `backend_artifact_signature_b64` (optional) | `BACKEND_ARTIFACT_SIGNATURE_B64` |
| `client_core.*` | `client_core_artifact_*` (unchanged; arch-neutral) | `CLIENT_CORE_ARTIFACT_*` |

**URL + arch:** Prefer
`s3://$BUCKET/…/<version>/linux-x86_64/…` (or `linux-aarch64` when intentional).
Do not silently construct or default to unlabeled `hermes/<version>/hermes-…`
paths once labeled objects exist. Bootstrap host arch check is `lp-2md.3`.

Operators may continue to hand-copy pin fields into tfvars (current deploy practice). A future helper may render tfvars from a pins file; out of scope here.

## Related surfaces (follow-on, not this bead)

| Surface | Bead | Note |
| --- | --- | --- |
| Bootstrap install paths + provenance | `lp-k7g.7.4` | Consume `BACKEND_*` env; `/opt/company-brain-backend/versions/<ver>` + `current` + provenance JSON — [deploy-bootstrap-backend-install.md](deploy-bootstrap-backend-install.md) |
| Systemd unit generalization | `lp-k7g.7.5` | Kind-aware service, not Terraform var rename |
| Artifact landing zones (`hermes/` → `backends/<kind-slug>/`) | `lp-k7g.7.6` | [deploy-artifact-landing-zones.md](deploy-artifact-landing-zones.md); product-artifact-infra URL templates + OIDC publishers |
| Upgrade / rollback runbook | `lp-k7g.7.7` | Operator docs for backend swaps |

## Merge plan when `deploy/` is imported

1. Import `company-brain-deploy` → `deploy/` (phase 6).
2. Add (or merge) stub files under `deploy/modules/company-brain-ec2/` and `deploy/templates/tenant/`.
3. Point `user_data.sh.tftpl` + `templatefile` args at **effective** backend locals; dual-write legacy env.
4. Update `terraform.tfvars.example`, mocklab, smoke scripts, and runbooks to prefer `backend_artifact_*`.
5. After tenants migrate: delete legacy variables, dual-write env keys, and hermes-named outputs.

## Acceptance (lp-k7g.7.3)

| Criterion | Evidence in this monorepo |
| --- | --- |
| Module variables expose `backend_artifact_url` / `version` / `sha256` | [`deploy/modules/company-brain-ec2/backend_artifact_variables.tf`](../../deploy/modules/company-brain-ec2/backend_artifact_variables.tf) |
| Tenant templates render generic backend variables | [`deploy/templates/tenant/`](../../deploy/templates/tenant/) stubs + module args example |
| Legacy aliases documented and temporary | This doc § Temporary legacy aliases; locals check blocks; stub comments mark `TEMPORARY` |

## Related docs

- [Phase 3 plan](../plans/0001-platform-monorepo-migration/phase-3-artifact-deploy-generalization.md)
- [Compatibility pins v2](../../compatibility/README.md)
- [Pins v1 → v2 translation](../../compatibility/translation-v1-to-v2.md)
- [Backend runtime contract](backend-runtime-contract.md)
- [Workspace map / ADR 0004](workspace-map.md)
