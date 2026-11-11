# self-improve — deployment on a Company Brain vault

Canonical skill and schema live in **Core** (`skills/self-improve/`). Each deployment (employee Lanyard vault, client EC2 brain) wires runtime paths and one Hermes cron job.

## 1. Initialize eval database

At the **vault root** (same directory as vault `AGENTS.md` / `mempalace.yaml`):

```bash
<Core>/scripts/init-evals-db.sh <VaultRoot>
```

Or:

```bash
python3 <Core>/skills/self-improve/scripts/self_improve_tools.py init-eval-db --vault-root <VaultRoot>
```

Creates `<VaultRoot>/evals.db` idempotently from `references/schema.sql`. The file is **gitignored** (`*.db`); back it up with the vault (e.g. S3).

## 2. Install skill into Hermes

From Core repo root:

```bash
./scripts/sync-self-improve-to-hermes.sh
```

Copies `skills/self-improve/` → `~/.hermes/skills/self-improve/`. Re-run after pulling Core changes.

## 3. Nightly cron (`self-improve-nightly`)

Create or edit via `hermes cron` / `cronjob` tool. **Pin the runner model** (orchestration only):

| Field | Value |
|-------|--------|
| `model` | `grok-composer-2.5-fast` |
| `provider` | `xai-oauth` |
| `skills` | `["self-improve"]` |
| `schedule` | `30 3 * * *` (example: 03:30 local) |
| `deliver` | `<SlackTarget>` e.g. `slack:#general` |
| `workdir` | `<VaultRoot>` (loads vault `AGENTS.md`) |

**Prompt body** (replace placeholders; keep deployment-specific notes out of Core):

```
Run the nightly self-improvement loop for the Company Brain. Follow the self-improve skill exactly, phases 0-9.

Key parameters for this deployment:
- Vault root: <VaultRoot> — eval DB at <VaultRoot>/evals.db (re-run schema init idempotently in Phase 0).
- Hermes history: ~/.hermes/state.db — READ-ONLY (URI mode=ro). Never write to it.
- Helper CLI: python3 <Core>/skills/self-improve/scripts/self_improve_tools.py (list-sessions, export-messages, compute-features).
- Evaluation window: since the last completed eval_runs row; if none, trailing 24 hours.
- Judge and fixer: `hermes chat -q` pinned to Grok 4.3 — see references/model-routing-judge-fixer.md. Every subprocess prompt MUST begin with [self-improve-internal].
- Hard exclusions: this cron job's own sessions (prefix cron_<JOB_ID>) and any session whose first user message contains [self-improve-internal].
- Never patch the self-improve skill itself — proposals only.

FINAL RESPONSE: Phase 8 morning report (<SlackTarget> delivery). Under ~40 lines; note failures if any phase crashed.
```

Record `<JOB_ID>` from `hermes cron list` and pass `--exclude-cron-job-id` when using `list-sessions`.

## 4. Verify

```bash
sqlite3 <VaultRoot>/evals.db "SELECT version FROM schema_version;"
hermes skills list | grep self-improve
hermes cron list | grep self-improve-nightly
```

## Pitfalls

- Do not commit `evals.db` or personal `<VaultRoot>` paths into Core.
- Judge/fixer use **Grok 4.3** subprocess; cron runner uses **grok-composer-2.5-fast** — different roles.
- `ob sync` on vault markdown may require the deployment's documented Node version if auto-fix touches `Clients/`.