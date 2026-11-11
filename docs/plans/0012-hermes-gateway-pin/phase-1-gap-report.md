# Phase 1 gap report: Hermes pin `v0.1.0-g7h2` vs Portal needs

**Bead:** `cbd-ukg.4`  
**Date:** 2026-07-19  
**Pin under investigation:** hermes-lanyard **`v0.1.0-g7h2`**  
**Decision:** **GO phase 2 pack** (publish a new hermes-lanyard artifact)

## Executive summary

Deploy already installs **hermes-lanyard** (`/opt/hermes-lanyard`, unit `hermes-gateway` → `bin/hermes gateway`). There is no second gateway binary. The gap is **pin currency**: staged release `v0.1.0-g7h2` was cut from git SHA `f929f478e` and **does not include** the Lanyard Portal integration surface that lives on branch `lanyard/portal-integration` (cwd pin from `chat_topic`, `portal_event` tool_progress, relay `edit_message`), nor the post-tag **G2a jti** upgrade-token mint on `origin/main`.

| Classification | Result |
|----------------|--------|
| Pin contents (tarball + tag) | **missing X** — portal-integration + G2a jti (see table) |
| Host mocklab provenance | **unknown (host unreachable)** — no SSM inventory in this operator account; did not SSH |
| Phase 2 pack | **GO** — do not skip |

Basic WSS chat *may* limp on the pin (legacy upgrade tokens + generic relay), but multi-project cwd, durable tool rows, and production-shaped auth are not on the pin. Vault UI via Brain RPC **is** in the pin; empty vault content is a separate phase-5 seed problem, not a Hermes pin miss for RPC handlers.

## Evidence sources

| Source | What was used |
|--------|----------------|
| Deploy pin file | `compatibility/pins.real-releases.yaml` → hermes `v0.1.0-g7h2`, SHA-256 `046f9987b10ae6f19a0e1e74bf2e68e5ce8ddeb853dee6a50211bc5cdffa71f4`, GH release URL |
| Mocklab intent (main workspace tfvars keys only) | `hermes_artifact_version = "v0.1.0-g7h2"` + matching SHA; S3 URL under staging product-artifacts prefix (account IDs not repeated here) |
| Local pin tarball | SHA-256 **matches** pins file; `.seed/build.env` → `git_sha=f929f478e…`, `version=v0.1.0-g7h2` |
| hermes-lanyard git | `/home/operator/Lanyard-Dev/hermes-lanyard` tag `v0.1.0-g7h2` = `f929f478e`; `origin/main` has G2a jti only beyond tag; `origin/lanyard/portal-integration` has portal patches **not** in tag or main |
| GH release | `LanyardBrain/hermes-lanyard` `v0.1.0-g7h2` published 2026-07-12; same SHA-256 |
| Host | AWS caller account has empty SSM instance list; mocklab host not probed — provenance **unknown** |
| Portal contract | `portal/artifacts/hermes-lanyard-tool-citations-contract.md`; shared `LANYARD_WEB_PLATFORM = "lanyard_web"` |
| Deploy unit / env | `modules/company-brain-ec2/systemd/hermes-gateway.service`; `modules/customer-gateway-relay` default `relay_platform = "lanyard_web"` → `GATEWAY_RELAY_PLATFORMS` |

## Pin identity

| Field | Value |
|-------|--------|
| Version | `v0.1.0-g7h2` |
| SHA-256 | `046f9987b10ae6f19a0e1e74bf2e68e5ce8ddeb853dee6a50211bc5cdffa71f4` |
| Pack git_sha (`.seed/build.env`) | `f929f478eab05033db807cf0c3562e073aa27d52` |
| Tag message | docs: product OIDC/release authority is hermes-lanyard only |
| Install layout | `hermes-v0.1.0-g7h2/{bin/hermes,.venv,share,.seed,VERSION}` — gateway code under `.venv/lib/python3.12/site-packages/gateway/` |
| Commits on `origin/main` after tag | `7ff6bf22b` / `d94df9e32` — **feat(relay): mint single-use jti upgrade tokens (G2a)** |
| Portal patches relative to tag | **Not ancestors of tag**; live only on `origin/lanyard/portal-integration` (`1506032c8`, `d956fac28`, …) |

## Gap table

Legend: **in pin?** = present in unpacked `v0.1.0-g7h2` tarball / tag tree. Chat = portal “hello brain” / streaming UX. Vault UI = Brain RPC vault/settings/projects (when BFF enables it).

| File / feature | In pin? | Needed for chat? | Needed for vault UI? | Evidence |
|----------------|---------|------------------|----------------------|----------|
| `gateway/brain_rpc/*` (ping, health, vault.list/stat/read, settings.snapshot, projects.list) | **yes** | nice-to-have (brain.ping) | **yes** (when Brain RPC on) | Tag + tarball site-packages list full package; `handlers.py` method map; `ws_transport.py` dispatches `brain_rpc_request` |
| Relay stack `gateway/relay/{adapter,auth,descriptor,transport,ws_transport}.py` | **yes** (base) | **yes** | **yes** (RPC rides same WS) | Present in tarball; `GATEWAY_RELAY_*` env parsing in `__init__.py` |
| `GATEWAY_RELAY_PLATFORMS=lanyard_web` (env string, not enum member) | **yes** (generic platforms list) | **yes** | yes | Deploy default `relay_platform = "lanyard_web"`; hermes reads comma-sep env — no hard-coded enum required for handshake identity |
| G2a **jti** upgrade tokens (`make_upgrade_token` → `gateway_id:exp:jti:sig`) | **no** | staging: **partial** (Portal dual-accepts legacy); prod posture: **yes** | same WS | Pin `auth.py` has legacy `make_upgrade_token` only; jti commit **not** ancestor of tag; Portal relay has `upgrade_legacy_accepted` + jti store |
| `gateway/relay/portal_metadata.py` + `portal_event: tool_progress` enrichment | **no** | **yes** for durable ChatToolCalls | no | File absent in tarball `gateway/relay/`; only on `lanyard/portal-integration` (`1506032c8`); Portal contract requires structured metadata |
| Relay adapter `edit_message` + portal metadata enrich on send/edit | **no** | **yes** (tool progress upserts / edit path) | no | Same portal-integration commit; pin adapter lacks `_portal_enrich_metadata` / `edit_message` |
| Cwd pin from absolute `chat_topic` (`_session_cwd_from_chat_topic` for `lanyard_web`/`relay`) | **no** | **yes** for multi-project tool cwd | helps tools under project paths | Portal injects `primary_path` as `chat_topic`; pin has generic `cwd_placeholder` / `TERMINAL_CWD` only — **not** per-session topic pin |
| `chat_topic` passthrough on wire (`ws_transport` → session source) | **yes** | yes (context / future pin) | no | Pin `ws_transport.py` sets `chat_topic=src.get("chat_topic")` |
| Generic `display.tool_progress` chrome (emoji / text bubbles) | **yes** | degraded chat only | no | Pin `display_config.py` + stream consumer; Portal falls back to chrome heuristics (lossy) |
| Structured `metadata.citations` on final answer | **no** (not in pin; incomplete even on portal-integration) | nice-to-have for vault chips from chat | helps vault deep-link UX | Portal contract phases 1–3; portal-integration has path helpers, not full final-answer citations ship |
| `gateway/cwd_placeholder.py` / global `TERMINAL_CWD` resolution | **yes** | baseline host cwd | no | In pin site-packages; unit sets `VAULT_ROOT=/opt/company-brain` |
| Unit `hermes-gateway` → `/opt/hermes-lanyard/bin/hermes gateway` | **yes** (deploy) | **yes** | **yes** | `modules/company-brain-ec2/systemd/hermes-gateway.service` — not a pin content issue |
| Host `/opt/hermes-lanyard/.seed/provenance.env` matches pin SHA | **unknown** | ops prove only | ops prove only | Host unreachable from this session (no SSM targets in caller account) |

## What the pin *is* good for

- Hermes **runtime** layout contract (`bin/hermes`, relocatable venv, `.seed/build.env`).
- **Brain RPC MVP** on the host (vault/settings/projects read path) once BFF enables Brain RPC.
- **Generic relay** WSS client with legacy upgrade tokens (Portal still dual-accepts legacy today).
- Bootstrap / pin validation exercises already using this SHA.

## What breaks or degrades without a new pack

1. **Chat multi-project cwd** — without `_session_cwd_from_chat_topic`, tools do not pin to the project path Portal puts on `chat_topic`; Directory/project UX is wrong even if WSS connects.
2. **Tool UI** — without `portal_event` metadata, Portal relies on brittle emoji chrome; Astryx `ChatToolCalls` will not be reliable.
3. **G2a auth** — pin cannot mint jti tokens; fine only while staging dual-accepts legacy; not the production auth posture.
4. **Release branch drift** — portal patches are **not on `main`**; cutting from `main` alone yields jti but still **misses** portal-integration. Phase 2 must merge/cherry-pick before pack (open question in overview).

## Go / no-go for phase 2 pack

### **GO — publish a new hermes-lanyard runtime artifact**

**Reasons (blocking gaps):**

1. Portal integration commit `1506032c8` (cwd pin, `portal_metadata`, relay `edit_message`) is **absent** from `v0.1.0-g7h2` and from `origin/main`.
2. G2a jti (`d94df9e32` / `7ff6bf22b`) is **absent** from the pin (present on `origin/main` only).
3. Epic goal requires mocklab to run portal-adapted hermes-lanyard, not “stock-enough for WSS.”

**Not a skip:** pin is **not** “sufficient for chat + vault UX as planned.” Brain RPC presence alone does not make the pin sufficient for chat.

### Phase 2 cut guidance (input only; do not execute here)

| Option | Includes portal patches? | Includes G2a jti? | Notes |
|--------|--------------------------|-------------------|--------|
| Re-tag from current `origin/main` | **no** | yes | Insufficient for chat UX |
| Tag only `lanyard/portal-integration` tip | yes (branch tip) | **no** (unless merged) | Missing production jti mint |
| **Merge portal-integration + main (or cherry-pick both), then tag** | yes | yes | **Recommended cut for phase 2** |

Pack command (hermes-lanyard): `./scripts/pack-lanyard-runtime.sh --version <immutable>` (see `docs/lanyard-release-artifact.md`). Then re-pin mocklab (phase 3).

## File pointers

### hermes-lanyard (product)

| Path | Role |
|------|------|
| `/home/operator/Lanyard-Dev/hermes-lanyard` | Clone |
| `gateway/brain_rpc/` | Host Brain RPC MVP |
| `gateway/relay/auth.py` | Upgrade token mint/verify (jti only post-g7h2) |
| `gateway/relay/adapter.py` | Relay adapter; portal enrich + `edit_message` on portal-integration |
| `gateway/relay/portal_metadata.py` | **portal-integration only** — `portal_event` helpers |
| `gateway/relay/ws_transport.py` | WSS + brain_rpc_request dispatch |
| `gateway/run.py` | Session cwd pin from `chat_topic` (portal-integration) |
| `gateway/cwd_placeholder.py` | Global TERMINAL_CWD placeholders (in pin) |
| `docs/lanyard-release-artifact.md` | Pack/publish contract |
| `scripts/pack-lanyard-runtime.sh` | Local pack |
| Tag `v0.1.0-g7h2` @ `f929f478e` | Current deploy pin source |
| Branch `origin/lanyard/portal-integration` | Portal UX surface not in pin |
| `origin/main` @ G2a jti | Auth upgrade not in pin |

### company-brain-deploy (this repo)

| Path | Role |
|------|------|
| `compatibility/pins.real-releases.yaml` | Hermes pin coordinates |
| `deployments/mocklab/` | Tenant root (pins via tfvars; do not commit live secrets) |
| `modules/company-brain-ec2/systemd/hermes-gateway.service` | Unit → `hermes gateway` |
| `modules/customer-gateway-relay/` | `GATEWAY_RELAY_PLATFORMS=lanyard_web` |
| `scripts/bootstrap-host.sh` | Artifact install to `/opt/hermes-lanyard` |
| `artifacts/README.md` | Artifact contract |
| `references/runbooks/pin-update.md` | Pin update procedure |
| This plan dir | Phases 0–7 |

### Portal (consumer contract)

| Path | Role |
|------|------|
| `packages/shared/src/relay/contract.ts` | `LANYARD_WEB_PLATFORM` |
| `artifacts/hermes-lanyard-tool-citations-contract.md` | tool_progress / citations wire |
| `packages/relay/src/relay-session-server.ts` | G2a jti + legacy dual-accept |

## Host provenance (mocklab)

| Check | Result |
|-------|--------|
| Reach host via SSM/SSH this session | **No** — caller AWS account SSM instance list empty; no host probe |
| `/opt/hermes-lanyard/.seed/provenance.env` | **unknown (host unreachable)** |
| Expected if bootstrap used current pin | version `v0.1.0-g7h2`, sha matching `046f9987…`, product `hermes-lanyard` |

Operator follow-up (phase 3/4, not this bead): compare host provenance to pin after any re-bootstrap; do not commit secrets or live account IDs.

## Explicit non-claims

- Not production G1–G8 certification.
- Not a claim that mocklab chat already fails or succeeds live (host not checked).
- Not starting phase 2 pack, re-pin, seed, or chat smoke in this bead.
- Structured citations remain a Hermes product follow-up even after portal-integration merge.

## Acceptance map (phase-1-gap.md)

| Criterion | Status |
|-----------|--------|
| Portal-required features enumerated with file pointers | **done** — table + pointers above |
| Current mocklab pin classified | **missing X** (portal-integration + G2a jti); host row **unknown (host unreachable)** |
| Phase 2 starts or skipped with reason | **starts (GO)** — reasons above |
