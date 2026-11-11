# Cutover checklist: mocklab backend runtime secrets (AWS SM)

**Bead:** `lp-645.6` · **Epic:** `lp-645` · **Multi-provider expansion:** `lp-645.8.6`  
**Plan:** `docs/plans/0002-backend-runtime-secrets-aws-sm/phase-4-mocklab-live.md`  
**Matrix plan:** `docs/plans/0002-backend-runtime-secrets-aws-sm/phase-6-multi-provider-secrets-matrix.md`

Operator sequence to put **BackendRuntimeSecretsEnvelope** in Secrets Manager,
wire the ARN through monorepo mocklab Terraform, materialize on the instance
(SSM only — no interactive SSH), restart the gateway, and prove a provider.

Cutover is **not API-key-only**. The same envelope may carry:

| Slot | Envelope | Host (Hermes mocklab) |
| --- | --- | --- |
| API keys | `env.*` | `$HERMES_HOME/.env.secrets` |
| Super Heavy OAuth | `oauth.xai-oauth` and/or `files[]` `auth.json` | `$HERMES_HOME/auth.json` |
| Codex OAuth | `oauth.openai-codex` (same store) | same `auth.json` |
| Meta / custom | `custom_providers[]` + `env.META_API_KEY` | `config.secrets.yaml` + `.env.secrets` |

| Claim | Status |
| --- | --- |
| Prep code (root → module passthrough + this checklist) | Ready for review |
| Multi-provider cutover sections (OAuth, custom, placeholders) | Ready for review (`lp-645.8.6`) |
| Live SM create / put-secret-value / apply / SSM / prove | **Blocked** on human credentials + deploy approval |

**Do not run `terraform apply`, create secrets with real keys, SSM send-command
against production hosts, or restart gateway without explicit human approval.**
This checklist is the approved sequence; it is not authorization to execute it.

---

## Preconditions

1. AWS credentials for the mocklab account via `AWS_PROFILE=lanyard-main`.
2. Credential material available **offline** on the operator machine (not in git,
   not in chat logs):
   - API keys for any key-based providers you intend to activate, **and/or**
   - Super Heavy / Codex device-code export already completed (see §2a–2b).
3. Mocklab instance id known (replace `i-INSTANCE` below).
4. Monorepo checkout with `deploy/deployments/mocklab` on a revision that includes
   `backend_runtime_secrets_*` passthrough into `company-brain-ec2` (lp-645.6 prep)
   and multi-provider materialize (`lp-645.8.3`+).
5. Private (gitignored) `backend.tf` + `terraform.tfvars` for mocklab already in use.

Hermes consumption detail:
[`docs/architecture/hermes-multi-provider-secrets.md`](../../../docs/architecture/hermes-multi-provider-secrets.md).  
Agent / LiteLLM (if kind is agent later):
[`docs/architecture/lanyard-agent-multi-provider-secrets.md`](../../../docs/architecture/lanyard-agent-multi-provider-secrets.md).  
Lifecycle runbook (create / rotate / clone):
[`docs/runbooks/backend-runtime-secrets.md`](../../../docs/runbooks/backend-runtime-secrets.md).

---

## 1. Create SM secret shell (name only)

Secret **name** convention (no value yet):

```text
/company-brain/mocklab/backend-runtime-secrets
```

```bash
export AWS_PROFILE=lanyard-main
export AWS_REGION=us-east-1   # or mocklab region

aws secretsmanager create-secret \
  --name "/company-brain/mocklab/backend-runtime-secrets" \
  --description "BackendRuntimeSecretsEnvelope for mocklab (values via put-secret-value; not in git)" \
  --tags Key=tenant,Value=mocklab Key=purpose,Value=backend-runtime-secrets
```

Capture the returned **ARN** (includes random suffix). Example shape only:

```text
arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:company-brain/mocklab/backend-runtime-secrets-AbCdEf
```

If the shell already exists, use `describe-secret` / `list-secrets` and skip create.

---

## 2. Put secret value (envelope schema — placeholders shown)

**Placeholder example only.** Replace every `sk-placeholder-…` /
`oauth-placeholder-…` / `REPLACE_ME…` with real offline-exported material on the
operator machine; never commit the filled JSON or paste real tokens into
beads/chat.

Envelope contract: `contracts/backend-runtime-v1/secrets-envelope.schema.json`  
Fixtures: `contracts/backend-runtime-v1/examples/`  
(full matrix: `secrets-envelope.full-matrix.json`; path-focused Hermes fixtures
under `secrets-envelope.hermes-*-oauth.json` / `hermes-meta-custom.json`).

### Placeholder policy (git vs live SM)

| Layer | Policy |
| --- | --- |
| **Git / docs / this checklist** | Full matrix may appear. Values must be obvious non-secrets: `sk-placeholder-…`, `REPLACE_ME…`, `oauth-placeholder-…` |
| **Live SM (mocklab / production)** | Include **only active slots**. Omit unused `env` keys, unused `oauth` providers, and unused `files[]` entries entirely |
| **Forbidden live** | Empty-string keys, leftover git sentinels, live-looking fake keys on a call path |

Mocklab default stance (when Super Heavy is available): prefer **`oauth.xai-oauth`**
primary; optional real API-key backup or omit; Codex / Meta optional.

### 2a. API-key-only envelope (minimal)

Include only the `env` key names your chosen provider needs.

```bash
export AWS_PROFILE=lanyard-main
export AWS_REGION=us-east-1

# Write a private local file (not under the repo), mode 600, then put-secret-value.
cat > /tmp/mocklab-backend-runtime-secrets.json <<'EOF'
{
  "schema_version": 1,
  "kind_hint": "hermes_lanyard",
  "env": {
    "OPENAI_API_KEY": "sk-placeholder-openai-replace-me",
    "XAI_API_KEY": "sk-placeholder-xai-replace-me"
  },
  "meta": {
    "tenant_slug": "mocklab",
    "rotated_at": "YYYY-MM-DDTHH:MM:SSZ",
    "notes": "operator-held value; not in git"
  }
}
EOF
chmod 600 /tmp/mocklab-backend-runtime-secrets.json

# Optional offline schema check (from monorepo root, no secrets in logs):
# python3 scripts/validate-secrets-envelope.py --file /tmp/mocklab-backend-runtime-secrets.json

aws secretsmanager put-secret-value \
  --secret-id "/company-brain/mocklab/backend-runtime-secrets" \
  --secret-string file:///tmp/mocklab-backend-runtime-secrets.json

# Wipe local copy when done:
shred -u /tmp/mocklab-backend-runtime-secrets.json 2>/dev/null \
  || rm -f /tmp/mocklab-backend-runtime-secrets.json
```

Optional `config_secret_overlay` only for secret-bearing YAML fields.

### 2b. Super Heavy OAuth (preferred mocklab primary)

Complete device-code **offline** (laptop/bastion with browser). No browser OAuth
in Terraform.

```bash
# Operator machine only:
export HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
hermes auth add xai-oauth --no-browser
# Follow the printed verification URL signed into Super Heavy / SuperGrok.
# Result: $HERMES_HOME/auth.json (mode 0600) with providers.xai-oauth
```

**Structured oauth inject** (single-provider; Hermes id is `xai-oauth`, **not**
Agent `xai-grok`):

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
      "token_type": "Bearer",
      "metadata": {
        "account_label": "REPLACE_ME_super_heavy_account_label"
      }
    }
  },
  "meta": {
    "tenant_slug": "mocklab",
    "notes": "placeholder Super Heavy template — replace before put"
  }
}
```

**Opaque `files[]`** when exporting a full multi-provider Hermes store:

```json
{
  "schema_version": 1,
  "kind_hint": "hermes_lanyard",
  "env": {},
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

When both structured `oauth` and `files[]` `auth.json` are present, **opaque
`files[]` wins** (no merge). Prefer one inject path per put-secret-value.

Non-secret public config (tfvars / host seed — **not** SM):

```hcl
backend_model_provider = "xai-oauth"
backend_model_default  = "grok-3"   # operator-confirmed Super Heavy-capable id
```

When both OAuth material and `XAI_API_KEY` are present, **prefer OAuth**: keep
`backend_model_provider = "xai-oauth"`. Treat API key as optional backup only
(omit live if unused). Detail:
[`hermes-multi-provider-secrets.md`](../../../docs/architecture/hermes-multi-provider-secrets.md) § Super Heavy.

Fixture: `contracts/backend-runtime-v1/examples/secrets-envelope.hermes-super-heavy-oauth.json`.

### 2c. OpenAI Codex OAuth (optional second account)

```bash
export HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
hermes auth add openai-codex --no-browser
# Or import from Codex CLI ~/.codex/auth.json into Hermes-shaped auth.json
# (always ship Hermes store shape into SM — not the raw Codex CLI file).
```

```json
{
  "schema_version": 1,
  "kind_hint": "hermes_lanyard",
  "env": {},
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

Public selector when Codex is the active path:

```hcl
backend_model_provider = "openai-codex"
backend_model_default  = "gpt-4.1"
```

Fixture: `secrets-envelope.hermes-codex-oauth.json`. Combined store shape:
`hermes-auth.placeholder.json`.

### 2d. Meta / custom OpenAI-compatible provider

Prefer `api_key_env` / `key_env` so the secret value lives only under `env`.

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
      "models": ["llama-3.1-405b"]
    }
  ]
}
```

Materialize projects to `$HERMES_HOME/config.secrets.yaml` (`providers.meta`) and
`.env.secrets` (`META_API_KEY=…`). Public selector:

```hcl
backend_model_provider = "meta"
backend_model_default  = "llama-3.1-405b"
```

Operators may add N custom providers; each `id` becomes `providers.<id>`.  
Fixture: `secrets-envelope.hermes-meta-custom.json`.

### 2e. Combined put (active slots only)

Build a private local envelope with **only** the slots you are activating, replace
placeholders, validate offline, put, then shred:

```bash
# After filling /tmp/mocklab-backend-runtime-secrets.json (mode 600):
# python3 scripts/validate-secrets-envelope.py --file /tmp/mocklab-backend-runtime-secrets.json

aws secretsmanager put-secret-value \
  --secret-id "/company-brain/mocklab/backend-runtime-secrets" \
  --secret-string file:///tmp/mocklab-backend-runtime-secrets.json

shred -u /tmp/mocklab-backend-runtime-secrets.json 2>/dev/null \
  || rm -f /tmp/mocklab-backend-runtime-secrets.json
```

---

## 3. Private tfvars keys (names only)

Edit **private** `deploy/deployments/mocklab/terraform.tfvars` (gitignored). Set:

| Key | Purpose |
| --- | --- |
| `backend_runtime_secrets_arn` | Full SM ARN from step 1 |
| `backend_runtime_secrets_enabled` | `true` (or omit; module enables when ARN non-empty) |
| `backend_runtime_secrets_region` | Optional; empty → module region |
| `backend_model_provider` | Non-secret provider id (e.g. `xai-oauth`, `openai-codex`, `meta`, `openai`, `xai`) |
| `backend_model_default` | Non-secret model id (e.g. `grok-3`, `gpt-4.1`, `llama-3.1-405b`) |

Example **shape** (not a live ARN) — Super Heavy primary:

```hcl
backend_runtime_secrets_arn     = "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:company-brain/mocklab/backend-runtime-secrets-AbCdEf"
backend_runtime_secrets_enabled = true
# backend_runtime_secrets_region  = "us-east-1"
backend_model_provider          = "xai-oauth"
backend_model_default           = "grok-3"
```

Never put envelope JSON, OAuth tokens, or raw API keys in tfvars.  
Committed notes only: [`terraform.tfvars.example`](terraform.tfvars.example).

---

## 4. Terraform plan / apply (monorepo)

```bash
export AWS_PROFILE=lanyard-main
cd deploy/deployments/mocklab

terraform init
terraform validate
terraform plan -out=tfplan
# Human review: expect IAM GetSecretValue on the ARN, user_data / tags refresh as applicable.
# Only after approval:
# terraform apply tfplan
```

Offline prep (no credentials required for validate):

```bash
cd deploy/deployments/mocklab
terraform init -backend=false -input=false
terraform validate
```

---

## 5. SSM Run Command — materialize + restart (no interactive SSH)

After apply (or when the instance already exists and only the secret version changed).
Replace `i-INSTANCE` with the mocklab instance id.

```bash
export AWS_PROFILE=lanyard-main
export AWS_REGION=us-east-1

aws ssm send-command \
  --instance-ids "i-INSTANCE" \
  --document-name "AWS-RunShellScript" \
  --comment "mocklab backend-runtime-secrets materialize + hermes-gateway restart" \
  --parameters 'commands=["set -euo pipefail","test -x /usr/local/sbin/materialize-backend-secrets","sudo /usr/local/sbin/materialize-backend-secrets","sudo systemctl restart hermes-gateway","sudo systemctl is-active hermes-gateway"]'
```

Poll command status (replace `COMMAND_ID`):

```bash
aws ssm get-command-invocation \
  --command-id "COMMAND_ID" \
  --instance-id "i-INSTANCE" \
  --query '{Status:Status,Stdout:StandardOutputContent,Stderr:StandardErrorContent}'
```

Steady state: reboots and unit `ExecStartPre` re-run materialize; this Run Command
is the one-shot force path for an already-running host.

---

## 6. Prove checks (key **names** / provider **ids** only — never log values)

Via SSM Run Command (template; same `i-INSTANCE`):

```bash
aws ssm send-command \
  --instance-ids "i-INSTANCE" \
  --document-name "AWS-RunShellScript" \
  --comment "mocklab backend-runtime-secrets prove (no secret values)" \
  --parameters 'commands=["set -euo pipefail","echo \"--- materialize config (ARN only) ---\"","grep -E \"^(BACKEND_RUNTIME_SECRETS_ARN|AWS_REGION)=\" /etc/company-brain/backend-runtime-secrets.env || true","HERMES_HOME=/home/hermes/.hermes","echo \"--- env.secrets key names (not values) ---\"","if [ -f $HERMES_HOME/.env.secrets ]; then sudo awk -F= \"/^[^#]/ {print \\$1}\" $HERMES_HOME/.env.secrets; ls -la $HERMES_HOME/.env.secrets; else echo \"MISSING .env.secrets (ok if OAuth-only with no env keys)\"; fi","echo \"--- auth.json provider ids (names only) ---\"","if [ -f $HERMES_HOME/auth.json ]; then sudo -u hermes python3 -c \"import json; d=json.load(open(\\\"$HERMES_HOME/auth.json\\\")); print(sorted((d.get(\\\"providers\\\") or {})))\"; ls -la $HERMES_HOME/auth.json; else echo \"no auth.json (ok if API-key-only)\"; fi","echo \"--- config.secrets.yaml present? ---\"","ls -la $HERMES_HOME/config.secrets.yaml 2>/dev/null || echo \"no config.secrets.yaml (ok if no custom_providers)\";","echo \"--- gateway ---\"","sudo systemctl is-active hermes-gateway","sudo systemctl show hermes-gateway -p ActiveState -p SubState --no-pager"]'
```

| Check | Pass criteria |
| --- | --- |
| SM secret | ARN in private tfvars matches `describe-secret` |
| Host ARN env | `/etc/company-brain/backend-runtime-secrets.env` has `BACKEND_RUNTIME_SECRETS_ARN` (reference only) |
| Materialize | Exit 0; secret files mode `0600` |
| API keys (if active) | `$HERMES_HOME/.env.secrets` lists expected **key names** only |
| Super Heavy / Codex (if active) | `auth.json` provider ids include `xai-oauth` and/or `openai-codex` (no token dump) |
| Meta / custom (if active) | `config.secrets.yaml` has `providers.<id>.key_env`; env has the matching key name |
| Gateway | `systemctl is-active hermes-gateway` → `active` |
| Product | Portal `https://app.withlanyard.com/mocklab` Settings shows provider / connected model, **or** chat completes a simple prompt |
| Placeholders | Live SM has no `sk-placeholder-…` / `oauth-placeholder-…` on active call paths |

Do **not** `cat` secret files into bead notes or CI logs. Evidence on the bead should
list key names, provider ids, unit state, and Portal/chat outcome only.

### Offline prep (no AWS)

```bash
python3 scripts/validate-secrets-envelope.py
bash deploy/scripts/smoke-materialize-backend-secrets.sh
# Path fixtures:
#   secrets-envelope.hermes-super-heavy-oauth.json
#   secrets-envelope.hermes-codex-oauth.json
#   secrets-envelope.hermes-meta-custom.json
```

---

## Rollback (operator)

1. Capture previous SM **version id** + `backend_model_*` pins before rotation.
2. Rotate: put new envelope version (active slots only) → re-run materialize → restart gateway.
3. Drop a slot: omit it from the next put-secret-value (materialize rewrites managed files) → materialize → restart.
4. OAuth re-export: only when host refresh fails or the account rotates; re-run offline device-code, put new version, materialize, restart.
5. Or clear managed files (`.env.secrets` keys / `auth.json` / `config.secrets.yaml`) and restart (product loses provider until restored).

Full lifecycle (rotate / revoke / tenant clone):  
[`docs/runbooks/backend-runtime-secrets.md`](../../../docs/runbooks/backend-runtime-secrets.md).

---

## Related

- Phase plan: [`docs/plans/0002-backend-runtime-secrets-aws-sm/phase-4-mocklab-live.md`](../../../docs/plans/0002-backend-runtime-secrets-aws-sm/phase-4-mocklab-live.md)
- Multi-provider matrix plan: [`docs/plans/0002-backend-runtime-secrets-aws-sm/phase-6-multi-provider-secrets-matrix.md`](../../../docs/plans/0002-backend-runtime-secrets-aws-sm/phase-6-multi-provider-secrets-matrix.md)
- Architecture (all kinds): [`docs/architecture/backend-runtime-secrets.md`](../../../docs/architecture/backend-runtime-secrets.md)
- Hermes Super Heavy / Codex / Meta: [`docs/architecture/hermes-multi-provider-secrets.md`](../../../docs/architecture/hermes-multi-provider-secrets.md)
- Agent / LiteLLM: [`docs/architecture/lanyard-agent-multi-provider-secrets.md`](../../../docs/architecture/lanyard-agent-multi-provider-secrets.md)
- Operator runbook: [`docs/runbooks/backend-runtime-secrets.md`](../../../docs/runbooks/backend-runtime-secrets.md)
- Module: `deploy/modules/company-brain-ec2` (`backend_runtime_secrets_*` variables + user_data fragment)
- Materialize tool: `deploy/scripts/materialize-backend-secrets.py` (host: `/usr/local/sbin/materialize-backend-secrets`)
- Mocklab INDEX: [`INDEX.md`](INDEX.md)
