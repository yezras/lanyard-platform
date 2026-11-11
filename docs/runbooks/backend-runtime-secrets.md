# Runbook: backend runtime secrets (AWS SM)

**Bead:** `lp-645.7` · **Multi-provider expand:** `lp-645.8.6` · **Epic:** `lp-645`  
**Plan:** [`docs/plans/0002-backend-runtime-secrets-aws-sm/phase-5-runbooks.md`](../plans/0002-backend-runtime-secrets-aws-sm/phase-5-runbooks.md)

Operator lifecycle for **BackendRuntimeSecretsEnvelope**: create, wire ARN,
materialize, rotate, revoke, and clone a tenant from mocklab. Covers **API keys**,
**OAuth** (Super Heavy / Codex), and **custom providers** (e.g. Meta) — not
API-key-only.

| Surface | Canonical path / name |
| --- | --- |
| Envelope schema | [`contracts/backend-runtime-v1/secrets-envelope.schema.json`](../../contracts/backend-runtime-v1/secrets-envelope.schema.json) |
| Architecture map | [`docs/architecture/backend-runtime-secrets.md`](../architecture/backend-runtime-secrets.md) |
| Hermes multi-provider | [`docs/architecture/hermes-multi-provider-secrets.md`](../architecture/hermes-multi-provider-secrets.md) |
| Agent / LiteLLM multi-provider | [`docs/architecture/lanyard-agent-multi-provider-secrets.md`](../architecture/lanyard-agent-multi-provider-secrets.md) |
| Mocklab live cutover | [`deploy/deployments/mocklab/CUTOVER-backend-runtime-secrets.md`](../../deploy/deployments/mocklab/CUTOVER-backend-runtime-secrets.md) |
| Materialize | [`deploy/scripts/materialize-backend-secrets.py`](../../deploy/scripts/materialize-backend-secrets.py) (host: `/usr/local/sbin/materialize-backend-secrets`) |
| SM name convention | `/company-brain/<tenant>/backend-runtime-secrets` |

**Do not** put secret values in git, tfvars, Terraform state, CI logs, or bead
notes. Evidence is key **names**, provider **ids**, unit state, and product
outcome only. Live SM / apply / SSM against production requires explicit human
approval.

---

## Credential slots (operator matrix)

| Slot | Envelope | Hermes host | Agent / LiteLLM host |
| --- | --- | --- | --- |
| API keys | `env.OPENAI_API_KEY`, `XAI_API_KEY`, … | `$HERMES_HOME/.env.secrets` | `$BACKEND_HOME/.env.secrets` |
| Super Heavy OAuth | `oauth.xai-oauth` or `files[]` `auth.json` | `$HERMES_HOME/auth.json` → `providers.xai-oauth` | Agent id `xai-grok` → `oauth.enc` + `LANYARD_OAUTH_KEY` |
| Codex OAuth | `oauth.openai-codex` | same `auth.json` → `providers.openai-codex` | same store, provider `openai-codex` |
| Custom / Meta | `custom_providers[]` + `env.<KEY>` | `config.secrets.yaml` + `.env.secrets` | LiteLLM `model_list` `api_base` + env key |
| LiteLLM master | `env.LITELLM_MASTER_KEY` | N/A (Hermes) | required when Agent+LiteLLM runs |

**Provider id map (do not confuse):** Hermes Super Heavy = `xai-oauth`; Agent =
`xai-grok`. Codex id is `openai-codex` on both.

### Placeholder policy

| Layer | Policy |
| --- | --- |
| Git / templates | Full matrix OK with `sk-placeholder-…`, `REPLACE_ME…`, `oauth-placeholder-…` |
| Live SM | **Omit** unused slots entirely; never empty-string call-path keys; never ship git sentinels |
| Optional backups | If OAuth is primary, omit unused API keys or use real keys only |

Schema note: `x-lanyard-placeholder-policy` on the envelope schema.  
Teaching fixtures: `contracts/backend-runtime-v1/examples/secrets-envelope.*.json`.

### Non-secret companions (tfvars / public config)

| Slot | Example values | Owner |
| --- | --- | --- |
| Default provider id | `xai-oauth`, `openai-codex`, `meta`, `xai`, `openai` | `backend_model_provider` / `model.provider` |
| Default model id | `grok-3`, `gpt-4.1`, `llama-3.1-405b` | `backend_model_default` / `model.default` |
| Custom base URL (non-secret) | `https://api.llama.com/compat/v1` | public config / LiteLLM seed |

When OAuth material and an API key are both present, **prefer OAuth** by setting
`model.provider` / `backend_model_provider` to `xai-oauth` or `openai-codex`.

---

## Preconditions

1. AWS credentials for the tenant account (e.g. `AWS_PROFILE=lanyard-main` for mocklab).
2. Offline credential material for the slots you will activate (API keys and/or
   completed device-code OAuth export). **No browser OAuth in Terraform.**
3. Tenant Terraform root (mocklab or clone) with `backend_runtime_secrets_*`
   passthrough into `company-brain-ec2`.
4. Private (gitignored) `backend.tf` + `terraform.tfvars`.
5. Instance id for SSM (no interactive SSH required).

---

## 1. Create secret (shell + first value)

### 1.1 Secret shell (name only)

```bash
export AWS_PROFILE=lanyard-main   # or tenant profile
export AWS_REGION=us-east-1

TENANT=mocklab   # replace for clones
SECRET_NAME="/company-brain/${TENANT}/backend-runtime-secrets"

aws secretsmanager create-secret \
  --name "$SECRET_NAME" \
  --description "BackendRuntimeSecretsEnvelope for ${TENANT}" \
  --tags Key=tenant,Value="$TENANT" Key=purpose,Value=backend-runtime-secrets
```

Capture the returned **ARN** (includes random suffix). If the shell exists, use
`describe-secret` and skip create.

### 1.2 Offline OAuth export (when using Super Heavy / Codex)

**Hermes** (mocklab default):

```bash
export HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
hermes auth add xai-oauth --no-browser          # Super Heavy
hermes auth add openai-codex --no-browser       # optional Codex
# Or import Codex CLI ~/.codex/auth.json into Hermes-shaped auth.json
# Always put Hermes store shape into SM (structured oauth or files[]).
```

**Agent** (when backend kind is `lanyard_agent`): export encrypted `oauth.enc` +
set `LANYARD_OAUTH_KEY` in envelope `env`. See
[`lanyard-agent-multi-provider-secrets.md`](../architecture/lanyard-agent-multi-provider-secrets.md).

### 1.3 Put envelope value (active slots only)

Write a **private** local file (not under the repo), mode `600`. Shape examples
(placeholders only — replace before put):

**API-key-only:**

```json
{
  "schema_version": 1,
  "kind_hint": "hermes_lanyard",
  "env": {
    "OPENAI_API_KEY": "sk-placeholder-openai-replace-me"
  },
  "meta": { "tenant_slug": "mocklab", "rotated_at": "YYYY-MM-DDTHH:MM:SSZ" }
}
```

**Super Heavy OAuth (preferred mocklab primary):**

```json
{
  "schema_version": 1,
  "kind_hint": "hermes_lanyard",
  "env": {},
  "oauth": {
    "xai-oauth": {
      "access_token": "oauth-placeholder-xai-oauth-access",
      "refresh_token": "oauth-placeholder-xai-oauth-refresh",
      "expires_at": "2026-12-31T00:00:00Z",
      "token_type": "Bearer"
    }
  },
  "meta": { "tenant_slug": "mocklab" }
}
```

**Codex OAuth:** use `oauth.openai-codex` (include `metadata.chatgpt_account_id`
when available).

**Meta custom:**

```json
{
  "schema_version": 1,
  "kind_hint": "hermes_lanyard",
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

Prefer `api_key_env` / `key_env` over inline `api_key`. Opaque multi-provider
Hermes store: `files[]` with `path_relative: auth.json` (wins over structured
`oauth` when both present).

```bash
chmod 600 /tmp/tenant-backend-runtime-secrets.json
# python3 scripts/validate-secrets-envelope.py --file /tmp/tenant-backend-runtime-secrets.json

aws secretsmanager put-secret-value \
  --secret-id "$SECRET_NAME" \
  --secret-string file:///tmp/tenant-backend-runtime-secrets.json

shred -u /tmp/tenant-backend-runtime-secrets.json 2>/dev/null \
  || rm -f /tmp/tenant-backend-runtime-secrets.json
```

---

## 2. Wire ARN in tenant tfvars

Private `terraform.tfvars` (gitignored) only:

```hcl
backend_runtime_secrets_arn     = "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:company-brain/TENANT/backend-runtime-secrets-AbCdEf"
backend_runtime_secrets_enabled = true
# backend_runtime_secrets_region  = "us-east-1"

# Non-secret model defaults — match the active SM slot:
backend_model_provider = "xai-oauth"   # or openai-codex | meta | xai | openai | …
backend_model_default  = "grok-3"
```

Never put envelope JSON, tokens, or API keys in tfvars. Committed shape notes:
[`deploy/deployments/mocklab/terraform.tfvars.example`](../../deploy/deployments/mocklab/terraform.tfvars.example).

Relay secret remains **separate** (`relay_secret_*` / SSM) — do not merge into
this envelope unless you intentionally co-materialize `GATEWAY_RELAY_SECRET`.

---

## 3. Apply / bootstrap / materialize

```bash
cd deploy/deployments/<tenant>   # e.g. mocklab
terraform init
terraform validate
terraform plan -out=tfplan
# Human review: IAM GetSecretValue on the ARN only.
# terraform apply tfplan   # after approval
```

One-shot force on an already-running host (SSM, replace `i-INSTANCE`):

```bash
aws ssm send-command \
  --instance-ids "i-INSTANCE" \
  --document-name "AWS-RunShellScript" \
  --comment "backend-runtime-secrets materialize + restart" \
  --parameters 'commands=["set -euo pipefail","test -x /usr/local/sbin/materialize-backend-secrets","sudo /usr/local/sbin/materialize-backend-secrets","sudo systemctl restart hermes-gateway || sudo systemctl restart company-brain-backend","sudo systemctl is-active hermes-gateway company-brain-backend 2>/dev/null || true"]'
```

Steady state: reboot / `ExecStartPre` re-runs materialize.

**Hermes units:** restart `hermes-gateway` (mocklab).  
**Agent units:** restart `company-brain-backend` and LiteLLM unit when present
(both must load `$BACKEND_HOME/.env.secrets`).

---

## 4. Rotate (new SM version → materialize → restart)

Use this for API key rotation, OAuth re-export, custom provider key change, or
slot set change.

### 4.1 Capture rollback evidence (always)

Record **before** put-secret-value (ticket / private notes — no secret values):

| Item | How |
| --- | --- |
| SM version id | `aws secretsmanager describe-secret --secret-id …` → `VersionIdsToStages` |
| Active slots | list of env key **names**, oauth provider **ids**, custom provider **ids** |
| Non-secret pins | `backend_model_provider`, `backend_model_default`, backend artifact pins |
| Host prove baseline | unit active; Portal/chat outcome |

### 4.2 Build next envelope version

1. Start from the **previous private** envelope (or re-export OAuth offline).
2. Update only the slots that change.
3. **Omit** slots you are retiring (do not leave empty strings or placeholders).
4. For OAuth: re-run device-code only when refresh failed or the account rotated;
   otherwise keep existing refresh material and let the host refresh.
5. Validate offline; put-secret-value; shred local file.

### 4.3 Materialize + restart

Same SSM command as §3. Materialize **rewrites** managed files from the new
version (idempotent):

| Slot change | Host effect |
| --- | --- |
| Env key added/changed | `.env.secrets` rewritten with new set |
| Env key removed | key disappears from managed `.env.secrets` |
| OAuth providers changed | Hermes `auth.json` / Agent `oauth.enc` rewritten |
| Custom providers changed | `config.secrets.yaml` projection updated |

### 4.4 Prove (names / ids only)

Hermes home example (`HERMES_HOME` often `/home/hermes/.hermes`):

```bash
# Via SSM — never cat secret values into logs
HERMES_HOME=/home/hermes/.hermes
# env key names:
sudo awk -F= '/^[^#]/ {print $1}' "$HERMES_HOME/.env.secrets" 2>/dev/null || true
# oauth provider ids:
sudo -u hermes python3 -c "import json; d=json.load(open('$HERMES_HOME/auth.json')); print(sorted((d.get('providers') or {})))" 2>/dev/null || true
# custom providers file present?
ls -la "$HERMES_HOME/config.secrets.yaml" 2>/dev/null || true
sudo systemctl is-active hermes-gateway
```

Pass: expected names/ids present; unit active; product chat or Settings OK;
no placeholder sentinels on live call paths.

### 4.5 Rollback rotate

1. `put-secret-value` previous known-good JSON (from private offline backup) **or**
   AWSM version restore if your org process allows staging a prior version.
2. Materialize + restart.
3. Re-prove §4.4.

---

## 5. Revoke

### 5.1 Revoke a single slot

1. Put a new envelope version **without** that env key / oauth provider / custom
   provider entry.
2. Materialize + restart.
3. Confirm host file no longer lists the key name or provider id.
4. Invalidate the upstream credential out-of-band (provider console) when required.

### 5.2 Revoke entire backend-runtime secret

1. Disable or delete the SM secret **after** capturing whether any other system
   still references the ARN (usually only this tenant).
2. Clear private tfvars ARN / set `backend_runtime_secrets_enabled = false` and
   plan carefully (may remove IAM GetSecretValue).
3. On host: materialize will fail closed without ARN — or manually remove managed
   secret files and restart so the product no longer presents a connected model.

Prefer slot-level revoke when the tenant still needs other providers.

---

## 6. Tenant clone checklist (from mocklab)

| Step | Action | Notes |
| --- | --- | --- |
| 1 | Copy tenant root from `deploy/templates/tenant/` (or mocklab shape) | Live `backend.tf` / `terraform.tfvars` stay private |
| 2 | New SM path `/company-brain/<tenant>/backend-runtime-secrets` | **New** secret shell + value — never copy another tenant's SecretString into git |
| 3 | Export OAuth **per tenant account** offline if Super Heavy/Codex apply | Do not reuse another tenant's tokens |
| 4 | Put envelope with **only** that tenant's active slots | Placeholder policy: no sentinels live |
| 5 | Private tfvars: new ARN + non-secret `backend_model_*` | Match active SM slot |
| 6 | Keep **relay** secret separate | `relay_secret_*` / SSM path per tenant |
| 7 | `terraform plan` / apply (human-approved) | IAM GetSecretValue on new ARN only |
| 8 | Bootstrap / materialize / restart | Same as mocklab cutover §5 |
| 9 | Prove names/ids + product | Same as §4.4 |
| 10 | Offline validate still green in monorepo | `python3 scripts/validate-secrets-envelope.py` |

Mocklab operator sequence (step-by-step SSM templates):  
[`CUTOVER-backend-runtime-secrets.md`](../../deploy/deployments/mocklab/CUTOVER-backend-runtime-secrets.md).

---

## 7. Incident: materialize failed / gateway down

| Symptom | Likely cause | Operator action |
| --- | --- | --- |
| Materialize non-zero | Bad envelope JSON / schema | Fix private envelope; validate offline; put new version |
| Materialize non-zero | IAM / wrong ARN / region | Check instance role GetSecretValue; tfvars ARN; `BACKEND_RUNTIME_SECRETS_*` host env |
| Materialize non-zero | Agent OAuth without `oauth.enc` | For `lanyard_agent`, structured oauth without `files[] oauth.enc` fails closed — ship encrypted store |
| Gateway active but no provider | Public `model.provider` mismatches SM slots | Align `backend_model_provider` with live oauth/env |
| Gateway active but 401/403 | Stale OAuth or bad key | Re-export OAuth offline or rotate API key; put; materialize; restart |
| Gateway down after restart | Unrelated unit / pin failure | See [`backend-upgrade-rollback.md`](backend-upgrade-rollback.md); restore previous SM version if secrets-related |

Do not paste SM SecretString or host secret file contents into tickets. Attach
**names**, exit codes, and unit status only.

---

## 8. Offline verification (no AWS, no real secrets)

```bash
# From monorepo root
python3 scripts/validate-secrets-envelope.py
bash deploy/scripts/smoke-materialize-backend-secrets.sh
# Hermes path fixtures (lp-645.8.4):
#   contracts/backend-runtime-v1/examples/secrets-envelope.hermes-super-heavy-oauth.json
#   contracts/backend-runtime-v1/examples/secrets-envelope.hermes-codex-oauth.json
#   contracts/backend-runtime-v1/examples/secrets-envelope.hermes-meta-custom.json
# Agent / LiteLLM (lp-645.8.5):
bash deploy/scripts/smoke-litellm-multi-slot.sh
python3 deploy/scripts/map-oauth-to-litellm.py --self-test
bash scripts/validate.sh
```

---

## Related documents

| Doc | Role |
| --- | --- |
| [`backend-runtime-secrets.md`](../architecture/backend-runtime-secrets.md) | Normative envelope → host mapping |
| [`hermes-multi-provider-secrets.md`](../architecture/hermes-multi-provider-secrets.md) | Hermes Super Heavy / Codex / Meta |
| [`lanyard-agent-multi-provider-secrets.md`](../architecture/lanyard-agent-multi-provider-secrets.md) | Agent OAuthStore + LiteLLM |
| [`phase-5-runbooks.md`](../plans/0002-backend-runtime-secrets-aws-sm/phase-5-runbooks.md) | Phase plan for this runbook |
| [`phase-6-multi-provider-secrets-matrix.md`](../plans/0002-backend-runtime-secrets-aws-sm/phase-6-multi-provider-secrets-matrix.md) | Credential matrix decisions |
| [`CUTOVER-backend-runtime-secrets.md`](../../deploy/deployments/mocklab/CUTOVER-backend-runtime-secrets.md) | Mocklab live sequence |
| [`deploy/deployments/mocklab/INDEX.md`](../../deploy/deployments/mocklab/INDEX.md) | Mocklab operator index |
| [`backend-upgrade-rollback.md`](backend-upgrade-rollback.md) | Artifact pin swap (separate from secrets) |
