---
name: self-improve
description: Nightly self-improvement loop for the Company Brain. Segments the last 24h of Hermes sessions into task episodes, scores them (behavioral features + LLM judge), attributes failures to brain components (skills, crons, MCP, memory, connectors), applies verified low-risk fixes autonomously, proposes risky fixes via morning Slack message, and tracks fix outcomes with a 7-night regression watch. Invoked by the self-improve-nightly cron job.
---

# self-improve — nightly evaluation & repair loop for the Company Brain

## Purpose

Convert daily usage into a test suite. Every night: score what happened, attribute friction to the responsible brain component, fix what is safely fixable, propose the rest, and verify that past fixes actually held.

**This skill is part of the brain's core.** Canonical copy lives in `~/Core/skills/self-improve/`; the eval database schema is `references/schema.sql`. On any brain deployment (Lanyard or client EC2), the eval DB is initialized at `<vault-root>/evals.db` from that schema.

## Locked design decisions (grill session 2026-07-07)

| Decision | Value |
|---|---|
| Unit of evaluation | **Task episode** (goal-scoped contiguous stretch of one session; N per session) |
| Scoring | **Hybrid**: mechanical behavioral features → LLM judge constrained to rubric + component-attribution enum. Precedence: explicit user feedback > behavioral > judge inference |
| Storage | **SQLite + JSON1** at `<VaultRoot>/evals.db`, WAL mode, **append-only** (verdicts superseded by new rows, never mutated). Schema versioned in Core |
| Autonomy | **Tiered + verification gate**. Auto-apply tier requires reproduced failure + passing re-run evidence. Everything else → Slack proposal |
| Proposals | Morning **Slack message** with diffs |
| Models | Cron pinned to **grok-composer-2.5-fast (xai-oauth)** for orchestration/segmentation/features. Judge + fixer via **`hermes chat -q` subprocess pinned to Grok 4.3** (`references/model-routing-judge-fixer.md`) |
| Fix outcomes | **7-night regression watch**; regressed fix → auto-revert + escalate; **never re-auto-fix a regressed component** |
| Scope | User-facing sessions → full pipeline. Cron sessions → mechanical health check only. Self-improve's own sessions → **hard-excluded** |

## Nightly procedure

### Phase 0 — Setup
1. Ensure eval DB exists: `sqlite3 <vault-root>/evals.db < <skill-dir>/references/schema.sql` (idempotent, `IF NOT EXISTS` throughout).
2. Open an `eval_runs` row. Window = end of last completed run → now (default trailing 24h).
3. All reads of Hermes session history come from `~/.hermes/state.db` — **open read-only** (`file:...?mode=ro`). Never write to state.db.
4. **Wrap the entire run in try/finally** — if any phase crashes, Phase 9 (Close) MUST still execute and set `eval_runs.status='failed'` with the error in `notes`. A stuck `running` row means tomorrow's window calculation breaks.

### Phase 1 — Population filter
Query `state.db` `sessions` for sessions overlapping the window:
- **User-facing** (full pipeline): `source NOT IN ('cron','subagent')` and `parent_session_id IS NULL`.
- **Cron** (health check): `source = 'cron'`.
- **Hard exclusions**: sessions of the `self-improve-nightly` job itself (session id prefix `cron_<jobid>`), sessions with `source='self-improve-internal'` (the `--source` flag on judge/fixer subprocesses), and any session whose first user message contains the marker `[self-improve-internal]`. Belt + suspenders: both the session source tag and the text marker are checked. Self-improve never evaluates, judges, or patches itself. Changes to this skill are permanently propose-only.

### Phase 2 — Cron health check (mechanical, no judge)
For each enabled cron job (via `cronjob action='list'`), cross-check the window:
- Did it run? Exit clean? Deliver? Tool errors in its transcript (scan `messages.tool_calls`/`content` for error strings)?
- Record one `cron_health` row per job per night. Failures become `cron-failure` fixer items with transcript attached.

### Phase 3 — Episode segmentation (orchestrator model)
For each user-facing session, dump `role`, `content` (truncate tool results to ~500 chars), `tool_name`, `timestamp` ordered by id. Segment into episodes: a new episode starts when the user pivots to an unrelated goal. Clarification loops are ONE episode. Record `episodes` rows anchored to `state.db` message ids (`first_message_id`, `last_message_id`).

### Phase 4 — Behavioral features (pure Python/SQL, free)
Per episode compute: `user_turns`, `assistant_turns`, `tool_calls`, `tool_errors` (error/exception/traceback strings in tool results), `user_corrections` ("no", "that's wrong", "I meant", rephrased same ask), `retry_loops` (same tool + similar args ≥3×), `abandoned` (episode ends on unresolved user turn / session dies mid-goal), `explicit_feedback` (praise/complaint strings). Store full payload in `features_json`. Baseline implementation: `scripts/self_improve_tools.py compute-features`.

### Phase 5 — Judge (Grok 4.3 subprocess)
Judge EVERY episode (volume is small). Input: transcript + behavioral features as structured context. Rubric and output contract: `references/judge-rubric.md`. Output (JSON): `verdict` (success|friction|failure|abandoned), `score` 0–1, `failure_attribution` (enum from rubric — the *component*, not the symptom), `attribution_detail_json` (evidence quotes, reasoning). Precedence rule is binding: explicit user feedback overrides behavioral signals overrides judge inference. Append `verdicts` rows (supersede via `supersedes_verdict_id`, never UPDATE).

**Subprocess invocation (verified pattern):**
```bash
hermes chat -q "[self-improve-internal] JUDGE. Return STRICT JSON only, no prose.
<rubric from references/judge-rubric.md>
<episode transcript + features>
Output: {\"verdict\":..., \"score\":..., \"failure_attribution\":..., \"attribution_detail\":{...}}" \
  --provider xai-oauth -m grok-4.3 \
  -t safe -Q \
  --source self-improve-internal
```

Key flags:
- `-t safe` — minimal toolset; prevents "Unknown toolsets" errors and stops the model from trying to call tools instead of returning JSON
- `-Q` — quiet mode; suppresses banner/spinner/tool previews so stdout is parseable
- `--source self-improve-internal` — tags the session for Phase 1 exclusion (belt + suspenders with the text marker)
- `terminal(timeout=120)` per call; if it times out, record `verdict='abandoned'` with `failure_attribution='tool-failure'` and component_name `'self-improve judge subprocess'`

**Parsing:** extract JSON from stdout. If no parseable JSON, do NOT default to friction — record the parse failure in `eval_runs.notes` and continue to the next episode. Unparseable verdicts are infrastructure failures, not episode verdicts.

### Phase 6 — Fixer (Grok 4.3 subprocess)
Inputs: failure/friction episodes with attribution + cron failures. Check `component_freezes` first — frozen components are propose-only regardless of tier.

**Tier table:**

| Auto-apply (with verification gate) | Propose-only (Slack) |
|---|---|
| Skill prompt clarifications; adding pitfalls/examples to SKILL.md | Creating/deleting skills |
| Fixing a broken command inside a skill it diagnosed | Cron schedules or cron prompts |
| RECALL.md query updates | Memory edits; config/model changes |
| | MCP/connector credentials; anything under `Clients/**`; this skill itself |

**Verification gate (mandatory for auto tier):** reproduce the failure (run the broken command / minimal repro) → apply patch → re-run → capture passing output into `fixes.verification_evidence`. No reproducible test → demote to proposal. Every auto-fix stores a unified diff (revertible) in `fixes.diff`.

**Circuit breakers:**
1. Component auto-patched **2× in 7 days** → insert `component_freezes` row, escalate to Slack.
2. Component with a **regressed** fix → never auto-fix again (permanent, enforced via `fixes` history).

Every fix row records `watch_condition` (e.g. "skill X invoked") and `watch_until` = +7 nights.

### Phase 7 — Regression watch
For open fixes (`status='applied'`, `watch_until >= today`): if the watched component was exercised in tonight's episodes —
- episode success → `status='validated'`.
- same `failure_signature` recurs → `status='regressed'`, apply reverse diff (revert), append escalation to Slack report with both attempts attached.

### Phase 8 — Morning Slack report (the cron's final response; delivery handles Slack)
Lead with: **"What I changed while you slept"** (auto-fixes + evidence links). Then: episodes scored (verdict counts), proposal queue (numbered, each with component, diagnosis, diff — ready for yes/no reply), regression watch status, weekly validated-vs-regressed rate (the health metric for self-improve itself), and eval DB row counts (tamper evidence). Keep under ~40 lines; full detail lives in evals.db.

**Slack tables:** When tabular data is clearer than bullets, emit normal GitHub-style markdown tables. Do **not** hand-align tables in monospace/preformatted blocks as an interim fallback. Hermes Slack gateway commit `7c7b489` can render markdown tables as native Slack Block Kit `table` blocks when `platforms.slack.extra.rich_blocks: true` is enabled; rich blocks are opt-in and require a gateway restart after config changes. It preserves rich-text cells, alignment from the separator row, escaped-pipe handling, and automatic monospace fallback only when Slack limits are exceeded/unparseable (100 rows / 20 cols / ~10k aggregate chars). Keep report tables small enough to stay on the native path.

### Phase 9 — Close
Mark `eval_runs.status='completed'` with counts. On any phase crash: mark `'failed'` with error in `notes` — the report must still send. **This phase MUST execute even on crash** (Phase 0's try/finally guarantees it).

## Safety rules (non-negotiable)
- `hermes chat -q` subprocess calls MUST use `-t safe -Q --source self-improve-internal` to avoid toolset errors and ensure parseable stdout. Do NOT pass toolset names like "messaging" that may not be enabled on the target deployment.
- Judge parse failures are infrastructure failures, not episode verdicts — do NOT default them to `friction`. Log and skip.
- `state.db` is read-only. `evals.db` is append-only (INSERT; status transitions on `fixes` are the sole exception).
- Never evaluate, judge, or patch self-improve itself; its changes are human-approved only.
- Never auto-fix: frozen components, regressed components, anything in the propose-only tier.
- All subprocess prompts carry `[self-improve-internal]`.
- Auto-fix without verification evidence is a bug, not a fix.

## Deployment (client brains)
`~/Core` repo ships this skill, schema, and `self_improve_tools.py`. Follow `references/deployment.md`: init `<VaultRoot>/evals.db`, run `scripts/sync-self-improve-to-hermes.sh`, register `self-improve-nightly` cron with `<SlackTarget>` delivery. Eval DB is gitignored (`*.db`) like `clients_crm.db`; include in vault backup.

## References

- `references/deployment.md` — eval DB init, Hermes sync, cron template
- `references/hermes-state-readonly.md` — `state.db` tables and filters
- `references/model-routing-judge-fixer.md` — judge/fixer subprocess invocation
- `references/judge-rubric.md` — verdict JSON contract
- `references/schema.sql` — `evals.db` DDL
- `scripts/self_improve_tools.py` — init DB, list sessions, export messages, compute features

## Pitfalls
- Cron sessions have no user turns — never run them through the episode judge (category error). Health check only.
- Judge attribution names the **component**, not the symptom ("mempalace recall returned stale contacts", not "wrong answer").
- `user-ambiguity` attribution = no component fix; it feeds AGENTS.md/skill *documentation* improvements at most.
- Don't score subagent child sessions independently — their parent session carries the outcome.
- `ob sync` requires nvm Node 24 on this machine (system Node 22 breaks better-sqlite3).
