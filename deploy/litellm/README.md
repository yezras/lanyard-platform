# LiteLLM multi-slot seed (Lanyard Agent)

Platform-owned **non-secret** LiteLLM config and env placeholder set for hosts
running **Lanyard Agent + LiteLLM**. Maps the expanded
[`BackendRuntimeSecretsEnvelope`](../../contracts/backend-runtime-v1/secrets-envelope.schema.json)
onto LiteLLM the same way Hermes maps onto `auth.json` / `providers.*`.

| File | Role |
| --- | --- |
| [`config.yaml`](config.yaml) | `model_list` seed: openai/*, xai/*, anthropic/*, `*-oauth` (clientside auth), custom Meta + corp stub, **intelligence tiers + `lanyard-auto` auto_router** (lp-uxy.12) |
| [`env.secrets.example`](env.secrets.example) | Full env placeholder set for `$BACKEND_HOME/.env.secrets` / EnvironmentFile |
| [`../scripts/map-oauth-to-litellm.py`](../scripts/map-oauth-to-litellm.py) | Offline OAuth provider → LiteLLM model mapping (no live keys) |
| [`../scripts/smoke-litellm-multi-slot.sh`](../scripts/smoke-litellm-multi-slot.sh) | Offline smoke for slots + mapping + auto_router |

Architecture (OAuthStore path, materialize, unit wiring):

[`docs/architecture/lanyard-agent-multi-provider-secrets.md`](../../docs/architecture/lanyard-agent-multi-provider-secrets.md)

Plan matrix:

[`docs/plans/0002-backend-runtime-secrets-aws-sm/phase-6-multi-provider-secrets-matrix.md`](../../docs/plans/0002-backend-runtime-secrets-aws-sm/phase-6-multi-provider-secrets-matrix.md)

---

## Slot → model_list

| Envelope / env slot | LiteLLM `model_name` examples | Auth |
| --- | --- | --- |
| `env.OPENAI_API_KEY` | `openai/*`, `openai/gpt-4.1` | `api_key: os.environ/OPENAI_API_KEY` |
| `env.XAI_API_KEY` | `xai/*`, `xai/grok-3` | `api_key: os.environ/XAI_API_KEY` |
| `env.ANTHROPIC_API_KEY` | `anthropic/*` | `api_key: os.environ/ANTHROPIC_API_KEY` |
| OAuth `xai-grok` → `oauth.enc` | `xai/grok-3-oauth`, `xai/grok-build-oauth` | `configurable_clientside_auth_params: [api_key, api_base]` |
| OAuth `openai-codex` → `oauth.enc` | `openai/codex-oauth` | same clientside params |
| `env.META_API_KEY` + custom Meta | `meta/llama-3.1-405b` | `api_base` in yaml + `api_key: os.environ/META_API_KEY` |
| `env.CORP_LLM_API_KEY` | `corp/proxy-default` | multi-entry stub |
| `env.POOLSIDE_API_KEY` | `poolside/*`, `poolside/laguna-s-2.1` | `api_base: https://inference.poolside.ai/v1` + env key |
| `env.LITELLM_MASTER_KEY` | (proxy) | `general_settings.master_key` |

---

## OAuth path (xai-grok / openai-codex)

1. **Offline** on operator machine (never in Terraform):

   ```bash
   export LANYARD_OAUTH_KEY='…'   # durable; goes into SM env
   lanyard-agent auth login --provider xai-grok --no-browser
   lanyard-agent auth login --provider openai-codex --no-browser
   # Produces encrypted store (default oauth.enc) + needs LANYARD_OAUTH_KEY
   ```

2. Put into SM envelope:

   - `env.LANYARD_OAUTH_KEY`
   - `files[]` entry `path_relative: oauth.enc` (`encoding: base64`, `content_base64`)
   - Optional structured `oauth.xai-grok` / `oauth.openai-codex` for docs/validation
     (materialize does **not** encrypt structured oauth into `oauth.enc` — supply `files[]`)

3. Host materialize (`materialize-backend-secrets.py`) writes:

   - `$BACKEND_HOME/.env.secrets` (includes `LANYARD_OAUTH_KEY`, `LITELLM_MASTER_KEY`, API keys)
   - `$BACKEND_HOME/oauth.enc` mode `0600`

4. Runtime:

   - Agent `OAuthStore` decrypts `oauth.enc` with `LANYARD_OAUTH_KEY`
   - For models whose `model_info.lanyard_oauth_provider` matches a store provider,
     Agent maps access_token → clientside `api_key` (and optional `api_base`)
   - LiteLLM proxy auth Agent→proxy uses `LITELLM_MASTER_KEY` only

Offline map table (no live tokens):

```bash
python3 deploy/scripts/map-oauth-to-litellm.py --self-test
python3 deploy/scripts/map-oauth-to-litellm.py \
  --from-envelope contracts/backend-runtime-v1/examples/secrets-envelope.lanyard-agent.json
```

Hermes Super Heavy / Codex operator path (auth.json) is owned by the parallel
Hermes bead — see architecture secrets doc; Agent uses **provider id `xai-grok`**
(not Hermes `xai-oauth`) in `oauth.enc`.

---

## Portal intelligence tiers + auto_router (lp-uxy.12)

Composer **Auto | Simple | Moderate | Complex** routes via **LiteLLM**, not a
Portal-only classifier. ADR: [`docs/adr/0007-composer-model-intelligence-routing.md`](../../docs/adr/0007-composer-model-intelligence-routing.md).
LiteLLM Auto Routing docs: https://docs.litellm.ai/docs/proxy/auto_routing

| Composer selection | LiteLLM `model_name` | Role |
| --- | --- | --- |
| Auto | `lanyard-auto` | `auto_router/complexity_router` — classifies each request into SIMPLE/MEDIUM/COMPLEX/REASONING |
| Simple | `lanyard-simple` | Tier pin (default seed: `openai/gpt-4o`) |
| Moderate | `lanyard-moderate` | Tier pin (default seed: `xai/grok-3`) |
| Complex | `lanyard-complex` | Tier pin (default seed: `anthropic/claude-sonnet-4-20250514`) |
| _(router only)_ | `lanyard-reasoning` | REASONING tier pin (default seed: `xai/grok-build-0.1`); not a composer button |

**Operator re-pin:** change `litellm_params.model` (and matching `api_key:
os.environ/…`) under each `lanyard-*` pin. Keep `model_name` stable so Portal’s
`DEFAULT_LITELLM_INTELLIGENCE_MODELS` continues to resolve. Never put raw API
keys in `config.yaml`.

**Classifier cost:** seed defaults to LiteLLM’s free heuristic scorer. Optional
LLM classifier (extra cheap model call) — uncomment under `lanyard-auto` in
`config.yaml`:

```yaml
complexity_router_config:
  tiers: { ... }
  classifier_type: llm
  classifier_llm_config:
    model: lanyard-simple
    timeout_ms: 2000
```

**Host catalog:** Agent should surface these `model_name`s in the settings model
list (provider typically `litellm`) so Portal prefers the LiteLLM path. If the
catalog lacks `lanyard-auto`, Portal falls back to the offline client heuristic
and name-based catalog match (documented fallback only).

**Call shape (proxy):**

```bash
curl -X POST "$LITELLM_BASE/v1/chat/completions" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -d '{"model":"lanyard-auto","messages":[{"role":"user","content":"What is 2+2?"}]}'
```

---

## Custom Meta (and multi-entry)

Teaching entry in `config.yaml` (LiteLLM **proxy** `api_base`; openai provider
joins `{api_base}/chat/completions`):

```yaml
- model_name: meta/llama-3.1-405b
  litellm_params:
    model: openai/llama-3.1-405b
    api_base: https://api.llama.com/compat/v1
    api_key: os.environ/META_API_KEY
```

Envelope only needs `env.META_API_KEY` (and optional `custom_providers[]` /
`config_secret_overlay` for Hermes-style projection). Operators may add N
custom `model_list` rows + matching env keys (`CORP_LLM_API_KEY`, …).

### Local Muse Spark (LiteLlmClient, not the proxy)

Local harness turns use `@lanyard-agent/providers` `LiteLlmClient`, which POSTs
`{baseUrl}/v1/chat/completions`. For Meta Model API / Muse Spark that is **not**
`https://api.meta.ai/v1`:

| Env | Value |
| --- | --- |
| `LITELLM_BASE_URL` | `https://api.meta.ai` (no trailing `/v1`) |
| `LITELLM_API_KEY` | Meta key (`META_API_KEY` alias is accepted by the localhost wrapper) |
| `HARNESS_MODEL` | `muse-spark-1.2-contributor` |

Keys live in `~/.lanyard-agent/meta.env` (mode `600`). Do not put them in
`meta.env.example`. Local start: [`dev/localhost-muse-spark/`](../dev/localhost-muse-spark/).
`createEnvLiteLlmTurnRunner` only — never a one-off Meta `complete()` fetch, and
never a Meta fetch in Portal BFF. Optional `reasoning_effort` is a first-class
field on the lanyard-agent provider client, not a forked wrapper.

Setting `LITELLM_BASE_URL=https://api.meta.ai/v1` double-joins to
`/v1/v1/chat/completions` (404, empty `message_send`).

---

## Install notes

| Concern | Guidance |
| --- | --- |
| Config path | Seed from this directory to host LiteLLM config path (e.g. `/etc/lanyard-agent/litellm/config.yaml` or `$BACKEND_HOME/litellm/config.yaml`). Non-secret; may be world-readable if desired, but prefer service-user only. |
| Secrets | Never embed keys in `config.yaml`. Always `os.environ/…`. |
| Units | Agent + LiteLLM both load `EnvironmentFile=-$BACKEND_HOME/.env.secrets`. |
| Live SM | Omit unused env keys and unused OAuth files. Git templates keep the full matrix with placeholders. |
| Product code | Agent `OAuthStore` + request-time map-to-litellm live in **external** lanyard-agent (`packages/providers`). This monorepo owns platform contracts, seeds, and offline mapping smoke. |

---

## Validation

```bash
bash deploy/scripts/smoke-litellm-multi-slot.sh
# also covered by: bash scripts/validate.sh   # check 24 when present
```
