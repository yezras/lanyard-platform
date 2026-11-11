# Plan: Hermes Lanyard fork + weekly self-hosted sync

**Status:** executed (2026-07-10) — epic `portal-emr`  
**Date:** 2026-07-10  
**Related:** Portal multi-root projects, `chat_topic` cwd pin, portal tool_progress metadata  
**Runtime vs code:** `HERMES_HOME` = `~/.hermes/` (instance data); agent source = `~/.hermes/hermes-agent/` (git)

### Live layout (post-execution)

| Item | Value |
|------|--------|
| Fork | https://github.com/LanyardBrain/hermes-agent |
| Upstream | https://github.com/NousResearch/hermes-agent |
| Run branch | `lanyard/portal-integration` (gateway checkout) |
| Workflow | `.github/workflows/sync-upstream.yml` on fork `main` + portal branch |
| Schedule | `0 5 * * 0` UTC (~Sun 00:00 America/New_York EST; ~1h EDT drift) |
| Runner | `~/actions-runners/hermes-agent`, labels `self-hosted,linux,hermes-sync`, unit `actions.runner.LanyardBrain-hermes-agent.hermes-sync-spark-0a00.service` |
| Host note | `~/.hermes/README-LANYARD.md` |

---

## Goal

1. Convert the existing Hermes clone into a **owned fork** under Lanyard (not a dirty checkout of Nous main).
2. Land Portal-required patches on a durable branch.
3. Run a **self-hosted GitHub Actions runner** on the Hermes machine.
4. **Every Sunday 00:00 America/New_York** (cron in UTC), rebase Lanyard branch onto `upstream/main` and push to the fork.
5. **Guarantee:** forking/remotes/sync **do not** remove cron jobs, connectors, skills, MCP, auth, or projects.

---

## Non-goals

- Changing Portal monorepo layout.
- Auto-restarting `hermes-gateway` on every sync (optional later; default manual).
- Upstreaming patches to Nous in this epic (follow-up).
- Moving `HERMES_HOME` or re-seeding instance data.

---

## Safety: what forking does / does not touch

| Location | Contents | Affected by fork / git sync? |
|----------|----------|------------------------------|
| `~/.hermes/config.yaml`, `.env`, `auth.json` | Gateway, models, credentials | **No** |
| `~/.hermes/cron/` | Cron jobs | **No** |
| `~/.hermes/skills/` | Skills | **No** |
| `~/.hermes/mcp-tokens/`, MCP config in config.yaml | MCP servers | **No** |
| `~/.hermes/projects.db`, `state.db`, sessions | Projects / sessions | **No** |
| Connectors / channel pairing state | Under `~/.hermes/` | **No** |
| `~/.hermes/hermes-agent/` | **Source code only** | **Yes** (remotes, commits, rebase) |

**Rule:** Never delete or overwrite all of `~/.hermes/`. Only operate on `hermes-agent/` git state.

---

## Target remote layout

```text
origin   →  https://github.com/LanyardBrain/hermes-agent.git   (Lanyard fork — push)
upstream →  https://github.com/NousResearch/hermes-agent.git   (Nous — fetch/rebase)
```

**Branches:**

| Branch | Role |
|--------|------|
| `main` | Tracks Nous `main` (optional mirror on fork) |
| `lanyard/portal-integration` | Portal patches; **what gateway should run** |

---

## Portal patches to preserve (current working tree)

Already present under `~/.hermes/hermes-agent/` (as of plan date):

| Path | Purpose |
|------|---------|
| `gateway/run.py` | Cwd pin from absolute `chat_topic` + `register_task_env_overrides`; portal tool progress events |
| `gateway/relay/adapter.py` | Portal metadata enrich; `edit_message` over relay |
| `gateway/relay/portal_metadata.py` | `portal_event: tool_progress` helpers |
| `tests/gateway/test_session_env.py` | Cwd / override tests |
| `tests/gateway/relay/test_portal_metadata.py` | Metadata unit tests |

---

## Execution slices

### Slice 1 — Create fork and rewire remotes

1. `gh repo fork NousResearch/hermes-agent --org LanyardBrain --fork-name hermes-agent --clone=false`
2. In `~/.hermes/hermes-agent`:
   - `git remote rename origin upstream` (if origin is still Nous)
   - `git remote add origin https://github.com/LanyardBrain/hermes-agent.git`
   - `git fetch upstream && git fetch origin`
3. Verify: `git remote -v` shows origin=fork, upstream=Nous.
4. Confirm gateway still starts; crons/skills unchanged.

**Acceptance:** Fork exists on GitHub; remotes correct; `systemctl`/gateway healthy; `~/.hermes/cron` and `config.yaml` untouched.

---

### Slice 2 — Commit Portal patches on Lanyard branch

1. `git checkout -b lanyard/portal-integration` (from current `main` = upstream tip).
2. Stage only Portal-related files (list above).
3. Commit with clear message (`feat(lanyard): …`).
4. `git push -u origin lanyard/portal-integration`
5. Optionally `git push origin main:main` so fork `main` mirrors Nous.
6. Document: gateway checkout = `lanyard/portal-integration`.
7. Restart gateway once so runtime loads committed tree (optional if already running patched code).

**Acceptance:** Branch on GitHub; pytest for portal tests pass; `pwd` in Portal project still works after restart.

---

### Slice 3 — Self-hosted runner on Hermes machine

1. Dedicated dir: `~/actions-runners/hermes-agent` (do not put under `~/.hermes/` data dirs).
2. Install GitHub Actions runner for this host arch.
3. Register against **fork** `LanyardBrain/hermes-agent` with labels: `self-hosted`, `linux`, `hermes-sync`.
4. Install as service (`svc.sh install` / user service) so it survives reboot/logout.
5. Confirm runner **Idle** in GitHub UI.

**Acceptance:** Runner online; can pick jobs with `runs-on: [self-hosted, linux, hermes-sync]`.

---

### Slice 4 — Weekly sync workflow (Sunday 00:00 America/New_York)

1. Add `.github/workflows/sync-upstream.yml` on fork **default branch** (so schedule fires).
2. Schedule: Sunday local midnight Eastern ≈ **`0 5 * * 0` UTC** (EST); document DST (EDT ≈ `0 4 * * 0`). Prefer one cron + comment; accept ~1h DST drift or dual notes.
3. Job:
   - `runs-on: [self-hosted, linux, hermes-sync]`
   - `working-directory: /home/operator/.hermes/hermes-agent` (same tree gateway uses)
   - Ensure remotes `upstream` / `origin`
   - **Refuse if working tree dirty**
   - `git fetch upstream main`
   - `git checkout lanyard/portal-integration`
   - `git rebase upstream/main`
   - Run portal smoke tests (`test_session_env`, `test_portal_metadata`)
   - `git push --force-with-lease origin lanyard/portal-integration`
   - Log HEAD; **do not** auto-restart gateway by default
4. `workflow_dispatch` for manual runs.
5. Auth: `GITHUB_TOKEN` with `contents: write`, or repo secret `LANYARD_HERMES_PUSH_TOKEN` if needed.

**Acceptance:** Manual dispatch succeeds; schedule registered; branch advances after upstream moves; dirty-tree guard works.

---

### Slice 5 — Ops docs + Portal pointer

1. Short doc in Portal (this file is canonical) + optional `~/.hermes/README-LANYARD.md` or note in Portal `testing.md` / README:
   - Remotes, branch, runner labels, sync schedule
   - Restart gateway after intentional sync when ready
   - Safety: never wipe `HERMES_HOME`
2. Optional: `bd remember` one-liner for agents.

**Acceptance:** Another operator can re-run sync or fix a failed rebase from docs alone.

---

## Weekly ops runbook (after automation)

| Event | Action |
|-------|--------|
| Sync green | Optional: review log, restart gateway when convenient |
| Rebase conflict | SSH machine, fix in `hermes-agent`, continue rebase, push, re-run workflow |
| Dirty tree refuse | Commit/stash local experiments, re-run workflow |
| Runner offline | `svc.sh status` / start runner service |

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Rebase conflict on hot files (`run.py`) | Manual resolve; keep Portal patches small; upstream later |
| Force-push after rebase | Always `--force-with-lease` |
| Gateway runs stale code after sync | Document restart; optional later job step with approval |
| Runner compromised | Self-hosted only for this private fork; least-privilege token |
| Accidental wipe of `~/.hermes` | Never script `rm -rf ~/.hermes`; only git under `hermes-agent` |

---

## Out of scope / follow-ups (separate beads if needed)

- Upstream PRs to Nous (edit_message, session cwd API, portal_event).
- Auto-restart gateway after green sync.
- Multi-machine runners / HA Hermes.
- Packaging Hermes as a versioned artifact (tarball/container) instead of live git dir.

---

## Success criteria (epic)

1. `LanyardBrain/hermes-agent` exists; remotes on host are origin=fork, upstream=Nous.
2. `lanyard/portal-integration` contains Portal patches and is the intended run branch.
3. Self-hosted runner online with `hermes-sync` label.
4. Workflow runs on schedule + manual dispatch; rebases and pushes without touching `HERMES_HOME` data.
5. Documented that cron/skills/MCP/connectors survive fork + sync.
6. Smoke tests for Portal Hermes patches pass after a sync cycle.
