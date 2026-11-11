# Backend runtime contract

## Purpose

The backend runtime contract lets Portal, deploy, and client-core work with several backend agents without special casing each implementation.

The first supported backend families are:

- `hermes_upstream`
- `hermes_lanyard`
- `lanyard_agent`

Hermes-Lanyard is the reference implementation for contract version 1.

## Required artifact shape

Each backend release publishes an immutable archive with a manifest:

```text
backend.tar.gz
  bin/company-brain-backend
  manifest/backend.json
  config/defaults.yaml
  docs/backend-release.md
```

The required executable is:

```bash
bin/company-brain-backend gateway
```

Backend-specific binaries may still exist. The standard entrypoint is the stable contract used by systemd and bootstrap.

## Required runtime layout

Each backend must run against this layout:

```text
BACKEND_HOME/
  config.yaml
  projects.db
  profiles/
    admin.json
    contributor.json
  skills/
  cron/
    jobs.json
  logs/
  sessions/
  workspace/
```

For Hermes-compatible runtimes, deploy must set:

```text
HERMES_HOME=$BACKEND_HOME
```

For Lanyard Agent, the implementation should either use this layout directly or provide a compatibility projection that is indistinguishable to Portal and deploy.

**Normative detail** (path catalog, ownership, alias rules, Lanyard Agent
options A/B, conformance checklist):
[`contracts/backend-runtime-v1/filesystem-layout.md`](../../contracts/backend-runtime-v1/filesystem-layout.md).
Architecture notes here stay summary-only.

## Required environment

The platform owns these names:

```text
BACKEND_KIND
BACKEND_HOME
VAULT_ROOT
COMPANY_BRAIN_VAULT_ROOT
GATEWAY_RELAY_URL
GATEWAY_RELAY_ID
GATEWAY_RELAY_SECRET
GATEWAY_RELAY_INSTANCE_ID
BRAIN_TENANT_ID
BRAIN_RPC_ENABLED
BRAIN_PROFILES_DIR
RELAY_CONTRACT_MAJOR
BRAIN_RPC_CONTRACT_MAJOR
```

Hermes-compatible aliases may be set for compatibility:

```text
HERMES_HOME
HERMES_INSTALL_PATH
```

## Required Brain RPC methods

Version 1 requires:

- `brain.ping`
- `brain.health`
- `vault.list`
- `vault.stat`
- `vault.read`
- `settings.snapshot`
- `projects.list`

The first expansion should add (optional until implemented and advertised):

- `brain.capabilities` (live backend capability descriptor; selected discovery path)
- `projects.create`
- `projects.delete` — soft-archive registry row only (`{id}` → `{id, archived:true}`);
  does not purge workspace/vault disk (`lp-uxy.5`)
- `settings.patch`
- `vault.write` — typed schema (`lp-5q6.18`); Hermes-Lanyard host pin implements
  inline write + CAS (`lp-5q6.20`, see
  [`hermes-lanyard-vault-write.md`](./hermes-lanyard-vault-write.md)); advertise
  only when the live host registers the method
- `models.list`
- `models.set_active`
- `cron.list`
- `cron.patch`

**Normative machine-readable shapes** (wire envelopes, auth, errors, and
per-method params/results):
[`contracts/backend-runtime-v1/brain-rpc.schema.json`](../../contracts/backend-runtime-v1/brain-rpc.schema.json).

| Topic | Detail |
| --- | --- |
| Transport | Authenticated egress-only relay WSS; frames `brain_rpc_request` / `brain_rpc_result` |
| Contract field | `contract_version: 1` on every frame; artifact pin `contract.brain_rpc: 1` |
| Auth | Fail-closed L0–L5; subject stamps `backend_profile` (preferred) or legacy `hermes_profile` plus `path_prefixes` |
| Vault methods | Path ACL via profile caps + subject prefixes (see profiles schema) |
| Settings | Always redacted; no secrets on the wire |
| Expansion | Listed in schema `x-lanyard-expansion-methods` as `optional_until_implemented` |

Examples: `contracts/backend-runtime-v1/examples/brain-rpc.*.json`. Offline
check: `python3 scripts/validate-brain-rpc.py`.

## Backend capability descriptor

Portal feature gates on a **backend capability descriptor** (what the host can
do), not on backend kind strings and not on profile authorization tokens.

| Layer | Contract | Meaning |
| --- | --- | --- |
| Backend runtime capabilities | [`capabilities.schema.json`](../../contracts/backend-runtime-v1/capabilities.schema.json) | Methods, feature flags, UI affordances |
| Profile capabilities | [`profiles.schema.json`](../../contracts/backend-runtime-v1/profiles.schema.json) | Subject authorization (`vault_read`, `vault_full`, …) |
| Connector / platform capabilities | Relay descriptors (outside this contract) | Channel features only |

**Discovery path (selected):** Brain RPC `brain.capabilities`. Relay hello is
**not** used for backend ops capabilities (connector vs host separation).

**Static companion:** artifact manifest `capabilities` for install/pin time.
If live discovery returns `method_not_found`, Portal builds a descriptor from
the pin and derives UI states.

**UI affordances** (examples): `chat_panel`, `vault_browser`, `vault_editor`,
`settings_page`, `settings_editor`, `project_picker`, `project_create`,
`model_selector`, `cron_manager`, `host_health` — each
`supported` | `unsupported` | `degraded`.

**Unsupported behavior:** Portal renders empty/disabled states (no crash). If a
client still calls a missing method, the host returns `method_not_found`
(distinct from `forbidden` when the method exists but the profile/path ACL
denies). Normative matrix:
`capabilities.schema.json` → `x-lanyard-unsupported-error-states`.

Examples: `contracts/backend-runtime-v1/examples/capabilities.*.json`. Offline
check: `python3 scripts/validate-backend-capabilities.py`.

## Required profile model

Profiles are named capability bundles stored as JSON under
`BACKEND_HOME/profiles/` (see runtime layout). Version 1 requires:

- `admin` — full vault (`vault_full`) plus ops capabilities
- `contributor` — `vault_read`, `vault_write`, `chat` only (no ops elevation)

**Portal terminology is backend-neutral:** display and API fields refer to
**backend profiles** (preferred field `backend_profile`). Do not present them
as Hermes profiles. Legacy `hermes_profile` is an accepted migration alias only.

**Vault path prefixes:** Brain RPC vault methods authorize
vault-root-relative paths against the auth subject's `path_prefixes`.
`vault_full` with empty prefixes grants the whole vault; empty prefixes
without `vault_full` deny path methods (Portal must stamp contributor
prefixes). Normative detail:
[`contracts/backend-runtime-v1/profiles.schema.json`](../../contracts/backend-runtime-v1/profiles.schema.json)
(`x-lanyard-path-acl`, `x-lanyard-terminology`). Examples:
[`admin.json`](../../contracts/backend-runtime-v1/examples/admin.json),
[`contributor.json`](../../contracts/backend-runtime-v1/examples/contributor.json).

## Conformance and backend gaps

**Published compatibility matrix** (backend kind, version, contract versions,
capabilities, conformance result, deploy readiness):

[`backend-compatibility-matrix.md`](backend-compatibility-matrix.md)
(`lp-k7g.11.7`).

Platform conformance checklist and **surface** matrix (Hermes-Lanyard vs
Lanyard Agent vs hermes_upstream):

[`contracts/backend-runtime-v1/conformance.md`](../../contracts/backend-runtime-v1/conformance.md).

Lanyard Agent is **not** fully conformant today. Documented gaps (Brain RPC
request handling, runtime layout, settings/profile/project compatibility,
artifact packaging), **external implementation checklist** (platform ACs 1:1,
owners, DoD), and GitHub follow-ups for
[LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent)
(#134–#137):

[`lanyard-agent-conformance-gaps.md`](lanyard-agent-conformance-gaps.md)
(`lp-k7g.11.6`).

Hermes upstream (`NousResearch/hermes-agent`, `kind: hermes_upstream`) has
relay + home layout close to the contract but **lacks Brain RPC and contract
packaging**. Assessment, shim options, and upstream sync constraints:

[`hermes-upstream-compatibility.md`](hermes-upstream-compatibility.md).

Hermes-Lanyard remains the v1 reference and the production customer-host pin.
Do not special-case Lanyard Agent or stock Nous paths in Portal; close gaps in
external backend products (or packaging) and re-verify in phase 7
([phase-7-backend-conformance.md](../plans/0001-platform-monorepo-migration/phase-7-backend-conformance.md)).

