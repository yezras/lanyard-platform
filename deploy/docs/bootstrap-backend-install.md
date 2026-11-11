# Bootstrap backend install (paths + provenance)

**Bead:** `lp-k7g.7.4` · **Status:** platform scaffold coexists with imported product under `deploy/` (`lp-k7g.10.1`+).

## Design

Full design (layout, algorithm, idempotency, env mapping):

[`docs/architecture/deploy-bootstrap-backend-install.md`](../../docs/architecture/deploy-bootstrap-backend-install.md)

## Scaffold in this tree

| Path | Role |
| --- | --- |
| [`../scripts/bootstrap-backend-install.sh`](../scripts/bootstrap-backend-install.sh) | Reference install: download → verify → `versions/<ver>/` → `current` → provenance JSON |
| [`../schemas/backend-install-provenance.schema.json`](../schemas/backend-install-provenance.schema.json) | Provenance JSON Schema |
| [`../examples/backend-install-provenance.example.json`](../examples/backend-install-provenance.example.json) | Example provenance document |

## Canonical layout

```text
/opt/company-brain-backend/
  versions/<version>/          # extracted backend artifact
    .seed/provenance.json
  current -> versions/<version>
```

## Pins consumed

Primary: `BACKEND_ARTIFACT_{URL,VERSION,SHA256,KIND}`,
optional `BACKEND_ARTIFACT_ARCH` (`linux-x86_64` \| `linux-aarch64`),
`BACKEND_CONTRACT_{RUNTIME_LAYOUT,RELAY,BRAIN_RPC}`,
`BACKEND_INSTALL_ROOT` (default `/opt/company-brain-backend`).

Temporary fallback: `HERMES_ARTIFACT_*` (including `HERMES_ARTIFACT_ARCH`),
`RELAY_CONTRACT_MAJOR`, `HERMES_INSTALL_PATH`
(from `lp-k7g.7.3` user_data dual-write).

**Arch fail-closed (`lp-2md.3`):** after extract (or from pin/URL earlier), host
`uname -m` must match artifact `TARGET_ARCH` / pin / arch-labeled URL path.
Mismatch or missing metadata aborts install (do not start `hermes-gateway`).
Offline smoke: `bash deploy/scripts/smoke-bootstrap-arch-check.sh`.

## Merge note (phase 6)

Replace the Hermes install block in imported `scripts/bootstrap-host.sh` with this
versioned layout (or source this script). Client-core vault seed stays separate.
