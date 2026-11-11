# Omnibox Mode A on Company Brain (multi-phase plan)

**Epic bead:** `cbd-o9s`  
**Status:** planning complete (do not implement until instructed)  
**Supersedes for execution:** dual-mode plan under `.hermes/plans/2026-07-15_164600-…` and the single-file Mode A draft; this directory is the multi-phase source of truth.

## Context

Company Brain tenant EC2 already runs Hermes gateway as an unprivileged service with profile RBAC (admin/contributor), tool allowlists, and systemd hardening. That hardens the **gateway process**. It does not OS-cage **agent tool execution** (especially admin `shell_exec`). Operators need default-deny egress and no access to host secrets from agent-spawned work, without adopting a paid code sandbox or a second session host (Omnigent server / Mode B).

**Consumer impact:** Client tenants get safer agent behavior on the same Portal chat path. Admins still get shell when allowed. Secrets and arbitrary network stay out of the agent view.  
**Maintainer impact:** One feature flag, idempotent ensure script, offline smokes in CI, and an optional small Hermes hook. No dual control plane.

## Scope

### In

- Mode A only: **Hermes uses Omnibox** (Omnibox wraps host-impacting tools).
- Deploy ownership in `company-brain-deploy`: policy seeds, `run-under-omnibox`, `ensure-omnibox`, bootstrap flag, docs, CI smokes.
- Map `admin` / `contributor` Hermes profiles to Omnibox grant sets.
- Egress allowlist render from approved processors + tenant model endpoints.
- Staging validation with break-glass disable.

### Out

- Mode B (Omnigent server, session host, multi-device Omnigent UI).
- Daytona, Modal, E2B, LangSmith sandboxes as required runtime.
- MicroVM per user.
- Replacing `hermes-gateway` systemd unit with Omnigent.
- Contributor shell by default (allowlist remains deny).
- Portal product changes beyond using existing `source.profile`.

## Constraints

| Constraint | Source |
|------------|--------|
| Portal → relay → Hermes path stays primary | Company Brain product doctrine |
| Service user `hermes`, vault `/opt/company-brain` | host-runtime-hardening |
| Profiles and tool allowlists already enforced | hermes-profile-rbac |
| Controlled egress / no public agent UI | SSM-first, threat model |
| Feature flag default **off** until staging pass | production honesty |
| Shared kernel residual risk must be documented | not microVM |
| Omnigent (if used) is CLI/library for Omnibox only, not a server | Mode A lock |

## Alternatives considered

| Approach | Verdict |
|----------|---------|
| **A. Wrap shell/host tools under Omnibox (this plan)** | Chosen: smallest change, preserves Portal path |
| **B. Omnigent session host for all agent work** | Rejected for now: second control plane, alpha product risk on chat path |
| **C. Paid microVM sandbox (E2B/Daytona) for code only** | Rejected: paid, wrong abstraction, not “whole harness on our EC2” |
| **D. systemd-only tighter unit** | Insufficient: does not per-tool FS/egress/credential inject for children |

**Principles that forced the choice:** Laziness Protocol (wrap tools, do not replace gateway); Subtract Before You Add (drop Mode B/Daytona); Boundary Discipline (secrets and egress at OS boundary); Redesign from First Principles would still keep Hermes as agent and add an execution cage, delivered as Mode A incrementally.

## Domain model (foundational shapes)

| Concept | Shape |
|---------|--------|
| `OmniboxProfile` | `admin` \| `contributor` (mirrors Hermes profile name) |
| `OmniboxPolicy` | FS grants, never_grant paths, egress allowlist, credential placeholder set |
| `SessionContext` | profile + optional path_prefixes from Portal inject |
| `WrapperInvocation` | `run-under-omnibox --profile … [--path-prefix …] -- cmd…` |
| `HostFlags` | `enable_omnibox` (tf) → `OMNIBOX_ENABLED` (env) |

Encode mapping as **policy files + registry**, not scattered if/else in bootstrap.

## Applicable skills (implementer)

- `pstack-playbooks` / Feature when coding phases
- `how` before changing unfamiliar Hermes gateway tool backend
- `unslop` / deslop on diffs and docs
- `show-me-your-work` for decision trail on spike tool choice
- Offline smokes as **Build the Lever** artifacts reviewers re-run

## Phases (delivery order)

| Phase | File | Bead | Parallel? |
|-------|------|------|-----------|
| 0 Spike and tool choice | [phase-0-spike.md](./phase-0-spike.md) | `cbd-o9s.6` | No |
| 1 Policy seeds | [phase-1-policy-seeds.md](./phase-1-policy-seeds.md) | `cbd-o9s.7` | After 0 |
| 2 Wrapper CLI | [phase-2-wrapper.md](./phase-2-wrapper.md) | `cbd-o9s.8` | After 1 |
| 3 Ensure + offline smoke | [phase-3-ensure-smoke.md](./phase-3-ensure-smoke.md) | `cbd-o9s.9` | After 2 |
| 4 Bootstrap and systemd env | [phase-4-bootstrap-flag.md](./phase-4-bootstrap-flag.md) | `cbd-o9s.10` | After 3 |
| 5 Hermes shell hook | [phase-5-hermes-hook.md](./phase-5-hermes-hook.md) | `cbd-o9s.11` | After 4 |
| 6 Egress render | [phase-6-egress-render.md](./phase-6-egress-render.md) | `cbd-o9s.12` | After 1 |
| 7 Docs and threat model | [phase-7-docs.md](./phase-7-docs.md) | `cbd-o9s.13` | After 4 |
| 8 CI | [phase-8-ci.md](./phase-8-ci.md) | `cbd-o9s.14` | After 3 |
| 9 Staging validation | [phase-9-staging.md](./phase-9-staging.md) | `cbd-o9s.15` | After 5,6,7,8 |
| Testing summary | [testing.md](./testing.md) | (on `.15`) | — |

Deps encoded in beads: `.6`→`.7`→`.8`→`.9`→`.10`→`.11`; `.12`←`.7`; `.13`←`.10`; `.14`←`.9`; `.15`←`.11,.12,.13,.14`.

## Project-level verification

```bash
# From monorepo root (live deploy tree is deploy/; company-brain-deploy is ARCHIVED)
cd deploy
bash scripts/smoke-omnibox.sh
bash scripts/smoke-host-runtime-hardening.sh
bash scripts/smoke-hermes-profiles.sh
bash scripts/validate-production-gates.sh   # must not falsely claim microVM
# Staging: portal chat + admin shell isolation + break-glass
```

## Implementation guidance

1. Do not implement Omnigent server units.
2. Do not bwrap the long-lived gateway process; only tool children.
3. Prefer deploy-owned wrapper before Hermes product PR; product PR only for pre-exec if missing.
4. Keep `enable_omnibox` default false until phase 9 passes.
5. Every phase ends in a smoke or staged runtime check (**prove-it-works**).
6. After PR: babysit CI; no force-push to shared main without human.

## Beads

| Role | ID |
|------|-----|
| Plan epic | `cbd-o9s` |
| Planning steps | `cbd-o9s.1` … `cbd-o9s.5` (closed) |
| Phase children | `cbd-o9s.6` … `cbd-o9s.15` (open for claim / `/beads-execute`) |

## Definition of done (MVP)

- Staging tenant with Omnibox on: Portal chat healthy.
- Admin host-impacting tools run under Omnibox; cannot read gateway `.env`; blocked egress fails.
- Contributor still no shell; vault path rules unchanged.
- Offline smokes green in CI.
- Threat model states shared-kernel residual risk.
- Mode B not introduced.

## Open questions (product, not blockers for planning)

1. Exact Hermes pre-exec surface (confirm in phase 0/5).
2. When to default `enable_omnibox=true` for new tenants (after phase 9).
3. Tenant model endpoint list source (tfvars vs SSM). Defaults in plan: tfvars list + render script.
