# Phase 5. Runbooks and multi-backend readiness

Back to [overview](overview.md).

## Goal

Document operator lifecycle and how the same SM envelope works for all backend kinds so the next customer is a clone of mocklab, not a one-off.

## Runbooks

1. **`docs/runbooks/backend-runtime-secrets.md`**
   - Create secret (template JSON)
   - Wire ARN in tenant tfvars
   - Apply / bootstrap
   - Rotate (new SM version → materialize → restart)
   - Revoke (delete version / empty env keys → materialize → restart)
   - Incident: materialize failed, gateway down

2. **Tenant clone checklist** (from mocklab)
   - Copy tenant root from template
   - New SM secret path `/company-brain/<tenant>/backend-runtime-secrets`
   - Relay secret already separate (keep separate)
   - Model provider non-secret defaults in tfvars
   - First apply + smoke

3. **Backend kind matrix** (in architecture doc)
   - Hermes-Lanyard / upstream: paths under `HERMES_HOME`
   - Lanyard Agent: paths under `BACKEND_HOME` once Agent implements layout; until then envelope still valid, materialize path gated on kind

## Integration secrets guidance

- Prefer **env** entries when the integration reads env.
- Use **config_secret_overlay** only for fields that must live in config YAML (document each known Hermes key).
- Never store whole non-secret `config.yaml` in SM (bloat + merge hazard).

## Verification

- Link from `deploy/README` / mocklab INDEX / phase-8 cutover
- Dry-run of rotate steps on mocklab (version bump) with evidence
- Offline validate still green

## Beads

Implementable leaf: runbooks + matrix + mocklab INDEX links.
