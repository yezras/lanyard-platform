# Backend runtime secrets via AWS Secrets Manager

## Context

Customer hosts run a swappable backend (`hermes_upstream`, `hermes_lanyard`, or `lanyard_agent`). Today model API keys, OAuth material, and integration credentials are either missing (mocklab) or would require SSH to edit Hermes `HERMES_HOME` (`.env` + `config.yaml`). Operators must manage those secrets for every tenant without logging into each host. Bitwarden and 1Password are out of scope. AWS Secrets Manager is the system of record. Terraform owns **references, IAM, and materialization wiring**, never secret values in state when avoidable.

Mocklab is the first-customer reference: if secrets work there end-to-end, the same path ships for later tenants.

## Scope

**In**

- Platform-owned **secret envelope schema** consumed by every backend kind.
- Host **materialize** step: fetch SM → write env file(s) + optional secret config overlay → restart-safe, idempotent.
- Terraform on `company-brain-ec2` / tenant roots: secret ARN (or name convention), IAM, user_data / systemd `ExecStartPre`, non-secret model defaults.
- Mocklab live: create secret, wire ARN, materialize, set provider, prove chat / settings show a connected provider.
- Runbooks for rotate, revoke, and first-tenant clone from mocklab.

**Out**

- Bitwarden / 1Password as the central store.
- Putting secret values in git, tfvars, or Terraform state as plaintext.
- Portal UI as the secret-entry system of record (Portal may later display “connected”; it does not replace SM).
- Full Lanyard Agent product implementation of Brain RPC (separate epic); only the **shared secrets contract** so Agent can consume the same envelope later.
- Changing which backend product is selected (still Hermes-Lanyard on mocklab).

## Constraints

- Secrets Manager in the customer or platform account that owns the EC2 role.
- Instance role: least-privilege `GetSecretValue` (and KMS decrypt if CMK) on the tenant secret only.
- Hermes-Lanyard already loads `/home/hermes/.hermes/.env` via systemd `EnvironmentFile`. Materialize must land there (or a drop-in file that unit includes).
- Hermes in-tree secret sources are Bitwarden/1Password only; **AWS SM is deploy-owned materialization**, not a Hermes plugin dependency for v1.
- Same envelope must map cleanly to Hermes install paths **and** future Lanyard Agent / generic `BACKEND_HOME` layout.
- Operations must be **idempotent**: re-bootstrap and re-apply must converge without duplicating env keys or corrupting non-secret config.
- Mocklab deployment root was historically local-only; monorepo path is `deploy/deployments/mocklab` with gitignored `backend.tf` / `terraform.tfvars`.

## Alternatives considered

### Hermes AWS SM plugin only

Hermes docs allow a plugin `SecretSource`. That couples every backend product to Hermes plugin packaging and leaves Lanyard Agent unsolved. Rejected as the **only** path for v1.

### SSH / SSM Session Manager per change

Works for lab; fails “every client” and mocklab-as-product. Rejected as the steady state.

### One shared SM secret for all tenants

Cross-tenant blast radius. Rejected. One secret (or versioned family) **per tenant**.

### Selected design: platform envelope + host materialize + TF refs

Deploy owns SM fetch and file write at the host boundary. Backends only read env + config files they already understand. Terraform passes ARNs and non-secret defaults. Matches existing relay-secret pattern.

## Principles that shaped decisions

| Principle | Choice it drove |
| --- | --- |
| **Foundational thinking** | Define `BackendRuntimeSecretsEnvelope` before scripts or TF vars. |
| **Boundary discipline** | Validate/parse SM JSON once at materialize boundary; backends trust files. Secret values never cross Terraform apply outputs. |
| **Model the domain** | Envelope is `env` + optional `config_secret_overlay` + metadata; not “Hermes-only .env hacks”. |
| **Make operations idempotent** | Materialize rewrites managed files from SM; merge rules for managed keys only; safe re-run. |
| **Sequence verifiable units** | Schema → offline materialize tests → TF wiring → mocklab live proof. |
| **Laziness protocol** | Reuse relay SM/IAM patterns; no new secret product (Vault/BW). |
| **Redesign from first principles** | Treat secrets as backend-runtime contract, not Hermes-only ops debt. |
| **Prove it works** | Mocklab: SM has key, host env has key, gateway restarted, Portal/settings or chat shows provider. |

## Phases

1. [Envelope contract](phase-1-envelope-contract.md) — schema + docs + backend mapping table.
2. [Materialize script](phase-2-materialize-script.md) — offline-tested host tool.
3. [Terraform wiring](phase-3-terraform-wiring.md) — vars, IAM, user_data/systemd, mocklab root in monorepo.
4. [Mocklab live cutover](phase-4-mocklab-live.md) — create secret, apply, prove provider works.
5. [Runbooks and multi-backend readiness](phase-5-runbooks.md) — rotate, tenant clone, Agent/Hermes path notes.
6. [Multi-provider secrets matrix](phase-6-multi-provider-secrets-matrix.md) — OAuth, custom endpoints (Meta), LiteLLM master key, placeholder policy (Hermes + Agent); plan for envelope `files[]` extension.

## Definition of done

- Operator can set or rotate model/integration secrets in AWS SM only.
- Terraform apply (or host re-bootstrap) materializes them with **no SSH**.
- Mocklab has a real provider key via SM and is usable for first-customer QA.
- Contract docs state how `hermes_lanyard`, `hermes_upstream`, and `lanyard_agent` consume the same envelope.
- Beads for each phase are closed with evidence (tests, plan, live checks).

## Tracking

Epic and phase beads: see `bd show` under epic title **backend runtime secrets via AWS Secrets Manager** (created with this plan).

## Related

- Relay secret pattern: `deploy/modules/customer-gateway-relay/`
- Staging HL pins: `docs/runbooks/staging-hermes-lanyard-backend-pins.md`
- Backend runtime contract: `docs/architecture/backend-runtime-contract.md`
- Mocklab host: Hermes-Lanyard, `HERMES_HOME=/home/hermes/.hermes`
