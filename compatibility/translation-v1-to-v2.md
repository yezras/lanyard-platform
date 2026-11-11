# Translating schema_version 1 (hermes.*) → schema_version 2 (backend.*)

This note formalizes how existing **company-brain-deploy** compatibility pins convert to the platform monorepo pin shape. Source of the legacy shape: `company-brain-deploy/compatibility/` (`schema_version: 1`, top-level `hermes`, `client_core`, `portal`, `relay_contract`).

Platform design only — do not copy deploy product validators here.

## Field map

| Legacy (v1) | Pins v2 | Rule |
|-------------|---------|------|
| `schema_version: 1` | `schema_version: 2` | Always |
| — | `backend.kind` | **Required new field.** For published Hermes-Lanyard product pins, set `hermes_lanyard`. Use `hermes_upstream` or `lanyard_agent` only when the artifact is that product. |
| `hermes.version` | `backend.version` | Copy string |
| `hermes.sha256` | `backend.sha256` | Copy (64 hex or `sha256:` prefix) |
| `hermes.url` | `backend.url` | Copy URL as-is (no re-publish required). Prefer rewrite to arch-labeled object when mirrored: `s3://$BUCKET/hermes/<version>/linux-x86_64/…` or `s3://$BUCKET/backends/hermes-lanyard/<version>/linux-x86_64/…` |
| `hermes.arch` / `hermes.target_arch` | `backend.arch` | Copy when present. Product default is `linux-x86_64`. Optional arm pack = `linux-aarch64`. If absent on old unlabeled pins, set intentionally on repin (do not invent unlabeled path). |
| `hermes.signature_b64` | `backend.signature_b64` | Copy if present |
| `relay_contract.major` | `backend.contract.relay` | Copy integer. If `0` or missing, use `1` (platform v1 floor) |
| — | `backend.contract.runtime_layout` | Default `1` for all current Hermes-Lanyard deploys |
| — | `backend.contract.brain_rpc` | Default `1` for all current Hermes-Lanyard deploys |
| `client_core` | `client_core` | **Copy entire block unchanged.** Remains a **separate top-level** key (arch-neutral seed; no `arch` field) |
| `portal` | `portal` | Copy entire block unchanged |
| `meta` | `meta` | Copy if present |
| `artifact_attestation` | `artifact_attestation` | Copy if present |

### Explicit non-mappings

| Do not | Why |
|--------|-----|
| Nest `client_core` under `backend` | client-core is an independent seed artifact installed into the vault root |
| Keep top-level `hermes` alongside `backend` | Dual-shape is migration-tool input only; committed v2 files reject `hermes` |
| Keep top-level `relay_contract` | Superseded by `backend.contract.relay` |
| Infer kind from URL alone without operator review | GitHub/S3 paths may still say `hermes` while the product is Hermes-Lanyard; default kind for existing deploy pins is `hermes_lanyard` |
| Silently map unlabeled `hermes/<version>/…` URLs to arch when labeled objects exist | Set `backend.arch` and pin the `…/<arch>/…` object intentionally (lp-2md) |

## Worked example: Hermes-Lanyard real-release coordinates

Illustrative translation of the first private Hermes-Lanyard + client-core pins (coordinates only; digests as published in deploy repo history). Placeholder Portal image repos retained as in the legacy file.

### Before — schema_version 1

```yaml
schema_version: 1

meta:
  description: "Private GH pins for Hermes/client-core; Portal digests pending ECR"

portal:
  web:
    version: "v0.1.0-g7p"
    sha256: "b1d00dafc01c1e7b1de5d0ace59f44b1697de8e90eefd290829b4f9d45d8dff1"
    url: "https://github.com/LanyardBrain/Portal/releases/download/v0.1.0-g7p/portal-web-v0.1.0-g7p.tar.gz"
  images:
    bff:
      repository: "example.dkr.ecr.example.amazonaws.com/lanyard-platform-staging/portal/bff"
      digest: "sha256:f6e8e9adbafe4ad82bb61c90861e0d5ae75e7f72135ee86986ba0453898d9620"
      tag: "v0.1.0-g7p"
    relay:
      repository: "example.dkr.ecr.example.amazonaws.com/lanyard-platform-staging/portal/relay"
      digest: "sha256:1b43ba48cf0529f6d9823ef6a8c6005dc0678dc36428cb0bcfcc26e4a975b771"
      tag: "v0.1.0-g7p"
    control-plane:
      repository: "example.dkr.ecr.example.amazonaws.com/lanyard-platform-staging/portal/control-plane"
      digest: "sha256:703e2436fdea0f926e3a2a24c4cf7e1ff13061e553d6f9d3c0aecd64d4b580d6"
      tag: "v0.1.0-g7p"

hermes:
  version: "v0.1.0-g7h2"
  sha256: "046f9987b10ae6f19a0e1e74bf2e68e5ce8ddeb853dee6a50211bc5cdffa71f4"
  url: "https://github.com/LanyardBrain/hermes-lanyard/releases/download/v0.1.0-g7h2/hermes-v0.1.0-g7h2.tar.gz"

client_core:
  version: "v0.1.0-g7c2"
  sha256: "ef21c313525afdca9902c40814293bbe924f428c219d93cf80398941c1f181e1"
  url: "https://github.com/LanyardBrain/client-core/releases/download/v0.1.0-g7c2/client-core-v0.1.0-g7c2.tar.gz"

relay_contract:
  major: 1
```

### After — schema_version 2

```yaml
schema_version: 2

meta:
  description: "Private GH pins for Hermes/client-core; Portal digests pending ECR"
  notes: "Translated from schema_version 1 hermes.* → backend.* (kind=hermes_lanyard)"

backend:
  kind: hermes_lanyard
  version: "v0.1.0-g7h2"
  sha256: "046f9987b10ae6f19a0e1e74bf2e68e5ce8ddeb853dee6a50211bc5cdffa71f4"
  url: "https://github.com/LanyardBrain/hermes-lanyard/releases/download/v0.1.0-g7h2/hermes-v0.1.0-g7h2.tar.gz"
  contract:
    runtime_layout: 1
    relay: 1
    brain_rpc: 1

client_core:
  version: "v0.1.0-g7c2"
  sha256: "ef21c313525afdca9902c40814293bbe924f428c219d93cf80398941c1f181e1"
  url: "https://github.com/LanyardBrain/client-core/releases/download/v0.1.0-g7c2/client-core-v0.1.0-g7c2.tar.gz"

portal:
  web:
    version: "v0.1.0-g7p"
    sha256: "b1d00dafc01c1e7b1de5d0ace59f44b1697de8e90eefd290829b4f9d45d8dff1"
    url: "https://github.com/LanyardBrain/Portal/releases/download/v0.1.0-g7p/portal-web-v0.1.0-g7p.tar.gz"
  images:
    bff:
      repository: "example.dkr.ecr.example.amazonaws.com/lanyard-platform-staging/portal/bff"
      digest: "sha256:f6e8e9adbafe4ad82bb61c90861e0d5ae75e7f72135ee86986ba0453898d9620"
      tag: "v0.1.0-g7p"
    relay:
      repository: "example.dkr.ecr.example.amazonaws.com/lanyard-platform-staging/portal/relay"
      digest: "sha256:1b43ba48cf0529f6d9823ef6a8c6005dc0678dc36428cb0bcfcc26e4a975b771"
      tag: "v0.1.0-g7p"
    control-plane:
      repository: "example.dkr.ecr.example.amazonaws.com/lanyard-platform-staging/portal/control-plane"
      digest: "sha256:703e2436fdea0f926e3a2a24c4cf7e1ff13061e553d6f9d3c0aecd64d4b580d6"
      tag: "v0.1.0-g7p"
```

### Checklist (per pin file)

1. Set `schema_version: 2`
2. Create `backend` from `hermes` + defaults for `kind` and `contract`
3. Delete top-level `hermes` and `relay_contract`
4. Leave `client_core` and `portal` in place (separate blocks)
5. Validate with `python3 scripts/validate-compatibility-pins.py path/to/pins.yaml` (or `bash scripts/validate.sh` for the example file)

## Synthetic example pins (git-safe)

[`pins.example.yaml`](pins.example.yaml) is the **canonical v2** document with placeholder digests. It already uses:

- `schema_version: 2`
- `backend.kind: hermes_lanyard`
- separate `client_core`
- `portal.web` + `portal.images`

It is not a translation of a live account pin set; use the worked example above for real Hermes-Lanyard coordinates.
