# Backend runtime v1 — conformance expectations

How a backend claims and proves `backend-runtime-v1` compliance.

This file is the **platform-owned** conformance index (suite checklist +
surface-level detail). Implementation work for non-monorepo products
(Hermes-Lanyard, Hermes upstream, Lanyard Agent) lives in those external
repositories.

**Published compatibility matrix** (kind · version · contract · capabilities ·
conformance result · deploy readiness) — **canonical operator view:**

[`docs/architecture/backend-compatibility-matrix.md`](../../docs/architecture/backend-compatibility-matrix.md)
(`lp-k7g.11.7`).

Detailed gap analyses and external follow-up:

| Kind | Doc |
| --- | --- |
| `hermes_lanyard` | Matrix card + offline job below (`lp-k7g.11.4`) |
| `lanyard_agent` | [`docs/architecture/lanyard-agent-conformance-gaps.md`](../../docs/architecture/lanyard-agent-conformance-gaps.md) |
| `hermes_upstream` | [`docs/architecture/hermes-upstream-compatibility.md`](../../docs/architecture/hermes-upstream-compatibility.md) |

Architecture summary:
[`docs/architecture/backend-runtime-contract.md`](../../docs/architecture/backend-runtime-contract.md).

Phase 7 automates much of this suite (`lp-k7g.11.*`). Treat this document as
the human checklist and **surface** matrix; the published summary matrix is the
link target for deploy docs and pin decisions.

---

## Contract surfaces under test

| Surface | Normative source | Claim field |
| --- | --- | --- |
| Artifact shape | [`artifact-manifest.schema.json`](artifact-manifest.schema.json) | `manifest/backend.json` |
| Runtime layout | [`filesystem-layout.md`](filesystem-layout.md) | `contract.runtime_layout: 1` |
| Config | [`config.schema.json`](config.schema.json) | `$BACKEND_HOME/config.yaml` |
| Profiles | [`profiles.schema.json`](profiles.schema.json) | `$BACKEND_HOME/profiles/*.json` |
| Brain RPC | [`brain-rpc.schema.json`](brain-rpc.schema.json) | `contract.brain_rpc: 1` |
| Capability descriptor | [`capabilities.schema.json`](capabilities.schema.json) | live `brain.capabilities` and/or manifest `capabilities` |
| Relay chat | relay contract (outside this directory) | `contract.relay: 1` |

Supported kinds: `hermes_upstream` · `hermes_lanyard` · `lanyard_agent`.

**Reference implementation:** Hermes-Lanyard (`kind: hermes_lanyard`).

---

## Status legend

| Status | Meaning |
| --- | --- |
| **yes** | Present and usable for the v1 claim (code + layout evidence) |
| **partial** | Related code or product surface exists, but not full contract shape |
| **no** | Missing; Portal must treat as unsupported / not yet claimable |
| **n/a** | Not required for that kind at v1, or out of scope |

Statuses below are from **static code inspection** of local trees under
`/home/operator/Lanyard-Dev/` (Hermes-Lanyard, Lanyard Agent) against schemas in
this directory. They are not phase-7 harness results.

**Inspection date context:** monorepo bead `lp-k7g.6.7` (2026-07-20).

---

## Compatibility matrix

**Summary (kind / version / contract / capabilities / result / deploy readiness):**
[`docs/architecture/backend-compatibility-matrix.md`](../../docs/architecture/backend-compatibility-matrix.md).

Surface detail below (static inspection + offline harness evidence for
Hermes-Lanyard).

### A. Artifact and process

| Surface | Hermes-Lanyard (reference) | Lanyard Agent | hermes_upstream |
| --- | --- | --- | --- |
| Publish versioned host tarball | **yes** (product release) | **partial** — product `lanyard-agent-*.tar.gz` + pin contract; **no** `manifest/backend.json` / `bin/company-brain-backend` layout yet | **partial** — upstream release artifacts; platform pin shape TBD |
| `manifest/backend.json` (`artifact-manifest.schema.json`) | **partial** — reference layout documented; platform examples present | **no** | **no** (expected until conformance job) |
| Stable entrypoint `bin/company-brain-backend gateway` | **partial** — product bins exist; contract wrapper name may be deploy-side | **no** — bins are `lanyard-agent` / `lanyard-agent-gateway` | **partial** |
| `BACKEND_KIND` / `BACKEND_HOME` env contract | **partial** — historically `HERMES_HOME`; layout doc requires alias | **no** — uses `/etc` + `/var/lib` + `/var/log` split | **partial** — `HERMES_HOME` only |

### B. Runtime filesystem layout (`runtime_layout: 1`)

| Path / rule | Hermes-Lanyard | Lanyard Agent | hermes_upstream |
| --- | --- | --- | --- |
| Single `BACKEND_HOME` tree | **yes** (via `HERMES_HOME=$BACKEND_HOME`) | **no** — split host layout; Option A/B projection not implemented | **yes** (`HERMES_HOME`) |
| `config.yaml` under home | **yes** | **partial** — file exists at `/etc/lanyard-agent/config.yaml` (or `~/.lanyard-agent/`), not under a contract home | **yes** |
| `profiles/admin.json` + `contributor.json` | **yes** (seeds + builtins) | **no** | **partial** — profile files may exist; Brain RPC ACL may lag |
| `projects.db` | **yes** | **no** | **partial** |
| `skills/` under home | **yes** | **no** — skills via `vault_root` / `skills_roots` only | **yes** |
| `cron/jobs.json` under home | **yes** | **partial** — must be `$BACKEND_HOME/cron/jobs.json` (never `~/.hermes`); product `stateDir` must align (`lp-uxy.3`) | **yes** |
| `logs/`, `sessions/`, `workspace/` dirs | **yes** / product-specific under home | **partial** — logs `/var/log/lanyard-agent`; sessions = `sessions.db` file; no contract `workspace/` | **partial** |
| `HERMES_HOME=$BACKEND_HOME` | **yes** (required) | **n/a** optional; currently unset / unused | **yes** |

Normative Lanyard Agent options (direct layout vs projection):
[`filesystem-layout.md` § Lanyard Agent](filesystem-layout.md#lanyard-agent-compatibility-options).

### C. Brain RPC required methods (`brain_rpc: 1`)

| Method | Hermes-Lanyard | Lanyard Agent | hermes_upstream |
| --- | --- | --- | --- |
| Wire frames `brain_rpc_request` / `brain_rpc_result` on relay | **yes** (`gateway/relay/ws_transport.py` + dispatcher) | **partial** — types vendored in `@lanyard-agent/adapters-portal`; **transport ignores** `brain_rpc_request` | **no** / unknown without fork |
| Auth L0–L5 + path ACL | **yes** (`gateway/brain_rpc/auth.py`) | **no** | **no** / unknown |
| `brain.ping` | **yes** | **no** | **no** / unknown |
| `brain.health` | **yes** | **partial** — localhost HTTP `/health` + `/ready` only; **not** Brain RPC | **no** / unknown |
| `vault.list` / `vault.stat` / `vault.read` | **yes** | **partial** — agent-core vault loader for **agent tools**; **no** RPC handlers | **no** / unknown |
| `settings.snapshot` (redacted) | **yes** | **no** | **no** / unknown |
| `projects.list` | **yes** | **no** | **no** / unknown |
| Unimplemented → `method_not_found` | **yes** | **no** — requests are dropped silently today | **no** / unknown |

### D. Expansion methods (optional until implemented + advertised)

| Method / feature | Hermes-Lanyard | Lanyard Agent | hermes_upstream |
| --- | --- | --- | --- |
| `brain.capabilities` live discovery | **no** (example descriptor only; not in `HANDLERS`) | **no** | **no** |
| `vault.write` | **partial** / product-dependent | **no** (RPC); agent tools may write vault under product rules | **no** |
| `settings.patch` | **partial** / product-dependent | **no** | **no** |
| `projects.create` | **partial** / product-dependent | **no** | **no** |
| `models.list` / `models.set_active` | **partial** | **no** (RPC); LiteLLM + config `default_model` / routing exist | **partial** |
| `cron.list` / `cron.patch` | **partial** | **partial** — product store under state/`BACKEND_HOME`; Brain RPC list/patch expansion still optional; Settings path via `settings.snapshot` crons + `settings.patch` `cron.set_enabled` when advertised (`lp-uxy.3` fixtures) | **partial** |

Manifest feature flags for examples:
[`examples/hermes-lanyard.manifest.json`](examples/hermes-lanyard.manifest.json),
[`examples/lanyard-agent.manifest.json`](examples/lanyard-agent.manifest.json),
[`examples/hermes-upstream.manifest.json`](examples/hermes-upstream.manifest.json).

### E. Config, profiles, projects (compatibility)

| Surface | Hermes-Lanyard | Lanyard Agent | hermes_upstream |
| --- | --- | --- | --- |
| Hermes-shaped `config.yaml` (`model` / `providers` / `skills` / `cron`) | **yes** (schema reference) | **no** — distinct Zod schema (`vault_root`, `default_model`, `litellm`, `session`, `channels`, …) | **yes** / close |
| Secret policy (no plaintext keys in defaults) | **yes** | **yes** (env *names* in YAML) | **yes** |
| Profile seeds `admin` / `contributor` | **yes** | **no** | **partial** |
| Subject field `backend_profile` (preferred) | **partial** — still `hermes_profile` on wire | **partial** — vendored types only `hermes_profile` | **partial** |
| `projects.db` project registry | **yes** | **no** | **partial** |
| Portal settings without direct home file reads | **yes** via `settings.snapshot` | **no** — gap blocks host-backed settings | **no** |

### F. Relay chat (contract.relay)

| Surface | Hermes-Lanyard | Lanyard Agent | hermes_upstream |
| --- | --- | --- | --- |
| Egress WSS + v1j upgrade auth | **yes** | **yes** (`adapters-portal`) | **partial** |
| Hello / descriptor / inbound / outbound | **yes** | **yes** | **partial** |
| Platform id for Portal web | Hermes product ids | **yes** — `lanyard_web` | product-specific |

Relay alone is **not** sufficient for Portal settings, vault browser, or project pickers — those require Brain RPC.

---

## Conformance checklist (per artifact claim)

A release may advertise the majors below only when the checks pass (manual now;
automated in phase 7).

### `contract.runtime_layout: 1`

- [ ] `BACKEND_HOME` set for the gateway process
- [ ] Required dirs: `profiles/`, `skills/`, `cron/`, `logs/`, `sessions/`, `workspace/`
- [ ] Profile seeds `admin` + `contributor` (or documented builtins)
- [ ] `config.yaml` primary structured config under home (or Option B projection)
- [ ] Hermes-compatible kinds: `HERMES_HOME=$BACKEND_HOME`
- [ ] `lanyard_agent`: Option A direct tree **or** Option B projection (no Portal special cases)

### `contract.brain_rpc: 1`

- [ ] On authenticated relay session, handle `brain_rpc_request` → `brain_rpc_result`
- [ ] Implement all seven required methods with schema shapes
- [ ] Fail-closed auth; path ACL on vault methods
- [ ] Redact secrets in `settings.snapshot`
- [ ] Missing expansion methods return `method_not_found` (not silent drop)
- [ ] Advertise implemented methods on artifact `capabilities.brain_rpc_methods`

### `contract.relay: 1`

- [ ] Egress dial + hello/descriptor + chat frames per relay contract
- [ ] Credentials via platform env names (`GATEWAY_RELAY_*`)

### Artifact

- [ ] `manifest/backend.json` validates
- [ ] Entrypoint path works after extract
- [ ] `capabilities` honest vs live behavior (do not claim unimplemented methods)

### Capability descriptor

- [ ] Prefer live `brain.capabilities` when implemented
- [ ] Else Portal uses manifest fallback (`source: artifact_manifest`)
- [ ] UI affordances match feature flags

---

## External follow-up ownership

| Work | Repository | Tracking |
| --- | --- | --- |
| Close Lanyard Agent gaps (RPC, layout projection, profiles, settings/projects, artifact) | [LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent) | Full external checklist + AC map in [`docs/architecture/lanyard-agent-conformance-gaps.md`](../../docs/architecture/lanyard-agent-conformance-gaps.md) (`lp-k7g.11.6`); GitHub [#134](https://github.com/LanyardBrain/lanyard-agent/issues/134)–[#137](https://github.com/LanyardBrain/lanyard-agent/issues/137); product Beads (`lac-*`) |
| Keep Hermes-Lanyard as reference; add expansion methods / `backend_profile` | Hermes-Lanyard product repo | Product Beads; monorepo job `lp-k7g.11.4` (offline landed) |
| Hermes upstream compatibility assessment (gaps, shims, sync constraints) | Upstream Hermes + pin process | `lp-k7g.11.5` — [`docs/architecture/hermes-upstream-compatibility.md`](../../docs/architecture/hermes-upstream-compatibility.md) |
| Automated harness + published matrix | This monorepo + deploy CI | `lp-k7g.11.1`–`lp-k7g.11.7` — published matrix: [`docs/architecture/backend-compatibility-matrix.md`](../../docs/architecture/backend-compatibility-matrix.md) |

**Rule:** Lanyard Agent gaps are **contract deltas and external backlog**, not
Portal forks that hard-code `/etc/lanyard-agent` or skip Brain RPC.

---

## Offline validators (this monorepo)

These check **schemas and examples**, not live backends:

```bash
python3 scripts/validate-artifact-manifests.py
python3 scripts/validate-backend-config.py
python3 scripts/validate-backend-profiles.py
python3 scripts/validate-brain-rpc.py
python3 scripts/validate-backend-capabilities.py
python3 scripts/validate-backend-tarball.py
bash scripts/validate.sh
```

### Fake relay harness (`lp-k7g.11.1`)

Offline connector-side session that speaks relay NDJSON frames without Portal:

| Path | Purpose |
| --- | --- |
| [`harness/`](harness/) | `FakeRelayHarness` + `FakeBackendClient` + mock socket |
| [`harness/run_tests.py`](harness/run_tests.py) | stdlib unittest entrypoint (hello / inject / interrupt / Brain RPC) |

```bash
python3 contracts/backend-runtime-v1/harness/run_tests.py
```

Wired as **check 18** in `scripts/validate.sh`. Live gateway WebSocket auth and
artifact-backed runs land in later `lp-k7g.11.*` Beads.

### Backend tarball fixture (`lp-k7g.11.2`)

Offline check that a release archive carries the contract artifact shape:

| Path | Purpose |
| --- | --- |
| [`scripts/validate-backend-tarball.py`](../../scripts/validate-backend-tarball.py) | Validate tarball (or build fixture): `manifest/backend.json`, executable `bin/company-brain-backend`, pin kind/version/contract |
| [`fixtures/backend-conformance-fixture.tar.gz`](fixtures/backend-conformance-fixture.tar.gz) | Committed offline fixture (from hermes-lanyard example manifest) |

```bash
python3 scripts/validate-backend-tarball.py
python3 scripts/validate-backend-tarball.py --tarball contracts/backend-runtime-v1/fixtures/backend-conformance-fixture.tar.gz \
  --pins compatibility/pins.example.yaml
python3 scripts/validate-backend-tarball.py --build-fixture \
  contracts/backend-runtime-v1/fixtures/backend-conformance-fixture.tar.gz
```

Wired as **check 19** in `scripts/validate.sh`.

### Brain RPC required methods (`lp-k7g.11.3`)

Offline suite that exercises the seven required Brain RPC methods via
`FakeBrainRpcHost` over the fake relay harness (contributor vs admin vault ACL):

| Path | Purpose |
| --- | --- |
| [`harness/fake_brain_rpc.py`](harness/fake_brain_rpc.py) | In-memory host (mirrors Portal `FakeBackendRuntimeService` / `FakeBrainRpcInvoker`) |
| [`harness/test_brain_rpc_required.py`](harness/test_brain_rpc_required.py) | Acceptance: ping, health, vault ACL, settings/projects shapes |
| [`harness/run_brain_rpc_conformance.py`](harness/run_brain_rpc_conformance.py) | stdlib unittest entrypoint |
| [`portal/packages/backend-runtime/test/brain-rpc-conformance.test.ts`](../../portal/packages/backend-runtime/test/brain-rpc-conformance.test.ts) | Same criteria via TypeScript fakes |

```bash
python3 contracts/backend-runtime-v1/harness/run_brain_rpc_conformance.py
# optional (when portal package deps installed):
#   cd portal/packages/backend-runtime && npm test -- test/brain-rpc-conformance
```

Wired as **check 20** in `scripts/validate.sh`. Live artifact runs land in
`lp-k7g.11.4` (Hermes-Lanyard job).

### Hermes-Lanyard artifact conformance job (`lp-k7g.11.4`)

End-to-end job for the **reference backend** (`kind: hermes_lanyard`):

| Path | Purpose |
| --- | --- |
| [`scripts/run-hermes-lanyard-conformance.py`](../../scripts/run-hermes-lanyard-conformance.py) | Offline/download job: resolve pin or fixture → validate tarball → entrypoint smoke → fake relay + required Brain RPC |
| [`.github/workflows/conformance.yml`](../../.github/workflows/conformance.yml) | Integrated monorepo workflow (`lp-k7g.12.4`): path-filtered offline on PR/push; `workflow_dispatch` offline/download; release `contract-gate` re-runs offline and **blocks release** on failure ([ci-and-release.md](../../docs/architecture/ci-and-release.md)) |

```bash
# Offline (default): committed fixture + pins.example.yaml + FakeBrainRpcHost
python3 scripts/run-hermes-lanyard-conformance.py
python3 scripts/run-hermes-lanyard-conformance.py --mode offline

# Download (network + credentials; refuse placeholder pins):
python3 scripts/run-hermes-lanyard-conformance.py --mode download \
  --pins path/to/operator-pins.yaml
```

**Acceptance mapping**

| Criterion | Offline path | Download path |
| --- | --- | --- |
| Job downloads pinned artifact | Resolves committed fixture as pin substitute (kind/version match `pins.example.yaml`) | Fetches `pins.backend.url` (`s3://` or `https://`), verifies SHA-256 |
| Job starts backend with fake relay | Extracts tarball, smokes `bin/company-brain-backend gateway`, starts `FakeBackendClient` on `FakeRelayHarness` | Same harness path (live WSS product adapter is a follow-up) |
| Required contract checks pass | Hello/descriptor + seven Brain RPC methods + vault ACL + settings/projects + chat inject | Same checks after download |

**Download credentials (CI / operators)**

| URL scheme | Tool | Credentials |
| --- | --- | --- |
| `s3://` | `aws s3 cp` | Instance role, OIDC, or `AWS_*` keys |
| `https://` public | `curl` / `wget` | None |
| Private GitHub release | `curl` + `Accept: application/octet-stream` | `GITHUB_TOKEN` or `GH_TOKEN` (env only; never commit) |

Wired as **check 21** in `scripts/validate.sh` (**offline mode only** — no network).

---

## Related documents

| Doc | Role |
| --- | --- |
| [`docs/architecture/backend-compatibility-matrix.md`](../../docs/architecture/backend-compatibility-matrix.md) | **Published** kind/version/contract/capabilities/result/deploy-readiness matrix (`lp-k7g.11.7`) |
| [`README.md`](README.md) | Contract directory index |
| [`filesystem-layout.md`](filesystem-layout.md) | Layout + Lanyard Agent options |
| [`docs/architecture/lanyard-agent-conformance-gaps.md`](../../docs/architecture/lanyard-agent-conformance-gaps.md) | Detailed LA gaps + external checklist |
| [`docs/architecture/hermes-upstream-compatibility.md`](../../docs/architecture/hermes-upstream-compatibility.md) | Hermes upstream gaps, shim options, sync constraints |
| [`docs/architecture/backend-runtime-contract.md`](../../docs/architecture/backend-runtime-contract.md) | Architecture summary |
| [`docs/architecture/current-architecture-evaluation.md`](../../docs/architecture/current-architecture-evaluation.md) | Why Brain RPC / layout matter |
| [`docs/plans/0001-platform-monorepo-migration/phase-7-backend-conformance.md`](../../docs/plans/0001-platform-monorepo-migration/phase-7-backend-conformance.md) | Phase automation |
| [`deploy/references/readiness-matrix.md`](../../deploy/references/readiness-matrix.md) | Product/security deploy gates (links to backend matrix) |
| Examples | [`examples/`](examples/) |
