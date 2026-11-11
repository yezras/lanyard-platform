# Phase 6. Multi-provider secrets matrix (Hermes + LiteLLM)

Back to [overview](overview.md).

**Bead:** `lp-645.8.1` · **Epic:** `lp-645.8` (parent epic `lp-645` SM envelope)

## Goal

Define the **full credential matrix** operators must provision for real mocklab /
tenant hosts — API keys, subscription OAuth (xAI Super Heavy / OpenAI Codex),
custom OpenAI-compatible providers (e.g. Meta), LiteLLM master key — and map
each slot onto **Hermes-Lanyard** host files and **Lanyard Agent / LiteLLM**
host files. Extend the existing
[`BackendRuntimeSecretsEnvelope`](../../../contracts/backend-runtime-v1/secrets-envelope.schema.json)
contract; do not invent a parallel secret product.

This phase is **plan-only**. Schema bumps, materialize file writers, and cutover
runbook updates are follow-on beads under `lp-645.8`.

## Constraints (locked)

| Constraint | Implication |
| --- | --- |
| No interactive OAuth in Terraform | Operators complete device-code OAuth **offline** (laptop / bastion), export material, `put-secret-value` into SM |
| No raw tokens in TF state | TF owns ARN/IAM only; values live only in SM + host files mode `0600` |
| Backends do not parse the SM envelope | Materialize writes env + overlay + oauth files backends already understand |
| Envelope stays backend-neutral | Same SM document can materialize for `hermes_lanyard` or `lanyard_agent`; unused slots follow placeholder policy |
| No Bitwarden / 1Password / Portal as secret SoR | AWS SM remains system of record |

Normative path contract today:
[`docs/architecture/backend-runtime-secrets.md`](../../architecture/backend-runtime-secrets.md).

---

## Decision table (summary)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Envelope major | Stay on `schema_version: 1` for API-key + `config_secret_overlay` paths; **add optional `files` (or `oauth_material`) in a follow-on schema bead** for opaque OAuth blobs | Avoids forcing backends to invent new parsers; materialize owns file writes |
| API keys | Always `env` map → `$BACKEND_HOME/.env.secrets` | Existing v1 path; Hermes + LiteLLM already use env names |
| Custom providers | Secret-bearing entries via `config_secret_overlay` + `key_env` pointing at `env`; public `base_url` / model ids may live in public `config.yaml` seed | Prefer `key_env` over inline `api_key` in YAML |
| Hermes OAuth | Offline export of `$HERMES_HOME/auth.json` (and any companion auth store Hermes uses) → SM `files[]` → materialize write `auth.json` mode `0600` | Hermes stores OAuth under `auth.json` (device-code / `hermes auth`) |
| Agent OAuth | Offline export of encrypted store (`LANYARD_OAUTH_STORE`, default `oauth.enc`) + `LANYARD_OAUTH_KEY` in `env` → materialize writes store file + key | Agent `OAuthStore` providers `xai-grok`, `openai-codex` |
| Placeholder (git) | Full matrix present with obvious placeholders (`sk-placeholder-…`, `REPLACE_ME`, `oauth-placeholder-…`) | Matches existing `x-lanyard-placeholder-policy` |
| Placeholder (live SM) | **Omit** unused slots; never empty-string keys that look "set"; never use live-looking fake keys | Empty/`""` can fool clients into thinking a key exists; sentinels risk accidental upstream calls |
| Mocklab default active set | Prefer **xAI Super Heavy OAuth** primary; API keys optional backups; Codex OAuth optional second account; Meta custom optional; Anthropic placeholder-only unless used; Agent-only keys only when kind is agent | Matches product intent in epic `lp-645.8` |
| Multi custom providers | Ordered list (Hermes `custom_providers[]` / Agent LiteLLM `model_list` entries); envelope overlay holds secret-bearing subset only | Operators may add many Meta/OpenAI-compatible endpoints |

---

## Credential matrix (minimum)

Slots below are the **operator matrix**. Columns show Hermes-Lanyard vs Lanyard
Agent / LiteLLM materialize targets. Values never appear in git, tfvars, or plan
logs — only SM and host files.

| Slot | Hermes-Lanyard path | Lanyard Agent / LiteLLM path | Required mocklab default | Notes |
| --- | --- | --- | --- | --- |
| `xai_api_key` | `env` → `XAI_API_KEY` in `$HERMES_HOME/.env.secrets` | `env` → `XAI_API_KEY`; LiteLLM `xai/*` `api_key: os.environ/XAI_API_KEY` | Optional if OAuth primary | API-key path (`provider: xai`). Optional backup when Super Heavy OAuth is primary |
| `xai_oauth_super_heavy` | OAuth store → `$HERMES_HOME/auth.json` (provider `xai-oauth`); non-secret `model.provider: xai-oauth` in public config seed | Agent `OAuthStore` provider `xai-grok` → `$BACKEND_HOME/oauth.enc` (or `LANYARD_OAUTH_STORE`); LiteLLM models `xai/*-oauth` with clientside `api_key`/`api_base` | **Preferred primary** for Super Heavy tenants | Device-code offline; refresh stays on host after inject. Grok Super Heavy / SuperGrok / X Premium+ account |
| `openai_api_key` | `env` → `OPENAI_API_KEY` | `env` → `OPENAI_API_KEY`; LiteLLM `openai/*` | Optional if Codex OAuth primary | Direct OpenAI API |
| `openai_codex_oauth` | `$HERMES_HOME/auth.json` (Codex / `openai-codex`; `hermes auth` / Codex import of `~/.codex/auth.json` offline) | Agent provider `openai-codex` in OAuth store + LiteLLM `openai/codex-oauth` | Optional second account | Device-code export path for ops |
| `custom_providers[]` | Overlay / public config: Hermes `custom_providers` list **or** `providers.<id>` map with `{ base_url, key_env \| api_key }`; key value in `.env.secrets` via `key_env` | LiteLLM `model_list` entry: `api_base` + `api_key: os.environ/<KEY>` | Optional (Meta example when needed) | Multi-entry list; see [Custom providers](#custom-providers-meta-and-multi-entry) |
| `anthropic_api_key` | `env` → `ANTHROPIC_API_KEY` | `env` → `ANTHROPIC_API_KEY`; LiteLLM `anthropic/*` | Placeholder / omit live if unused | Keep in committed full-matrix template only when documenting all slots |
| `litellm_master_key` | N/A (Hermes does not use LiteLLM proxy master key) | `env` → `LITELLM_MASTER_KEY`; LiteLLM `general_settings.master_key: os.environ/LITELLM_MASTER_KEY` | Required **when** `kind_hint` / host runs Agent+LiteLLM | Agent ↔ proxy Bearer auth |

### Companion non-secret slots (not in SM)

Stay in tfvars / public `config.yaml` / pins:

| Slot | Example | Owner |
| --- | --- | --- |
| Default provider id | `xai-oauth`, `xai`, `openai`, `openai-codex`, `custom:meta` | `backend_model_provider` / `model.provider` |
| Default model id | `grok-build-0.1`, `grok-3`, `gpt-4.1` | `backend_model_default` / `model.default` / `default_model` |
| Custom provider base URL (non-secret) | `https://api.llama.meta.com/...` | Public config seed (may also appear in overlay if co-located with `key_env`) |
| LiteLLM model allowlist (non-secret names) | `xai/grok-3-oauth`, `openai/codex-oauth` | Agent `deploy/litellm/config.yaml` seed / host projection |

---

## File targets by backend kind

### `hermes_lanyard` / `hermes_upstream`

| Artifact | Path | Source in envelope | Mode |
| --- | --- | --- | --- |
| Managed env | `$HERMES_HOME/.env.secrets` | `env` | `0600` |
| Secret config overlay | `$HERMES_HOME/config.secrets.yaml` | `config_secret_overlay` (secret-bearing keys only) | `0600` |
| OAuth auth store | `$HERMES_HOME/auth.json` | Proposed `files[]` entry `path_relative: auth.json` | `0600` |
| Public config | `$HERMES_HOME/config.yaml` | **Not** from SM (seeds / operator); may reference `key_env` | operator |
| Unit | existing Hermes unit `EnvironmentFile` must include `.env` and/or `.env.secrets` | phase 2–3 | — |

Mocklab reference home: `/home/hermes/.hermes` when that is `HERMES_HOME`.

Hermes OAuth providers of interest:

| Logical slot | Hermes provider id | How obtained offline |
| --- | --- | --- |
| xAI Super Heavy | `xai-oauth` | `hermes auth add xai-oauth --no-browser` (device code) on operator machine with the Super Heavy account |
| OpenAI Codex | `openai-codex` | `hermes auth` / Codex device-code; may import `~/.codex/auth.json` offline then copy resulting Hermes `auth.json` |

### `lanyard_agent`

| Artifact | Path | Source in envelope | Mode |
| --- | --- | --- | --- |
| Managed env | `$BACKEND_HOME/.env.secrets` | `env` (`OPENAI_*`, `XAI_*`, `ANTHROPIC_*`, `LITELLM_MASTER_KEY`, `LANYARD_OAUTH_KEY`, custom `*_API_KEY`) | `0600` |
| Secret config overlay | `$BACKEND_HOME/config.secrets.yaml` | `config_secret_overlay` if Agent uses YAML secret keys | `0600` |
| Encrypted OAuth store | `$BACKEND_HOME/oauth.enc` or path from `LANYARD_OAUTH_STORE` | Proposed `files[]` + `LANYARD_OAUTH_KEY` in `env` | `0600` |
| LiteLLM config | Host LiteLLM yaml (often under Agent deploy path) | Non-secret model_list seed; keys via `os.environ/*` only | deploy seed |
| Unit | generic backend + litellm units `EnvironmentFile` | phase 2–3 | — |

Agent OAuth providers (existing packages):

| Logical slot | Agent provider id | LiteLLM model example |
| --- | --- | --- |
| xAI Super Heavy | `xai-grok` | `xai/grok-3-oauth` (`configurable_clientside_auth_params`) |
| OpenAI Codex | `openai-codex` | `openai/codex-oauth` |

Offline login (operator machine, not TF):

```bash
# Agent — device code, no browser auto-open on headless
lanyard-agent auth login --provider xai-grok --no-browser
lanyard-agent auth login --provider openai-codex --no-browser
# Store path: LANYARD_OAUTH_STORE (default-friendly oauth.enc)
# Encryption key: LANYARD_OAUTH_KEY (must travel with the store blob)
```

---

## Envelope extension plan (follow-on schema bead — not this phase)

Current v1 fields (`schema_version`, `env`, `config_secret_overlay`, `kind_hint`,
`meta`) already cover **API keys** and **YAML secret overlays**. OAuth stores are
**opaque files**, not process env. Plan the additive optional field:

### Option A (recommended): `files[]`

```json
{
  "schema_version": 1,
  "kind_hint": "hermes_lanyard",
  "env": {
    "XAI_API_KEY": "sk-placeholder-xai-optional-backup",
    "OPENAI_API_KEY": "sk-placeholder-openai-optional-backup",
    "ANTHROPIC_API_KEY": "sk-placeholder-anthropic-unused",
    "META_API_KEY": "sk-placeholder-meta-replace-me"
  },
  "config_secret_overlay": {
    "custom_providers": [
      {
        "name": "meta",
        "base_url": "https://api.llama.com/compat/v1",
        "key_env": "META_API_KEY"
      }
    ]
  },
  "files": [
    {
      "path_relative": "auth.json",
      "encoding": "utf-8",
      "content": "{ \"…hermes auth store placeholder…\" }",
      "mode": "0600"
    }
  ],
  "meta": {
    "tenant_slug": "mocklab",
    "notes": "placeholders only — full matrix template"
  }
}
```

Rules for `files[]` (to lock in schema bead):

| Rule | Detail |
| --- | --- |
| Paths | Relative to `BACKEND_HOME` / `HERMES_HOME` only; reject `..` and absolute paths |
| Allowlist (v1 multi-provider) | `auth.json` (Hermes); `oauth.enc` (Agent). Expand later if needed |
| Content | UTF-8 text **or** `content_base64` for binary encrypted stores |
| Permissions | Default `0600`, service-user owned |
| Idempotent | Rewrite whole file from SM; no partial merge of OAuth JSON unless product requires it |
| Logging | Never log content; log path + byte length only |

### Option B (rejected as sole path): base64-only env vars

e.g. `HERMES_AUTH_JSON_B64=…`. Rejected as primary design: oversized env, poor
diff/rotate ergonomics, unit EnvironmentFile bloat. May exist as escape hatch
only if `files[]` is delayed.

### Agent-shaped example (placeholders)

```json
{
  "schema_version": 1,
  "kind_hint": "lanyard_agent",
  "env": {
    "LITELLM_MASTER_KEY": "sk-placeholder-litellm-master",
    "XAI_API_KEY": "sk-placeholder-xai-optional-backup",
    "OPENAI_API_KEY": "sk-placeholder-openai-optional-backup",
    "ANTHROPIC_API_KEY": "sk-placeholder-anthropic-unused",
    "META_API_KEY": "sk-placeholder-meta-replace-me",
    "LANYARD_OAUTH_KEY": "REPLACE_ME_oauth_encryption_key_32B_min"
  },
  "config_secret_overlay": {},
  "files": [
    {
      "path_relative": "oauth.enc",
      "encoding": "base64",
      "content_base64": "REPLACE_ME_base64_oauth_enc_blob",
      "mode": "0600"
    }
  ],
  "meta": {
    "tenant_slug": "example-tenant",
    "notes": "placeholders only — Agent + LiteLLM matrix"
  }
}
```

Until `files[]` ships, operators may still use API-key-only envelopes (phase 1–5
path). OAuth without SSH is **blocked** until materialize learns `files[]` (or a
temporary approved SSM one-shot that still sources content from SM, not from
interactive browser on the instance).

---

## OAuth export / import path (no browser in TF)

### Principles

1. **Browser / device-code only on operator workstation** (or approved bastion), never inside Terraform providers, never as part of `terraform apply`.
2. **Export** durable auth material after successful offline login.
3. **Inject** via `aws secretsmanager put-secret-value` on the envelope document.
4. **Materialize** on the instance writes files; gateway restart picks them up.
5. **Refresh** of access tokens happens **on the host** using refresh tokens already in the store (Hermes auth refresh / Agent `refreshIfNeeded`). Re-export only when refresh fails or account rotates.

### Hermes — Super Heavy / Codex

```text
Operator laptop
  → hermes auth add xai-oauth --no-browser   # open verification URL in local browser
  → hermes auth … openai-codex               # device code similarly
  → copy ~/.hermes/auth.json (mode 600) content into envelope files[]
  → put-secret-value on /company-brain/<tenant>/backend-runtime-secrets
  → (optional) shred local copy of filled envelope

Customer host
  → materialize-backend-secrets
  → writes $HERMES_HOME/auth.json + .env.secrets
  → systemctl restart hermes-gateway
  → Hermes refreshes tokens in place under auth.json
```

Notes:

- Device-code flows (`xai-oauth`, `openai-codex`) do **not** need SSH port forwards (unlike Spotify loopback OAuth).
- Do **not** commit `auth.json`. Committed fixtures use non-functional placeholder JSON only.
- If Super Heavy OAuth is gated by xAI tier (403 on inference), keep `XAI_API_KEY` as documented optional backup and set public `model.provider: xai`.

### Agent — xai-grok / openai-codex

```text
Operator laptop
  → export LANYARD_OAUTH_KEY=…   # generate once; store in password manager / SM env slot
  → lanyard-agent auth login --provider xai-grok --no-browser
  → lanyard-agent auth login --provider openai-codex --no-browser
  → base64-encode oauth.enc into envelope files[]
  → put LANYARD_OAUTH_KEY into envelope env
  → put-secret-value

Customer host
  → materialize writes oauth.enc + .env.secrets (incl. LANYARD_OAUTH_KEY, LITELLM_MASTER_KEY, provider keys)
  → restart lanyard-agent + lanyard-litellm
  → completions: OAuthStore → clientside api_key on *-oauth models; proxy auth stays master key
```

### Explicit non-goals

| Non-goal | Why |
| --- | --- |
| `null_resource` / local-exec OAuth in TF | Secrets + interactive browser; non-reproducible apply |
| Portal as OAuth entry SoR for model accounts | Out of scope for this epic |
| Storing refresh tokens in tfvars | State leakage |

---

## Custom providers (Meta and multi-entry)

### Shape — Hermes

Prefer **named custom providers** with `key_env` (secret value only in `env`):

```yaml
# Public seed (config.yaml) and/or secret overlay merge target
custom_providers:
  - name: meta
    base_url: https://api.llama.com/compat/v1   # operator-confirmed Meta OpenAI-compat URL
    key_env: META_API_KEY
    api_mode: chat_completions
  - name: corp-proxy
    base_url: https://llm.example.com/v1
    key_env: CORP_LLM_API_KEY
```

Platform `config.schema.json` also documents map form `providers.<id>`:

```yaml
providers:
  meta:
    base_url: https://api.llama.com/compat/v1
    key_env: META_API_KEY
```

**Envelope mapping:**

| Piece | Where |
| --- | --- |
| `META_API_KEY` value | `env.META_API_KEY` |
| `key_env` + `base_url` + `name` | Prefer public `config.yaml` seed for non-secret fields; if co-locating secrets-only edits, put the list under `config_secret_overlay.custom_providers` **only when** an entry must carry secret fields — still prefer `key_env` over inline `api_key` |
| Inline `api_key` in YAML | Discouraged; allowed only inside SM overlay when `key_env` is impossible |

### Shape — Agent / LiteLLM

Each custom endpoint is an additional `model_list` entry (non-secret yaml seed)
bound to an env key:

```yaml
# host litellm config (non-secret); keys from EnvironmentFile
model_list:
  - model_name: meta/llama-3.1-405b
    litellm_params:
      model: openai/llama-3.1-405b
      api_base: https://api.llama.com/compat/v1
      api_key: os.environ/META_API_KEY
  - model_name: corp/proxy-default
    litellm_params:
      model: openai/default
      api_base: https://llm.example.com/v1
      api_key: os.environ/CORP_LLM_API_KEY
```

Envelope only needs `env.META_API_KEY`, `env.CORP_LLM_API_KEY`, etc. Model names
and `api_base` stay in deploy/public config unless a tenant-private base URL is
itself secret (rare) — then place `api_base` in overlay / private host config.

### Multi-entry list policy

- Operators may add **N** custom providers; matrix slot is `custom_providers[]`, not a single Meta hardcode.
- Materialize does not interpret provider semantics — it writes env keys and optional overlay list.
- Naming: env keys `^[A-Za-z_][A-Za-z0-9_]*$` (existing envelope `propertyNames`).
- Committed full-matrix examples include **one** Meta-shaped entry as the teaching case plus a second stub entry to prove multi-entry.

---

## Placeholder policy (decided)

### Layers

| Layer | Policy |
| --- | --- |
| **Git fixtures / docs** | Full matrix may appear. Values must be obvious non-secrets: `sk-placeholder-…`, `REPLACE_ME…`, `oauth-placeholder-…`. Never real keys, refresh tokens, or customer account ids |
| **Live SM (production / mocklab)** | Include **only active slots**. Omit unused API-key env names entirely. Omit `files[]` entries that are not in use. Do not store empty strings for keys |
| **Sentinel values in live SM** | **Forbidden** for call-path credentials (`sk-live-looking…`, empty string, single space). Risk: backend treats them as configured and fails open/closed unpredictably |
| **Optional backup keys** | If OAuth is primary, API-key backup may be omitted live; if present, must be a real key or omitted — not a placeholder left over from the template |
| **meta.notes** | May document which slots are intentional placeholders in **templates**; live notes must not paste secret values |

### Mocklab default slot set

| Slot | Mocklab default stance |
| --- | --- |
| `xai_oauth_super_heavy` | **Active** when Super Heavy account is available (preferred) |
| `xai_api_key` | Optional real backup **or** omit |
| `openai_codex_oauth` | Optional second account **or** omit |
| `openai_api_key` | Optional **or** omit |
| `custom_providers[]` / Meta | Omit until a Meta (or other) endpoint is required for QA |
| `anthropic_api_key` | Omit live; present only in git full-matrix template |
| `litellm_master_key` | Omit on Hermes mocklab; required only if Agent is the backend kind |

### Materialize behavior with partial envelopes

Already true for v1 `env`:

- Write only keys present in SM `env`.
- Remove managed keys that disappeared from SM (idempotent rewrite of `.env.secrets`).
- Same rule will apply to `files[]`: missing allowlisted file in SM → remove host file or leave operator-owned file untouched (schema bead must pick one; recommendation: **remove only if previous materialize managed-marker / content hash matches** to avoid deleting hand-placed auth during partial rollout).

---

## Mapping cheat-sheet (operator view)

```text
AWS SM SecretString  (BackendRuntimeSecretsEnvelope)
        │
        ├─ env.*  ──────────────────────►  $BACKEND_HOME/.env.secrets
        │                                     Hermes: XAI_API_KEY, OPENAI_API_KEY, …
        │                                     Agent:  + LITELLM_MASTER_KEY, LANYARD_OAUTH_KEY, META_API_KEY, …
        │
        ├─ config_secret_overlay.*  ────►  $BACKEND_HOME/config.secrets.yaml
        │                                     custom_providers / secret YAML only
        │
        └─ files[]  (planned)  ─────────►  $BACKEND_HOME/auth.json   (Hermes OAuth)
                                           $BACKEND_HOME/oauth.enc   (Agent OAuth store)

Public / TF non-secrets:
  model.provider / model.default / LiteLLM model_list names / base URLs
```

---

## Changes (this phase)

| Path | Change |
| --- | --- |
| This file | Plan + decision table + matrix |
| [overview.md](overview.md) | Link phase 6 |
| [`docs/architecture/backend-runtime-secrets.md`](../../architecture/backend-runtime-secrets.md) | Cross-link multi-provider matrix / placeholder + OAuth offline path |

**Not in this phase:** schema JSON edits, new examples with `files[]`, materialize code, cutover checklist OAuth sections (later beads under `lp-645.8`).

## Follow-on implementation beads (suggested)

| Work | Depends on this plan |
| --- | --- |
| Schema: optional `files[]` + examples (full matrix placeholders) | yes |
| Materialize: write allowlisted files + tests | schema |
| Runbook: offline OAuth export → put-secret-value → materialize | materialize |
| Mocklab cutover: Super Heavy + optional Codex + Meta | runbook |
| Agent LiteLLM seed: ensure `*-oauth` + custom model_list entries documented for platform hosts | parallel |

## Verification (plan phase)

- [x] Matrix covers Hermes and Agent columns for all minimum slots
- [x] OAuth offline export/import documented; TF/browser excluded
- [x] Meta multi-entry custom provider shape documented
- [x] Placeholder policy decided (git full matrix vs live omit)
- [x] Linked from plan overview + architecture secrets doc

Offline validators remain green without schema change (no code).

## Beads

- Plan leaf: `lp-645.8.1` (this document).
- Implementation leaves: under epic `lp-645.8` (schema, materialize, runbooks, cutover).
