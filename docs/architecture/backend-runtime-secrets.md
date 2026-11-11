# Backend runtime secrets (AWS Secrets Manager)

Normative mapping from the platform **BackendRuntimeSecretsEnvelope** to host
files for every supported backend kind. Implementation phases (materialize
script, Terraform, mocklab cutover) live under
[`docs/plans/0002-backend-runtime-secrets-aws-sm/`](../plans/0002-backend-runtime-secrets-aws-sm/overview.md).

**Contract schema:**
[`contracts/backend-runtime-v1/secrets-envelope.schema.json`](../../contracts/backend-runtime-v1/secrets-envelope.schema.json).

**Layout companion:**
[`contracts/backend-runtime-v1/filesystem-layout.md`](../../contracts/backend-runtime-v1/filesystem-layout.md).

---

## Purpose

Customer hosts run a swappable backend (`hermes_upstream`, `hermes_lanyard`, or
`lanyard_agent`). Model API keys, OAuth material, and integration credentials
are stored in **AWS Secrets Manager** as a single JSON `SecretString` shaped as
`BackendRuntimeSecretsEnvelope`. Deploy materializes that envelope onto files
backends already understand (env + optional config overlay). Backends do **not**
parse the SM envelope.

| Layer | Owns |
| --- | --- |
| AWS Secrets Manager | System of record for secret **values** (one secret per tenant) |
| Terraform | Secret **ARN/name**, IAM `GetSecretValue`, materialize wiring — never plaintext values in state when avoidable |
| Host materialize | Fetch SM → write `.env.secrets` + optional `config.secrets.yaml` → restart-safe, idempotent |
| Backend process | Read env / config files only |

Out of scope for this contract: Portal as secret-entry SoR, Bitwarden/1Password
as central store, putting secret values in git or tfvars.

---

## Envelope shape

```json
{
  "schema_version": 1,
  "kind_hint": "hermes_lanyard",
  "env": {
    "OPENAI_API_KEY": "…",
    "XAI_API_KEY": "…",
    "ANTHROPIC_API_KEY": "…",
    "META_API_KEY": "…",
    "LITELLM_MASTER_KEY": "…",
    "LANYARD_OAUTH_KEY": "…"
  },
  "oauth": {
    "xai-grok": {
      "access_token": "…",
      "refresh_token": "…",
      "expires_at": "2026-12-31T00:00:00Z",
      "metadata": { "account_label": "…" }
    },
    "openai-codex": {
      "access_token": "…",
      "refresh_token": "…",
      "expires_at": "2026-12-31T00:00:00Z",
      "metadata": { "chatgpt_account_id": "…" }
    }
  },
  "custom_providers": [
    {
      "id": "meta",
      "base_url": "https://api.llama.com/compat/v1",
      "api_key_env": "META_API_KEY",
      "default_model": "llama-3.1-405b",
      "models": ["llama-3.1-405b"]
    }
  ],
  "config_secret_overlay": {
    "providers": {
      "meta": {
        "base_url": "https://api.llama.com/compat/v1",
        "key_env": "META_API_KEY"
      }
    },
    "mcp_servers": {
      "some_integration": {
        "auth": "…"
      }
    }
  },
  "files": [
    {
      "path_relative": "auth.json",
      "encoding": "utf-8",
      "content": "{…}",
      "mode": "0600"
    }
  ],
  "meta": {
    "tenant_slug": "mocklab",
    "rotated_at": "2026-07-20T00:00:00Z"
  }
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `schema_version` | yes | integer const `1` (additive fields stay on major 1) |
| `env` | yes | object of string → string; keys are process env names backends already understand. Recommended multi-provider set: `OPENAI_API_KEY`, `XAI_API_KEY`, `ANTHROPIC_API_KEY`, `LITELLM_MASTER_KEY`, `LANYARD_OAUTH_KEY`, `META_API_KEY` / custom `key_env` names, `OPENROUTER_API_KEY`, `GATEWAY_RELAY_SECRET`; optional cost-gated web slots (lp-uxy.7): `FIRECRAWL_API_KEY`, `X_BEARER_TOKEN`, `TAVILY_API_KEY`, `BRAVE_API_KEY` (omit from live SM until enabled). Same `FIRECRAWL_API_KEY` is reused for parse_document scanned-PDF OCR (lp-uxy.10 F5) — host agent only, never BFF; pair with host `PARSE_DOCUMENT_ALLOW_OCR` policy flag |
| `oauth` | no | object keyed by provider id (`xai-grok`, `xai-oauth`, `openai-codex`, …). Each entry requires `access_token`; optional `refresh_token`, `expires_at`, `token_type`, `metadata` (e.g. `chatgpt_account_id` for Codex). Placeholders allowed in git; materialize may skip placeholder sentinels |
| `custom_providers` | no | ordered array of OpenAI-compatible backends (`id`, `base_url` required; prefer `api_key_env` / `key_env` over inline `api_key`; optional `default_model`, `models`) |
| `config_secret_overlay` | no | deep-merge target for **secret-bearing** config only (never non-secrets-only content). Prefer `providers.<id>.key_env` pointing at `env` values |
| `files` | no | optional opaque files relative to `BACKEND_HOME`/`HERMES_HOME` (v1 allowlist: `auth.json`, `oauth.enc`). No absolute paths or `..` |
| `kind_hint` | no | documentation / validation hint (`hermes_upstream` \| `hermes_lanyard` \| `lanyard_agent`). **Materialize must not refuse** the envelope when `kind_hint` is absent or differs from `BACKEND_KIND` — the envelope is backend-neutral |
| `meta` | no | non-authoritative operator metadata (not consumed by backends) |

### Non-secret companions

Not in SM (stay in tfvars, pins, or public `config.yaml` seeds):

- `model.provider` display name / default model id
- feature flags, path layouts, relay non-secret ids

Prefer `key_env` / `${VAR}` in public config so credentials resolve from the
materialized env file.

### Placeholder examples (git)

Committed fixtures use obvious placeholders only (`sk-placeholder-…`,
`REPLACE_ME`, `oauth-placeholder-…`). Never real keys:

- [`examples/secrets-envelope.minimal.json`](../../contracts/backend-runtime-v1/examples/secrets-envelope.minimal.json)
- [`examples/secrets-envelope.hermes-lanyard.json`](../../contracts/backend-runtime-v1/examples/secrets-envelope.hermes-lanyard.json)
- [`examples/secrets-envelope.hermes-upstream.json`](../../contracts/backend-runtime-v1/examples/secrets-envelope.hermes-upstream.json)
- [`examples/secrets-envelope.lanyard-agent.json`](../../contracts/backend-runtime-v1/examples/secrets-envelope.lanyard-agent.json)
- [`examples/secrets-envelope.full-matrix.json`](../../contracts/backend-runtime-v1/examples/secrets-envelope.full-matrix.json) — all env/oauth/custom_providers/files slots
- Hermes path-focused fixtures (`lp-645.8.4`):
  - [`secrets-envelope.hermes-super-heavy-oauth.json`](../../contracts/backend-runtime-v1/examples/secrets-envelope.hermes-super-heavy-oauth.json)
  - [`secrets-envelope.hermes-codex-oauth.json`](../../contracts/backend-runtime-v1/examples/secrets-envelope.hermes-codex-oauth.json)
  - [`secrets-envelope.hermes-meta-custom.json`](../../contracts/backend-runtime-v1/examples/secrets-envelope.hermes-meta-custom.json)
  - [`hermes-auth.placeholder.json`](../../contracts/backend-runtime-v1/examples/hermes-auth.placeholder.json) — Hermes `auth.json` shape (not an envelope)
  - [`hermes-lanyard-multi-provider.config.yaml`](../../contracts/backend-runtime-v1/examples/hermes-lanyard-multi-provider.config.yaml) — public `model.provider` seed

---

## Backend mapping (v1)

Normative host targets. `HERMES_HOME` equals `BACKEND_HOME` for Hermes-compatible
kinds (see filesystem layout). Absolute mocklab reference path for Hermes-Lanyard:
`/home/hermes/.hermes` when that is the configured home.

| Backend kind | Env target | Config overlay target | OAuth target | Custom providers | Unit EnvironmentFile |
| --- | --- | --- | --- | --- | --- |
| `hermes_lanyard` | `$HERMES_HOME/.env.secrets` (merged or included) | `$HERMES_HOME/config.secrets.yaml` or managed merge into `config.yaml` **secret keys only** | `$HERMES_HOME/auth.json` from structured `oauth` and/or `files[]` (`path_relative: auth.json`) | Overlay `providers.*` / `custom_providers` + env via `key_env` / `api_key_env` | existing `EnvironmentFile=-$HERMES_HOME/.env` must include secrets (merge into `.env` **or** add a second `EnvironmentFile` for `.env.secrets`) |
| `hermes_upstream` | same Hermes home layout (`$HERMES_HOME/.env.secrets`) | same (`$HERMES_HOME/config.secrets.yaml` / managed merge) | same (`$HERMES_HOME/auth.json`) | same Hermes custom provider projection | same as `hermes_lanyard` |
| `lanyard_agent` | `$BACKEND_HOME/.env.secrets` (or Agent-documented path projected to `BACKEND_HOME`) | Agent config secret overlay: `$BACKEND_HOME/config.secrets.yaml` preferred; implement when Agent conforms to runtime_layout | `$BACKEND_HOME/oauth.enc` (or `LANYARD_OAUTH_STORE`) from structured `oauth` and/or `files[]` (`path_relative: oauth.enc`) plus `LANYARD_OAUTH_KEY` in env | LiteLLM `model_list` `api_base` (public seed) + env API keys; optional overlay | generic backend unit (`EnvironmentFile=-$BACKEND_HOME/.env` and/or `EnvironmentFile=-$BACKEND_HOME/.env.secrets`) |

### Path notes

| File | Owner | Mode guidance | Purpose |
| --- | --- | --- | --- |
| `$BACKEND_HOME/.env.secrets` | materialize (deploy) | `0600`, service-user owned | KEY=value lines from envelope `env`. Managed keys are rewritten on each materialize run |
| `$BACKEND_HOME/.env` | operators / bootstrap | `0600` | Optional non-secret or historically mixed env; may include secrets if unit has only one EnvironmentFile — prefer separate `.env.secrets` |
| `$BACKEND_HOME/config.secrets.yaml` | materialize (deploy) | `0600` | Secret-bearing overlay from `config_secret_overlay` and/or projected `custom_providers`. Not committed; not a Portal surface |
| `$BACKEND_HOME/config.yaml` | operators + public seeds | typically `0600` | Non-secret runtime config ([`config.schema.json`](../../contracts/backend-runtime-v1/config.schema.json)). Secret keys must not be committed in examples |
| `$HERMES_HOME/auth.json` | materialize (deploy) | `0600` | Hermes OAuth store (`xai-oauth`, `openai-codex`). From envelope `oauth` and/or `files[]` |
| `$BACKEND_HOME/oauth.enc` | materialize (deploy) | `0600` | Agent encrypted OAuth store (`xai-grok`, `openai-codex`). From envelope `oauth` and/or `files[]`; decrypt key is `LANYARD_OAUTH_KEY` in env |

Hermes-compatible kinds resolve the same paths via `HERMES_HOME=$BACKEND_HOME`.

### systemd

Generic unit
[`deploy/modules/company-brain-ec2/systemd/company-brain-backend.service`](../../deploy/modules/company-brain-ec2/systemd/company-brain-backend.service)
already loads:

```text
EnvironmentFile=-/var/lib/company-brain-backend/.env
EnvironmentFile=-/etc/company-brain/backend.env
```

Secrets materialization for platform layout should either:

1. **Merge** managed keys into `$BACKEND_HOME/.env` (materialize owns a managed block), or
2. **Add** `EnvironmentFile=-$BACKEND_HOME/.env.secrets` (preferred when units can be updated).

Mocklab / Hermes-only hosts that still use `EnvironmentFile=-$HERMES_HOME/.env`
must ensure secrets land in a file the unit includes (merge or second
EnvironmentFile under that home).

### Lanyard Agent

Until Agent natively uses a single `BACKEND_HOME` tree (layout Option A/B),
materialize may write to Agent-documented paths **provided** a projection at
`BACKEND_HOME` remains the contract view for Portal/deploy. Preferred v1 targets
remain `$BACKEND_HOME/.env.secrets` and `$BACKEND_HOME/config.secrets.yaml`.
Product-private paths under `/etc/lanyard-agent/` are out of contract unless
projected.

### Hermes-Lanyard concrete paths (Super Heavy, Codex, Meta)

Operator-facing consumption guide (offline export → envelope → materialize →
Hermes runtime selectors, OAuth-over-API-key precedence, verification steps):

[`hermes-multi-provider-secrets.md`](hermes-multi-provider-secrets.md)

| Product intent | Envelope | Hermes host | Public selector |
| --- | --- | --- | --- |
| xAI Super Heavy OAuth | `oauth.xai-oauth` (Hermes id; **not** Agent `xai-grok`) | `$HERMES_HOME/auth.json` → `providers.xai-oauth` | `model.provider: xai-oauth` |
| OpenAI Codex OAuth | `oauth.openai-codex` (or Hermes-shaped `files[]` `auth.json` after `~/.codex/auth.json` import) | same `auth.json` → `providers.openai-codex` | `model.provider: openai-codex` |
| Meta custom endpoint | `custom_providers[{id:meta}]` + `env.META_API_KEY` | `config.secrets.yaml` `providers.meta.key_env` + `.env.secrets` | `model.provider: meta` |

**OAuth vs API key precedence (Hermes):** when both OAuth material and an API key
are present, **prefer OAuth** — set public `model.provider` to `xai-oauth` /
`openai-codex`. Materialize writes both credential types when present; Hermes
selects by `model.provider` (`xai` / `openai` = API-key path). Optional API keys
are backups only; omit them live when unused.

Opaque `files[]` `auth.json` **wins** over structured `oauth` for the same path
(no merge). Prefer one inject path per put-secret-value.

---

## Materialize rules (contract-level)

Detailed algorithm is phase 2 (env/overlay) and phase 6 follow-on beads
(OAuth/custom providers); this contract requires:

1. **Parse once** at the host boundary: load SM `SecretString` as
   `BackendRuntimeSecretsEnvelope`; reject missing `schema_version` / non-object
   `env` / invalid `oauth` / `custom_providers` / `files` shapes.
2. **Ignore kind mismatch:** if `kind_hint` is present and differs from
   `BACKEND_KIND`, log a warning — do not refuse materialize.
3. **Idempotent env write:** rewrite managed secret env file from `env`; do not
   duplicate keys; do not leave prior managed values when removed from SM.
4. **Config overlay:** if `config_secret_overlay` is present, write
   `config.secrets.yaml` (or merge secret keys only into `config.yaml` under
   documented rules). Never put non-secret-only content only in the overlay.
   Prefer `providers.<id>.key_env` over inline `api_key`.
5. **OAuth / files:** when `files[]` is present, write allowlisted relative paths
   (`auth.json`, `oauth.enc`) mode `0600`. When structured `oauth` is present,
   materialize may reconstruct the kind-appropriate store (Hermes `auth.json` /
   Agent `oauth.enc`) — implementation is deploy materialize (not backends).
   Placeholder sentinels may be skipped rather than written.
6. **Custom providers:** ensure `api_key_env` / `key_env` values exist under
   `env` when projecting; non-secret `base_url` / model ids may stay in public
   config seeds.
7. **Permissions:** secret files `0600`, owned by the backend service user.
8. **No network in offline validation:** schema + placeholder examples validate
   without calling AWS.

---

## Validation

```bash
python3 scripts/validate-secrets-envelope.py
# also: bash scripts/validate.sh  (check 22)
```

Offline checks: schema loadable, placeholder examples validate, negative
payloads rejected (missing `schema_version`, non-object `env`, wrong types).

---

## Multi-provider matrix (OAuth, custom endpoints, LiteLLM)

The envelope contract (schema_version 1, additive) carries the full matrix:

| Concern | Envelope field | Host target |
| --- | --- | --- |
| API keys | `env` | `.env.secrets` |
| Custom providers | `custom_providers` + `env` (`api_key_env`/`key_env`) + optional `config_secret_overlay.providers.*` | Hermes `config.secrets.yaml` / `providers.<id>`; Agent LiteLLM `model_list` `api_base` + env keys |
| Structured OAuth | `oauth` (`xai-grok`, `xai-oauth`, `openai-codex`) | Hermes `$HERMES_HOME/auth.json`; Agent `$BACKEND_HOME/oauth.enc` + `LANYARD_OAUTH_KEY` |
| Opaque OAuth store | `files[]` (`auth.json` / `oauth.enc`) | same paths as structured OAuth (write-through) |
| LiteLLM master | `env.LITELLM_MASTER_KEY` | Agent + LiteLLM only |

**Lanyard Agent / LiteLLM detail** (model_list seed, OAuthStore → clientside
auth, full env placeholder set, external product follow-ups):

[`docs/architecture/lanyard-agent-multi-provider-secrets.md`](lanyard-agent-multi-provider-secrets.md)
· [`deploy/litellm/`](../../deploy/litellm/)

Normative plan (credential matrix, offline OAuth export/import, placeholder
policy):

[`docs/plans/0002-backend-runtime-secrets-aws-sm/phase-6-multi-provider-secrets-matrix.md`](../plans/0002-backend-runtime-secrets-aws-sm/phase-6-multi-provider-secrets-matrix.md)

Summary rules:

| Concern | Rule |
| --- | --- |
| API keys | Continue via envelope `env` → `.env.secrets` |
| Custom providers | Prefer `key_env` / `api_key_env` + env value; multi-entry `custom_providers[]` |
| OAuth | Offline device-code on operator machine → SM (`oauth` and/or `files[]`) → materialize to `auth.json` (Hermes) or `oauth.enc` + `LANYARD_OAUTH_KEY` (Agent). **No browser OAuth in Terraform** |
| Placeholders | Git: full matrix with `sk-placeholder-…` / `REPLACE_ME` / `oauth-placeholder-…` ([`secrets-envelope.full-matrix.json`](../../contracts/backend-runtime-v1/examples/secrets-envelope.full-matrix.json)). Live SM: **omit** unused slots; never empty-string call-path keys |

---

## Related documents

| Doc | Role |
| --- | --- |
| [`secrets-envelope.schema.json`](../../contracts/backend-runtime-v1/secrets-envelope.schema.json) | Machine-readable envelope |
| [`filesystem-layout.md`](../../contracts/backend-runtime-v1/filesystem-layout.md) | `BACKEND_HOME` tree + secret file names + Agent oauth.enc / litellm |
| [`lanyard-agent-multi-provider-secrets.md`](lanyard-agent-multi-provider-secrets.md) | Agent OAuthStore + LiteLLM multi-slot (lp-645.8.5) |
| [`deploy/litellm/`](../../deploy/litellm/) | LiteLLM config template + env.secrets.example |
| [`config.schema.json`](../../contracts/backend-runtime-v1/config.schema.json) | Public `config.yaml` (secret policy) |
| [`backend-runtime-contract.md`](backend-runtime-contract.md) | Runtime contract summary |
| [`deploy-backend-systemd-service.md`](deploy-backend-systemd-service.md) | Unit EnvironmentFile |
| [`hermes-multi-provider-secrets.md`](hermes-multi-provider-secrets.md) | Hermes Super Heavy / Codex / Meta consumption + offline verify |
| [`docs/runbooks/backend-runtime-secrets.md`](../runbooks/backend-runtime-secrets.md) | Operator create / rotate / revoke / clone (full provider matrix) |
| [`deploy/deployments/mocklab/CUTOVER-backend-runtime-secrets.md`](../../deploy/deployments/mocklab/CUTOVER-backend-runtime-secrets.md) | Mocklab live cutover checklist |
| Plan phase 1 | [`phase-1-envelope-contract.md`](../plans/0002-backend-runtime-secrets-aws-sm/phase-1-envelope-contract.md) |
| Plan phase 5 | [`phase-5-runbooks.md`](../plans/0002-backend-runtime-secrets-aws-sm/phase-5-runbooks.md) |
| Plan phase 6 | [`phase-6-multi-provider-secrets-matrix.md`](../plans/0002-backend-runtime-secrets-aws-sm/phase-6-multi-provider-secrets-matrix.md) |
