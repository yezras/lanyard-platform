# Local Muse Spark — LiteLLM provider contract

**Bead:** `lp-k5c4.17`  
**Offline smoke:** `bash deploy/scripts/smoke-localhost-muse-spark-provider.sh`  
**Live turn (operator machine, keys present):** `LIVE=1 bash deploy/scripts/prove-localhost-muse-spark-turn.sh`

Localhost QA adapter for Lanyard Agent `createEnvLiteLlmTurnRunner`. This is **not** a Portal/BFF gateway. BFF still talks only to harness HTTP (`POST /internal/turns`). Do not add Meta-specific fetch in Portal BFF.

## Why not `metaComplete()`

The lp-k5c4.13 local wrapper (`/tmp/lp-k5c4.13-serve-la.mjs`) forked `POST https://api.meta.ai/v1/chat/completions` because:

```
LITELLM_BASE_URL=https://api.meta.ai/v1
+ LiteLlmClient path /v1/chat/completions
= https://api.meta.ai/v1/v1/chat/completions  → 404, empty turns
```

The client already POSTs `{baseUrl}/v1/chat/completions`. The contract is the env, not a one-off fetch.

## Env (names only)

Keep real keys in `~/.lanyard-agent/meta.env` (mode `600`), not `meta.env.example`.

| Name | Value |
|------|--------|
| `LITELLM_BASE_URL` | `https://api.meta.ai` (**no** trailing `/v1`; not `https://api.meta.ai/v1`) |
| `LITELLM_API_KEY` | Meta Model API key (`META_API_KEY` is copied when this is unset) |
| `HARNESS_MODEL` | `muse-spark-1.2-contributor` |

`serve-la.mjs` strips a trailing `/v1` if someone still exports the wrong base. Optional `reasoning_effort` belongs on the lanyard-agent `LiteLlmClient` / `CompletionRequest` — never as a forked `complete()`.

## Start (LiteLLM client only)

```bash
export LANYARD_AGENT_ROOT=/path/to/lanyard-agent   # built adapters-portal dist
set -a
# shellcheck disable=SC1090
source ~/.lanyard-agent/meta.env
set +a
chmod 600 ~/.lanyard-agent/meta.env
node deploy/dev/localhost-muse-spark/serve-la.mjs
# listens 127.0.0.1:4310  kind=createHarnessTurnServer runner=litellm
```

Point local BFF at `HARNESS_URL=http://127.0.0.1:4310` and the same service token. Do not set `CHAT_DELIVERY=harness` globally.

## Files

| File | Role |
|------|------|
| `litellm-base-url.mjs` | Normalize `https://api.meta.ai` (strip `/v1`); bind factory without `complete` |
| `serve-la.mjs` | `createEnvLiteLlmTurnRunner` + `createHarnessTurnServer` |
| `meta.env.example` | Placeholders only |
| `*.test.mjs` | Offline node:test |

Fargate `start-la-harness.mjs` already binds LiteLLM without a custom `complete`. This directory is the localhost replacement for the deleted `/tmp` wrapper.
