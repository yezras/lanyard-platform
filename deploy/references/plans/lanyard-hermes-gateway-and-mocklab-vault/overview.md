# Plan: Lanyard Hermes gateway (redeploy) + mocklab vault seed

**Epic bead:** `cbd-ukg`  
**Related:** `cbd-mta.8` (solo mock E2E), especially `cbd-mta.8.8.1` chat smoke  
**Status:** plan for human review (do not implement until approved)  
**Date:** 2026-07-19  

## Problem / goal

Portal chat and vault UX depend on **Hermes source that Lanyard edited for Portal** (cwd pin, `lanyard_web` metadata, tool_progress/citations, brain_rpc, G2a jti). Operators need every customer host (starting with **mocklab**) to run that product, not a stock/unpatched Hermes.

Separately, mocklab’s vault after bootstrap is an **empty client-core spine**. Portal needs **synthetic projects/folders/sample data** (and Hermes `projects.db` entries) so login + vault + chat feel like a real client.

## Key finding (investigation)

There is **no second daemon** named “Lanyard gateway.”

| What people say | What the system actually runs |
|-----------------|-------------------------------|
| “Hermes gateway” | systemd unit **`hermes-gateway`** → `/opt/hermes-lanyard/bin/hermes gateway` |
| “Lanyard Hermes gateway” | **Same unit and CLI**, but the **artifact** is built from **`LanyardBrain/hermes-lanyard`** (portal-adapted tree), not raw Nous |

**Deploy already targets hermes-lanyard** (`/opt/hermes-lanyard`, mocklab pin `v0.1.0-g7h2`). The work is not renaming the service. The work is:

1. **Prove** the host pin includes the portal-integration surface operators care about.
2. **Republish + re-pin + re-bootstrap** when source has moved ahead of `v0.1.0-g7h2`.
3. **Seed mock vault content** post-bootstrap without polluting the production client-core artifact.

## Who this is for

| Consumer | Impact |
|----------|--------|
| Operator (you) | Clear upgrade path for Hermes on mocklab and every future tenant |
| Portal UX testing | Realistic tree + projects so chat Directory, vault, citations work |
| Maintainer | One redeploy contract encoded in pins/smokes; demo seed stays deploy-only |

## Scope

### In scope

- Inventory portal-required Hermes deltas vs pinned release.
- Publish new hermes-lanyard runtime tarball when pin is behind source.
- Update compatibility pins + `deployments/mocklab` (pattern for any tenant).
- Re-bootstrap mocklab Hermes install; restart `hermes-gateway`; prove WSS + chat path.
- Deploy-only **mock vault seed** (synthetic Projects/Knowledge/Clients + Hermes projects + optional CP path_prefixes).
- Docs/runbook notes for “any new client” Hermes pin + seed optional.

### Out of scope

- Renaming `hermes-gateway` unit or inventing a second gateway binary.
- Production readiness matrix G1–G8 flips from mock alone.
- Shipping demo content inside production **client-core** release tags.
- Copying real employee-vault clients into mocklab.
- Omnibox product wrap (`cbd-mta.8.9` / `cbd-o9s`) unless unblocked by chat.
- Track A/B multi-account E2E (`cbd-mta.7.6`).

## Principles that shaped this plan

| Principle | Choice it forced |
|-----------|------------------|
| **Fix root causes** | Redeploy hermes-lanyard pin that contains portal patches; do not paper over with a mock-only gateway process |
| **Laziness protocol** | Keep unit name `hermes-gateway` and ExecStart `hermes gateway`; only change pins + bootstrap + seed |
| **Boundary discipline** | Demo markdown stays out of client-core release; secrets stay SSM/host |
| **Sequence verifiable units** | Investigate pin gap → publish → re-pin mocklab → prove gateway → seed vault → chat/vault smoke |
| **Prove it works** | Host provenance SHA, WSS connected, portal “hello brain”, vault paths visible |
| **Encode lessons in structure** | Optional smoke: assert hermes install path + provenance version shape; seed script is the lever |
| **Guard the context window** | Exploration via subagents across hermes-lanyard / deploy / portal / client-core |
| **Migrate callers then delete** | No dual “stock path forever”; tenants only pin hermes-lanyard artifacts |

## Architecture (current, correct target)

```text
Browser  /mocklab  →  BFF  →  Relay /internal/deliver-inbound
                                 ↕ WSS /relay  (egress from customer host)
                         hermes-gateway unit
                         ExecStart=/opt/hermes-lanyard/bin/hermes gateway
                         GATEWAY_RELAY_* + lanyard_web
                         VAULT_ROOT=/opt/company-brain
```

Portal-required product surface (lives in **hermes-lanyard** tree, not deploy):

- `gateway/relay/*` + `GATEWAY_RELAY_PLATFORMS=lanyard_web`
- portal metadata (tool_progress, citations, cwd from chat_topic)
- `gateway/brain_rpc/*` (vault/settings when BFF enables Brain RPC)
- G2a jti upgrade tokens for production relay auth

## Phases

| Phase | Bead | Deliverable |
|-------|------|-------------|
| 0 | `cbd-ukg.1`–`.3` | Principles, exploration, plan docs; human review |
| 1 | `cbd-ukg.4` | Gap report: pinned hermes artifact vs portal-needed commits/files |
| 2 | `cbd-ukg.5` | Publish hermes-lanyard runtime tarball (if gap) + S3 mirror |
| 3 | `cbd-ukg.6` | Re-pin mocklab (+ compatibility docs); bootstrap + restart gateway |
| 4 | `cbd-ukg.7` | Prove gateway portal contract (WSS, hello, optional brain.ping) |
| 5 | `cbd-ukg.8` | Mock vault seed script + synthetic content on mocklab |
| 6 | `cbd-ukg.9` | Hermes projects.db + CP path_prefixes for demo ACL |
| 7 | `cbd-ukg.10` | Encode: runbook + smoke hooks for any future tenant (**done**: pin-update + tenant/mocklab checklist + ExecStart smoke) |

Phase details: `phase-1-gap.md` … `phase-7-encode.md`, `testing.md`.

## Definition of done

1. Human approved this plan (phase 0).
2. Mocklab host runs hermes-lanyard install whose provenance matches the new pin (or gap report proves current pin is sufficient).
3. `hermes-gateway` active; WSS to staging relay healthy; portal chat smoke can proceed (`cbd-mta.8.8.1`).
4. `/opt/company-brain` has synthetic Projects/Knowledge/(optional Clients); Hermes Directory lists projects.
5. Documented path for the next tenant (pin + bootstrap + optional seed).
6. No claim of production-certified G1–G8 from this work alone.

## Open questions (for review)

1. **Release cut branch:** Tag from `hermes-lanyard` `main` or require merge of `lanyard/portal-integration` first?
2. **How far behind is `v0.1.0-g7h2`?** Phase 1 answers with file/commit evidence before packing.
3. **Demo seed packaging:** Prefer in-repo `scripts/seed-demo-vault.sh` only, or also a small versioned S3 demo tarball?
4. **Should Brain RPC be on** for mocklab vault UI (`BRAIN_RPC_ENABLED` on BFF), or is FS/chat-only enough for first pass?
5. **Relation to `cbd-mta.8.8.1`:** Close chat smoke only after phase 4 (gateway) and preferably phase 5–6 (content)?

## Related paths

| Area | Path |
|------|------|
| Plan | `references/plans/lanyard-hermes-gateway-and-mocklab-vault/` |
| Hermes product | `/home/operator/Lanyard-Dev/hermes-lanyard` (`docs/lanyard-release-artifact.md`, `gateway/brain_rpc/`) |
| Portal contract | monorepo `portal/packages/shared/src/relay/*`, `portal/docs/brain-rpc.md` |
| Deploy unit | `modules/company-brain-ec2/systemd/hermes-gateway.service` |
| Relay env | `modules/customer-gateway-relay/` |
| Mocklab pins | `deployments/mocklab/terraform.tfvars` |
| Bootstrap | `scripts/bootstrap-host.sh` |
| Vault seed spine | monorepo `client-core/` (empty by design) |
| Pin update | `references/runbooks/pin-update.md` |
