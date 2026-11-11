# Backend compatibility matrix

**Bead:** `lp-k7g.11.7` · **Epic:** `lp-k7g.11` (phase 7)  
**Contract:** [`contracts/backend-runtime-v1/`](../../contracts/backend-runtime-v1/)  
**Suite / surface checklist:** [`contracts/backend-runtime-v1/conformance.md`](../../contracts/backend-runtime-v1/conformance.md)

This is the **published** platform matrix of backend kind, artifact version,
contract majors, capabilities, conformance result, and deploy readiness. Use it
when choosing a customer-host pin, reading Portal capability gates, or checking
whether a backend family is honest for `backend-runtime-v1`.

Detailed surface-by-surface tables (artifact, layout, Brain RPC methods, relay)
remain in [`conformance.md`](../../contracts/backend-runtime-v1/conformance.md).
Per-kind gap assessments:

| Kind | Assessment |
| --- | --- |
| `hermes_lanyard` | Reference rows in this matrix + offline job `lp-k7g.11.4` |
| `hermes_upstream` | [`hermes-upstream-compatibility.md`](hermes-upstream-compatibility.md) (`lp-k7g.11.5`) |
| `lanyard_agent` | [`lanyard-agent-conformance-gaps.md`](lanyard-agent-conformance-gaps.md) (`lp-k7g.11.6`) |

**As-of:** 2026-07-20 (monorepo bead `lp-k7g.11.7`). Re-verify after product
releases or when closing external ACs.

---

## Status legend

| Field | Values |
| --- | --- |
| **Conformance result** | `pass` · `partial` · `fail` · `not_run` · `n/a` |
| **Deploy readiness** | `production` · `lab_only` · `blocked` · `forbidden` |
| **Capability claim** | `yes` · `partial` · `no` · `n/a` (same spirit as conformance.md) |

**Honesty rules**

1. Advertise contract majors only for surfaces that pass checks (manual or harness).
2. Do not pin raw Nous (`hermes_upstream`) on customer hosts
   ([`deploy/references/runbooks/pin-update.md`](../../deploy/references/runbooks/pin-update.md)).
3. Do not treat chat-only relay as Brain RPC readiness.
4. Platform readiness for production Portal/relay **security** remains separate
   ([`deploy/references/readiness-matrix.md`](../../deploy/references/readiness-matrix.md)
   G1/G2/G3) — this matrix is **backend kind / contract** readiness only.

---

## Summary matrix

Columns match the phase-7 publish shape: **kind · version · contract versions ·
capabilities · conformance result · deploy readiness**.

| Backend kind | Version (reference / pin) | Contract majors (honest claim) | Capabilities (summary) | Conformance result | Deploy readiness |
| --- | --- | --- | --- | --- | --- |
| **`hermes_lanyard`** | Offline fixture / example pin **`v0.0.0-example`**; first private product pin **`v0.1.0-g7h3`** (`deploy/compatibility/pins.real-releases.yaml` as Hermes family) | `runtime_layout: 1` · `relay: 1` · `brain_rpc: 1` | Required Brain RPC (7) **yes**; profiles admin/contributor **yes**; expansion methods **partial**; live `brain.capabilities` **no** (manifest fallback) | **`pass`** (offline job `lp-k7g.11.4`: 16/16 against fixture + FakeBrainRpcHost; download mode documented when real pins + secrets exist) | **`production`** — default customer-host pin (`kind: hermes_lanyard`). Install path `/opt/hermes-lanyard` today; generic `BACKEND_*` migration does not license other kinds for prod |
| **`hermes_upstream`** | **No** platform customer pin. Assessment vs Nous `main` / product sync line (`lp-k7g.11.5`) | At most `relay: 1` + layout **partial** if packaging lands. **Must not** claim `brain_rpc: 1` until host exists | Relay chat **yes**/close; `HERMES_HOME` layout **yes**/close; Brain RPC transport + 7 methods **no**; profile seeds for ACL **no**; contract artifact **no** | **`fail`** for full v1 claim / **`not_run`** for harness against a published pin (none) | **`forbidden`** on customer hosts (pin doctrine). Optional **`lab_only`** after packaging shim with honest majors (`brain_rpc` omitted/0) |
| **`lanyard_agent`** | **No** honest contract-shaped pin yet. Product tarball ≠ `manifest/backend.json` layout. Aspirational example only (`examples/lanyard-agent.manifest.json`) | May claim `relay: 1` for chat. **Must not** claim full `runtime_layout: 1` or `brain_rpc: 1` until AC-1…AC-4 close | Relay chat **yes**; Brain RPC **no** (types only; frames dropped); split FHS layout **no** projection; settings/profile/projects **no**; artifact claim **no** | **`fail`** / backlog for v1 host ops. External checklist open ([#134](https://github.com/LanyardBrain/lanyard-agent/issues/134)–[#137](https://github.com/LanyardBrain/lanyard-agent/issues/137)) | **`blocked`** for drop-in Portal host ops. First-class contract **target**, not production default until verified artifact + matrix flip |

### Pin / fixture coordinates (illustrative)

| Kind | Where coordinates live | Notes |
| --- | --- | --- |
| `hermes_lanyard` | Root [`compatibility/pins.example.yaml`](../../compatibility/pins.example.yaml) (`backend.kind`); offline fixture [`contracts/backend-runtime-v1/fixtures/backend-conformance-fixture.tar.gz`](../../contracts/backend-runtime-v1/fixtures/backend-conformance-fixture.tar.gz); product v1 pins still under `deploy/compatibility/pins.real-releases.yaml` `hermes.*` until cutover to schema_version 2 | Preferred S3: `s3://$BUCKET/backends/hermes-lanyard/<version>/backend.tar.gz` |
| `hermes_upstream` | Example manifest only: [`examples/hermes-upstream.manifest.json`](../../contracts/backend-runtime-v1/examples/hermes-upstream.manifest.json) | Optional prefix `backends/hermes-upstream/` — not production |
| `lanyard_agent` | Example manifest only: [`examples/lanyard-agent.manifest.json`](../../contracts/backend-runtime-v1/examples/lanyard-agent.manifest.json) | Target prefix `backends/lanyard-agent/` after AC-4 |

---

## Per-kind cards

### 1. Hermes-Lanyard (`hermes_lanyard`) — reference

| Field | Value |
| --- | --- |
| **Role** | v1 **reference implementation** and **production** customer-host pin |
| **Product** | [LanyardBrain/hermes-lanyard](https://github.com/LanyardBrain/hermes-lanyard) (weekly rebase from Nous) |
| **Version (matrix)** | Fixture / pins.example `v0.0.0-example`; real private release `v0.1.0-g7h3` (deploy real-releases file) |
| **Contract versions** | `runtime_layout: 1`, `relay: 1`, `brain_rpc: 1` |
| **Capabilities** | Profiles `admin` + `contributor`; required Brain RPC methods live; expansion (write/patch/create/models/cron) product-dependent / partial; live `brain.capabilities` not in handlers yet (Portal uses manifest fallback) |
| **Conformance result** | **`pass` offline** — `python3 scripts/run-hermes-lanyard-conformance.py` (tarball, entrypoint, fake relay hello, seven Brain RPC methods + vault ACL, chat inject). Wired as `scripts/validate.sh` check 21. Download mode for real pins is documented; requires secrets + non-placeholder pins |
| **Deploy readiness** | **`production`** — default `backend.kind: hermes_lanyard`. Customer-host doctrine: hermes-lanyard only (never raw Nous) |
| **Evidence** | [`conformance.md`](../../contracts/backend-runtime-v1/conformance.md) offline jobs; [`.github/workflows/conformance.yml`](../../.github/workflows/conformance.yml) (draft); product release contract under `deploy/references/` |
| **Follow-up** | Prefer contract entrypoint name on pack; `backend_profile` on wire; live `brain.capabilities`; keep rebase healthy |

### 2. Hermes upstream (`hermes_upstream`) — assessment

| Field | Value |
| --- | --- |
| **Role** | Optional lab / future conformance target — **not** production pin |
| **Product** | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (`main`) |
| **Version (matrix)** | No platform-published pin; assessment against stock upstream + hermes-lanyard sync sink |
| **Contract versions (honest)** | Relay close to `1`; layout close if `BACKEND_HOME` dual-write + seeds exist; **`brain_rpc` must stay 0 / omitted** |
| **Capabilities** | Relay chat + `HERMES_HOME` strong; no Brain RPC host (frames silently ignored); multiplex CLI profiles ≠ ACL seeds; no `manifest/backend.json` / `bin/company-brain-backend` |
| **Conformance result** | **`fail`** for full `backend-runtime-v1` claim. Harness **not run** against a real `hermes_upstream` pin (none trusted for customers) |
| **Deploy readiness** | **`forbidden`** on customer hosts. Packaging-only shim may be **`lab_only`** with honest majors (Option B in assessment) |
| **Evidence** | [`hermes-upstream-compatibility.md`](hermes-upstream-compatibility.md) |
| **Follow-up** | Prefer hermes-lanyard (Option A/D). Optional packaging shim; long-term upstream contribute for Brain RPC is async and non-blocking |

### 3. Lanyard Agent (`lanyard_agent`) — status

| Field | Value |
| --- | --- |
| **Role** | First-class contract **target**; external product backlog |
| **Product** | [LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent) |
| **Version (matrix)** | No honest contract-shaped release pin in platform pins yet |
| **Contract versions (honest)** | `relay: 1` usable for chat. `runtime_layout` / `brain_rpc` **not** full-claim until AC-2 / AC-1 |
| **Capabilities** | Chat **yes**; Brain RPC **no** (vendored types; transport drops `brain_rpc_request`); layout split FHS without Option A/B; no profile seeds / `projects.db` / `settings.snapshot`; product tarball ≠ contract artifact |
| **Conformance result** | **`fail`** for host-ops claim. External packages all `todo` (platform tracking only in monorepo) |
| **Deploy readiness** | **`blocked`** for Portal settings/vault/projects. Do not set full contract majors in pins until verified. Production default remains hermes-lanyard |
| **Evidence** | [`lanyard-agent-conformance-gaps.md`](lanyard-agent-conformance-gaps.md); GitHub [#134](https://github.com/LanyardBrain/lanyard-agent/issues/134)–[#137](https://github.com/LanyardBrain/lanyard-agent/issues/137) |
| **Follow-up** | External AC-1…AC-4 then monorepo re-verify (tarball + harness) and matrix flip |

---

## Capability matrix (condensed)

Full method/layout tables:
[`conformance.md` § Compatibility matrix](../../contracts/backend-runtime-v1/conformance.md#compatibility-matrix).

| Capability / surface | `hermes_lanyard` | `hermes_upstream` | `lanyard_agent` |
| --- | --- | --- | --- |
| Contract artifact (`manifest/backend.json` + entrypoint) | **partial** → yes path via fixture/job | **no** | **no** |
| `BACKEND_HOME` runtime layout | **yes** (`HERMES_HOME=$BACKEND_HOME`) | **partial** (`HERMES_HOME` only) | **no** (split FHS) |
| Relay chat + egress | **yes** | **yes** / close | **yes** |
| Brain RPC transport + 7 required methods | **yes** | **no** | **no** (types only) |
| Profile seeds + vault path ACL | **yes** | **no** | **no** |
| `settings.snapshot` / `projects.list` | **yes** | **no** | **no** |
| Expansion methods advertised honestly | **partial** | **no** | **no** |
| Live `brain.capabilities` | **no** (fallback) | **no** | **no** |

---

## Conformance runs (evidence log)

Shape: `BackendConformanceRun` — kind, artifact version, contract, result, evidence.

| Run id | Kind | Artifact version | Contract (claimed) | Mode | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `hl-offline-fixture` | `hermes_lanyard` | `v0.0.0-example` | layout 1 / relay 1 / brain_rpc 1 | offline | **pass** | `python3 scripts/run-hermes-lanyard-conformance.py`; fixture tar + FakeBrainRpcHost; `validate.sh` check 21 |
| `hl-download` | `hermes_lanyard` | operator pin | per pin | download | **not_run** in CI default | Requires real pins + `s3://` or private `https://` credentials ([`conformance.md`](../../contracts/backend-runtime-v1/conformance.md) § Hermes-Lanyard job) |
| `upstream-assessment` | `hermes_upstream` | n/a (static) | n/a honest full claim | static inspection | **fail** (full v1) | [`hermes-upstream-compatibility.md`](hermes-upstream-compatibility.md) |
| `la-gap-tracking` | `lanyard_agent` | n/a (static) | n/a honest full claim | static inspection | **fail** (host ops) | [`lanyard-agent-conformance-gaps.md`](lanyard-agent-conformance-gaps.md) + #134–#137 |

---

## Deploy operator quick rules

| Goal | Action |
| --- | --- |
| Production tenant host | Pin **`hermes_lanyard`** only; follow [`docs/runbooks/backend-upgrade-rollback.md`](../runbooks/backend-upgrade-rollback.md) and deploy pin-update |
| Lab stock Hermes | Packaging shim only; honest majors; **never** enable Portal vault/settings as if Brain RPC existed |
| Prep Lanyard Agent | Wait for product AC close + publish; re-run tarball + Brain RPC checks; flip this matrix before tenant pin |
| Portal/relay production security | Orthogonal gates in [`deploy/references/readiness-matrix.md`](../../deploy/references/readiness-matrix.md) (G1/G2/G3) — backend kind readiness ≠ security sign-off |

Landing zones / kind slugs:
[`deploy-artifact-landing-zones.md`](deploy-artifact-landing-zones.md).

---

## How to update this matrix

1. After a product release: update **version** + pin coordinates; re-run offline (and download if available) conformance.
2. After external AC close (LA or upstream packaging): update **capabilities**, **conformance result**, and **deploy readiness**; attach evidence.
3. Keep surface detail tables in `conformance.md` in sync for method-level honesty.
4. Do not invent SHA-256 or digests; never commit tokens.

Offline re-verify:

```bash
bash scripts/validate.sh
python3 scripts/run-hermes-lanyard-conformance.py
python3 scripts/validate-backend-tarball.py
python3 contracts/backend-runtime-v1/harness/run_brain_rpc_conformance.py
```

---

## Related documents

| Doc | Role |
| --- | --- |
| [`contracts/backend-runtime-v1/conformance.md`](../../contracts/backend-runtime-v1/conformance.md) | Suite expectations + full surface matrix |
| [`backend-runtime-contract.md`](backend-runtime-contract.md) | Architecture summary |
| [`hermes-upstream-compatibility.md`](hermes-upstream-compatibility.md) | Upstream gaps, shims, sync |
| [`lanyard-agent-conformance-gaps.md`](lanyard-agent-conformance-gaps.md) | LA external checklist |
| [`deploy/references/readiness-matrix.md`](../../deploy/references/readiness-matrix.md) | Product/security deploy gates (G*) |
| [`deploy/references/runbooks/pin-update.md`](../../deploy/references/runbooks/pin-update.md) | Operator pin procedure |
| [`docs/runbooks/backend-upgrade-rollback.md`](../runbooks/backend-upgrade-rollback.md) | Backend swap / rollback |
| [`compatibility/README.md`](../../compatibility/README.md) | Pins schema_version 2 |
| [`phase-7-backend-conformance.md`](../plans/0001-platform-monorepo-migration/phase-7-backend-conformance.md) | Phase plan |
