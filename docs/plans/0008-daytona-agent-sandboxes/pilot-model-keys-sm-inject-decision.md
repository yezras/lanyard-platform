# Pilot decision: model / provider keys via SM + wake inject (`lp-kng.7.1`)

| Field | Value |
|-------|--------|
| **Bead** | `lp-kng.7.1` |
| **Epic** | `lp-kng.7` — Pilot residual: model/connector admin vs wake-inject (Settings honesty) |
| **Parent plan** | [overview.md](./overview.md) (`lp-kng` Daytona sandboxes) |
| **Date** | 2026-08-13 |
| **Status** | **Decision documented (draft)** — pilot path locked as inject-only; **human gate** before any production multi-tenant key-admin productization |
| **Needs human** | **true** — product/ops sign-off that inject-only is acceptable for pilot and that product follow-ons are correctly deferred |
| **No secrets** | This file names env keys and paths only; no live key values |

Related sources:

| Source | Role |
|--------|------|
| [gateway-env-contract.md](./gateway-env-contract.md) | Bucket C wake inject; provider keys at same env names as EC2 |
| [spike-4l5-gateway-secret-inject.md](./spike-4l5-gateway-secret-inject.md) | Create-time env inject proof (Relay secret path; same inject port) |
| [backend-runtime-secrets.md](../../architecture/backend-runtime-secrets.md) | SM envelope SoT for provider keys (EC2 materialize; Daytona inject parity) |
| [portal-web-settings-schema.md](../../architecture/portal-web-settings-schema.md) | Settings controls gated on capabilities / affordances |
| [lanyard-agent-conformance-gaps.md](../../architecture/lanyard-agent-conformance-gaps.md) §8.5 | `models.list` / `models.set_active` still expansion (`LA-EXP-05`) |
| [adr/0007-composer-model-intelligence-routing.md](../../adr/0007-composer-model-intelligence-routing.md) | Capability-gate: hide/disable model selector when unsupported |
| Contracts | `brain-rpc` `models.*`; `capabilities` `model_selector` / `features.models` |

---

## 1. Executive decision (normative for pilot)

| Topic | Decision | Pilot gate? |
|-------|----------|-------------|
| **Provider API keys (pilot)** | **Platform AWS Secrets Manager** holds keys; **Control Plane / Instance Orchestrator wake inject** delivers them into sandbox process env (Bucket C) under standard names (`OPENAI_API_KEY`, `XAI_API_KEY`, …) | **Yes** — pilot chat/inference **must** work via injected keys |
| **Multi-tenant platform admin UI for per-tenant provider keys** | **Not live for pilot** — operators use SM + deploy/runbook paths, not a Portal super-admin console | **Yes** — do **not** block pilot on building this UI |
| **Tenant self-serve “configure models / paste API key” in Settings** | **Out of pilot scope** — Settings must not claim that path when capabilities lack it | **Yes** — honesty required (`lp-kng.7.2`) |
| **LA `models.list` / `models.set_active` + Settings/composer selector** | **Product follow-on** (not required to exit pilot inject path) | **No** — deferred; track under `lp-kng.7.2` / LA expansion |
| **Ops multi-tenant key admin console** | **Product follow-on** after pilot | **No** — residual bead(s) only |

**One-line:** For the Daytona / MockLab pilot, model provider keys are **platform-owned SM material injected at wake**; there is **no** live multi-tenant platform admin UI for those keys, and Settings must stay **honest** when `models.*` / `model_selector` are unsupported.

This document **closes** the M1 decision residual for epic `lp-kng.7` (`lp-kng.7.1`). It does **not** implement LA RPC or Portal UI changes — those are `lp-kng.7.2` and later product work.

---

## 2. Current pilot reality (as-of decision)

Operators often expect an admin page to attach model/API connectors per company brain. Staging / pilot posture today:

| Observation | Implication |
|-------------|-------------|
| Provider keys (e.g. `XAI_API_KEY`) live in **platform SM** (secrets envelope) | SM is SoT for secret **values** ([backend-runtime-secrets](../../architecture/backend-runtime-secrets.md)) |
| Daytona path: CP / orchestrator **wake injects** env into sandbox (Bucket C) | Same key **names** as EC2; injection **timing** differs ([gateway-env-contract](./gateway-env-contract.md) §Secrets beyond Relay) |
| `settings.snapshot` may show one LiteLLM / connected model | Read-only catalog can exist without `models.*` mutators |
| Lanyard Agent: `features.models` / `model_selector` often **false** / unsupported; no live `models.list` / `models.set_active` Brain RPC on honest LA baseline | Selector / “configure models” must not pretend to work ([LA-EXP-05](../../architecture/lanyard-agent-conformance-gaps.md)) |
| No multi-tenant **platform admin UI** for per-tenant provider keys in this monorepo | Aligns with “no shipped super-admin UI” posture |

Pilot **does not** wait on vault ensure-mounted epics for this decision, but both affect MockLab completeness.

---

## 3. Options considered

| Option | Description | Verdict for pilot |
|--------|-------------|-------------------|
| **A. Inject-only (SM + wake inject)** | Ops put keys in SM; orchestrator injects at create/start; chat uses env keys | **Chosen** |
| **B. Platform ops admin UI for keys** | Super-admin console to set/rotate per-tenant provider keys without raw SM | **Deferred** — product follow-on |
| **C. Implement LA `models.*` + Settings selector now** | Ship Brain RPC list/set_active and wire Portal selector | **Deferred** — product follow-on; honesty work is separate (`lp-kng.7.2`) |
| **D. Tenant-paste keys in Portal Settings** | End-user/admin enters API keys in browser | **Rejected for pilot** — expands secret surface; conflicts with SM-as-SoT |

---

## 4. Normative pilot rules

### 4.1 Source of truth for secret values

| Layer | Owns |
|-------|------|
| **AWS Secrets Manager** (secrets envelope) | Provider key **values** per tenant / host secret |
| **CP + Instance Orchestrator** | Fetch / map material → **wake inject** env (Daytona) or materialize files (EC2) |
| **Agent process** | Read `os.environ` / layout files only — **never** parse SM envelope |
| **Portal / BFF** | **Not** SoR for provider API keys in pilot |

### 4.2 Daytona inject path (keys)

1. SM envelope includes active provider slots (e.g. `env.XAI_API_KEY`).
2. On `ensure_online` / sandbox create-start, Bucket C inject includes those env names ([gateway-env-contract](./gateway-env-contract.md) inject sequence step 4: “+ provider keys as needed”).
3. Idle stop discards guest env; **next wake re-injects** (rotation = next cold wake with updated SM material).
4. **Do not** bake keys into agent snapshot / image labels / vault objects.

### 4.3 What Settings may show in pilot

| Allowed | Forbidden (pilot) |
|---------|-------------------|
| Read-only model list from `settings.snapshot` when host exposes it | Interactive “add API key” / connector admin without a real backend path |
| Disabled model controls with honest `disabledReason` / `unavailableCode` when `model_selector` / `models.*` missing | Advertising “configure models” as if `models.set_active` works |
| Composer model control only when capabilities support it ([ADR 0007](../../adr/0007-composer-model-intelligence-routing.md)) | Hiding capability failure behind a dead control |

Settings UI honesty is **implementation** under `lp-kng.7.2` (capability match or minimal `models.list`).

### 4.3.1 Implementation choice (`lp-kng.7.2`) — honesty, not `models.*`

| Choice | Result |
|--------|--------|
| **Path** | **Settings / capability honesty** (not LA `models.list` / `models.set_active` for pilot) |
| **Contracts** | LA pin keeps `features.models=false`, `model_selector=unsupported`, no `models.*` methods ([capabilities.lanyard-agent.json](../../../contracts/backend-runtime-v1/examples/capabilities.lanyard-agent.json)) |
| **Portal** | Settings → Models may **list** snapshot models (read-only) when inventory exists; **Set active** is disabled with `model_selector_unsupported` copy when `modelEditIsSupported` is false; composer model control already gates via the same helper ([ADR 0007](../../adr/0007-composer-model-intelligence-routing.md)) |
| **Deferred** | LA expansion `LA-EXP-05` (`models.*`) + interactive selector when product prioritizes |

Evidence anchors: `portal/packages/web/src/features/settings/SettingsView.tsx` (`canActivateModel`); `@lanyard/web-settings-schema` `modelEditIsSupported` / `modelSectionIsVisible`.

### 4.4 Chat path expectation

With inject-only, pilot chat succeeds when:

1. SM has a valid key for the active provider slot, and  
2. Wake inject delivers it under the name the agent/LiteLLM config expects, and  
3. Egress allowlist permits the model API.

Verification of the live chat path with an injected key is an epic-level check for `lp-kng.7` (not re-proven solely by this doc). Residual: operators confirm MockLab/pilot turn after inject; product admin remains deferred.

---

## 5. Product follow-ons (explicitly deferred)

These are **not** pilot gates. File/keep residual beads when prioritized; do not block Daytona dual-run or inject-only pilot exit on them.

| Follow-on | Intent | Tracking |
|-----------|--------|----------|
| **Ops multi-tenant admin UI for provider keys** | Platform operators manage per-tenant keys without console-only SM access; still no tenant-paste secrets by default | Epic `lp-2qs` / [dual-auth-credential-planes.md](../../architecture/dual-auth-credential-planes.md) (CP KMS ciphertext, not SM envelope) |
| **LA `models.list` / `models.set_active`** | Honest Brain RPC for catalog + active model; capability `model_selector` / `features.models` | LA expansion `LA-EXP-05`; depends on this decision → `lp-kng.7.2` chooses honesty **or** implement |
| **Settings / composer model selector** | Interactive select when RPC + capabilities live | Portal settings schema + ADR 0007; only after host advertises support |
| **Per-tenant connector matrix UI** | Beyond single inject slot — multi-provider admin | Post-pilot product |

**Dependency for `lp-kng.7.2`:** use this decision: **prefer Settings honesty** if LA will not ship `models.*` for pilot; **implement `models.list`** only if product prioritizes selector over inject-only honesty for the same release.

---

## 6. Out of scope

- Migrating product code for admin UI or LA RPC (unless a later bead claims it).
- Changing secrets envelope schema field names.
- BYOC / customer-managed KMS key entry (Phase 9+).
- Putting plaintext keys in git, Terraform state, snapshot images, or vault S3.

---

## 7. Acceptance mapping (`lp-kng.7.1`)

| Acceptance | How met |
|------------|---------|
| Decision note in `docs/` or `artifacts/daytona-pilot/` | This file under `docs/plans/0008-daytona-agent-sandboxes/` |
| Linked from epic | [overview.md](./overview.md) residual line + [issue-map.md](./issue-map.md) residual entry for `lp-kng.7` |
| Pilot SoT documented (SM + wake inject vs admin UI) | §1, §4 |
| Product follow-ons listed | §5 |

Epic-level items remaining under `lp-kng.7` (not this bead alone): Settings honesty / optional `models.list` (`lp-kng.7.2`); live chat verification with injected key when pilot environment is available.

---

## 8. Human gate

**Needs human = true** before treating multi-tenant key admin or tenant-facing key entry as committed product scope, and before declaring production unlock for anything beyond inject-only pilot.

Suggested reviewer checks:

1. Confirm inject-only is acceptable for named pilot tenants (ops can rotate via SM).
2. Confirm no customer commitment was made for self-serve model connectors in pilot.
3. Prioritize §5 follow-ons (ops UI vs LA `models.*` vs honesty-only) for the next product cycle.

**Approve by:** comment on `lp-kng.7.1` / PR, then close or supersede this draft status to **Accepted**.
