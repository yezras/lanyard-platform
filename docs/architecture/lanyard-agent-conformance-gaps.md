# Lanyard Agent — backend-runtime-v1 conformance gaps

**Beads:** `lp-k7g.6.7` (initial gap inventory) · **`lp-k7g.11.6`** (external
implementation checklist + tracking)  
**Contract:** [`contracts/backend-runtime-v1/`](../../contracts/backend-runtime-v1/)  
**Published compatibility matrix (all kinds):** [`backend-compatibility-matrix.md`](backend-compatibility-matrix.md)  
**Surface matrix / suite:** [`contracts/backend-runtime-v1/conformance.md`](../../contracts/backend-runtime-v1/conformance.md)  
**External product repo:** [LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent)  
  (local inspection tree used for gap writeup: `/home/operator/Lanyard-Dev/lanyard-agent`)

This document is the **platform-owned** tracking surface for Lanyard Agent work
needed to satisfy `backend-runtime-v1`. It lists real code gaps versus
Hermes-Lanyard (v1 reference), maps platform acceptance **1:1**, and provides
an external implementation checklist with owners and definitions of done.

It does **not** implement Lanyard Agent changes and must **not** copy LA source
into this monorepo ([ADR 0002](../adr/0002-external-backend-products.md)).
Closing items is external product work; the monorepo owns the contract, matrix,
and phase-7 verification against published artifacts.

**External tracking (GitHub, product repo):**

| # | Work item | Issue |
| --- | --- | --- |
| AC-1 | Portal transport handles `brain_rpc_request` | [lanyard-agent#134](https://github.com/LanyardBrain/lanyard-agent/issues/134) |
| AC-2 | Runtime layout matches `BACKEND_HOME` | [lanyard-agent#135](https://github.com/LanyardBrain/lanyard-agent/issues/135) |
| AC-3 | Settings / profile / projects match contract | [lanyard-agent#136](https://github.com/LanyardBrain/lanyard-agent/issues/136) |
| AC-4 | Release artifact: manifest + entrypoint | [lanyard-agent#137](https://github.com/LanyardBrain/lanyard-agent/issues/137) |

Product Beads in [LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent)
use prefix `lac-*`. Platform phase 7 (`lp-k7g.11.*`) only verifies artifacts.

---

## Platform acceptance criteria (1:1 map)

These four criteria are the monorepo bead `lp-k7g.11.6` acceptance list. Each
maps to one major external work package, a GitHub issue, and checklist section
§8 below.

| ID | Acceptance criterion (platform bead) | Gap § | Checklist § | Owner | External issue | Status (2026-07-20) |
| --- | --- | --- | --- | --- | --- | --- |
| **AC-1** | Portal transport handles `brain_rpc_request` | §1 | §8.1 | Lanyard Agent product (`LanyardBrain/lanyard-agent`) | [#134](https://github.com/LanyardBrain/lanyard-agent/issues/134) | **open** — types only; transport drops frames |
| **AC-2** | Runtime layout matches `BACKEND_HOME` contract | §2 | §8.2 | Lanyard Agent product + deploy packaging as needed | [#135](https://github.com/LanyardBrain/lanyard-agent/issues/135) | **open** — split FHS; no Option A/B |
| **AC-3** | Settings / profile / projects behavior matches contract | §3 | §8.3 | Lanyard Agent product | [#136](https://github.com/LanyardBrain/lanyard-agent/issues/136) | **open** — no seeds, snapshot, or `projects.db` |
| **AC-4** | Release artifact includes standard manifest and entrypoint | §2 (artifact rows) | §8.4 | Lanyard Agent release / CI | [#137](https://github.com/LanyardBrain/lanyard-agent/issues/137) | **open** — product tarball ≠ contract shape |

### Definition of done — platform bead `lp-k7g.11.6` (this monorepo)

This bead is **tracking documentation only**. It is done when:

1. This file contains a complete external checklist with AC 1:1 mapping, owners,
   and DoD per item (this document).
2. Follow-up is linked to [LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent)
   (issues above and/or product `lac-*` Beads).
3. No Lanyard Agent product source is vendored into the monorepo.

**Closing the four ACs in product code is not required to close the monorepo
tracking bead.** Product completion is proven later when phase-7 conformance
(or an equivalent job) passes against a published `kind: lanyard_agent`
artifact.

---

## Executive summary

| Area | Status | One-line gap |
| --- | --- | --- |
| Relay chat | **partial / mostly yes** | Portal dial-out works; chat is usable |
| Brain RPC request handling | **no** | Requests ignored; no host dispatcher |
| Runtime layout (`BACKEND_HOME`) | **no** | Split `/etc` + `/var/lib` + `/var/log`; no projection |
| Settings / profile / project compatibility | **no** / **partial** | No profile seeds, no `projects.db`, no `settings.snapshot`; config schema differs |
| Artifact claim (`manifest/backend.json`) | **no** | Product tarball ≠ contract backend artifact yet |

Until required Brain RPC methods and layout projection exist, Lanyard Agent
**must not** advertise `contract.brain_rpc: 1` or `contract.runtime_layout: 1`
as fully satisfied. Portal must continue to use capability fallbacks / disabled
UI for host-backed settings and vault browser when this backend is selected.

**Production default:** keep customer hosts on **`hermes_lanyard`** until LA
claims are honest and verified. Lanyard Agent remains a first-class contract
target, not a Portal special case.

---

## 1. Brain RPC request handling gap → AC-1

### Contract requirement

Every backend claiming `contract.brain_rpc: 1` must:

1. Accept `brain_rpc_request` on the authenticated egress relay WebSocket.
2. Return `brain_rpc_result` with `contract_version: 1`.
3. Implement required methods: `brain.ping`, `brain.health`, `vault.list`,
   `vault.stat`, `vault.read`, `settings.snapshot`, `projects.list`.
4. Enforce fail-closed auth + profile capabilities + vault path ACL.
5. Return `method_not_found` for unimplemented expansion methods (never silent drop).

Normative: [`brain-rpc.schema.json`](../../contracts/backend-runtime-v1/brain-rpc.schema.json).

### What Lanyard Agent has today

| Piece | Location | Status |
| --- | --- | --- |
| Wire types (methods, errors, frames) | `packages/adapters-portal/src/wire/brain-rpc.ts` | **partial** — types only |
| Frame union includes Brain RPC | `packages/adapters-portal/src/wire/frames.ts` | **partial** |
| Transport dispatch of `brain_rpc_request` | `packages/adapters-portal/src/transport.ts` | **no** — default branch comment: *“interrupt_inbound / brain_rpc_request / going_idle_ack: later phases”* |
| Host method handlers | (none under `apps/gateway` / packages) | **no** |
| Auth / path ACL for RPC | (none) | **no** |
| Explicit “out of scope” docs | `packages/adapters-portal/README.md` | States Brain RPC host methods are later-phase / plan v1 out |

Vendored subject still uses **`hermes_profile` only** (no `backend_profile`
alias on the type). Contract prefers `backend_profile` with legacy alias.

### What Hermes-Lanyard has (reference)

| Piece | Location |
| --- | --- |
| Dispatcher | `gateway/brain_rpc/dispatcher.py` |
| Handlers map (7 required methods) | `gateway/brain_rpc/handlers.py` → `HANDLERS` |
| Auth + profile caps + path ACL | `gateway/brain_rpc/auth.py` |
| Vault ops | `gateway/brain_rpc/vault_ops.py` |
| Settings snapshot (redacted) | `gateway/brain_rpc/settings_snapshot.py` |
| Projects list | `gateway/brain_rpc/projects_handler.py` |
| WS integration | `gateway/relay/ws_transport.py` routes `brain_rpc_request` |

### Related but non-substituting surfaces in Lanyard Agent

These **must not** be counted as Brain RPC conformance:

| Surface | Why it is not enough |
| --- | --- |
| HTTP `GET /health`, `GET /ready` (`apps/gateway/src/health-server.ts`) | Local ops probes, not relay `brain.health` |
| Agent-core vault loader (`packages/agent-core/src/vault/*`) | Agent-turn progressive reads; no Portal RPC, no subject path ACL |
| Cron CLI / slash (`packages/cron`, gateway cron) | Product cron, not `cron.list` / `settings.snapshot` |

### Gap statement (acceptance)

> **Brain RPC request handling gap:** Lanyard Agent does not handle
> `brain_rpc_request` frames. Portal host ops (vault browser, settings page,
> project picker, structured host health over Brain RPC) cannot work against
> this backend until a host dispatcher + seven required methods ship.

**External issue:** [lanyard-agent#134](https://github.com/LanyardBrain/lanyard-agent/issues/134)

---

## 2. Runtime layout gap → AC-2 (and packaging overlap AC-4)

### Contract requirement

`contract.runtime_layout: 1` requires a single `BACKEND_HOME` tree:

```text
BACKEND_HOME/
  config.yaml
  projects.db
  profiles/admin.json
  profiles/contributor.json
  skills/
  cron/jobs.json
  logs/
  sessions/
  workspace/
```

Lanyard Agent may use **Option A** (native tree) or **Option B** (projection /
symlink tree indistinguishable to Portal and deploy). See
[`filesystem-layout.md`](../../contracts/backend-runtime-v1/filesystem-layout.md)
§ Lanyard Agent compatibility options.

### What Lanyard Agent has today

| Host path (production) | Role |
| --- | --- |
| `/etc/lanyard-agent/config.yaml` | Structured config |
| `/etc/lanyard-agent/env` | Secrets (mode 600) |
| `/var/lib/lanyard-agent/` | State: `sessions.db`, OAuth store, cron under `{stateDir}/cron/`, export staging |
| `/var/log/lanyard-agent` | Logs (systemd `ReadWritePaths`) |
| `vault_root` in config (e.g. `/opt/company-brain`) | Vault — correct that vault is **outside** home |

Evidence:

- Config resolution: `apps/gateway/src/config-path.ts` → `SYSTEM_CONFIG_PATH = "/etc/lanyard-agent/config.yaml"`.
- Systemd unit: `deploy/systemd/lanyard-agent-gateway.service` — `WorkingDirectory=/var/lib/lanyard-agent`, config under `/etc`.
- Cron store: `packages/cron` → `{stateDir}/cron/jobs.json` (tests default `/var/lib/lanyard-agent`).
- Architecture docs: `docs/ARCHITECTURE.md` documents the split layout explicitly.
- Migrate runbook: `docs/runbooks/migrate-from-hermes.md` maps Hermes home → LA split paths (not the reverse contract projection).

### Missing contract elements

| Contract path | Lanyard Agent today |
| --- | --- |
| `BACKEND_HOME` env | **Absent** |
| `profiles/*.json` | **Absent** |
| `projects.db` | **Absent** |
| `skills/` under home | **Absent** (skills from vault roots) |
| `sessions/` directory | **Different** — single SQLite `sessions.db` |
| `workspace/` | **Absent** (worktrees use env `LANYARD_WORKTREE_ROOT` when subagents enabled) |
| `bin/company-brain-backend` | **Absent** — entrypoints `lanyard-agent-gateway` / `lanyard-agent` |
| `manifest/backend.json` in release tarball | **Absent** — product artifact layout per `docs/deploy/RELEASE.md` |

### Gap statement (acceptance)

> **Runtime layout gap:** Lanyard Agent uses a split FHS layout and product
> bins. It does not present `BACKEND_HOME` (Option A or B). Deploy and Portal
> cannot treat it as a drop-in `runtime_layout: 1` host without a projection
> layer and contract entrypoint/manifest packaging.

**External issues:** layout [#135](https://github.com/LanyardBrain/lanyard-agent/issues/135) ·
artifact [#137](https://github.com/LanyardBrain/lanyard-agent/issues/137)

---

## 3. Settings / profile / project compatibility gaps → AC-3

### 3.1 Config / settings

| Concern | Hermes-Lanyard (reference) | Lanyard Agent |
| --- | --- | --- |
| Primary config file | `$HERMES_HOME/config.yaml` Hermes shape | `/etc/lanyard-agent/config.yaml` Zod schema |
| Schema keys | `model`, `providers`, `skills`, `cron`, … ([`config.schema.json`](../../contracts/backend-runtime-v1/config.schema.json)) | `vault_root`, `default_model`, `litellm`, `session`, `channels`, `cron`, `routing`, … (`packages/config/src/schema.ts`) |
| Portal redacted view | Brain RPC `settings.snapshot` | **Missing** |
| Secret handling | env / `key_env` | env *names* in YAML — aligned in spirit |

Contract `config.schema.json` is intentionally Hermes-baseline with additional
properties allowed. Lanyard Agent’s **authoritative** config is a different
document shape. Conformance for settings UX does **not** require bit-identical
YAML; it requires:

1. A file (or projection) at `$BACKEND_HOME/config.yaml` deploy can seed, **and**
2. Redacted Brain RPC `settings.snapshot` for Portal.

Both are missing for (2); (1) is missing without layout projection.

### 3.2 Profiles

| Concern | Contract / Hermes-Lanyard | Lanyard Agent |
| --- | --- | --- |
| Seeds `admin` + `contributor` | Required under `profiles/` | **None** |
| Capability tokens (`vault_read`, `vault_full`, …) | [`profiles.schema.json`](../../contracts/backend-runtime-v1/profiles.schema.json) | **Not loaded** for host ops |
| Path prefix ACL | Subject `path_prefixes` + profile caps | **Not enforced** on RPC (no RPC) |
| Terminology | Prefer `backend_profile` | Vendored wire: `hermes_profile` only |
| Pairing / allowlists | Hermes pairing under home | Product `pairing` config block — **not** the same as backend profiles |

Gateway pairing (`packages/gateway-core` pairing modes) is a **channel trust**
control. It does not replace Brain RPC profile capability seeds.

### 3.3 Projects

| Concern | Hermes-Lanyard | Lanyard Agent |
| --- | --- | --- |
| `projects.db` | Under home; `projects.list` reads it | **No** DB, **no** list method |
| Empty DB behavior | Empty list allowed | N/A |
| Compaction “project” helpers | N/A | Agent-core compaction has a `project.ts` helper for **context compaction**, not Portal project registry |

### Gap statement (acceptance)

> **Settings / profile / project compatibility gaps:** Lanyard Agent lacks
> profile seed JSON, vault path ACL for host ops, `projects.db` +
> `projects.list`, and redacted `settings.snapshot`. Its config schema is
> product-specific and is not projected into the Hermes-baseline home layout.

**External issue:** [lanyard-agent#136](https://github.com/LanyardBrain/lanyard-agent/issues/136)

---

## 4. Compatibility matrix (Hermes-Lanyard vs Lanyard Agent vs hermes_upstream)

Abbreviated matrix; full tables live in
[`contracts/backend-runtime-v1/conformance.md`](../../contracts/backend-runtime-v1/conformance.md).

| Contract surface | Hermes-Lanyard | Lanyard Agent | hermes_upstream |
| --- | --- | --- | --- |
| Relay chat + egress auth | **yes** | **yes** | **partial** |
| Brain RPC transport + 7 methods | **yes** | **no** (types only) | **no** / unproven |
| `BACKEND_HOME` layout | **yes** (`HERMES_HOME`) | **no** (split FHS) | **yes** / close |
| Profile seeds + ACL | **yes** | **no** | **partial** |
| `settings.snapshot` | **yes** | **no** | **no** / unproven |
| `projects.list` | **yes** | **no** | **partial** / unproven |
| Hermes-shaped `config.yaml` | **yes** | **no** (different schema) | **yes** / close |
| Product cron under state dir | **yes** under home | **partial** under `/var/lib` | **yes** |
| Contract backend artifact + entrypoint | **partial** (reference) | **no** | **partial** |
| Live `brain.capabilities` | **no** (example only) | **no** | **no** |

**External repo work** is linked from the matrix section in `conformance.md`
and from §8 (do not implement here). Parallel upstream assessment:
[`hermes-upstream-compatibility.md`](hermes-upstream-compatibility.md).

---

## 5. Ownership model

| Layer | Owner | Responsibility |
| --- | --- | --- |
| Contract schemas + examples | **This monorepo** | `contracts/backend-runtime-v1/*` |
| Gap analysis + external checklist | **This monorepo** | This document (`lp-k7g.6.7`, `lp-k7g.11.6`) |
| Compatibility matrix | **This monorepo** | [`backend-compatibility-matrix.md`](backend-compatibility-matrix.md) (`lp-k7g.11.7`); surface tables in `conformance.md` |
| Brain RPC host, layout, profiles, settings, projects | **Lanyard Agent product** | [LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent) — GitHub #134–#136, `lac-*` |
| Contract-shaped release tarball | **Lanyard Agent release / CI** | #137; may coordinate with deploy pin docs |
| Deploy pins / install of published LA artifacts | **Platform deploy** (after product ships honest artifact) | `deploy/*`, pins v2; no LA source in monorepo |
| Portal feature gates | **Portal** | Capability descriptor only — **no** `/etc/lanyard-agent` forks |
| Phase-7 verification | **This monorepo + CI** | Harness, tarball validate, future LA job when pin exists |

**Rule:** Lanyard Agent gaps are **contract deltas and external backlog**, not
Portal forks that hard-code product FHS paths or skip Brain RPC.

---

## 6. Recommended implementation order (external)

Suggested sequence so intermediate claims stay honest:

```text
1. Layout Option B (or A) + profile seeds + empty projects.db     → AC-2 foundation
2. Brain RPC transport + auth + seven methods                    → AC-1 (+ AC-3 methods)
3. settings.snapshot mapping + projects.list over DB             → AC-3 complete
4. Contract artifact pack (manifest, entrypoint, defaults)       → AC-4
5. Advertise contract majors only for surfaces that pass tests
6. Platform phase-7 / matrix re-verify against published pin
```

Packaging (#4) may land early with **honest** majors (`brain_rpc: 0` or omit
methods until host exists). Over-claiming is a release blocker.

---

## 7. Explicit non-goals

- Do **not** require Portal to read `/etc/lanyard-agent` or `/var/lib/lanyard-agent` directly.
- Do **not** import Hermes skills hub or Hermes multiplex profiles as a substitute for backend profiles.
- Do **not** claim session DB portability Hermes ↔ Lanyard Agent (layout compatibility ≠ session import).
- Do **not** copy or subtree-merge Lanyard Agent source into this monorepo.
- Do **not** treat HTTP health probes or agent-turn vault tools as Brain RPC.
- Do **not** require bit-identical Hermes `config.yaml` keys — snapshot + home projection suffice.

---

## 8. External implementation checklist

Implement in **[LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent)**
(and release/deploy packaging as needed). Track with product Beads (`lac-*`)
and the GitHub issues below. Platform phase 7 only verifies artifacts.

**Status legend:** `todo` · `in_progress` · `blocked` · `done`  
Statuses below are from platform static inspection (2026-07-20), not product CI.

### 8.1 AC-1 — Brain RPC transport + required methods

| Field | Value |
| --- | --- |
| **Platform AC** | Portal transport handles `brain_rpc_request` |
| **Owner** | Lanyard Agent product team |
| **Repo** | [LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent) |
| **GitHub** | [#134](https://github.com/LanyardBrain/lanyard-agent/issues/134) |
| **Contract claim** | `contract.brain_rpc: 1` |
| **Depends on** | Profile seeds / path ACL data (AC-2/AC-3); vault root env |
| **Status** | `todo` |

| ID | Work item | Status | Definition of done |
| --- | --- | --- | --- |
| LA-RPC-01 | Route `brain_rpc_request` in `RelayWsTransport` (stop silent drop) | `todo` | Frame type dispatches to host; unknown types no longer drop Brain RPC silently |
| LA-RPC-02 | Host dispatcher with concurrency / timeout bounds aligned to contract | `todo` | Bounded in-flight RPCs; timeouts produce structured errors, not hang |
| LA-RPC-03 | Auth verification: tenant/instance pins, expiry, subject profile + roles | `todo` | Fail-closed L0–L5 per schema; invalid subjects never reach handlers |
| LA-RPC-04 | Accept `backend_profile` with fallback to `hermes_profile` | `todo` | Preferred field works; legacy alias still accepted |
| LA-RPC-05 | Load profile capabilities from seeds (or documented builtins) | `todo` | Admin/contributor caps drive authorization identically to HL spirit |
| LA-RPC-06 | Path ACL for `vault.list` / `stat` / `read` against `VAULT_ROOT` | `todo` | Contributor prefixes enforced; `vault_full` empty prefixes = whole vault |
| LA-RPC-07 | Implement `brain.ping`, `brain.health` | `todo` | Schema-valid results over relay (HTTP probes optional extras only) |
| LA-RPC-08 | Implement `vault.list`, `vault.stat`, `vault.read` with size caps | `todo` | Caps/errors match contract; ACL applied |
| LA-RPC-09 | Implement redacted `settings.snapshot` | `in_progress` (product has handler reading `$BACKEND_HOME/cron/jobs.json`; platform pin fixtures `lp-uxy.3`) | Skills/models/cron summary/integrations; **no secrets** on wire; `crons[]` from LA home only |
| LA-RPC-10 | Implement `projects.list` (empty list if DB missing) | `todo` | Schema-valid list; empty OK |
| LA-RPC-11 | Return structured `method_not_found` for unknown / unimplemented | `todo` | Never silent drop; distinct from `forbidden` |
| LA-RPC-12 | Unit + relay integration tests | `todo` | CI green; coverage mirrors HL `tests/gateway/brain_rpc/` intent |

**AC-1 package DoD:**

1. Authenticated relay session: `brain_rpc_request` → `brain_rpc_result` with `contract_version: 1`.
2. All seven required methods schema-valid (or ACL errors where appropriate).
3. Expansion methods not implemented return `method_not_found`.
4. Manifest may list the seven methods **only after** tests prove them.
5. Evidence attached to product issue/Bead; platform can re-run harness against artifact when pin exists.

### 8.2 AC-2 — Runtime layout (`BACKEND_HOME`)

| Field | Value |
| --- | --- |
| **Platform AC** | Runtime layout matches `BACKEND_HOME` contract |
| **Owner** | Lanyard Agent product (+ install/systemd docs) |
| **Repo** | [LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent) |
| **GitHub** | [#135](https://github.com/LanyardBrain/lanyard-agent/issues/135) |
| **Contract claim** | `contract.runtime_layout: 1` |
| **Depends on** | Decision Option A vs B |
| **Status** | `todo` |

| ID | Work item | Status | Definition of done |
| --- | --- | --- | --- |
| LA-FS-01 | Choose **Option A** (preferred long term) or **Option B** projection | `todo` | Written decision in product ARCHITECTURE / install docs |
| LA-FS-02 | Set and document `BACKEND_HOME` for the gateway process | `todo` | Env required in unit/env fragment; process resolves home from it |
| LA-FS-03 | Path catalog present or projected (config, profiles, skills, cron, logs, sessions, workspace) | `todo` | Tree matches [`filesystem-layout.md`](../../contracts/backend-runtime-v1/filesystem-layout.md) path catalog |
| LA-FS-04 | Seed `profiles/admin.json` + `profiles/contributor.json` | `todo` | Validates against `profiles.schema.json` capability tokens |
| LA-FS-05 | Provide `projects.db` path under home (create empty OK) | `todo` | Path exists or is created on boot; RPC empty-list safe |
| LA-FS-06 | Prefer projecting cron store to `$BACKEND_HOME/cron/jobs.json` | `in_progress` (platform contract + fixtures `lp-uxy.3`; product `stateDir` must equal `BACKEND_HOME`, not nested sessions path) | Cron state visible at contract path when cron enabled; never under `~/.hermes` for LA |
| LA-FS-07 | Optional `HERMES_HOME=$BACKEND_HOME` only if dual-tooling needs it | `todo` | Documented; unset is valid for pure `lanyard_agent` |

**AC-2 package DoD:**

1. Deploy sets only platform env names; no Portal special cases for `/etc` or `/var/lib`.
2. Required dirs exist at boot; optional files empty OK.
3. Option A tree or Option B projection is **indistinguishable** to Portal/deploy.
4. `contract.runtime_layout: 1` advertised only when true.
5. Vault remains on `VAULT_ROOT` (outside home).

### 8.3 AC-3 — Settings / profile / projects behavior

| Field | Value |
| --- | --- |
| **Platform AC** | Settings / profile / projects behavior matches contract |
| **Owner** | Lanyard Agent product |
| **Repo** | [LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent) |
| **GitHub** | [#136](https://github.com/LanyardBrain/lanyard-agent/issues/136) |
| **Contract claim** | Profiles schema + Brain RPC settings/projects methods |
| **Depends on** | AC-1 (RPC) + AC-2 (home paths) |
| **Status** | `todo` |

| ID | Work item | Status | Definition of done |
| --- | --- | --- | --- |
| LA-SPP-01 | Map Lanyard Zod config → redacted snapshot fields Portal expects | `todo` | Documented field map; snapshot tests with secrets stripped |
| LA-SPP-02 | Seed path for deploy: artifact `config/defaults.yaml` + `$BACKEND_HOME/config.yaml` | `todo` | First-install seed works even if internal load uses `/etc` via symlink |
| LA-SPP-03 | Keep secrets out of YAML / snapshot | `todo` | No API keys or tokens in snapshot or defaults examples |
| LA-SPP-04 | Backend profile seeds + `backend_profile` subject terminology | `todo` | Portal-neutral naming; pairing is not a substitute |
| LA-SPP-05 | `projects.list` reads home `projects.db` (empty list OK) | `todo` | Schema-valid; not agent-core compaction helpers |
| LA-SPP-06 | Contributor vs admin UX behavior matches ACL | `todo` | Portal settings/vault/project surfaces degrade correctly when forbidden |

**AC-3 package DoD:**

1. Portal settings page loads via `settings.snapshot` without host file reads.
2. Admin/contributor subjects behave per profile schema + path ACL.
3. Project picker gets schema-valid `projects.list` (possibly empty).
4. `$BACKEND_HOME/config.yaml` exists for deploy seed/upgrade story.
5. Feature flags in manifest match live edit capabilities (`settings_patch`, etc.).

### 8.4 AC-4 — Release artifact (manifest + entrypoint)

| Field | Value |
| --- | --- |
| **Platform AC** | Release artifact includes standard manifest and entrypoint |
| **Owner** | Lanyard Agent release / CI |
| **Repo** | [LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent) |
| **GitHub** | [#137](https://github.com/LanyardBrain/lanyard-agent/issues/137) |
| **Contract claim** | Artifact shape + honest `manifest/backend.json` |
| **Depends on** | Prefer after AC-1–3 for full majors; may ship early with honest partial claims |
| **Status** | `todo` |

| ID | Work item | Status | Definition of done |
| --- | --- | --- | --- |
| LA-ART-01 | Emit `manifest/backend.json` validating against [`artifact-manifest.schema.json`](../../contracts/backend-runtime-v1/artifact-manifest.schema.json) | `todo` | Offline schema validate in product CI |
| LA-ART-02 | Ship or wrap `bin/company-brain-backend` → `gateway` | `todo` | Wrapper may exec `lanyard-agent-gateway`; path stable after extract |
| LA-ART-03 | Include `config/defaults.yaml` + `docs/backend-release.md` (or contract docs path) | `todo` | Present in tarball; referenced by manifest fields |
| LA-ART-04 | Advertise only implemented `capabilities.brain_rpc_methods` and honest `features.*` | `todo` | No method listed that returns `method_not_found` as the only path |
| LA-ART-05 | Align pin docs with platform `kind: lanyard_agent` | `todo` | Product RELEASE + platform pin example agree |
| LA-ART-06 | Provenance block (source_repo, git_sha, build_time, builder) | `todo` | Filled for every immutable release |

**AC-4 package DoD:**

1. Tarball validates with monorepo `python3 scripts/validate-backend-tarball.py` (or equivalent).
2. After extract, `bin/company-brain-backend gateway` starts the service.
3. Majors and method lists match live behavior.
4. Deploy bootstrap can install using the same contract paths as other backends.
5. Example target shape: [`examples/lanyard-agent.manifest.json`](../../contracts/backend-runtime-v1/examples/lanyard-agent.manifest.json).

### 8.5 Expansion methods (optional; advertise only when real)

Not required for v1 claim. Owner: Lanyard Agent product. Track under product
Beads when prioritized.

| ID | Work item | Status | Definition of done |
| --- | --- | --- | --- |
| LA-EXP-01 | Live `brain.capabilities` descriptor | `todo` | Method in handlers; matches `capabilities.schema.json` |
| LA-EXP-02 | `vault.write` | `todo` | ACL + size/policy; feature flag true only when live. **Reference:** Hermes-Lanyard host pin implements this (`lp-5q6.20`); LA still needs its own handler |
| LA-EXP-03 | `settings.patch` | `todo` | Redacting + safe mutate path |
| LA-EXP-04 | `projects.create` | `todo` | Writes `projects.db`; list reflects create |
| LA-EXP-05 | `models.list` / `models.set_active` | `todo` (Portal pilot honesty: keep `model_selector` unsupported; Settings list read-only — `lp-kng.7.2`) | Reflects LiteLLM / routing reality when product prioritizes selector over inject-only |
| LA-EXP-06 | `cron.list` / `cron.patch` | `todo` (keep `features.cron=false` until live; Portal toggles via `settings.patch` + snapshot — `lp-uxy.3`) | Bridges product cron store to RPC; pin example `capabilities.lanyard-agent.cron.json` |

### 8.6 Checklist rollup

| Platform AC | GitHub | Checklist IDs | Package status |
| --- | --- | --- | --- |
| AC-1 Brain RPC transport | [#134](https://github.com/LanyardBrain/lanyard-agent/issues/134) | LA-RPC-01 … LA-RPC-12 | `todo` |
| AC-2 `BACKEND_HOME` layout | [#135](https://github.com/LanyardBrain/lanyard-agent/issues/135) | LA-FS-01 … LA-FS-07 | `todo` |
| AC-3 Settings / profile / projects | [#136](https://github.com/LanyardBrain/lanyard-agent/issues/136) | LA-SPP-01 … LA-SPP-06 | `todo` |
| AC-4 Artifact manifest + entrypoint | [#137](https://github.com/LanyardBrain/lanyard-agent/issues/137) | LA-ART-01 … LA-ART-06 | `todo` |
| Expansion (optional) | (product) | LA-EXP-01 … LA-EXP-06 | `todo` |

---

## 9. Evidence index (inspection anchors)

| Claim | Anchor |
| --- | --- |
| Brain RPC ignored on transport | `lanyard-agent/packages/adapters-portal/src/transport.ts` (default case) |
| Types only / host dispatch OOS | `…/wire/brain-rpc.ts` header; `adapters-portal/README.md` “Out of scope” |
| Split layout | `docs/ARCHITECTURE.md` § filesystem; `deploy/systemd/lanyard-agent-gateway.service` |
| Config schema | `packages/config/src/schema.ts` root `configSchema` |
| Cron under stateDir | `packages/cron` store paths; tests use `/var/lib/lanyard-agent` |
| No profiles/projects.db | repo-wide absence except wire type `projects.list` |
| Hermes reference handlers | `hermes-lanyard/gateway/brain_rpc/handlers.py` `HANDLERS` |
| Platform evaluation note | [`current-architecture-evaluation.md`](current-architecture-evaluation.md) (“Lanyard Agent does not yet implement the Brain RPC request path…”) |
| External issues (2026-07-20) | [#134](https://github.com/LanyardBrain/lanyard-agent/issues/134)–[#137](https://github.com/LanyardBrain/lanyard-agent/issues/137) |

---

## 10. Related platform docs

| Doc | Role |
| --- | --- |
| [`backend-runtime-contract.md`](backend-runtime-contract.md) | Contract summary for Portal/deploy authors |
| [`backend-compatibility-matrix.md`](backend-compatibility-matrix.md) | Published kind/version/contract/capabilities/result/deploy-readiness |
| [`contracts/backend-runtime-v1/conformance.md`](../../contracts/backend-runtime-v1/conformance.md) | Suite expectations + surface matrix |
| [`contracts/backend-runtime-v1/filesystem-layout.md`](../../contracts/backend-runtime-v1/filesystem-layout.md) | Layout options A/B |
| [`contracts/backend-runtime-v1/README.md`](../../contracts/backend-runtime-v1/README.md) | Schema index |
| [`contracts/backend-runtime-v1/examples/lanyard-agent.manifest.json`](../../contracts/backend-runtime-v1/examples/lanyard-agent.manifest.json) | Aspirational artifact example |
| [`hermes-upstream-compatibility.md`](hermes-upstream-compatibility.md) | Parallel assessment for `hermes_upstream` |
| [`docs/plans/0001-platform-monorepo-migration/phase-7-backend-conformance.md`](../plans/0001-platform-monorepo-migration/phase-7-backend-conformance.md) | Phase 7 automated verification |
| [`workspace-map.md`](workspace-map.md) | Lanyard Agent remains external product |
| [ADR 0002 — external backend products](../adr/0002-external-backend-products.md) | Source stays external |

---

## 11. How to re-verify later (platform)

When a `kind: lanyard_agent` pin and tarball exist:

```bash
# Schema / offline suite (monorepo)
bash scripts/validate.sh
python3 scripts/validate-backend-tarball.py --tarball /path/to/backend.tar.gz
python3 contracts/backend-runtime-v1/harness/run_brain_rpc_conformance.py

# Product evidence (external repo)
# - CI green for Brain RPC + layout tests
# - Release notes claim only implemented majors
# - Issues #134–#137 closed with DoD evidence
```

Update the published matrix
[`backend-compatibility-matrix.md`](backend-compatibility-matrix.md), surface
tables in [`conformance.md`](../../contracts/backend-runtime-v1/conformance.md),
and §8 statuses in this file when product ships a verified claim.
