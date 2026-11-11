# Hermes-Lanyard multi-provider secrets consumption

**Bead:** `lp-645.8.4` · **Epic:** `lp-645.8` · **Parent contract:**
[`backend-runtime-secrets.md`](backend-runtime-secrets.md)

How **Hermes-Lanyard** (and Hermes-compatible `hermes_upstream`) consume
expanded materialize outputs for three concrete configs:

1. **xAI Super Heavy OAuth** (`envelope.oauth.xai-oauth` → `$HERMES_HOME/auth.json`)
2. **OpenAI Codex OAuth** (`envelope.oauth.openai-codex` → same `auth.json`)
3. **Meta (or generic) custom model** (`custom_providers` → `providers.meta` + `key_env`)

This document is **Hermes-only**. Agent / LiteLLM mapping is owned by parallel
work under the same epic (`lp-645.8.5` and cutover `lp-645.8.6`).

**No real secrets.** Every JSON/YAML example below is a placeholder template.

---

## End-to-end path (all three slots)

```text
Operator laptop (offline device-code / key paste)
        │
        ▼
AWS SM SecretString  =  BackendRuntimeSecretsEnvelope
        │
        │  materialize-backend-secrets.py  (host; no browser)
        ▼
$HERMES_HOME/   (= BACKEND_HOME for hermes_* kinds)
  .env.secrets              ← env.*  (API keys, META_API_KEY, …)
  config.secrets.yaml       ← config_secret_overlay + projected custom_providers
  auth.json                 ← structured oauth and/or files[] path_relative=auth.json
  config.yaml               ← public seed (model.provider / model.default) — not from SM
        │
        ▼
hermes-gateway restart  →  Hermes reads env + auth.json + config (not the SM envelope)
```

| Concern | Envelope field | Hermes host file | Hermes runtime selector |
| --- | --- | --- | --- |
| Super Heavy OAuth | `oauth.xai-oauth` (or `files[]` full store) | `$HERMES_HOME/auth.json` → `providers.xai-oauth` | public `model.provider: xai-oauth` |
| Codex OAuth | `oauth.openai-codex` | same `auth.json` → `providers.openai-codex` | public `model.provider: openai-codex` |
| Meta / custom API | `custom_providers[]` + `env.META_API_KEY` | `config.secrets.yaml` `providers.meta` + `.env.secrets` | public `model.provider: meta` (or `custom`) |
| API-key backup | `env.XAI_API_KEY` / `OPENAI_API_KEY` | `.env.secrets` | public `model.provider: xai` / `openai` |

Materialize implementation (already shipped `lp-645.8.3`):
[`deploy/scripts/materialize-backend-secrets.py`](../../deploy/scripts/materialize-backend-secrets.py).

---

## Provider id map (do not confuse Hermes vs Agent)

| Product intent | Hermes `auth.json` / `model.provider` id | Agent OAuthStore id (not this doc) |
| --- | --- | --- |
| xAI Super Heavy / SuperGrok | **`xai-oauth`** | `xai-grok` |
| OpenAI Codex device-code | **`openai-codex`** | `openai-codex` |
| xAI API key | env `XAI_API_KEY` + `model.provider: xai` | same env key |
| OpenAI API key | env `OPENAI_API_KEY` + `model.provider: openai` | same env key |
| Meta OpenAI-compat | `providers.meta` + `META_API_KEY` | LiteLLM `model_list` + env |

Envelope `oauth` keys for Hermes live templates **must** use `xai-oauth` (not
`xai-grok`). Git full-matrix templates may still document both ids for dual-backend
teaching; live Hermes SM should only carry Hermes ids.

---

## 1. xAI Super Heavy OAuth

### Intent

Grok Super Heavy / SuperGrok / X Premium+ subscription path. Preferred mocklab
primary when the Super Heavy account is available.

### Offline export (operator machine — never Terraform)

```bash
# On a laptop/bastion with Hermes CLI and a browser available for device-code:
export HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
hermes auth add xai-oauth --no-browser
# Follow the printed verification URL in a local browser signed into Super Heavy.

# Resulting Hermes auth store (mode 0600):
#   $HERMES_HOME/auth.json
# Shape (illustrative — do not commit real tokens):
# {
#   "providers": {
#     "xai-oauth": {
#       "access_token": "…",
#       "refresh_token": "…",
#       "expires_at": "…"
#     }
#   }
# }
```

### Envelope options

**A — Structured oauth (recommended for single-provider inject)**

```json
{
  "schema_version": 1,
  "kind_hint": "hermes_lanyard",
  "env": {
    "XAI_API_KEY": "sk-placeholder-xai-optional-backup"
  },
  "oauth": {
    "xai-oauth": {
      "access_token": "oauth-placeholder-xai-oauth-access",
      "refresh_token": "oauth-placeholder-xai-oauth-refresh",
      "expires_at": "2026-12-31T00:00:00Z",
      "token_type": "Bearer",
      "metadata": {
        "account_label": "REPLACE_ME_super_heavy_account_label"
      }
    }
  },
  "meta": {
    "tenant_slug": "mocklab",
    "notes": "placeholder Super Heavy template — not live"
  }
}
```

Materialize projects this to:

```json
{
  "providers": {
    "xai-oauth": {
      "access_token": "…",
      "refresh_token": "…",
      "expires_at": "…",
      "token_type": "Bearer",
      "metadata": {
        "account_label": "…"
      }
    }
  }
}
```

written as `$HERMES_HOME/auth.json` mode `0600`.

**B — Opaque `files[]` (recommended when exporting a full multi-provider store)**

```json
{
  "files": [
    {
      "path_relative": "auth.json",
      "encoding": "utf-8",
      "content": "{…full Hermes auth.json text…}",
      "mode": "0600"
    }
  ]
}
```

When both `files[]` `auth.json` **and** structured `oauth` are present,
**opaque `files[]` wins** (materialize does not merge structured tokens into the
exported blob). Prefer one path per put-secret-value.

Committed placeholder: [`secrets-envelope.hermes-super-heavy-oauth.json`](../../contracts/backend-runtime-v1/examples/secrets-envelope.hermes-super-heavy-oauth.json).

### Public config (not SM)

```yaml
# $HERMES_HOME/config.yaml  (or tfvars → seed)
model:
  provider: xai-oauth
  default: grok-3          # operator-confirmed Super Heavy-capable model id
```

Non-secret defaults may also come from Terraform `backend_model_provider` /
`backend_model_default` (mocklab tfvars).

### OAuth vs API key precedence (Hermes)

| Condition | What Hermes uses | Operator rule |
| --- | --- | --- |
| `model.provider: xai-oauth` and `auth.json` has `providers.xai-oauth` | **OAuth** from `auth.json` | Preferred Super Heavy path |
| `model.provider: xai` and `XAI_API_KEY` in env | **API key** from `.env.secrets` | Explicit API-key path |
| Both OAuth material **and** `XAI_API_KEY` present | Selected by **`model.provider`** | Keep OAuth primary: set `model.provider: xai-oauth`. Treat `XAI_API_KEY` as optional backup only (omit live if unused) |
| OAuth present but `model.provider: xai` | API key path | Misconfiguration for Super Heavy — fix public config |
| OAuth missing / 403 on Super Heavy tier | Fall back by setting `model.provider: xai` + real `XAI_API_KEY` | Documented optional backup |

**Platform rule:** when both Super Heavy OAuth and an xAI API key are provisioned,
**prefer OAuth** — set `model.provider: xai-oauth` and do not switch to `xai`
unless OAuth is intentionally retired. Materialize always writes both slots when
present; selection is runtime/config, not materialize.

Refresh: Hermes refreshes access tokens **on the host** using the refresh token
already in `auth.json`. Re-export only when refresh fails or the account rotates.
No browser OAuth inside Terraform.

---

## 2. OpenAI Codex OAuth

### Intent

Optional second account using OpenAI Codex / ChatGPT device-code credentials.
Hermes stores them under the same `auth.json` as Super Heavy (provider id
`openai-codex`).

### Offline export paths

**Path A — Hermes native device-code**

```bash
export HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
hermes auth add openai-codex --no-browser
# Complete device-code in local browser.
```

**Path B — Import from Codex CLI `~/.codex/auth.json`**

Codex CLI (and related tools) may already hold device-code tokens at
`~/.codex/auth.json` on the operator machine. Align with Hermes docs for your
installed Hermes version:

```bash
# Pattern (exact subcommand may vary by Hermes release — confirm with
# `hermes auth --help` on the operator machine):
#
# 1) Prefer Hermes import if available, e.g.:
#    hermes auth import-codex --from ~/.codex/auth.json
# 2) Or complete Hermes device-code (Path A), which writes Hermes-shaped store.
# 3) Always ship the Hermes store ($HERMES_HOME/auth.json), not the raw Codex
#    CLI file, unless materialize files[] content is confirmed Hermes-shaped.

ls -la "${CODEX_HOME:-$HOME/.codex}/auth.json"   # source only; never commit
ls -la "${HERMES_HOME:-$HOME/.hermes}/auth.json" # Hermes-shaped export target
```

**Always inject Hermes-shaped `auth.json`** into SM (via structured `oauth` or
`files[]`). Do not put the Codex CLI file under `$HERMES_HOME` unless its schema
matches Hermes `{"providers":{…}}`.

### Envelope (structured)

```json
{
  "schema_version": 1,
  "kind_hint": "hermes_lanyard",
  "env": {
    "OPENAI_API_KEY": "sk-placeholder-openai-optional-backup"
  },
  "oauth": {
    "openai-codex": {
      "access_token": "oauth-placeholder-openai-codex-access",
      "refresh_token": "oauth-placeholder-openai-codex-refresh",
      "expires_at": "2026-12-31T00:00:00Z",
      "metadata": {
        "account_label": "REPLACE_ME_codex_account_label",
        "chatgpt_account_id": "REPLACE_ME_chatgpt_account_id"
      }
    }
  }
}
```

`metadata.chatgpt_account_id` maps to the ChatGPT-Account-Id header Hermes/Agent
expect for Codex. Include it when the export provides one.

Committed placeholder: [`secrets-envelope.hermes-codex-oauth.json`](../../contracts/backend-runtime-v1/examples/secrets-envelope.hermes-codex-oauth.json).

Combined Super Heavy + Codex placeholder auth store shape:
[`hermes-auth.placeholder.json`](../../contracts/backend-runtime-v1/examples/hermes-auth.placeholder.json).

### Public config

```yaml
model:
  provider: openai-codex
  default: gpt-4.1          # operator-confirmed Codex-capable model id
```

### OAuth vs API key precedence (Codex / OpenAI)

Same rule as Super Heavy:

| Primary path | `model.provider` | Credential source |
| --- | --- | --- |
| Codex OAuth (preferred when using subscription) | `openai-codex` | `auth.json` → `providers.openai-codex` |
| OpenAI API key | `openai` | `OPENAI_API_KEY` in `.env.secrets` |

When both are present, **prefer OAuth** by keeping `model.provider: openai-codex`.

---

## 3. Meta custom model (`custom_providers` → `providers.meta`)

### Intent

Any OpenAI-compatible endpoint (Meta Llama API, corp proxy, etc.) selected as a
named Hermes provider. Teaching case id: **`meta`**.

### Envelope

```json
{
  "schema_version": 1,
  "kind_hint": "hermes_lanyard",
  "env": {
    "META_API_KEY": "sk-placeholder-meta-replace-me"
  },
  "custom_providers": [
    {
      "id": "meta",
      "base_url": "https://api.llama.com/compat/v1",
      "api_key_env": "META_API_KEY",
      "default_model": "llama-3.1-405b",
      "models": ["llama-3.1-405b", "llama-3.1-70b"],
      "api_mode": "chat_completions"
    }
  ],
  "config_secret_overlay": {
    "providers": {
      "meta": {
        "base_url": "https://api.llama.com/compat/v1",
        "key_env": "META_API_KEY"
      }
    }
  }
}
```

Prefer **`api_key_env` / `key_env`** so the secret value lives only under `env`
→ `.env.secrets`. Inline `api_key` in YAML is discouraged.

### Materialize projection (Hermes)

`project_custom_providers` writes `$HERMES_HOME/config.secrets.yaml` (mode `0600`)
roughly:

```yaml
# Managed by materialize-backend-secrets — secret-bearing overlay only.
providers:
  meta:
    base_url: https://api.llama.com/compat/v1
    key_env: META_API_KEY
    default_model: llama-3.1-405b
    models:
      - llama-3.1-405b
      - llama-3.1-70b
    api_mode: chat_completions
custom_providers:
  - name: meta
    base_url: https://api.llama.com/compat/v1
    key_env: META_API_KEY
```

and `.env.secrets` contains:

```text
META_API_KEY=…
```

Hermes merges `config.secrets.yaml` (or operators merge secret keys into
`config.yaml` under documented host practice). The process env must include
`.env.secrets` via unit `EnvironmentFile` so `key_env` resolves.

Committed placeholder: [`secrets-envelope.hermes-meta-custom.json`](../../contracts/backend-runtime-v1/examples/secrets-envelope.hermes-meta-custom.json).

### Public config seed

Non-secret base URL / model ids may live in public `config.yaml` even when the
overlay also carries them:

```yaml
# See also hermes-lanyard-multi-provider.config.yaml
model:
  provider: meta
  default: llama-3.1-405b
providers:
  meta:
    base_url: https://api.llama.com/compat/v1
    key_env: META_API_KEY
```

Selectable as `model.provider: meta` (named map form). Some Hermes builds also
accept `model.provider: custom` with an inline `base_url`; platform templates
prefer the **named** `providers.meta` form so multi-entry lists stay clear.

### Multi-entry note

Operators may add N custom providers (`corp-proxy`, second Meta region, …).
Envelope `custom_providers[]` is ordered; materialize projects each `id` to
`providers.<id>`. Env key names must match `^[A-Za-z_][A-Za-z0-9_]*$`.

---

## Combined public config seed (non-secret)

Teaching file (no secrets):
[`hermes-lanyard-multi-provider.config.yaml`](../../contracts/backend-runtime-v1/examples/hermes-lanyard-multi-provider.config.yaml).

Switch the active path by changing **only** `model.provider` / `model.default`
(and ensuring the corresponding SM slots are live):

| Active path | `model.provider` | Required SM slots |
| --- | --- | --- |
| Super Heavy | `xai-oauth` | `oauth.xai-oauth` (or files auth.json) |
| Codex | `openai-codex` | `oauth.openai-codex` |
| Meta | `meta` | `env.META_API_KEY` + `custom_providers` / overlay |
| xAI API key backup | `xai` | `env.XAI_API_KEY` |
| OpenAI API key backup | `openai` | `env.OPENAI_API_KEY` |

---

## Offline verification (no AWS, no real secrets)

From monorepo root. Uses placeholder fixtures only.

### 1. Schema + placeholder policy

```bash
python3 scripts/validate-secrets-envelope.py
# also covered by: bash scripts/validate.sh   # check 22
```

### 2. Materialize Super Heavy → auth.json

```bash
TMP=$(mktemp -d)
python3 deploy/scripts/materialize-backend-secrets.py \
  --from-file contracts/backend-runtime-v1/examples/secrets-envelope.hermes-super-heavy-oauth.json \
  --backend-home "$TMP" \
  --backend-kind hermes_lanyard

# Expect:
test -f "$TMP/auth.json"
python3 - <<PY
import json
from pathlib import Path
p = Path("$TMP/auth.json")
data = json.loads(p.read_text())
assert "xai-oauth" in data["providers"]
assert "access_token" in data["providers"]["xai-oauth"]
print("ok super-heavy auth.json providers:", sorted(data["providers"]))
PY
stat -c '%a' "$TMP/auth.json"   # expect 600
rm -rf "$TMP"
```

### 3. Materialize Codex → auth.json

```bash
TMP=$(mktemp -d)
python3 deploy/scripts/materialize-backend-secrets.py \
  --from-file contracts/backend-runtime-v1/examples/secrets-envelope.hermes-codex-oauth.json \
  --backend-home "$TMP" \
  --backend-kind hermes_lanyard

python3 - <<PY
import json
from pathlib import Path
data = json.loads(Path("$TMP/auth.json").read_text())
assert "openai-codex" in data["providers"]
md = data["providers"]["openai-codex"].get("metadata") or {}
assert "chatgpt_account_id" in md
print("ok codex auth.json + chatgpt_account_id")
PY
rm -rf "$TMP"
```

### 4. Materialize Meta → config.secrets.yaml + env

```bash
TMP=$(mktemp -d)
python3 deploy/scripts/materialize-backend-secrets.py \
  --from-file contracts/backend-runtime-v1/examples/secrets-envelope.hermes-meta-custom.json \
  --backend-home "$TMP" \
  --backend-kind hermes_lanyard

grep -q '^META_API_KEY=' "$TMP/.env.secrets"
grep -q 'key_env' "$TMP/config.secrets.yaml"
grep -q 'meta' "$TMP/config.secrets.yaml"
# Prefer key_env over inline api_key:
! grep -qE 'api_key:\s*sk-' "$TMP/config.secrets.yaml"
echo "ok meta providers projection"
rm -rf "$TMP"
```

### 5. Combined Hermes fixture (existing)

```bash
bash deploy/scripts/smoke-materialize-backend-secrets.sh
# Hermes fixture asserts auth.json has xai-oauth + openai-codex and
# config.secrets.yaml projects META_API_KEY via key_env.
```

### 6. Live host checks (when SM is filled — human-approved only)

Do **not** run against production without approval. After put-secret-value +
materialize + gateway restart:

```bash
# On host (SSM). Paths assume mocklab Hermes home.
HERMES_HOME="${HERMES_HOME:-/home/hermes/.hermes}"

# Files present, owner-only:
sudo -u hermes test -f "$HERMES_HOME/auth.json" && sudo -u hermes stat -c '%a' "$HERMES_HOME/auth.json"
sudo -u hermes test -f "$HERMES_HOME/.env.secrets" && sudo -u hermes stat -c '%a' "$HERMES_HOME/.env.secrets"
# Optional custom providers:
sudo -u hermes test -f "$HERMES_HOME/config.secrets.yaml" || true

# Provider ids present in auth store (names only — do not cat tokens):
sudo -u hermes python3 - <<'PY'
import json, os
home = os.environ.get("HERMES_HOME", "/home/hermes/.hermes")
with open(f"{home}/auth.json", encoding="utf-8") as f:
    data = json.load(f)
print("auth providers:", sorted((data.get("providers") or {}).keys()))
PY

# Hermes model list / chat (exact CLI may vary by pin):
sudo -u hermes hermes model list 2>/dev/null || true
# Or gateway chat: prove one completion with model.provider set to the active path.

sudo systemctl restart hermes-gateway   # only after materialize + human OK
```

Live success criteria:

- [ ] `auth.json` lists `xai-oauth` and/or `openai-codex` when those SM slots are active
- [ ] `.env.secrets` has `META_API_KEY` when Meta is active (value never logged)
- [ ] `config.secrets.yaml` (or merged config) has `providers.meta.key_env: META_API_KEY`
- [ ] `hermes model list` or a chat turn shows the selected provider when live
- [ ] No placeholder sentinels left in live SM for call-path credentials

---

## Operator put-secret-value sketch (placeholders)

Private local file only; shred after put. Full mocklab cutover sequence remains
[`deploy/deployments/mocklab/CUTOVER-backend-runtime-secrets.md`](../../deploy/deployments/mocklab/CUTOVER-backend-runtime-secrets.md)
(expanded matrix cutover: `lp-645.8.6`).

```bash
# Private path outside git:
cat > /tmp/hermes-runtime-secrets.json <<'EOF'
{
  "schema_version": 1,
  "kind_hint": "hermes_lanyard",
  "env": {
    "META_API_KEY": "sk-placeholder-meta-replace-me"
  },
  "oauth": {
    "xai-oauth": {
      "access_token": "oauth-placeholder-xai-oauth-access",
      "refresh_token": "oauth-placeholder-xai-oauth-refresh",
      "expires_at": "2026-12-31T00:00:00Z"
    }
  },
  "custom_providers": [
    {
      "id": "meta",
      "base_url": "https://api.llama.com/compat/v1",
      "api_key_env": "META_API_KEY",
      "default_model": "llama-3.1-405b"
    }
  ],
  "meta": { "tenant_slug": "mocklab", "notes": "replace placeholders before put" }
}
EOF
chmod 600 /tmp/hermes-runtime-secrets.json
# Replace placeholders with real offline-exported values, then:
# aws secretsmanager put-secret-value --secret-id "…" --secret-string file:///tmp/hermes-runtime-secrets.json
# shred -u /tmp/hermes-runtime-secrets.json
```

Live SM policy: **omit** unused slots entirely; never ship `oauth-placeholder-…`
or empty strings for active call-path keys.

---

## Related documents

| Doc | Role |
| --- | --- |
| [`backend-runtime-secrets.md`](backend-runtime-secrets.md) | Normative envelope → host mapping (all kinds) |
| [`phase-6-multi-provider-secrets-matrix.md`](../plans/0002-backend-runtime-secrets-aws-sm/phase-6-multi-provider-secrets-matrix.md) | Credential matrix plan |
| [`secrets-envelope.schema.json`](../../contracts/backend-runtime-v1/secrets-envelope.schema.json) | Machine schema |
| [`materialize-backend-secrets.py`](../../deploy/scripts/materialize-backend-secrets.py) | Host writer |
| [`CUTOVER-backend-runtime-secrets.md`](../../deploy/deployments/mocklab/CUTOVER-backend-runtime-secrets.md) | Mocklab live cutover (full matrix: lp-645.8.6) |
| [`docs/runbooks/backend-runtime-secrets.md`](../runbooks/backend-runtime-secrets.md) | Create / rotate / revoke / clone (OAuth + custom) |
| [`lanyard-agent-multi-provider-secrets.md`](lanyard-agent-multi-provider-secrets.md) | Agent / LiteLLM peer (lp-645.8.5) |

## Explicit non-goals (this bead)

| Non-goal | Owner |
| --- | --- |
| LiteLLM / Agent oauth.enc mapping docs | `lp-645.8.5` (done) |
| Full mocklab CUTOVER rewrite for entire provider matrix | `lp-645.8.6` (CUTOVER + runbook) |
| Hermes product code change | Not required — materialize matches existing Hermes `auth.json` + `providers.*` layout |
| Real secret values in git | Forbidden |
