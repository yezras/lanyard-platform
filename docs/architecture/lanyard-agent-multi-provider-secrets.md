# Lanyard Agent multi-provider secrets (LiteLLM + OAuth)

**Bead:** `lp-645.8.5` · **Epic:** `lp-645.8`  
**Audience:** operators, deploy, Agent implementers (external product repo)

This document is the **Agent / LiteLLM** half of the multi-provider matrix.
Hermes Super Heavy / Codex `auth.json` operator paths are owned by the parallel
Hermes bead — cross-link only:

- Matrix plan: [`docs/plans/0002-backend-runtime-secrets-aws-sm/phase-6-multi-provider-secrets-matrix.md`](../plans/0002-backend-runtime-secrets-aws-sm/phase-6-multi-provider-secrets-matrix.md)
- Envelope contract: [`docs/architecture/backend-runtime-secrets.md`](backend-runtime-secrets.md)
- LiteLLM seed: [`deploy/litellm/`](../../deploy/litellm/)

Product source for `OAuthStore` and request-time map-to-litellm lives in the
**external** lanyard-agent repository (`packages/providers`). This monorepo owns
platform contracts, materialize, LiteLLM seeds, and offline mapping smoke.

---

## Goals

| Goal | Host / contract surface |
| --- | --- |
| Same credential matrix as Hermes | `BackendRuntimeSecretsEnvelope` (`env`, `oauth`, `custom_providers`, `files`) |
| LiteLLM `model_list` for all slots | [`deploy/litellm/config.yaml`](../../deploy/litellm/config.yaml) with `os.environ/*` only |
| OAuth parity for Super Heavy + Codex | `oauth.enc` + `LANYARD_OAUTH_KEY`; providers `xai-grok`, `openai-codex` |
| Custom Meta (and N custom endpoints) | `model_list` `api_base` + env `api_key` |
| Full env placeholder set | [`deploy/litellm/env.secrets.example`](../../deploy/litellm/env.secrets.example) → `$BACKEND_HOME/.env.secrets` |
| Offline proof | `map-oauth-to-litellm.py --self-test` + `smoke-litellm-multi-slot.sh` |

---

## Host layout (Agent)

Prefer contract `BACKEND_HOME` (Option A) or a projection (Option B). See
[`contracts/backend-runtime-v1/filesystem-layout.md`](../../contracts/backend-runtime-v1/filesystem-layout.md).

| Artifact | Path | Source | Mode |
| --- | --- | --- | --- |
| Managed env | `$BACKEND_HOME/.env.secrets` | envelope `env` via materialize | `0600` |
| Secret overlay | `$BACKEND_HOME/config.secrets.yaml` | `config_secret_overlay` / projected `custom_providers` | `0600` |
| Encrypted OAuth store | `$BACKEND_HOME/oauth.enc` (or `LANYARD_OAUTH_STORE`) | envelope `files[]` (`path_relative: oauth.enc`) | `0600` |
| OAuth decrypt key | env `LANYARD_OAUTH_KEY` | envelope `env` | via EnvironmentFile |
| LiteLLM config | host LiteLLM yaml (seed from `deploy/litellm/config.yaml`) | deploy seed (non-secret) | service-user preferred |
| Agent public config | `$BACKEND_HOME/config.yaml` | artifact / operator (non-secret) | typically `0600` |

### systemd EnvironmentFile

Both **agent** and **LiteLLM proxy** units must load secrets:

```text
EnvironmentFile=-$BACKEND_HOME/.env
EnvironmentFile=-$BACKEND_HOME/.env.secrets
```

Generic backend unit baseline:
[`deploy/modules/company-brain-ec2/systemd/company-brain-backend.service`](../../deploy/modules/company-brain-ec2/systemd/company-brain-backend.service)
(add `.env.secrets` when wiring Agent hosts; Hermes mocklab may merge into `.env`).

Suggested companion unit name on Agent hosts: `lanyard-litellm.service` (product-
owned unit file in external agent repo; platform requires only that it share the
same EnvironmentFile secrets path).

---

## Credential matrix (Agent column)

| Slot | Envelope | Host | LiteLLM |
| --- | --- | --- | --- |
| OpenAI API key | `env.OPENAI_API_KEY` | `.env.secrets` | `openai/*` → `os.environ/OPENAI_API_KEY` |
| xAI API key | `env.XAI_API_KEY` | `.env.secrets` | `xai/*` → `os.environ/XAI_API_KEY` |
| Anthropic API key | `env.ANTHROPIC_API_KEY` | `.env.secrets` | `anthropic/*` → `os.environ/ANTHROPIC_API_KEY` |
| xAI Super Heavy OAuth | `files[] oauth.enc` + optional structured `oauth.xai-grok` | `oauth.enc` + `LANYARD_OAUTH_KEY` | `xai/grok-3-oauth`, `xai/grok-build-oauth` + `configurable_clientside_auth_params` |
| OpenAI Codex OAuth | same store, provider `openai-codex` | same | `openai/codex-oauth` + clientside params |
| Meta custom | `env.META_API_KEY` + optional `custom_providers[]` | `.env.secrets` | `meta/llama-3.1-405b` with `api_base` + env key |
| Poolside | `env.POOLSIDE_API_KEY` | `.env.secrets` | `poolside/*` → `api_base` inference.poolside.ai + env key |
| Corp / N custom | `env.<KEY>` + `custom_providers[]` | `.env.secrets` | additional `model_list` rows |
| LiteLLM master | `env.LITELLM_MASTER_KEY` | `.env.secrets` | `general_settings.master_key` |

Git full-matrix template: `secrets-envelope.full-matrix.json` and
`secrets-envelope.lanyard-agent.json`. Live SM **omits** unused slots.

---

## OAuthStore → map-to-litellm

### Provider ids (Agent)

| OAuthStore provider | LiteLLM `model_name` | Upstream model | Hermes peer id |
| --- | --- | --- | --- |
| `xai-grok` | `xai/grok-3-oauth`, `xai/grok-build-oauth` | `xai/grok-3`, `xai/grok-build-0.1` | `xai-oauth` (Hermes only) |
| `openai-codex` | `openai/codex-oauth` | `openai/gpt-4.1` (or product default) | `openai-codex` |

### Clientside auth

OAuth model entries set:

```yaml
configurable_clientside_auth_params: ["api_key", "api_base"]
```

Runtime (external Agent):

1. Decrypt `oauth.enc` with `LANYARD_OAUTH_KEY` (`OAuthStore`).
2. Resolve `model_info.lanyard_oauth_provider` (or equivalent) for the requested
   `*-oauth` model name.
3. `refreshIfNeeded` on the provider material.
4. Pass `access_token` as clientside `api_key` (never as LiteLLM master key).
5. Optional: pass `api_base` if the provider requires a non-default base.
6. Codex: attach `ChatGPT-Account-Id` from store `metadata.chatgpt_account_id`
   when present.
7. Authenticate Agent → LiteLLM proxy with `Authorization: Bearer $LITELLM_MASTER_KEY`.

### Materialize rules (platform)

| Kind | Structured `oauth` | `files[]` `oauth.enc` |
| --- | --- | --- |
| `lanyard_agent` | **Not** written as cleartext; if present without `files[] oauth.enc`, materialize **fails closed** | Written mode `0600` (opaque blob) |
| `hermes_*` | Projected to `auth.json` | `auth.json` allowlisted similarly |

Platform does **not** encrypt structured tokens into `oauth.enc` (no crypto key
handling beyond writing `LANYARD_OAUTH_KEY` env). Operators export an already-
encrypted store offline.

Offline mapper (contract smoke, no tokens in output):

```bash
python3 deploy/scripts/map-oauth-to-litellm.py --self-test
python3 deploy/scripts/map-oauth-to-litellm.py \
  --from-envelope contracts/backend-runtime-v1/examples/secrets-envelope.lanyard-agent.json
```

---

## Offline OAuth export / import (Agent)

```text
Operator laptop
  → export LANYARD_OAUTH_KEY=…          # durable secret; SM env slot
  → lanyard-agent auth login --provider xai-grok --no-browser
  → lanyard-agent auth login --provider openai-codex --no-browser
  → base64-encode oauth.enc into envelope files[]
  → put LANYARD_OAUTH_KEY + API keys + LITELLM_MASTER_KEY into envelope env
  → aws secretsmanager put-secret-value …

Customer host
  → materialize-backend-secrets
  → writes .env.secrets + oauth.enc (0600)
  → systemctl restart company-brain-backend lanyard-litellm
  → completions: OAuthStore → clientside api_key on *-oauth models
```

**Non-goals:** browser OAuth in Terraform; Portal as model-account SoR;
cleartext OAuth files under Agent home.

---

## Custom Meta example

LiteLLM seed entry:

```yaml
- model_name: meta/llama-3.1-405b
  litellm_params:
    model: openai/llama-3.1-405b
    api_base: https://api.llama.com/compat/v1
    api_key: os.environ/META_API_KEY
```

Envelope:

```json
{
  "env": { "META_API_KEY": "sk-placeholder-meta-replace-me" },
  "custom_providers": [
    {
      "id": "meta",
      "base_url": "https://api.llama.com/compat/v1",
      "api_key_env": "META_API_KEY",
      "default_model": "llama-3.1-405b"
    }
  ]
}
```

Non-secret `api_base` / model names stay in the LiteLLM seed (or public agent
config). Only the key value is SM-managed.

---

## Full env placeholder set

Teaching set (git): [`deploy/litellm/env.secrets.example`](../../deploy/litellm/env.secrets.example)

| Key | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI API |
| `XAI_API_KEY` | xAI API (optional backup when OAuth primary) |
| `ANTHROPIC_API_KEY` | Anthropic API |
| `OPENROUTER_API_KEY` | Optional OpenRouter |
| `META_API_KEY` | Meta custom OpenAI-compat |
| `POOLSIDE_API_KEY` | Poolside inference (OpenAI-compat) |
| `CORP_LLM_API_KEY` | Second custom stub |
| `LITELLM_MASTER_KEY` | Agent ↔ LiteLLM Bearer |
| `LANYARD_OAUTH_KEY` | Decrypt `oauth.enc` |
| `GATEWAY_RELAY_SECRET` | Relay (often co-materialized) |

Schema recommended keys: `x-lanyard-recommended-env-keys` on
[`secrets-envelope.schema.json`](../../contracts/backend-runtime-v1/secrets-envelope.schema.json).

---

## External lanyard-agent follow-ups

Monorepo work stops at contracts, seeds, materialize, and offline mapping.
Product repo should track (if not already done):

1. Ensure `OAuthStore` provider ids remain `xai-grok` and `openai-codex`.
2. Wire request path: model name → provider → clientside `api_key`/`api_base`
   for all `*-oauth` entries in the platform seed.
3. Document host unit `lanyard-litellm.service` EnvironmentFile to match
   `$BACKEND_HOME/.env.secrets`.
4. Optional: native encrypt path for structured envelope `oauth` → `oauth.enc`
   (today platform requires pre-encrypted `files[]`).
5. Conform `BACKEND_HOME` layout Option A/B for secrets files.

---

## Validation

```bash
bash deploy/scripts/smoke-litellm-multi-slot.sh
python3 deploy/scripts/map-oauth-to-litellm.py --self-test
bash deploy/scripts/smoke-materialize-backend-secrets.sh   # agent oauth.enc path
python3 scripts/validate-secrets-envelope.py
bash scripts/validate.sh
```

---

## Related documents

| Doc | Role |
| --- | --- |
| [`deploy/litellm/README.md`](../../deploy/litellm/README.md) | Operator LiteLLM seed index |
| [`backend-runtime-secrets.md`](backend-runtime-secrets.md) | Envelope mapping all kinds |
| [`hermes-multi-provider-secrets.md`](hermes-multi-provider-secrets.md) | Hermes Super Heavy / Codex / Meta peer |
| [`docs/runbooks/backend-runtime-secrets.md`](../runbooks/backend-runtime-secrets.md) | Create / rotate / clone (full matrix) |
| [`filesystem-layout.md`](../../contracts/backend-runtime-v1/filesystem-layout.md) | `BACKEND_HOME` + Agent projection + oauth.enc |
| [`lanyard-agent-conformance-gaps.md`](lanyard-agent-conformance-gaps.md) | Broader Agent deltas |
| Phase 6 plan | Multi-provider matrix decisions |
