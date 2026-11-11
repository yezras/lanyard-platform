# Backend runtime filesystem layout (v1)

Normative `BACKEND_HOME` layout for `backend-runtime-v1`. Portal and deploy
treat this tree as the stable host-side surface. Backends may store additional
files under `BACKEND_HOME`; they must not require Portal or deploy to know
implementation-private paths.

**Contract major:** `contract.runtime_layout: 1` (see
[`artifact-manifest.schema.json`](artifact-manifest.schema.json)).

**Reference implementation:** Hermes-Lanyard (`kind: hermes_lanyard`), where
the historical home directory is `HERMES_HOME`.

Architecture overview (non-normative notes):
[`docs/architecture/backend-runtime-contract.md`](../../docs/architecture/backend-runtime-contract.md).

---

## Platform names

| Name | Role |
| --- | --- |
| `BACKEND_HOME` | Absolute path to the backend runtime home on the host. Owned by deploy/bootstrap; set in the backend process environment. |
| `BACKEND_KIND` | Backend product family (`hermes_upstream`, `hermes_lanyard`, `lanyard_agent`). |
| `VAULT_ROOT` | Absolute path to the company-brain vault (client-core seed + live content). **Not** required to live under `BACKEND_HOME`. |
| `COMPANY_BRAIN_VAULT_ROOT` | Legacy alias for `VAULT_ROOT` (accept either; prefer `VAULT_ROOT`). |
| `BRAIN_PROFILES_DIR` | Optional override for the profiles directory (default: `$BACKEND_HOME/profiles`). |

Vault content (skills library, `AGENTS.md`, indexes) is owned by **client-core**
and is addressed via `VAULT_ROOT`, not via `BACKEND_HOME`.

---

## Required tree

Each backend process that claims `runtime_layout: 1` must run against this
layout (paths relative to `BACKEND_HOME`):

```text
BACKEND_HOME/
  config.yaml
  .env.secrets              # optional; SM materialize (mode 0600)
  config.secrets.yaml       # optional; secret-bearing overlay from SM
  auth.json                 # optional; Hermes OAuth store (mode 0600)
  oauth.enc                 # optional; Agent encrypted OAuth store (mode 0600)
  litellm/                  # optional; Agent LiteLLM seed projection (non-secret)
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
  ledger/                   # optional; required when advertising history/heads (lp-ye4.12)
    events.jsonl
    artifact_heads.json
    workspace_heads.json
    idempotency.json
    meta.json
```

Deploy/bootstrap is responsible for creating the directories before first
start (or the backend must create missing empty directories on boot). Missing
optional data files (for example an empty `projects.db` or empty `cron/jobs.json`)
must not prevent gateway start; Brain RPC and settings surfaces treat absence as
empty collections where the method allows it.

Hosts that advertise `features.history_read` / `features.heads_read` **must**
enable the durable ledger under `ledger/` (or an operator-documented equivalent
backend-owned path). See
[`docs/architecture/signed-operation-ledger.md`](../../docs/architecture/signed-operation-ledger.md)
phase 7.

### Path catalog

| Path | Type | Required at boot | Purpose |
| --- | --- | --- | --- |
| `config.yaml` | file | Recommended (seed from artifact `config/defaults.yaml` if absent) | Backend runtime configuration (models, gateway, features). Schema: [`config.schema.json`](config.schema.json). Secrets should not be committed in examples/defaults; host env / secret files remain separate. |
| `.env.secrets` | file | No — absent until SM materialize | KEY=value env from AWS Secrets Manager envelope `env`. Mode `0600`, service-user owned. Not committed. Normative mapping: [`docs/architecture/backend-runtime-secrets.md`](../../docs/architecture/backend-runtime-secrets.md). Schema: [`secrets-envelope.schema.json`](secrets-envelope.schema.json). Agent + LiteLLM multi-slot placeholders: [`deploy/litellm/env.secrets.example`](../../deploy/litellm/env.secrets.example). |
| `config.secrets.yaml` | file | No — only when envelope has `config_secret_overlay` | Secret-bearing config overlay (deep-merge or backend-private load). Mode `0600`. Not committed; never a Portal read surface. |
| `auth.json` | file | No — Hermes OAuth only | Hermes OAuth store from envelope `oauth` and/or `files[]` (`path_relative: auth.json`). Mode `0600`. Not used for `lanyard_agent`. |
| `oauth.enc` | file | No — Agent OAuth only | Encrypted Agent OAuthStore from envelope `files[]` (`path_relative: oauth.enc`). Decrypt key is env `LANYARD_OAUTH_KEY`. Mode `0600`. Providers: `xai-grok`, `openai-codex`. |
| `litellm/config.yaml` | file | No — Agent + LiteLLM hosts | Non-secret LiteLLM `model_list` seed (platform seed: [`deploy/litellm/config.yaml`](../../deploy/litellm/config.yaml)). Keys via `os.environ/*` only. May live outside `BACKEND_HOME` if projected (e.g. `/etc/lanyard-agent/litellm/config.yaml`). |
| `.env` | file | No | Optional host env (bootstrap / operators). Units may load this and/or `.env.secrets` via `EnvironmentFile`. Prefer keeping SM-managed keys in `.env.secrets`. |
| `projects.db` | file (SQLite) | No — empty/missing OK | Project / workspace registry used by Brain RPC `projects.list` (and later `projects.create`). |
| `profiles/` | directory | Yes | Named capability bundles (JSON). v1 requires at least `admin` and `contributor`. Schema: [`profiles.schema.json`](profiles.schema.json). |
| `profiles/admin.json` | file | Yes (or equivalent builtin seed) | Admin profile capabilities and path ACLs. Example: [`examples/admin.json`](examples/admin.json). |
| `profiles/contributor.json` | file | Yes (or equivalent builtin seed) | Contributor profile capabilities and path ACLs. Example: [`examples/contributor.json`](examples/contributor.json). |
| `skills/` | directory | Yes (may be empty) | Backend-local / user-installed skills. Distinct from vault/client-core skills under `VAULT_ROOT`. |
| `cron/` | directory | Yes (may be empty) | Scheduled job state for backends that implement cron. |
| `cron/jobs.json` | file | No — empty/missing OK | Job definitions for v1 cron listing/patch (when capability `cron` is true). |
| `logs/` | directory | Yes (may be empty) | Runtime logs (agent, errors, gateway). Journald may still be primary on some hosts; this directory is the portable file log location. |
| `sessions/` | directory | Yes (may be empty) | Session transcripts / session index state. Exact file formats are backend-private within this directory. |
| `workspace/` | directory | Yes (may be empty) | Scratch / working tree for agent file operations that are not vault writes. |
| `ledger/` | directory | No — required only when history/heads capabilities are advertised (`lp-ye4.12`) | Durable signed-operation ledger + heads + idempotency under backend-owned state. Mode `0700` recommended. |
| `ledger/events.jsonl` | file | No | Append-only signed operation events (one JSON object per line). Fsynced on append. Mode `0600`. |
| `ledger/artifact_heads.json` | file | No | Materialized artifact (path) heads snapshot. Atomic rewrite. |
| `ledger/workspace_heads.json` | file | No | Materialized workspace heads snapshot. Atomic rewrite. |
| `ledger/idempotency.json` | file | No | Idempotency key → fingerprint + operation_id. Atomic rewrite. |
| `ledger/meta.json` | file | No | tenant/instance ids, active signing key id, event count. |

### Secret materialization paths (platform-owned)

`.env.secrets` and `config.secrets.yaml` are **platform secret layout** names
(not product-private). Deploy/materialize owns their contents. Portal must never
open them (settings remain redacted Brain RPC). Hermes-compatible kinds use the
same relative names under `HERMES_HOME=$BACKEND_HOME`.

| Backend kind | Env target | Config overlay target | OAuth store | LiteLLM |
| --- | --- | --- | --- | --- |
| `hermes_lanyard` | `$HERMES_HOME/.env.secrets` | `$HERMES_HOME/config.secrets.yaml` | `$HERMES_HOME/auth.json` | N/A |
| `hermes_upstream` | same | same | same | N/A |
| `lanyard_agent` | `$BACKEND_HOME/.env.secrets` | `$BACKEND_HOME/config.secrets.yaml` (or documented projection) | `$BACKEND_HOME/oauth.enc` + `LANYARD_OAUTH_KEY` | `$BACKEND_HOME/litellm/config.yaml` or product path; seed [`deploy/litellm/`](../../deploy/litellm/) |

Full table (including unit `EnvironmentFile` rules):
[`docs/architecture/backend-runtime-secrets.md`](../../docs/architecture/backend-runtime-secrets.md).

Agent multi-provider (OAuthStore → LiteLLM `*-oauth`, custom Meta, full env set):
[`docs/architecture/lanyard-agent-multi-provider-secrets.md`](../../docs/architecture/lanyard-agent-multi-provider-secrets.md).

### Non-contract paths under `BACKEND_HOME`

Backends may create additional siblings (examples from Hermes-Lanyard today:
`state.db`, `plugins/`, `pairing/`, `memories/`, `optional-skills/`).
These are **out of contract** for Portal and deploy:

- Portal must not read them directly; use Brain RPC / settings surfaces instead.
- Deploy must not hard-code them except for backend-private bootstrap owned by
  that product's install scripts.
- Conformance checks only assert the required tree above.
- Host `.env` (when used) remains operator/bootstrap owned; SM-managed keys
  should land in `.env.secrets` when the unit can include a second
  `EnvironmentFile`.

---

## Ownership and mutability

| Concern | Owner | Notes |
| --- | --- | --- |
| Choosing `BACKEND_HOME` path | Deploy / bootstrap | Typical host path is product-specific today (`~/.hermes`, `/var/lib/…`); contract cares about the layout **inside** the directory, not the absolute prefix. |
| Seeding `config.yaml` | Deploy + artifact | Prefer copying artifact `config/defaults.yaml` on first install; do not overwrite operator edits on upgrade without an explicit migrate path. |
| Profile JSON | Backend + deploy seeds | v1 names `admin` / `contributor` are stable; Portal displays them as **backend profiles**, not Hermes profiles. Capability catalog, vault path prefix ACL, and terminology: [`profiles.schema.json`](profiles.schema.json) (`x-lanyard-path-acl`, `x-lanyard-terminology`). |
| `projects.db`, `sessions/`, `logs/`, `cron/` | Backend process | Runtime-owned state. |
| `skills/` under home | Backend / operators | Optional; vault skills remain under `VAULT_ROOT`. |
| Vault tree | client-core + operators | Via `VAULT_ROOT`, outside this layout. |

Permissions guidance (non-normative): restrict `BACKEND_HOME` to the backend
service user; config and DB files should not be world-readable.

---

## `HERMES_HOME` alias behavior

Hermes-compatible runtimes (`hermes_lanyard`, `hermes_upstream`) historically
resolve all home-relative paths through the environment variable `HERMES_HOME`
(default on POSIX: `~/.hermes`).

### Platform rule (v1)

For Hermes-compatible runtimes, deploy **must** set:

```text
HERMES_HOME=$BACKEND_HOME
```

so that:

1. Platform docs and unit files can standardize on `BACKEND_HOME`.
2. Hermes code that still calls `get_hermes_home()` / reads `HERMES_HOME`
   continues to resolve the same tree without a code fork.
3. Profile overrides that temporarily rebind `HERMES_HOME` to a profile
   subdirectory remain an **implementation detail** of Hermes; the **contract
   root** presented to deploy is still `BACKEND_HOME` (the tree that contains
   top-level `config.yaml`, `profiles/`, etc.).

### Alias summary

| Variable | When set | Meaning |
| --- | --- | --- |
| `BACKEND_HOME` | Always (platform) | Canonical runtime home for all kinds. |
| `HERMES_HOME` | Hermes-compatible kinds | **Must equal** `BACKEND_HOME` at process start for the primary gateway. |
| `HERMES_INSTALL_PATH` | Optional (Hermes) | Install prefix of the unpacked artifact (e.g. `/opt/hermes-lanyard`), **not** the runtime home. Do not confuse with `BACKEND_HOME`. |

If both `BACKEND_HOME` and `HERMES_HOME` are set and differ, Hermes-compatible
backends should prefer the platform contract: treat `BACKEND_HOME` as
authoritative when present, or fail closed at startup with a clear error.
Deploy must not ship divergent values.

Non-Hermes kinds (see below) are not required to honor `HERMES_HOME`.

---

## Lanyard Agent compatibility options

`lanyard_agent` today uses a split host layout (config under
`/etc/lanyard-agent/`, state under `/var/lib/lanyard-agent/`, logs under
`/var/log/lanyard-agent/`) and does not natively use `HERMES_HOME`. For
`runtime_layout: 1` conformance, Lanyard Agent **must** present the required
tree to Portal and deploy as either:

### Option A — Direct layout (preferred long term)

Run with `BACKEND_HOME` set to a single directory that contains the required
tree natively:

```text
BACKEND_HOME=/var/lib/lanyard-agent/backend-home   # example only
# or any deploy-chosen absolute path
```

Map product paths into that tree (config, projects DB, profiles, skills, cron,
logs, sessions, workspace) so Brain RPC and future host tooling see the same
shape as Hermes-Lanyard.

### Option B — Compatibility projection

Keep the existing split host layout **internally**, but provide a projection
directory (or bind-mount / symlink tree) at `BACKEND_HOME` that is
**indistinguishable** to Portal and deploy from Option A:

| Contract path | Example projection onto current Lanyard Agent paths |
| --- | --- |
| `$BACKEND_HOME/config.yaml` | Symlink or copy of `/etc/lanyard-agent/config.yaml` |
| `$BACKEND_HOME/.env.secrets` | Materialize target (or symlink to product env file loaded by unit EnvironmentFile) |
| `$BACKEND_HOME/oauth.enc` | Materialize target; product `LANYARD_OAUTH_STORE` should point here (or equal path) |
| `$BACKEND_HOME/litellm/config.yaml` | Symlink/copy of `/etc/lanyard-agent/litellm/config.yaml` (seed from monorepo `deploy/litellm/config.yaml`) |
| `$BACKEND_HOME/projects.db` | File under `/var/lib/lanyard-agent/` (or empty SQLite until Brain RPC projects land) |
| `$BACKEND_HOME/profiles/` | Seeded admin/contributor JSON (may be generated from capability config) |
| `$BACKEND_HOME/skills/` | Empty or agent-local skills only — **not** Hermes skills hub; vault skills stay on `VAULT_ROOT` |
| `$BACKEND_HOME/cron/` | **Must** be the product cron store root when cron is enabled (`jobs.json` shared by ticker/CLI and Brain RPC `settings.snapshot` / `cron.set_enabled`). Never Hermes `~/.hermes/cron` for `lanyard_agent` (lp-uxy.3). Prefer `cron.state_dir=$BACKEND_HOME` (or equivalent) so product `stateDir` is not a nested path like `$BACKEND_HOME/sessions`. |
| `$BACKEND_HOME/logs/` | Symlink to `/var/log/lanyard-agent` or a subdirectory |
| `$BACKEND_HOME/sessions/` | Directory view of session SQLite / session files under `/var/lib/lanyard-agent` |
| `$BACKEND_HOME/workspace/` | Dedicated scratch dir under state root |

### Agent secrets + LiteLLM notes

1. **Env multi-slot:** Agent + LiteLLM units both load
   `EnvironmentFile=-$BACKEND_HOME/.env.secrets`. Full placeholder set:
   [`deploy/litellm/env.secrets.example`](../../deploy/litellm/env.secrets.example)
   (`OPENAI_API_KEY`, `XAI_API_KEY`, `ANTHROPIC_API_KEY`, `LITELLM_MASTER_KEY`,
   `LANYARD_OAUTH_KEY`, custom `META_API_KEY` / `CORP_LLM_API_KEY`, …).
2. **OAuth:** Encrypted store is `oauth.enc` (not Hermes `auth.json`). Provider
   ids in the store are `xai-grok` and `openai-codex`. Materialize writes the
   blob from `files[]`; structured `oauth` alone fails closed for
   `lanyard_agent` (platform does not encrypt).
3. **LiteLLM:** Non-secret `model_list` includes `openai/*`, `xai/*`,
   `anthropic/*`, `*-oauth` models with `configurable_clientside_auth_params`,
   and custom Meta (`api_base` + env key). See
   [`deploy/litellm/README.md`](../../deploy/litellm/README.md).
4. **Map-to-litellm:** Agent product code maps OAuthStore tokens to clientside
   `api_key`/`api_base` for `*-oauth` models; monorepo offline table:
   `deploy/scripts/map-oauth-to-litellm.py`.

### Rules for both options

1. Portal and deploy must not special-case Lanyard Agent paths; they only see
   `BACKEND_HOME` + env contract names.
2. `HERMES_HOME` is **optional** for `lanyard_agent`. If set for dual-run or
   tooling convenience, it should equal `BACKEND_HOME` (same alias rule) or be
   left unset.
3. Sessions are **not** a portable source of truth across Hermes ↔ Lanyard
   Agent cutover; layout compatibility does not imply session DB import.
4. Gaps versus Hermes-Lanyard (missing Brain RPC methods, cron, etc.) are
   recorded as **capability / contract deltas** on the artifact manifest, not
   as alternate filesystem trees in Portal.
5. **Cron (lp-uxy.3):** LA-created jobs persist only under LA runtime home/state
   (`$BACKEND_HOME/cron/…`). Do not write Hermes install home for LA runtime.
   Advertise `features.cron` / `cron_manager` only when dedicated
   `cron.list` / `cron.patch` (or an equivalent honest claim) are live; Portal
   may still list/toggle via `settings.snapshot` + `settings.patch` when those
   methods are real. Platform fixtures:
   [`examples/lanyard-agent.cron.jobs.json`](examples/lanyard-agent.cron.jobs.json),
   [`docs/architecture/lanyard-agent-cron-portal.md`](../../docs/architecture/lanyard-agent-cron-portal.md).

---

## Environment variables that reference the layout

Platform-owned names (also listed in the architecture contract notes):

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

Hermes-compatible aliases:

```text
HERMES_HOME              # = BACKEND_HOME for hermes_* kinds
HERMES_INSTALL_PATH      # artifact install root, not runtime home
```

Profile directory resolution order for Brain RPC host profile load:

1. `BRAIN_PROFILES_DIR` if set
2. `$BACKEND_HOME/profiles`
3. Builtin admin/contributor seeds packaged with the backend (fallback only)

Vault root resolution:

1. `VAULT_ROOT` if set
2. `COMPANY_BRAIN_VAULT_ROOT` if set
3. Implementation fallback only (Hermes today: `$HERMES_HOME/vault`) — **not**
   required by this contract; production deploy should always set `VAULT_ROOT`.

---

## Conformance expectations (layout only)

A backend claims `contract.runtime_layout: 1` when:

- [ ] `BACKEND_HOME` is documented and set for the gateway process
- [ ] Required directories exist (or are created on start): `profiles/`,
      `skills/`, `cron/`, `logs/`, `sessions/`, `workspace/`
- [ ] Profile seeds for `admin` and `contributor` are available under
      `profiles/` (or via `BRAIN_PROFILES_DIR` / documented builtin seed)
- [ ] `config.yaml` is used as the primary structured config file under home
      (or projected there for Option B)
- [ ] Hermes-compatible kinds set `HERMES_HOME=$BACKEND_HOME`
- [ ] Lanyard Agent uses direct layout or a projection that satisfies the path
      catalog without Portal special cases
- [ ] No requirement that Portal open files under `BACKEND_HOME` directly

Full suite text: [`conformance.md`](conformance.md). Lanyard Agent layout and
related gaps:
[`docs/architecture/lanyard-agent-conformance-gaps.md`](../../docs/architecture/lanyard-agent-conformance-gaps.md).

---

## Related documents

| Doc | Role |
| --- | --- |
| [`README.md`](README.md) | Contract directory index |
| [`conformance.md`](conformance.md) | Conformance suite + compatibility matrix |
| [`artifact-manifest.schema.json`](artifact-manifest.schema.json) | `contract.runtime_layout` major |
| [`docs/architecture/backend-runtime-contract.md`](../../docs/architecture/backend-runtime-contract.md) | Architecture summary |
| [`docs/architecture/lanyard-agent-conformance-gaps.md`](../../docs/architecture/lanyard-agent-conformance-gaps.md) | Lanyard Agent deltas + external checklist |
| [`docs/architecture/lanyard-agent-multi-provider-secrets.md`](../../docs/architecture/lanyard-agent-multi-provider-secrets.md) | Agent OAuth + LiteLLM multi-slot matrix (lp-645.8.5) |
| [`deploy/litellm/`](../../deploy/litellm/) | LiteLLM `model_list` seed + env placeholders |
| [`docs/adr/0003-backend-runtime-v1-contract.md`](../../docs/adr/0003-backend-runtime-v1-contract.md) | Ownership ADR |
| [`config.schema.json`](config.schema.json) | Shape of `config.yaml` |
| [`secrets-envelope.schema.json`](secrets-envelope.schema.json) | SM envelope for `.env.secrets` / `config.secrets.yaml` |
| [`docs/architecture/backend-runtime-secrets.md`](../../docs/architecture/backend-runtime-secrets.md) | Normative secrets mapping for all backend kinds |
| [`profiles.schema.json`](profiles.schema.json) | Profile JSON, capability catalog, and vault path ACL model |
