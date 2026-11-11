# Phase 4. Mocklab live cutover

Back to [overview](overview.md).

## Goal

Make mocklab the perfect first-customer case: Secrets Manager holds model (and optional integration) secrets; Terraform apply materializes them; Hermes-Lanyard has a provider without SSH.

## Steps

1. **Create secret** (operator or TF `aws_secretsmanager_secret` **shell only** + external version):
   - Name convention: `/company-brain/mocklab/backend-runtime-secrets` (or existing org standard).
   - JSON envelope with real `env` keys for the chosen provider (e.g. `OPENAI_API_KEY` or `XAI_API_KEY`).
   - Value set via console/CLI/CI; not committed.

2. **tfvars** (private): set `backend_runtime_secrets_arn`, `backend_model_provider`, `backend_model_default`.

3. **`terraform apply`** from `lanyard-platform/deploy/deployments/mocklab` with `AWS_PROFILE=lanyard-main`.

4. **Force materialize** once if instance already running (SSM **Run Command**, non-interactive):
   ```bash
   aws ssm send-command --instance-ids i-… \
     --document-name AWS-RunShellScript \
     --parameters commands='["…/materialize-backend-secrets.sh && systemctl restart hermes-gateway"]'
   ```
   Steady state: reboots and `ExecStartPre` keep files fresh.

5. **Prove**:
   - Host: managed env file exists mode 0600, contains expected **key names** (not values in logs).
   - `systemctl is-active hermes-gateway`
   - Portal `app.withlanyard.com/mocklab` Settings shows provider / connected model, or chat completes a simple prompt.

## Rollback

- Remove or rotate SM secret; re-run materialize; or clear managed env block and restart.
- Capture previous pin + secret version id before rotation.

## Verification

| Check | Pass criteria |
| --- | --- |
| SM secret exists | ARN matches tfvars |
| IAM | Instance role can GetSecretValue (no broad `*` secrets) |
| Materialize | Exit 0; `.env.secrets` or managed block present |
| Gateway | Active after restart |
| Product | Provider visible or chat works |

## Beads

Implementable leaf: live mocklab cutover with evidence notes on the bead.
