# Backend runtime v1

This directory holds the machine-readable contract for swappable backend agents.

The contract is intentionally owned by the platform monorepo. Backend agent source remains outside this repository and must publish artifacts that conform to this contract.

## Files

| Path | Status | Purpose |
| --- | --- | --- |
| `artifact-manifest.schema.json` | **Present** | Schema for tarball `manifest/backend.json` |
| `examples/*.manifest.json` | **Present** | One valid example per backend kind |
| `filesystem-layout.md` | **Present** | Normative `BACKEND_HOME` tree, `HERMES_HOME` alias, Lanyard Agent projection |
| `config.schema.json` | **Present** | Shape of `BACKEND_HOME/config.yaml` (Hermes-Lanyard baseline) |
| `examples/*.config.yaml` / `*.config.json` | **Present** | Secret-free config examples (model/provider, skills, cron) |
| `profiles.schema.json` | **Present** | Profile capability seeds + vault path ACL model |
| `examples/admin.json` / `contributor.json` | **Present** | v1 required profile seeds (backend-neutral) |
| `brain-rpc.schema.json` | **Present** | Brain RPC wire envelopes + required method params/results |
| `examples/brain-rpc.*.json` | **Present** | Request/result frames for each required method + error |
| `capabilities.schema.json` | **Present** | Backend capability descriptor (UI affordances, discovery, errors) |
| `examples/capabilities.*.json` | **Present** | Live + manifest-fallback capability descriptors |
| `secrets-envelope.schema.json` | **Present** | AWS SM `SecretString` envelope (`env`, optional `oauth`, `custom_providers`, `config_secret_overlay`, `files`) |
| `signed-operation.schema.json` | **Present** | Multiplayer signed operation ledger domain + current heads (`lp-ye4.5`) |
| `examples/signed-operation.*.json` / `artifact-head.*.json` / `workspace-head.*.json` | **Present** | Human write, agent checkpoint, conflict, workspace tree advance, heads |
| `access-grant.schema.json` | **Present** | Signed scoped access grants for humans / unknown agents (`lp-ye4.9`) |
| `examples/access-grant.*.json` | **Present** | Human session, known agent, delegated unknown-agent grant fixtures |
| `examples/secrets-envelope.*.json` | **Present** | Placeholder-only envelope fixtures (all three kinds + minimal + full-matrix) |
| `conformance.md` | **Present** | Conformance suite expectations + surface compatibility matrix (all kinds) |
| `harness/` | **Present** | Offline fake relay harness (hello / chat inject / interrupt / Brain RPC) |
| `fixtures/backend-conformance-fixture.tar.gz` | **Present** | Offline backend tarball fixture for manifest + entrypoint checks |
| `reference/tools/parse_document/` | **Present** | F3 host tool reference (`parse_document` / local AnyDoc) — copy into HL/LA |
| `examples/parse-document.*.json` | **Present** | Locked F2 Args/Result example payloads |

Version 1 follows the Hermes-Lanyard runtime layout and relay behavior. Supported kinds: `hermes_upstream`, `hermes_lanyard`, `lanyard_agent`.

**Published compatibility matrix** (kind · version · contract · capabilities ·
conformance · deploy readiness):
[`docs/architecture/backend-compatibility-matrix.md`](../../docs/architecture/backend-compatibility-matrix.md)
(`lp-k7g.11.7`).

**Conformance and external gaps:** see [`conformance.md`](conformance.md)
(suite + surface tables), plus detailed assessments:

| Kind | Doc |
| --- | --- |
| `hermes_lanyard` | Matrix + offline job in `conformance.md` / published matrix |
| `lanyard_agent` | [`docs/architecture/lanyard-agent-conformance-gaps.md`](../../docs/architecture/lanyard-agent-conformance-gaps.md) |
| `hermes_upstream` | [`docs/architecture/hermes-upstream-compatibility.md`](../../docs/architecture/hermes-upstream-compatibility.md) |

**Fake relay harness (`lp-k7g.11.1`):** offline connector-side session under
[`harness/`](harness/) — validates gateway `hello`, injects chat `inbound`,
sends `interrupt_inbound` and `brain_rpc_request` over a mock socket. Run:

```bash
python3 contracts/backend-runtime-v1/harness/run_tests.py
# also: bash scripts/validate.sh  (check 18)
```

**Backend tarball validation (`lp-k7g.11.2`):** offline check that a release
archive contains `manifest/backend.json` (schema-valid), an executable
`bin/company-brain-backend`, and optional pin kind/version/contract match:

```bash
python3 scripts/validate-backend-tarball.py
# also: bash scripts/validate.sh  (check 19)
```

Fixture: [`fixtures/backend-conformance-fixture.tar.gz`](fixtures/backend-conformance-fixture.tar.gz).

**Brain RPC required methods (`lp-k7g.11.3`):** offline FakeBrainRpcHost + harness
conformance for the seven required methods, vault ACL (contributor vs admin),
and schema-shaped `settings.snapshot` / `projects.list`:

```bash
python3 contracts/backend-runtime-v1/harness/run_brain_rpc_conformance.py
# also: bash scripts/validate.sh  (check 20)
# Portal mirror: portal/packages/backend-runtime/test/brain-rpc-conformance.test.ts
```

**Hermes-Lanyard artifact job (`lp-k7g.11.4`):** end-to-end conformance for the
reference backend — resolve pins/fixture, validate tarball, smoke entrypoint,
start backend on the fake relay, run required Brain RPC checks:

```bash
python3 scripts/run-hermes-lanyard-conformance.py            # offline
python3 scripts/run-hermes-lanyard-conformance.py --mode download --pins path/to/pins.yaml
# also: bash scripts/validate.sh  (check 21, offline only)
# CI: .github/workflows/conformance.yml (path-filtered offline; see docs/architecture/ci-and-release.md)
```

## Artifact manifest

Each backend release tarball includes:

```text
backend.tar.gz
  bin/company-brain-backend
  manifest/backend.json    # validates against artifact-manifest.schema.json
  config/defaults.yaml
  docs/backend-release.md
```

Required top-level fields in `manifest/backend.json`:

- `schema_version` (const `1`)
- `kind` — `hermes_upstream` | `hermes_lanyard` | `lanyard_agent`
- `version` — immutable release version string
- `entrypoint` — archive-relative path (reference: `bin/company-brain-backend`)
- `contract` — majors: `runtime_layout`, `relay`, `brain_rpc`
- `capabilities` — `profiles`, `brain_rpc_methods`, optional `features`
- `provenance` — `source_repo` plus at least one of `git_sha` or `release_tag` (`build_time` optional)

Examples:

- [`examples/hermes-lanyard.manifest.json`](examples/hermes-lanyard.manifest.json)
- [`examples/hermes-upstream.manifest.json`](examples/hermes-upstream.manifest.json)
- [`examples/lanyard-agent.manifest.json`](examples/lanyard-agent.manifest.json)

## Runtime filesystem layout

Normative host tree for `contract.runtime_layout: 1`:

```text
BACKEND_HOME/
  config.yaml
  .env.secrets            # materialize from SM (optional; mode 0600)
  config.secrets.yaml     # optional secret overlay from SM
  projects.db
  profiles/   # admin.json, contributor.json
  skills/
  cron/       # jobs.json
  logs/
  sessions/
  workspace/
```

- Hermes-compatible kinds: deploy sets `HERMES_HOME=$BACKEND_HOME`.
- Lanyard Agent: use the layout directly or a projection indistinguishable to Portal/deploy.
- Secret files (`.env.secrets`, `config.secrets.yaml`) are host-materialized from
  AWS Secrets Manager — never committed. Envelope schema:
  [`secrets-envelope.schema.json`](secrets-envelope.schema.json); mapping:
  [`docs/architecture/backend-runtime-secrets.md`](../../docs/architecture/backend-runtime-secrets.md).

Full path catalog, alias rules, and Lanyard Agent options:
[`filesystem-layout.md`](filesystem-layout.md).

## Backend config (`config.yaml`)

Runtime configuration for models, providers, skills behavior, cron scheduler,
and related agent settings lives in `$BACKEND_HOME/config.yaml`. Artifact
releases may ship a seed as `config/defaults.yaml` (see artifact manifest
`config_defaults`).

Schema: [`config.schema.json`](config.schema.json).

Hermes-Lanyard is the v1 reference. The schema:

- Represents **model / provider** settings (`model` as string or object,
  `providers`, `fallback_providers` / `fallback_model`, optional routing).
- Represents **skills** and **cron** settings (`skills.*`, `cron.*`). Job rows
  remain in `cron/jobs.json`; skill packages remain under `skills/`.
- Allows additional top-level keys so a full Hermes-Lanyard `config.yaml` can
  validate without enumerating every product-private knob.
- Documents a **secret policy** (`x-lanyard-secret-policy`): committed examples
  and artifact defaults must omit plaintext secrets (`api_key`, tokens,
  passwords, nested `env`/`headers` credential maps). Prefer `key_env`,
  `${VAR}` substitution, host `.env`, or platform secret managers.

Examples (no secrets):

- [`examples/hermes-lanyard.config.yaml`](examples/hermes-lanyard.config.yaml)
  (JSON twin: [`examples/hermes-lanyard.config.json`](examples/hermes-lanyard.config.json))
- [`examples/minimal.config.yaml`](examples/minimal.config.yaml)
  (JSON twin: [`examples/minimal.config.json`](examples/minimal.config.json))

Portal reads a **redacted** view of settings via Brain RPC `settings.snapshot`
(skills inventory, crons, models, integrations) — not by opening `config.yaml`
over the network. Deploy templates seed non-secret defaults only.

## Runtime secrets envelope (AWS Secrets Manager)

Platform-owned JSON for SM `SecretString` materialization onto host env/config
files. Backends never parse the envelope; they only read resulting files.

Schema: [`secrets-envelope.schema.json`](secrets-envelope.schema.json).

Normative architecture (backend mapping for all three kinds):
[`docs/architecture/backend-runtime-secrets.md`](../../docs/architecture/backend-runtime-secrets.md).

| Field | Required | Notes |
| --- | --- | --- |
| `schema_version` | yes | const `1` (additive fields do not bump major) |
| `env` | yes | string → string process env names (API keys, `LITELLM_MASTER_KEY`, `LANYARD_OAUTH_KEY`, custom `*_API_KEY`) |
| `oauth` | no | structured per-provider tokens (`xai-grok`, `xai-oauth`, `openai-codex`, …) |
| `custom_providers` | no | N OpenAI-compatible backends (`id`, `base_url`, prefer `api_key_env`/`key_env`) |
| `config_secret_overlay` | no | secret-bearing config deep-merge only; prefer `providers.<id>.key_env` |
| `files` | no | opaque relative files (`auth.json`, `oauth.enc`); no `..` / absolute paths |
| `kind_hint` | no | optional kind enum; materialize must not refuse other kinds |
| `meta` | no | operator metadata only |

Host file names (see filesystem layout + architecture secrets doc):

| File | Source |
| --- | --- |
| `$BACKEND_HOME/.env.secrets` (Hermes: `$HERMES_HOME/.env.secrets`) | envelope `env` |
| `$BACKEND_HOME/config.secrets.yaml` | envelope `config_secret_overlay` / projected `custom_providers` |
| `$HERMES_HOME/auth.json` | envelope `oauth` and/or `files[]` (`hermes_lanyard` / `hermes_upstream`) |
| `$BACKEND_HOME/oauth.enc` | envelope `oauth` and/or `files[]` + `LANYARD_OAUTH_KEY` (`lanyard_agent`) |

Examples (placeholders only — never real keys):

- [`examples/secrets-envelope.minimal.json`](examples/secrets-envelope.minimal.json)
- [`examples/secrets-envelope.hermes-lanyard.json`](examples/secrets-envelope.hermes-lanyard.json)
- [`examples/secrets-envelope.hermes-upstream.json`](examples/secrets-envelope.hermes-upstream.json)
- [`examples/secrets-envelope.lanyard-agent.json`](examples/secrets-envelope.lanyard-agent.json)
- [`examples/secrets-envelope.full-matrix.json`](examples/secrets-envelope.full-matrix.json)
- [`examples/lanyard-agent.litellm-oauth-map.json`](examples/lanyard-agent.litellm-oauth-map.json) — Agent OAuthStore → LiteLLM model map teaching fixture (lp-645.8.5; see [`deploy/litellm/`](../../deploy/litellm/))

```bash
python3 scripts/validate-secrets-envelope.py
# also: bash scripts/validate.sh  (check 22)
```


## Profiles (capability seeds)

Named capability bundles live under `$BACKEND_HOME/profiles/<name>.json`
(override: `BRAIN_PROFILES_DIR`). Layout reference:
[`filesystem-layout.md`](filesystem-layout.md) (`profiles/` directory).

Schema: [`profiles.schema.json`](profiles.schema.json).

Version 1 **requires** seeds (or documented builtins) for:

| Profile | Role | Baseline capabilities |
| --- | --- | --- |
| `admin` | Full vault + ops | `vault_full`, `vault_read`, `vault_write`, `chat`, `profile_manage`, `system_ops`, `shell_exec`, `gateway_config`, `beads_admin` |
| `contributor` | Authoring only | `vault_read`, `vault_write`, `chat` (no admin-only tokens) |

### Vault path prefix ACL

Normative rules are on the schema under `x-lanyard-path-acl`. Summary:

1. Vault paths are **vault-root-relative** (under `VAULT_ROOT`), start with `/`,
   reject `..`, and never escape the vault root on disk.
2. Host seeds supply **capabilities** for the named profile. Session
   **path_prefixes** come from Portal/control-plane roles on the Brain RPC
   auth subject (seeds may document defaults).
3. `vault_full` + empty subject prefixes → full vault (admin shortcut).
4. Empty subject prefixes without `vault_full` → **deny** all vault path
   methods (contributor must receive prefixes from Portal).
5. Prefix `/` allows all; otherwise allow exact match or `prefix + "/"` children.
6. Directory listings filter children the subject cannot see.

### Backend-neutral terminology

Portal and platform APIs must treat these as **backend profiles**, not Hermes
profiles. Prefer field name `backend_profile`; accept legacy `hermes_profile`
only as a migration alias. UI copy uses labels such as Administrator /
Contributor (`display_name`), never product-branded “Hermes admin”.

Hermes-compatible hosts still store files at `$HERMES_HOME/profiles/` when
`HERMES_HOME=$BACKEND_HOME` — same contract files.

Examples:

- [`examples/admin.json`](examples/admin.json)
- [`examples/contributor.json`](examples/contributor.json)

## Signed operation ledger domain (`lp-ye4.5`)

Multiplayer versioning history and current-head materialization (schemas +
fixtures + shared TypeScript types only in phase 1):

| Path | Purpose |
| --- | --- |
| [`signed-operation.schema.json`](signed-operation.schema.json) | Operation event, actor, target, parents, body hash, result, signature, artifact head, workspace head |
| `examples/signed-operation.*.json` | Human write, agent checkpoint, CAS conflict, workspace tree advance |
| `examples/artifact-head.*.json` / `workspace-head.default.json` | Materialized heads |
| [`docs/architecture/signed-operation-ledger.md`](../../docs/architecture/signed-operation-ledger.md) | Domain model + phase map |
| `@lanyard/backend-runtime` `signed-operation.ts` | Shared TypeScript types + strict parse |
| `history.list` / `heads.artifact` / `heads.workspace` | Optional Brain RPC reads (lp-ye4.7); advertise only when implemented |
| `examples/brain-rpc.history-list.*` / `heads-artifact.*` / `heads-workspace.*` | Request/result frames for history and heads |
| `result_vault_write.commit` | Optional ledger commit metadata on vault.write success (lp-ye4.8) |
| [`access-grant.schema.json`](access-grant.schema.json) | Signed scoped grants: tenant, session, path prefixes, capabilities, expiry, signing key id (lp-ye4.9) |
| `examples/access-grant.*.json` | Human session, known agent, delegated unknown-agent |
| `@lanyard/backend-runtime` `access-grant.ts` / `access-grant-bff.ts` | Parse, validate at BFF boundary, stamp actor + path ACL |
| `@lanyard/backend-runtime` `durable-runtime-ledger.ts` / `ledger-signing.ts` | Crash-safe durable store + ed25519 canonicalization / key rotation (`lp-ye4.12`) |
| `$BACKEND_HOME/ledger/` | Normative durable ledger layout (events, heads, idempotency) — see [`filesystem-layout.md`](filesystem-layout.md) |

**Rules:** `operation_id` is separate from `DocumentRevision.token` (vault CAS).
`vault.write` modes and `DocumentRevision` remain the mutation/CAS API; ledger
events are append-only audit + currentness. Successful vault.write may include
optional `result.commit` (`operation_id`, `kind`, workspace head fields) without
breaking clients that ignore it. Access grants are validated only at the BFF;
browser/agent ACL and identity claims are never trusted as authority. Hosts that
advertise history/heads must enable the durable store and host-sign with ed25519
after ACL/CAS (`lp-ye4.12`). Offline check:

```bash
python3 scripts/validate-signed-operation.py
python3 scripts/validate-access-grant.py
```

## Brain RPC (method schemas)

Portal invokes host operations over the **authenticated egress-only relay**
WebSocket (same trust domain as chat). Frames:

| Direction | `type` |
| --- | --- |
| Portal/relay → host | `brain_rpc_request` |
| Host → Portal/relay | `brain_rpc_result` |

Schema: [`brain-rpc.schema.json`](brain-rpc.schema.json).

Architecture summary:
[`docs/architecture/backend-runtime-contract.md`](../../docs/architecture/backend-runtime-contract.md)
(Brain RPC section). Path ACL and profile capabilities:
[`profiles.schema.json`](profiles.schema.json).

### Required methods (v1)

Every artifact claiming `contract.brain_rpc: 1` must implement:

| Method | Purpose |
| --- | --- |
| `brain.ping` | Liveness / optional echo |
| `brain.health` | Structured readiness (`ok` / `degraded` / `unavailable`) |
| `vault.list` | Directory metadata (capped, filtered by path ACL) |
| `vault.stat` | Single-path metadata |
| `vault.read` | Single-file content (default max 1 MiB, hard max 4 MiB) |
| `settings.snapshot` | Redacted skills/crons/models/integrations view |
| `projects.list` | Project rows for Portal pickers (empty list if DB missing) |

Per-method params/results live under `$defs` in the schema
(`params_*` / `result_*`). Catalog + refs:
`x-lanyard-method-catalog`, `x-lanyard-validation-entrypoints`.

### Expansion methods (optional until implemented)

First-expansion names are **not** required for v1 conformance. They are
listed under `x-lanyard-expansion-methods` with
`status: optional_until_implemented` / per-method `optional_expansion`:

- `brain.capabilities` — live backend capability descriptor (see below)
- `projects.create` — wire shape defined (`params_projects_create` /
  `result_projects_create`); callers must gate on capability advertisement
  before UI enablement (see Portal `lp-k7g.8.3`)
- `projects.delete` — soft-archive only (`params_projects_delete` /
  `result_projects_delete` = `{id, archived:true}`); does **not** purge
  workspace/vault disk (see Portal `lp-uxy.5`); gate on `projects_delete`
- `settings.patch` — wire shape defined (`params_settings_patch` /
  `result_settings_patch`); BFF validates against config.schema surfaces;
  callers must gate on `settings_patch` (see Portal `lp-k7g.8.4`)
- `vault.write` — wire shape defined (`params_vault_write` /
  `result_vault_write`); CAS modes (`replace_if_match` preferred),
  `expected_revision` / `if_match`, inline or `content_ref`,
  `idempotency_key`; feature `vault_write` → UI `vault_editor` **only**
  when `vault.write` is advertised (see `lp-5q6.18`)
- `vault.read_chunk` — bounded byte-range read for BFF streaming of large Office files (`lp-5q6.17`); not a substitute for `vault.read` previews. See `x-lanyard-office-binary-transfer` and [portal-binary-vault-transfer-and-revision.md](../../docs/architecture/portal-binary-vault-transfer-and-revision.md)
- `models.list`
- `models.set_active`
- `cron.list`
- `cron.patch`

Hosts that receive an unimplemented expansion method return
`method_not_found`. Advertise implemented expansion methods on the artifact
manifest `capabilities.brain_rpc_methods` (and optional feature flags).

### Auth, errors, terminology

- **Auth** is fail-closed: channel (L0) + tenant/instance (L1) + Portal
  session (L2) + stamped subject (L3) + host profile caps (L4) + path ACL
  (L5 for vault path methods). Subject must carry `backend_profile` and/or
  legacy `hermes_profile`.
- **Errors** use stable codes (`unauthenticated`, `forbidden`, `not_found`,
  …) with BFF HTTP mapping in `x-lanyard-error-http-map`.
- **Settings redaction** is normative: strip secret-shaped keys before the
  host sends; BFF re-asserts.
- Prefer backend-neutral field names (`backend_profile`, `backend_home`);
  Hermes-Lanyard wire aliases remain accepted (see
  `x-lanyard-terminology` on the schema).

Examples (one request + success result per required method, plus error):

- [`examples/brain-rpc.ping.request.json`](examples/brain-rpc.ping.request.json) /
  [`.result.json`](examples/brain-rpc.ping.result.json)
- [`examples/brain-rpc.health.request.json`](examples/brain-rpc.health.request.json) /
  [`.result.json`](examples/brain-rpc.health.result.json)
- [`examples/brain-rpc.vault-list.request.json`](examples/brain-rpc.vault-list.request.json) /
  [`.result.json`](examples/brain-rpc.vault-list.result.json)
- [`examples/brain-rpc.vault-stat.request.json`](examples/brain-rpc.vault-stat.request.json) /
  [`.result.json`](examples/brain-rpc.vault-stat.result.json)
- [`examples/brain-rpc.vault-read.request.json`](examples/brain-rpc.vault-read.request.json) /
  [`.result.json`](examples/brain-rpc.vault-read.result.json)
- [`examples/brain-rpc.settings-snapshot.request.json`](examples/brain-rpc.settings-snapshot.request.json) /
  [`.result.json`](examples/brain-rpc.settings-snapshot.result.json)
- [`examples/brain-rpc.projects-list.request.json`](examples/brain-rpc.projects-list.request.json) /
  [`.result.json`](examples/brain-rpc.projects-list.result.json)
- [`examples/brain-rpc.error.result.json`](examples/brain-rpc.error.result.json)
- Expansion: [`examples/brain-rpc.projects-create.request.json`](examples/brain-rpc.projects-create.request.json) /
  [`.result.json`](examples/brain-rpc.projects-create.result.json)
- Expansion: [`examples/brain-rpc.settings-patch.request.json`](examples/brain-rpc.settings-patch.request.json) /
  [`.result.json`](examples/brain-rpc.settings-patch.result.json)
- Expansion: [`examples/brain-rpc.vault-write.request.json`](examples/brain-rpc.vault-write.request.json) /
  [`.result.json`](examples/brain-rpc.vault-write.result.json)
  (also [`vault-write-content-ref.request.json`](examples/brain-rpc.vault-write-content-ref.request.json),
  [`vault-write-conflict.result.json`](examples/brain-rpc.vault-write-conflict.result.json))
- Discovery (expansion): [`examples/brain-rpc.capabilities.request.json`](examples/brain-rpc.capabilities.request.json) /
  [`.result.json`](examples/brain-rpc.capabilities.result.json)

## Backend capability descriptor

Expanded host capability model for Portal feature gating. **Separate from:**

| Layer | Schema | Meaning |
| --- | --- | --- |
| Backend runtime capabilities | `capabilities.schema.json` | What the host can do (methods, features, UI) |
| Profile capabilities | `profiles.schema.json` | What a subject may do (`vault_read`, `vault_full`, …) |
| Connector / platform capabilities | relay descriptors (outside this contract) | Channel features — not backend host ops |

Schema: [`capabilities.schema.json`](capabilities.schema.json).

### Discovery path (selected)

**Live path: Brain RPC `brain.capabilities`** (not relay hello).

Rationale (normative notes on the schema under `x-lanyard-discovery`):

1. Relay capability descriptors already describe **connector** behavior; overloading
   relay hello would conflate connector vs backend runtime layers.
2. Portal already routes host ops through Brain RPC; capability discovery belongs
   on the same authenticated egress path.
3. Live claims can reflect config/partial enablement after connect; pins alone cannot.
4. Re-queryable after reconnect or version upgrade without re-running deploy.

**Static companion:** artifact manifest `capabilities` (profiles,
`brain_rpc_methods`, optional `features`) remains the install-time claim.
When `brain.capabilities` returns `method_not_found`, Portal BFF builds a
descriptor from the pin/manifest (`source: artifact_manifest`) and derives UI
states.

### Capability names → Portal UI affordances

Feature flags map to methods and UI surfaces (see
`x-lanyard-feature-catalog` + `x-lanyard-ui-affordance-catalog`):

| Feature | Methods (representative) | UI affordance |
| --- | --- | --- |
| `chat` | relay chat (not Brain RPC) | `chat_panel` |
| `health` | `brain.health` | `host_health` |
| `vault_read` | `vault.list` / `stat` / `read` | `vault_browser` |
| `vault_write` | `vault.write` | `vault_editor` |
| `settings_snapshot` | `settings.snapshot` | `settings_page` |
| `settings_patch` | `settings.patch` | `settings_editor` |
| `projects_list` | `projects.list` | `project_picker` |
| `projects_create` | `projects.create` | `project_create` |
| `projects_delete` | `projects.delete` (soft-archive) | `project_picker` (delete action) |
| `models` | `models.list` / `models.set_active` | `model_selector` |
| `cron` | `cron.list` / `cron.patch` | `cron_manager` |

Each affordance state is `supported` | `unsupported` | `degraded`.

### Unsupported capability error states

| Situation | Portal UI | If called anyway |
| --- | --- | --- |
| Feature false / method not advertised | Affordance empty/disabled (no crash) | Brain RPC `method_not_found` (HTTP 404) |
| Method implemented, profile lacks token | Hide controls for that role | `forbidden` (HTTP 403) — **not** unsupported |
| Path ACL denies vault path | Grey/hide denied paths | `forbidden` / `not_found` per ACL |
| Host unreachable | Health unknown | `unavailable` (HTTP 503) |

Full matrix: schema `x-lanyard-unsupported-error-states`.

Examples:

- [`examples/capabilities.hermes-lanyard.json`](examples/capabilities.hermes-lanyard.json) — full reference
- [`examples/capabilities.lanyard-agent.json`](examples/capabilities.lanyard-agent.json) — required methods only; expansion UI unsupported (`features.cron=false` honest baseline)
- [`examples/capabilities.lanyard-agent.cron.json`](examples/capabilities.lanyard-agent.cron.json) — LA pin when dedicated `cron.list`/`cron.patch` are real (`lp-uxy.3`)
- [`examples/lanyard-agent.cron.jobs.json`](examples/lanyard-agent.cron.jobs.json) — product cron store under `$BACKEND_HOME/cron/` (never `~/.hermes`)
- [`examples/brain-rpc.settings-snapshot.lanyard-agent.result.json`](examples/brain-rpc.settings-snapshot.lanyard-agent.result.json) — redacted LA snapshot with `backend_home` + crons
- [`examples/capabilities.manifest-fallback.json`](examples/capabilities.manifest-fallback.json) — static fallback when live discovery missing

## Validation

Offline (no network):

```bash
python3 scripts/validate-artifact-manifests.py
python3 scripts/validate-backend-config.py
python3 scripts/validate-backend-profiles.py
python3 scripts/validate-brain-rpc.py
python3 scripts/validate-backend-capabilities.py
python3 scripts/validate-secrets-envelope.py
# also invoked from:
bash scripts/validate.sh
```

Manifest validator: rejects missing `kind` / `version` / `entrypoint`, checks
all three kinds are covered by examples, uses `jsonschema` when installed
(stdlib subset otherwise).

Config validator: requires `model` / `providers` / `skills` / `cron` in the
schema, validates example configs, rejects secret-shaped keys in committed
examples, and uses `jsonschema` when installed (stdlib subset otherwise).
YAML examples need PyYAML; JSON twins keep the check offline without it.

Profile validator: requires `admin.json` and `contributor.json` examples,
rejects contributor elevation (admin-only caps), checks path ACL helper
semantics, and requires schema extensions for path ACL + terminology.

Brain RPC validator: requires all seven method param/result `$defs`, marks
expansion methods optional, validates request/result examples, rejects
negative frames (missing auth, bad version, timeout over max, ok/error
inconsistency).

Capabilities validator: requires discovery path `brain_rpc` /
`brain.capabilities`, feature→UI catalog mappings, unsupported error layers,
validates descriptor examples + discovery frames, rejects negative fixtures.

Secrets envelope validator: requires `schema_version` + object `env`, validates
placeholder examples for all three kinds, rejects bad payloads, and checks the
architecture mapping doc for `.env.secrets` / `config.secrets.yaml` markers.
