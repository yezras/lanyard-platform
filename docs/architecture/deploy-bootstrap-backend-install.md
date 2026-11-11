# Deploy bootstrap: generic backend install paths and provenance

Bead: `lp-k7g.7.4` (phase 3). Parent epic: `lp-k7g.7`.

This document generalizes host bootstrap install layout and provenance from
Hermes-specific paths (`/opt/hermes-lanyard`, `provenance.env`) to a **backend-kind
agnostic** layout under `/opt/company-brain-backend/`.

`company-brain-deploy` is **imported** under [`deploy/`](../../deploy/) (`lp-k7g.10.1`).
The reference generic installer is
[`deploy/scripts/bootstrap-backend-install.sh`](../../deploy/scripts/bootstrap-backend-install.sh)
and is intended to replace (or be merged into) the Hermes install block of
[`deploy/scripts/bootstrap-host.sh`](../../deploy/scripts/bootstrap-host.sh)
(later phase-6 beads).

Product baseline today (in-tree):
`deploy/scripts/bootstrap-host.sh`
— Hermes first: download → SHA-256 verify → optional Ed25519 attestation →
extract → flatten → rsync into `HERMES_INSTALL_PATH` (default `/opt/hermes-lanyard`)
→ write `.seed/provenance.env`.

Related:

- Terraform pin env: [deploy-backend-artifact-variables.md](deploy-backend-artifact-variables.md)
- Runtime home layout (`BACKEND_HOME`): [contracts/backend-runtime-v1/filesystem-layout.md](../../contracts/backend-runtime-v1/filesystem-layout.md)
- Systemd unit generalization: [deploy-backend-systemd-service.md](deploy-backend-systemd-service.md) (Bead `lp-k7g.7.5`)

---

## Goals

1. **Download and verify** the backend archive (SHA-256; optional attestation)
   **before** extraction.
2. Install under a **versioned tree** and point
   `/opt/company-brain-backend/current` at the selected version.
3. Write **JSON provenance** with backend kind, version, url, sha256, and
   contract majors.
4. Make install **idempotent**: re-running with the same pins converges to the
   same selected version and symlink without corrupting live trees.

Client-core vault seeding remains a **separate** artifact install (unchanged
concept from baseline bootstrap). This bead only generalizes the **backend**
install half. Client-core is an **arch-neutral** seed tarball; backend runtime
tarballs carry native wheels and must be pinned with
`backend.arch` / `BACKEND_ARTIFACT_ARCH` (default product **`linux-x86_64`**)
and an arch-labeled URL once labeled objects exist (pin contract: `lp-2md.4`;
host fail-closed arch check: `lp-2md.3` — do not rewrite here).

---

## Install layout

### Canonical host tree

```text
/opt/company-brain-backend/                 # BACKEND_INSTALL_ROOT
  versions/
    <version>/                              # e.g. v0.1.0-g7h2
      bin/…                                 # extracted artifact (flattened)
      manifest/…                            # optional
      .seed/
        provenance.json                     # install provenance (this bead)
  current -> versions/<version>             # active selection (symlink)
```

| Path | Role |
| --- | --- |
| `BACKEND_INSTALL_ROOT` | Default `/opt/company-brain-backend`. Parent of `versions/` and `current`. |
| `versions/<version>/` | Immutable-ish extract target for one pin version. Re-extract only when provenance/sha mismatch or forced refresh. |
| `current` | Relative symlink `versions/<version>` (prefer relative so the tree is relocatable under the root). |
| `versions/<version>/.seed/provenance.json` | Machine-readable install record (schema below). |

### Distinction: install root vs runtime home

| Name | What it is | Example |
| --- | --- | --- |
| `BACKEND_INSTALL_ROOT` / install tree | Unpacked **product binaries** (release tarball) | `/opt/company-brain-backend/current` |
| `BACKEND_HOME` | Runtime state home (`config.yaml`, profiles, sessions) | e.g. `/home/ec2-user/.hermes` or deploy-chosen path |

Deploy must not confuse these. Systemd (`lp-k7g.7.5`) will typically run:

```text
ExecStart=/opt/company-brain-backend/current/bin/company-brain-backend gateway
Environment=BACKEND_HOME=…
Environment=BACKEND_KIND=…
```

See [filesystem-layout.md](../../contracts/backend-runtime-v1/filesystem-layout.md).

### Terraform / env mapping

| Env (primary) | Meaning | Legacy (temporary) |
| --- | --- | --- |
| `BACKEND_ARTIFACT_URL` | Immutable artifact object URL | `HERMES_ARTIFACT_URL` |
| `BACKEND_ARTIFACT_VERSION` | Version label (directory name under `versions/`) | `HERMES_ARTIFACT_VERSION` |
| `BACKEND_ARTIFACT_SHA256` | Expected digest | `HERMES_ARTIFACT_SHA256` |
| `BACKEND_ARTIFACT_KIND` | `hermes_upstream` \| `hermes_lanyard` \| `lanyard_agent` | *(none)* |
| `BACKEND_ARTIFACT_ARCH` | Optional pin: `linux-x86_64` \| `linux-aarch64` (fail-closed vs host; see [Architecture match](#architecture-match-fail-closed--lp-2md3)) | `HERMES_ARTIFACT_ARCH` |
| `BACKEND_CONTRACT_RUNTIME_LAYOUT` | Contract major | *(none)*; default `1` |
| `BACKEND_CONTRACT_RELAY` | Relay contract major | `RELAY_CONTRACT_MAJOR` |
| `BACKEND_CONTRACT_BRAIN_RPC` | Brain RPC contract major | *(none)*; default `1` |
| `BACKEND_INSTALL_ROOT` | Install root (this layout) | Prefer over flat path |
| `BACKEND_INSTALL_PATH` | Accept-only alias: if set to a path **ending in** `/company-brain-backend` or equal to the root, treat as `BACKEND_INSTALL_ROOT`; if set to legacy flat path (e.g. `/opt/hermes-lanyard`), see migration mode below | `HERMES_INSTALL_PATH` |

**Default root:** `/opt/company-brain-backend`.

user_data dual-write (from `lp-k7g.7.3`) continues until bootstrap consumers read
only `BACKEND_*`. This bead's reference script **prefers `BACKEND_*`** and falls
back to `HERMES_*` / `RELAY_CONTRACT_MAJOR` when primary keys are unset.

### Legacy flat path mode (migration only)

If `BACKEND_INSTALL_PATH` / `HERMES_INSTALL_PATH` is set to a path that is **not**
the versioned root (e.g. `/opt/hermes-lanyard`), bootstrap may:

1. Still extract into `/opt/company-brain-backend/versions/<version>/` (preferred),
   set `current`, **and** keep a compatibility symlink
   `/opt/hermes-lanyard` → `/opt/company-brain-backend/current` when kind is
   Hermes-compatible; **or**
2. Extract directly into the flat path (baseline behavior) and write
   `.seed/provenance.json` there — **only** when
   `BACKEND_INSTALL_LAYOUT=flat` is forced.

Default for new deploys: **versioned** layout (`BACKEND_INSTALL_LAYOUT=versioned`).

---

## Install algorithm (normative order)

**Must** download and verify **before** extraction (acceptance criterion).

```text
1. Resolve pins (BACKEND_* with legacy fallback). Fail if unconfigured.
2. Normalize sha256; reject mutable version refs and insecure URL schemes
   (same policy as baseline bootstrap-host.sh).
3. mkdir -p $ROOT/versions $DOWNLOAD_DIR
4. If versions/$VERSION exists and provenance.json matches
   (kind, version, url, sha256, contract majors) and
   BACKEND_INSTALL_FORCE is not 1:
     → skip download/extract (idempotent fast path)
     → still require host arch match against pin / in-tree TARGET_ARCH / URL
   Else:
     a. early arch gate when pin BACKEND_ARTIFACT_ARCH or arch-labeled URL is known
     b. download archive to $DOWNLOAD_DIR/backend-$VERSION.artifact
     c. verify_sha256(archive, expected)     # fail closed on mismatch
     d. optional Ed25519 attestation
     e. extract to staging dir under $DOWNLOAD_DIR
     f. flatten single top-level directory if present
     g. require host arch match (TARGET_ARCH / pin / URL)  # fail closed; no gateway start
     h. rsync -a --delete staging/ → versions/$VERSION/
     i. write versions/$VERSION/.seed/provenance.json
     j. rm staging
5. ln -sfn versions/$VERSION $ROOT/current   # relative target
6. Optional: path helpers (e.g. /usr/local/bin wrappers) — kind profile / later beads
```

**Never** extract over `current` directly. Always materialize under
`versions/<version>/` then flip the symlink.

---

## Architecture match (fail closed) — `lp-2md.3`

Customer host runtime tarballs ship **native wheels** (e.g. `pydantic_core`).
Installing an aarch64 pack on x86_64 EC2 (or the reverse) fails at import time and
must not reach `hermes-gateway` start. Related incident: aarch64 Hermes wheels on
x86_64 mocklab (`t3.medium`).

### Canonical labels

| Label | Host `uname -m` | Typical EC2 |
| --- | --- | --- |
| `linux-x86_64` | `x86_64` | t3.*, m5.*, most default AMIs (**product default**) |
| `linux-aarch64` | `aarch64` / `arm64` | Graviton (t4g.*, m7g.*, …) |

Aliases accepted by bootstrap: `linux-arm64` → `linux-aarch64`; bare `x86_64` /
`amd64` / `aarch64` / `arm64`; `linux/x86_64` and `linux_x86_64` forms.

Hermes pack/publish (lp-2md.1 / lp-2md.2) writes:

- In-tree `TARGET_ARCH` (+ `TARGET_OS` / `TARGET_CPU`) and `.seed/build.env`
- Sidecar `hermes-<version>.meta` next to the tarball (CI; optional on host)
- S3 key segment `hermes/<version>/<TARGET_ARCH>/…` (default `linux-x86_64`)

### Detection order (artifact target arch)

1. **Pin field** — `BACKEND_ARTIFACT_ARCH` (or temporary `HERMES_ARTIFACT_ARCH`)
2. **In-tree meta** — `TARGET_ARCH` file, else `TARGET_ARCH=` in `.seed/build.env`
3. **URL path** — segment `/linux-x86_64/` or `/linux-aarch64/` (or `/linux-arm64/`)

When multiple sources are present they **must agree**; disagreement is fail-closed.

### Host check

Bootstrap compares host `uname -m` → canonical label against the resolved artifact
arch. On mismatch or **missing** metadata:

- Exit non-zero (**exit 5** in reference scripts)
- Operator-visible error includes host arch, artifact arch, and pin guidance
- Install tree is **not** materialized (host path aborts before `rsync` into
  `/opt/hermes-lanyard` or `versions/<ver>/`)
- **Do not start** `hermes-gateway`

Emergency override only (legacy unlabeled tarballs):
`BACKEND_ALLOW_MISSING_ARCH=1` / `HERMES_ALLOW_MISSING_ARCH=1`. Prefer repinning
an arch-labeled object instead.

### Scripts

| Path | Role |
| --- | --- |
| [`deploy/scripts/bootstrap-backend-install.sh`](../../deploy/scripts/bootstrap-backend-install.sh) | Generic versioned install + `require_host_arch_match` |
| [`deploy/scripts/bootstrap-host.sh`](../../deploy/scripts/bootstrap-host.sh) | Product host bootstrap (Hermes first) + compact `require_hermes_host_arch_match` |
| [`deploy/scripts/smoke-bootstrap-arch-check.sh`](../../deploy/scripts/smoke-bootstrap-arch-check.sh) | Offline unit smoke: normalize, match, mismatch, missing |

Pin/tfvars documentation for `backend_artifact_arch` defaults is owned by
**`lp-2md.4`** (not this bead).

---

## Provenance schema (JSON)

Schema file: [`deploy/schemas/backend-install-provenance.schema.json`](../../deploy/schemas/backend-install-provenance.schema.json)

Example: [`deploy/examples/backend-install-provenance.example.json`](../../deploy/examples/backend-install-provenance.example.json)

### Required fields

| Field | Type | Description |
| --- | --- | --- |
| `schema_version` | integer | Provenance document version; **1** for this bead |
| `kind` | string | Backend product family (`hermes_upstream`, `hermes_lanyard`, `lanyard_agent`) |
| `version` | string | Pinned release version (matches `versions/<version>` directory name) |
| `url` | string | Artifact URL used for download |
| `sha256` | string | 64-char lowercase hex digest of archive bytes |
| `contract` | object | Contract majors at install time |
| `contract.runtime_layout` | integer | ≥ 1 |
| `contract.relay` | integer | ≥ 1 |
| `contract.brain_rpc` | integer | ≥ 1 |
| `installed_at` | string | ISO-8601 UTC timestamp |
| `install_root` | string | Absolute `BACKEND_INSTALL_ROOT` |
| `install_path` | string | Absolute path to this version directory |

### Optional fields

| Field | Type | Description |
| --- | --- | --- |
| `attestation_status` | string | `verified` \| `skipped` \| `failed` (failed must not be written on success) |
| `attestation_alg` | string | e.g. `ed25519` |
| `signing_pubkey_sha256` | string | Fingerprint when attestation ran |
| `signing_identity` | string | Operator label for signing key |
| `layout` | string | `versioned` \| `flat` |
| `current_symlink` | string | Absolute path of `current` when layout is versioned |
| `entrypoint` | string | Relative entrypoint if known (e.g. `bin/company-brain-backend`) |
| `bootstrap` | string | Constant `artifact` (parity with client-core seed provenance) |

### Example

```json
{
  "schema_version": 1,
  "kind": "hermes_lanyard",
  "version": "v0.1.0-g7h2",
  "url": "s3://company-brain-artifacts/backends/hermes-lanyard/v0.1.0-g7h2/linux-x86_64/hermes-lanyard.tar.gz",
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "arch": "linux-x86_64",
  "contract": {
    "runtime_layout": 1,
    "relay": 1,
    "brain_rpc": 1
  },
  "installed_at": "2026-07-20T12:00:00Z",
  "install_root": "/opt/company-brain-backend",
  "install_path": "/opt/company-brain-backend/versions/v0.1.0-g7h2",
  "layout": "versioned",
  "current_symlink": "/opt/company-brain-backend/current",
  "attestation_status": "skipped",
  "bootstrap": "artifact"
}
```

### Migration from `provenance.env`

Baseline Hermes wrote key=value lines under `.seed/provenance.env`. On merge:

| Old key | New JSON field |
| --- | --- |
| `version` | `version` |
| `url` | `url` |
| `sha256` | `sha256` |
| `relay_contract_major` | `contract.relay` |
| `attestation_status` | `attestation_status` |
| `attestation_alg` | `attestation_alg` |
| `signing_pubkey_sha256` | `signing_pubkey_sha256` |
| `signing_identity` | `signing_identity` |
| `installed_at` | `installed_at` |
| *(missing)* | `kind`, `contract.runtime_layout`, `contract.brain_rpc` |

New installs **must** write JSON. Dual-writing `.env` is optional and temporary;
prefer JSON only for greenfield.

---

## Idempotency requirements

| Rule | Behavior |
| --- | --- |
| Same pins, re-run | Fast path: keep `versions/<version>/`, rewrite/refresh `current` symlink if needed, leave content untouched when provenance matches |
| Same version, different sha256 | Fail closed **or** re-download+verify+rsync when `BACKEND_INSTALL_FORCE=1`; never leave mixed trees without updating provenance |
| New version pin | Extract into new `versions/<new>/`, flip `current`; leave previous version directories for rollback (`lp-k7g.7.7`) |
| Interrupted extract | Staging dir only; `versions/<version>/` updated via rsync after full extract — partial staging is discarded on next run |
| Symlink only drift | If tree matches pins but `current` points elsewhere, only fix the symlink |
| Concurrent runs | Not supported; operators must not parallelize bootstrap on the same host |
| Client-core vault | Unchanged: skip re-seed when vault already has live markers (e.g. `AGENTS.md`) — separate from backend install idempotency |

**Convergence statement:** for fixed `BACKEND_ARTIFACT_*` + contract pins, any number
of successful bootstrap runs results in:

1. `versions/<version>/` content matching the verified archive (modulo allowed
   post-install seeds under `.seed/`)
2. `current` → that version
3. `provenance.json` recording the same kind, version, url, sha256, and contract majors

---

## Reference implementation

| Path | Role |
| --- | --- |
| [`deploy/scripts/bootstrap-backend-install.sh`](../../deploy/scripts/bootstrap-backend-install.sh) | Reference script: resolve pins, download, verify, versioned extract, `current` symlink, provenance JSON |
| [`deploy/schemas/backend-install-provenance.schema.json`](../../deploy/schemas/backend-install-provenance.schema.json) | JSON Schema for provenance |
| [`deploy/examples/backend-install-provenance.example.json`](../../deploy/examples/backend-install-provenance.example.json) | Valid example document |
| [`deploy/docs/bootstrap-backend-install.md`](../../deploy/docs/bootstrap-backend-install.md) | Short pointer from `deploy/` |

### Relationship to full `bootstrap-host.sh`

When `company-brain-deploy` is imported:

1. Source or inline the versioned install functions from
   `bootstrap-backend-install.sh` in place of the Hermes block
   (`HERMES_INSTALL_PATH` rsync + `provenance.env`).
2. Keep client-core seed, profiles, omnibox, and relay notes as sibling steps.
3. Prefer `BACKEND_*` pins from `artifact-pins.env`; drop dual-write after cutover.

`BOOTSTRAP_BACKEND_INSTALL_LIB_ONLY=1` allows smoke tests to source helpers
without running install (same pattern as `BOOTSTRAP_HOST_LIB_ONLY` in baseline).

---

## Acceptance (lp-k7g.7.4)

| Criterion | Evidence |
| --- | --- |
| Backend archive downloads and verifies before extraction | Algorithm § Install algorithm steps 4a–4c before 4d; reference script enforces order |
| `/opt/company-brain-backend/current` points to selected version | Layout § Canonical host tree; script `ln -sfn versions/$VERSION current` |
| Provenance records kind, version, url, sha256, contract versions | Schema + example; script writes `provenance.json` |
| Bootstrap is idempotent | § Idempotency requirements; script fast-path when provenance matches |

---

## Related documents

- [Phase 3 plan](../plans/0001-platform-monorepo-migration/phase-3-artifact-deploy-generalization.md)
- [Deploy Terraform backend_artifact variables](deploy-backend-artifact-variables.md)
- [Backend runtime contract](backend-runtime-contract.md)
- [Filesystem layout (BACKEND_HOME)](../../contracts/backend-runtime-v1/filesystem-layout.md)
- [Generic backend systemd service](deploy-backend-systemd-service.md)
- [Compatibility pins v2](../../compatibility/README.md)
- [Upgrade / rollback runbook](../runbooks/backend-upgrade-rollback.md) (Bead `lp-k7g.7.7`)
