# Phase 1. Envelope contract

Back to [overview](overview.md).

## Goal

Define a backend-neutral Secrets Manager JSON envelope and how each backend kind maps it onto env files and config.

## Data shapes

### `BackendRuntimeSecretsEnvelope` (SM `SecretString` JSON)

```json
{
  "schema_version": 1,
  "kind_hint": "hermes_lanyard",
  "env": {
    "OPENAI_API_KEY": "…",
    "XAI_API_KEY": "…",
    "ANTHROPIC_API_KEY": "…"
  },
  "config_secret_overlay": {
    "mcp_servers": {
      "some_integration": {
        "auth": "…"
      }
    }
  },
  "meta": {
    "tenant_slug": "mocklab",
    "rotated_at": "2026-07-20T00:00:00Z"
  }
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `schema_version` | yes | integer `1` for v1 |
| `env` | yes | object of string → string; keys are process env names backends already understand |
| `config_secret_overlay` | no | deep-merge target for secret-bearing config only (never put non-secrets only here) |
| `kind_hint` | no | documentation / validation hint; materialize must not refuse other kinds |
| `meta` | no | non-authoritative operator metadata |

### Non-secret companion (Terraform / pin / public config seed)

Not in SM:

- `model.provider` display name / default model id  
- feature flags, path layouts, relay non-secret ids  

Those stay in tfvars, pins, or public `config.yaml` seeds.

### Backend mapping (v1)

| Backend kind | Env target | Config overlay target | Unit EnvironmentFile |
| --- | --- | --- | --- |
| `hermes_lanyard` | `$HERMES_HOME/.env.secrets` (merged or included) | `$HERMES_HOME/config.secrets.yaml` or managed merge into `config.yaml` **secret keys only** | existing `EnvironmentFile=-$HERMES_HOME/.env` must include secrets (merge into `.env` or add second EnvironmentFile) |
| `hermes_upstream` | same Hermes home layout | same | same |
| `lanyard_agent` | `$BACKEND_HOME/.env.secrets` or Agent-documented path | Agent config secret overlay path (document; implement when Agent conforms) | generic backend unit |

## Changes

- `contracts/backend-runtime-v1/secrets-envelope.schema.json`
- Examples under `contracts/backend-runtime-v1/examples/` (**no real keys**; placeholders)
- `docs/architecture/backend-runtime-secrets.md` (normative)
- Update `contracts/backend-runtime-v1/README.md` and filesystem-layout notes for secret file names

## Verification

- Schema rejects missing `schema_version` / non-object `env`
- Placeholder examples validate
- Offline validator wired into `scripts/validate.sh` (or sibling script)
- Mapping table reviewed for Hermes-Lanyard mocklab paths (`/home/hermes/.hermes`)

## Beads

Implementable leaf under epic phase 1.
