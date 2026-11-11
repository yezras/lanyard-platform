# self-improve tools

Deterministic helpers for the nightly Company Brain eval loop. Canonical implementation lives under `skills/self-improve/scripts/`; this folder documents the contract for agents and deployers.

## CLI

From Core root:

```bash
python3 skills/self-improve/scripts/self_improve_tools.py <subcommand> ...
```

| Subcommand | Purpose |
|------------|---------|
| `init-eval-db --vault-root <VaultRoot>` | Create/update `<VaultRoot>/evals.db` |
| `list-sessions` | Sessions in a time window (read-only `state.db`) |
| `export-messages --session-id ID` | Message dump for episode segmentation |
| `compute-features --messages-json FILE` | Phase 4 behavioral features JSON |

## Shell wrappers

- `scripts/init-evals-db.sh <VaultRoot>`
- `scripts/sync-self-improve-to-hermes.sh` — install skill into `~/.hermes/skills/self-improve/`

## Safety

- Never write to `~/.hermes/state.db` from these tools.
- `evals.db` is append-only by policy (see skill `references/schema.sql`).
- Do not commit vault `evals.db` files into Core.

## Skill pointer

Load Hermes skill **`self-improve`** for phases 0–9, judge rubric, deployment, and cron template: `skills/self-improve/SKILL.md` and `skills/self-improve/references/deployment.md`.