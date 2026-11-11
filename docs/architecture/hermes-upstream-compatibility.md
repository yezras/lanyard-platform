# Hermes upstream — backend-runtime-v1 compatibility assessment

**Bead:** `lp-k7g.11.5`  
**Contract:** [`contracts/backend-runtime-v1/`](../../contracts/backend-runtime-v1/)  
**Published compatibility matrix (all kinds):** [`backend-compatibility-matrix.md`](backend-compatibility-matrix.md)  
**Surface matrix / suite:** [`contracts/backend-runtime-v1/conformance.md`](../../contracts/backend-runtime-v1/conformance.md)  
**Upstream product:** [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (`kind: hermes_upstream`)  
**Reference fork (already conforms for platform use):** [LanyardBrain/hermes-lanyard](https://github.com/LanyardBrain/hermes-lanyard) (`kind: hermes_lanyard`)

This document assesses what **stock Hermes upstream** would need to satisfy
`backend-runtime-v1` **without** requiring Lanyard fork changes in the monorepo.
It does **not** implement upstream or hermes-lanyard code. Closing gaps is
external product work (or packaging), subject to **upstream sync constraints**
below.

Inspection anchors (2026-07-20):

| Tree | Role |
| --- | --- |
| `NousResearch/hermes-agent` `main` (fetched as `upstream/main`) | Stock Hermes |
| `/home/operator/Lanyard-Dev/hermes-lanyard` | Lanyard product reference |

---

## Executive summary

| Area | Upstream status | Hermes-Lanyard (reference) |
| --- | --- | --- |
| Relay chat + egress WSS | **yes** / close (`gateway/relay/`) | **yes** |
| Brain RPC host (`contract.brain_rpc: 1`) | **no** — frames silently ignored | **yes** (`gateway/brain_rpc/` + `ws_transport` dispatch) |
| Runtime home layout (`HERMES_HOME`) | **yes** / close (config, cron, skills, sessions, `projects.db`) | **yes** (`HERMES_HOME=$BACKEND_HOME`) |
| Backend profile seeds (`admin` / `contributor`) | **no** — multiplex CLI profiles ≠ Brain RPC ACL seeds | **yes** (seeds + builtins) |
| Contract artifact (`manifest/backend.json`, `bin/company-brain-backend`) | **no** | **partial** (product pack `bin/hermes`; contract wrapper still deploy-side) |
| Platform env (`BACKEND_HOME`, `BACKEND_KIND`) | **no** — `HERMES_HOME` only | **partial** (alias required) |

**Recommendation for production customer hosts:** keep pinning **`hermes_lanyard`**
only. Deploy doctrine already forbids raw Nous on tenant hosts
([`deploy/references/runbooks/pin-update.md`](../../deploy/references/runbooks/pin-update.md)
§ Customer host Hermes pin). Treat `hermes_upstream` as an **optional**
conformance target for lab/experimental pins once packaging + Brain RPC exist —
not as a substitute for the Lanyard fork.

Until Brain RPC and an honest artifact claim exist, pure upstream **must not**
advertise `contract.brain_rpc: 1`. Portal must continue capability fallbacks /
disabled UI for host-backed settings, vault browser, and project pickers when
only stock Hermes is selected.

---

## Product relationship (do not blur)

| Repo | Role |
| --- | --- |
| **`NousResearch/hermes-agent`** | Public upstream source line |
| **`LanyardBrain/hermes-lanyard`** | Private **non-fork** product authority: Brain RPC, release tarballs, OIDC tags, **weekly rebase** from Nous |
| `LanyardBrain/hermes-agent` | **Archived** public fork — historical only; do not publish product artifacts |

Hermes-Lanyard is the v1 **reference implementation** of `backend-runtime-v1`.
It already carries the Lanyard-owned Brain RPC host and packaging path that
Portal + deploy expect. Upstream is the **sync source**, not the customer-host
pin for production.

Authority notes: [ADR 0002](../adr/0002-external-backend-products.md),
hermes-lanyard `docs/lanyard-private-repo.md`,
[`deploy/references/product-artifact-release-contract.md`](../../deploy/references/product-artifact-release-contract.md).

---

## 1. Missing contract pieces (upstream vs `backend-runtime-v1`)

Statuses are from static inspection of Nous `main` vs the contract and the
Hermes-Lanyard reference. They are **not** phase-7 harness results against a
published `hermes_upstream` pin.

### 1.1 Artifact and process

| Surface | Upstream today | Gap for claim |
| --- | --- | --- |
| Versioned host tarball | Upstream ships docker/PyPI/desktop packs — **not** platform `backend.tar.gz` layout | Need immutable archive with contract shape |
| `manifest/backend.json` | **Absent** | Required per [`artifact-manifest.schema.json`](../../contracts/backend-runtime-v1/artifact-manifest.schema.json); example only: [`examples/hermes-upstream.manifest.json`](../../contracts/backend-runtime-v1/examples/hermes-upstream.manifest.json) |
| `bin/company-brain-backend gateway` | **Absent** — CLI is `hermes` / product bins | Stable contract entrypoint (may wrap `hermes gateway`) |
| `BACKEND_KIND=hermes_upstream` | **Absent** | Deploy/Portal selection field |
| `BACKEND_HOME` | **Absent** — uses `HERMES_HOME` | Must set `HERMES_HOME=$BACKEND_HOME` for Hermes-compatible kinds |
| Honest `capabilities` | N/A | Do not list Brain RPC methods that are not live |

### 1.2 Runtime filesystem layout (`contract.runtime_layout: 1`)

Upstream **already** centers state on a single home (`get_hermes_home()` /
`HERMES_HOME`), close to the contract tree:

| Contract path | Upstream | Notes |
| --- | --- | --- |
| Single home tree | **yes** (`HERMES_HOME`, default `~/.hermes`) | Align name: `BACKEND_HOME` + alias |
| `config.yaml` | **yes** | Hermes-shaped; matches baseline [`config.schema.json`](../../contracts/backend-runtime-v1/config.schema.json) spirit |
| `projects.db` | **yes** (`hermes_cli/projects_db.py`) | Present for CLI/kanban; **not** exposed via Brain RPC |
| `skills/`, `cron/`, `logs/`, `sessions/` | **yes** / product-specific under home | Usable for layout claim if dirs guaranteed at gateway start |
| `workspace/` | **partial** | Product-dependent; may need bootstrap mkdir |
| `profiles/admin.json` + `contributor.json` | **no** for Brain RPC | Upstream **multiplex profiles** (`hermes profile create`) are **isolated `HERMES_HOME` trees** under `profiles/<name>/` — a different concept from backend capability seeds |

**Missing for a full layout claim:** backend profile seed JSON (or documented
builtins) that Brain RPC auth can load; explicit `BACKEND_HOME` dual-write;
contract packaging of defaults under the home.

### 1.3 Brain RPC required methods (`contract.brain_rpc: 1`)

| Requirement | Upstream | Hermes-Lanyard |
| --- | --- | --- |
| Accept `brain_rpc_request` → emit `brain_rpc_result` on relay WSS | **no** — unknown frame types fall through to silent ignore in `gateway/relay/ws_transport.py` | **yes** — `_handle_brain_rpc_request` → `gateway.brain_rpc` |
| Host package `gateway/brain_rpc/` | **absent** on Nous `main` | **present** (dispatcher, auth, vault, settings, projects) |
| Auth L0–L5 + path ACL | **no** | **yes** (`auth.py`) |
| `brain.ping` / `brain.health` | **no** (RPC) | **yes** |
| `vault.list` / `vault.stat` / `vault.read` | **no** (RPC) | **yes** |
| `settings.snapshot` (redacted) | **no** | **yes** |
| `projects.list` | **no** (RPC); DB exists | **yes** |
| Unimplemented → `method_not_found` | **no** (silent drop) | **yes** |

Relay chat alone is **not** enough for Portal settings, vault browser, or
project pickers — those require Brain RPC
([`conformance.md`](../../contracts/backend-runtime-v1/conformance.md) §F).

### 1.4 Profiles / settings / projects compatibility

| Surface | Upstream | Gap |
| --- | --- | --- |
| Hermes-shaped `config.yaml` | **yes** / close | Low friction |
| Secret policy (env / no plaintext defaults) | **yes** (product practice) | Align with snapshot redaction when RPC lands |
| Backend profile seeds + `backend_profile` subject | **no** | Need admin/contributor capability tokens; accept `hermes_profile` alias during migration |
| `settings.snapshot` for Portal | **no** | No host-backed settings UX |
| `projects.list` over RPC | **no** | `projects.db` is a head start, not a substitute |

### 1.5 Relay (`contract.relay: 1`)

| Surface | Upstream |
| --- | --- |
| Egress dial + hello/descriptor + chat frames | **yes** (relay connector contract lived upstream; mirrored in hermes-lanyard) |
| Platform env names (`GATEWAY_RELAY_*`) | **partial** / product docs — treat as close if deploy sets the same vars |

Relay is the strongest upstream surface today. It does **not** unlock vault or
settings UI.

### 1.6 Expansion methods (optional)

Same as matrix: live `brain.capabilities`, `vault.write`, `settings.patch`,
`projects.create`, models/cron RPC — **absent** on pure upstream; **partial** on
Hermes-Lanyard depending on product release. Advertise only when implemented.

### Gap statement (acceptance)

> **Missing contract pieces on Hermes upstream:** stock Nous Hermes has no Brain
> RPC host, no backend profile seed model, and no `backend-runtime-v1` artifact
> packaging. Runtime home + relay chat are close. Without those missing pieces,
> `kind: hermes_upstream` cannot honestly claim `brain_rpc: 1` or a full
> platform pin for Portal host ops. Hermes-Lanyard already closes the host-ops
> gap for production.

---

## 2. Shim and adapter options

Goal: satisfy (or honestly partial-claim) the contract **without** forcing
Nous to take Lanyard-specific code on their timeline, and **without** vendoring
upstream into this monorepo ([ADR 0002](../adr/0002-external-backend-products.md)).

### Option A — Prefer Hermes-Lanyard (recommended production path)

| | |
| --- | --- |
| **What** | Keep customer pins on `kind: hermes_lanyard`. Continue weekly Nous rebase into hermes-lanyard; product carries Brain RPC + pack scripts. |
| **Pros** | Already the reference; deploy doctrine matches; phase-7 job `lp-k7g.11.4` targets this kind. |
| **Cons** | Fork maintenance (intentional). |
| **Monorepo work** | Conformance jobs + pins only — **no** upstream source. |
| **Sync impact** | Product-only deltas stay in hermes-lanyard; rebase remains the integration path. |

### Option B — Packaging shim only (thin wrapper over stock upstream)

| | |
| --- | --- |
| **What** | External pack job produces `backend.tar.gz` with `manifest/backend.json` (`kind: hermes_upstream`), `bin/company-brain-backend` → `hermes gateway`, `config/defaults.yaml`, and sets `BACKEND_HOME`/`HERMES_HOME` dual-write. **No** Brain RPC code. |
| **Honest claim** | At most `runtime_layout: 1` (if profile seeds/dirs satisfied) + `relay: 1`. **`brain_rpc: 0` or omit.** Manifest `capabilities.brain_rpc_methods` must be empty or only methods that exist. |
| **Pros** | Unlocks install/bootstrap experiments without fork. |
| **Cons** | Portal host ops stay disabled; easy to over-claim majors. |
| **Where it lives** | Product CI or a small packaging repo — **not** monorepo source trees. |

### Option C — Out-of-process Brain RPC adapter (sidecar)

| | |
| --- | --- |
| **What** | Separate process shares the relay session or a local IPC path; implements the seven required methods by reading `$HERMES_HOME` / vault root. |
| **Pros** | Zero patch to Nous tree. |
| **Cons** | Dual lifecycle, auth surface, version skew; harder to prove fail-closed ACL; deploy becomes multi-unit. |
| **Verdict** | **Not recommended** for v1 customer hosts. Acceptable only as a lab spike. |

### Option D — In-tree Brain RPC on a Lanyard packaging branch (today’s hermes-lanyard)

| | |
| --- | --- |
| **What** | Same as Option A described as “adapter in the product tree”: `gateway/brain_rpc/*` + `ws_transport` hook + profile seeds. This **is** hermes-lanyard. |
| **Pros** | Single gateway process; tests exist (`tests/gateway/brain_rpc/`); matches Portal. |
| **Cons** | Rebase conflicts possible around `ws_transport.py`. |
| **Verdict** | **Current production design.** Do not re-implement in the monorepo. |

### Option E — Contribute Brain RPC upstream (long-term delta reduction)

| | |
| --- | --- |
| **What** | Propose Nous-facing design so `brain_rpc_request` handling is optional/upstreamed; Lanyard keeps profile seeds + packaging. |
| **Pros** | Shrinks fork surface over years. |
| **Cons** | Upstream may decline Lanyard auth/tenant pins; timeline uncertain. |
| **Rule** | Contribution is **optional**. Platform must not block on Nous merge. hermes-lanyard remains authority until a release proves parity. |

### Option F — Explicit non-options

| Non-option | Why |
| --- | --- |
| Vendor Nous or hermes-lanyard source into this monorepo | Violates ADR 0002 / migration overview constraints |
| Portal special-cases for stock Hermes file reads | Reverts settings/vault to direct home IO — blocked by phase 4 design |
| Pin raw Nous docker/PyPI on customer hosts | Forbidden by pin-update doctrine |
| Claim `brain_rpc: 1` from packaging alone | Dishonest; Portal would show broken UI |

### Recommendation matrix

| Goal | Choose |
| --- | --- |
| Production tenant host | **A / D** (`hermes_lanyard`) |
| Lab pin of stock Hermes for chat-only | **B** with honest majors |
| Spike host ops without fork | **C** (lab only) then discard or fold into product |
| Reduce long-term fork delta | **E** (async) |

---

## 3. Upstream sync constraints (must respect)

These constraints are **normative for agents and operators** working on
platform or product repos.

### 3.1 Source stays external

- Do **not** copy, subtree-merge, or vendor `NousResearch/hermes-agent` or
  `LanyardBrain/hermes-lanyard` into `lanyard-platform`.
- Integration is **versioned artifacts + pins + conformance**, not git
  submodules of agent source ([ADR 0002](../adr/0002-external-backend-products.md)).

### 3.2 Hermes-Lanyard is the sync sink, not the monorepo

From hermes-lanyard product docs (`docs/lanyard-private-repo.md`):

| Item | Constraint |
| --- | --- |
| Upstream remote | `NousResearch/hermes-agent` |
| Integration branch | `lanyard/portal-integration` — weekly `git rebase` onto Nous `main` |
| Automation | `.github/workflows/sync-upstream.yml` (Sunday schedule + dispatch) |
| Product default | `main` — merge integration → `main` is **manual** after review |
| Public fork | Archived; not deploy authority |

**Implication for shims:** any Lanyard-only surface (Brain RPC package, pack
script, profile seeds, docs/lanyard-*) must remain **rebasable** — small,
isolated modules preferred over wide edits to upstream files. The existing
pattern (dedicated `gateway/brain_rpc/` + thin `ws_transport` hook) is the
template for future deltas.

### 3.3 Customer host pin doctrine

| Rule | Detail |
| --- | --- |
| Pin product | **`LanyardBrain/hermes-lanyard`** artifacts (or platform S3 mirror built from that tree) |
| Never pin for customer hosts | Raw **`NousResearch/hermes-agent`** release tarballs, upstream docker images, or “stock Hermes” without portal/Brain RPC surface |
| Install path (today) | `/opt/hermes-lanyard` with `bin/hermes gateway` (generic `BACKEND_*` migration does not license raw Nous) |

Source: [`deploy/references/runbooks/pin-update.md`](../../deploy/references/runbooks/pin-update.md),
[`deploy/references/provision-runbook.md`](../../deploy/references/provision-runbook.md).

### 3.4 Optional `hermes_upstream` landing zone

Platform may reserve `backends/hermes-upstream/` and pin kind
`hermes_upstream` for **future** trusted publishers
([`deploy-artifact-landing-zones.md`](deploy-artifact-landing-zones.md)). That
path is **optional** and must not be used for production tenants until:

1. Artifact validates (`manifest/backend.json`, entrypoint).
2. Conformance job (or manual checklist) passes for advertised majors.
3. Operators accept residual risk vs hermes-lanyard reference.

### 3.5 What monorepo work is allowed

| Allowed here | Not allowed here |
| --- | --- |
| Contract schemas, examples, harness, pin schema | Upstream/Hermes product source |
| This assessment + matrix updates | Force-push or “sync” automation against Nous |
| Offline validators / future `hermes_upstream` job | Committing real Nous tarballs as substitutes for hermes-lanyard pins |
| Deploy docs for kind enum + optional prefix | Changing hermes-lanyard rebase policy from the monorepo |

### Sync constraint statement (acceptance)

> **Upstream sync constraints:** Hermes upstream remains external; hermes-lanyard
> absorbs Nous via weekly rebase on a product branch. Platform never vendors
> either tree. Customer hosts pin hermes-lanyard, not raw Nous. Shims must not
> break rebasability or reverse the pin doctrine.

---

## 4. Compatibility matrix (abbreviated)

Full tables:
[`contracts/backend-runtime-v1/conformance.md`](../../contracts/backend-runtime-v1/conformance.md).
Published summary:
[`backend-compatibility-matrix.md`](backend-compatibility-matrix.md).

| Contract surface | Hermes-Lanyard | hermes_upstream (stock) |
| --- | --- | --- |
| Relay chat + egress auth | **yes** | **yes** / close |
| Brain RPC transport + 7 methods | **yes** | **no** |
| `BACKEND_HOME` / `HERMES_HOME` layout | **yes** | **partial** (`HERMES_HOME` only; no backend profile seeds) |
| Profile seeds + ACL | **yes** | **no** (multiplex profiles only) |
| `settings.snapshot` / vault RPC | **yes** | **no** |
| `projects.list` (RPC) | **yes** | **no** (DB yes) |
| Hermes-shaped `config.yaml` | **yes** | **yes** / close |
| Contract backend artifact + entrypoint | **partial** | **no** |
| Live `brain.capabilities` | **no** / example | **no** |

---

## 5. External follow-up (not monorepo implementation)

Track outside this repository. Platform phase 7 only verifies artifacts.

### 5.1 If pursuing a real `hermes_upstream` claim (product/packaging repo)

- [ ] Pack `manifest/backend.json` with honest majors and empty Brain RPC method list until host exists.
- [ ] Ship `bin/company-brain-backend` wrapper → `hermes gateway`.
- [ ] Dual-write `BACKEND_HOME` + `HERMES_HOME` in unit/env fragments.
- [ ] Seed or document builtins for `admin` / `contributor` **only if** Brain RPC exists.
- [ ] Either implement Brain RPC (prefer contributing path that hermes-lanyard can drop) **or** never set `contract.brain_rpc: 1`.
- [ ] Add conformance evidence (download job or manual checklist) before any tenant pin.

### 5.2 Hermes-Lanyard (keep reference healthy)

- [ ] Preserve weekly Nous rebase; resolve conflicts in `ws_transport` carefully.
- [ ] Keep Brain RPC module isolated for rebasability.
- [ ] Align product pack toward contract entrypoint name when convenient (wrapper OK).
- [ ] Prefer `backend_profile` on the wire with `hermes_profile` alias.

### 5.3 Explicit non-goals

- Do not require Portal to open raw Nous install paths or skip Brain RPC.
- Do not treat multiplex CLI profiles as backend RBAC seeds.
- Do not claim session portability between arbitrary upstream tags and hermes-lanyard without migration notes.

---

## 6. Evidence index

| Claim | Anchor |
| --- | --- |
| No `gateway/brain_rpc` on Nous `main` | `git ls-tree upstream/main gateway/` — no `brain_rpc` tree |
| Silent ignore of unknown relay frames | Nous `gateway/relay/ws_transport.py` `_handle_frame` final `else: pass` |
| HL Brain RPC dispatch | hermes-lanyard `gateway/relay/ws_transport.py` `brain_rpc_request` branch; `gateway/brain_rpc/*` |
| HL product docs | hermes-lanyard `docs/lanyard-brain-rpc.md`, `docs/lanyard-private-repo.md`, `docs/lanyard-release-artifact.md` |
| Upstream multiplex profiles | Nous `hermes_cli/profiles.py`, `website/docs/user-guide/profiles.md` |
| Upstream `projects.db` | Nous `hermes_cli/projects_db.py` |
| Customer pin doctrine | `deploy/references/runbooks/pin-update.md` § Customer host Hermes pin |
| External backend boundary | [ADR 0002](../adr/0002-external-backend-products.md) |
| Example upstream manifest (aspirational) | `contracts/backend-runtime-v1/examples/hermes-upstream.manifest.json` |

---

## 7. Related platform docs

| Doc | Role |
| --- | --- |
| [`backend-runtime-contract.md`](backend-runtime-contract.md) | Contract summary |
| [`lanyard-agent-conformance-gaps.md`](lanyard-agent-conformance-gaps.md) | Parallel gap analysis for `lanyard_agent` |
| [`backend-compatibility-matrix.md`](backend-compatibility-matrix.md) | Published kind/version/contract/capabilities/result/deploy-readiness |
| [`contracts/backend-runtime-v1/conformance.md`](../../contracts/backend-runtime-v1/conformance.md) | Suite + surface matrix |
| [`contracts/backend-runtime-v1/filesystem-layout.md`](../../contracts/backend-runtime-v1/filesystem-layout.md) | Layout + Hermes aliases |
| [`portal-hermes-deployment-compat.md`](portal-hermes-deployment-compat.md) | Portal `HERMES_*` alias policy |
| [`docs/plans/0001-platform-monorepo-migration/phase-7-backend-conformance.md`](../plans/0001-platform-monorepo-migration/phase-7-backend-conformance.md) | Phase 7 automation |
| [`workspace-map.md`](workspace-map.md) | External product boundary |
