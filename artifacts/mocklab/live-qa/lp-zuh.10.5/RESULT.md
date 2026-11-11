# lp-zuh.10.5 — Workflow durable state_dir on vault (no hybrid BACKEND_HOME)

**Bead:** `lp-zuh.10.5`  
**Parent epic:** `lp-zuh.10` (kitchen-sink residuals; depends on `lp-zuh.9.4` vault mount GO)  
**When (UTC):** 2026-08-14T18:10Z–18:16Z  
**Tenant:** MockLab (`319d3808-e533-44db-bfdf-7b6ef8caaae1`)  
**Instance:** `452b1348-772a-49d0-8038-a410eda8accf`  
**Sandbox:** `7a300050-5316-44c9-b140-a6c51d3f66ce`  
**Guest LA (pre-hot-patch):** `0.0.0-main.508b0b736ad5`  
**Verdict:** **PASS** (with residual: bake workflow ENOSYS fix in next agent-gateway pin; journal append EPERM residual)

## Acceptance

| # | Criterion | Result |
|---|-----------|--------|
| 1 | kitchen-sink `workflow.state_dir=/mnt/vault` (or vault subpath) | **PASS** — guest `config.yaml` `workflow.state_dir: /mnt/vault` (entrypoint seed) |
| 2 | `mkdir` under workflows succeeds (depends `lp-zuh.9.4`) | **PASS** — `WORKFLOW_MKDIR_OK` on `/mnt/vault/workflows` as `brain` |
| 3 | Live research-lite run leaves state under vault; visible after remount | **PASS** — run `wf_7fad97d2e324fa00` under `/mnt/vault/wf_*`; S3 object durable; Daytona **stop → start** remount still shows program/args/state/journal |

## Residual closed vs `lp-zuh.7.5`

| Surface | `lp-zuh.7.5` | `lp-zuh.10.5` |
|---------|--------------|--------------|
| Launch | PASS | PASS (`research-lite` admit) |
| Run data path | hybrid `~/.lanyard-agent/data/workflows/wf_*` residual | **`/mnt/vault/wf_*`** (config `state_dir: /mnt/vault`) |
| `workflow.state_dir` | N/A / hybrid | **`/mnt/vault`** kitchen-sink |
| Durability | Ephemeral host disk | **Vault + S3**; survives stop/start remount |
| `$BACKEND_HOME` hybrid | Inferred | **None** — no `state/workflows` under BACKEND_HOME |

## Live proof sequence (no secrets)

1. **Precondition:** MockLab sandbox online with mountpoint-s3 R/W at `/mnt/vault` (`lp-zuh.9.4`).
2. **Config:** kitchen-sink already has:
   ```yaml
   workflow:
     enabled: true
     agent_budget: 128
     max_active_runs: 16
     state_dir: /mnt/vault
     definition_roots:
       - /mnt/vault/workflows
   ```
   Product rule: explicit `workflow.state_dir` **is** the workflowsDir (`{state_dir}/{run_id}/`), not a parent that appends `/workflows`.
3. **Blocker found:** stock `atomicWriteJson` uses write-tmp + **`renameSync`**. Mountpoint-S3 returns **`ENOSYS`** → admit failed with:
   `rename '.../program.json.*.tmp' -> '.../program.json'`.
4. **Fix applied (LA source + live hot-patched dist for proof):**
   - On `ENOSYS` / `EXDEV` / `EPERM` from rename → **overwrite** canonical JSON path (mirrors FileCronStore).
   - Source PR: [lanyard-agent#241](https://github.com/LanyardBrain/lanyard-agent/pull/241) (`packages/workflow/src/run-store.ts`).
   - Live: copied agent tree to `/var/lib/company-brain-backend/lanyard-agent-zuh105`, patched `packages/workflow/dist/run-store.js`, ran CLI from that tree (image `/opt` not writable as `brain`).
5. **Launch:**  
   `lanyard-agent workflow run research-lite --budget 8 --args '{"question":"GPU cluster planning residual lp-zuh.10.5 durable state_dir on vault"}'`  
   → `Launched workflow: research-lite` id=`wf_7fad97d2e324fa00`.
6. **Vault layout (guest):**
   ```text
   /mnt/vault/wf_7fad97d2e324fa00/
     program.json
     args.json
     state.json
     journal.jsonl
     scratch/
   ```
7. **S3 (external):** prefix  
   `s3://lanyard-mocklab-vault-123456789012/tenants/319d3808-…/vault/wf_7fad97d2e324fa00/`  
   contains the same four files.
8. **Survival:** Daytona **stop → start** same sandbox; remount shows same run dir + contents (`REMOUNT_VISIBLE_OK`).  
   No hybrid run dirs under `$BACKEND_HOME` or `~/.lanyard-agent`.

## Run inventory (redacted)

```json
{
  "run_id": "wf_7fad97d2e324fa00",
  "display_name": "research-lite",
  "workflow_name": "research-lite",
  "status": "failed",
  "phases": ["plan"],
  "budget_total": 8,
  "path": "/mnt/vault/wf_7fad97d2e324fa00"
}
```

Status `failed` is a **non-blocking residual** for this bead (see below): durable admit + vault/S3/remount visibility still meet acceptance. Full successful multi-agent completion is out of scope once state is vault-backed.

## Artifact index

| Path | Purpose |
|------|---------|
| [RESULT.md](./RESULT.md) | This verdict |
| [state.json](./state.json) | S3/guest tracker snapshot after launch |
| [../../daytona-pilot/lp-zuh.10.5-workflow/](../../daytona-pilot/lp-zuh.10.5-workflow/) | Guest pre-stop, remount, S3 listing notes |

## Product residuals (not blocking this PASS)

| Item | Status | Notes |
|------|--------|-------|
| Bake workflow ENOSYS rename fallback in **agent-gateway snapshot** | **Required residual** | Live proof used hot-patched dist; stock pin still ENOSYS without [LA #241](https://github.com/LanyardBrain/lanyard-agent/pull/241) bake (cron-only pin was `lp-zuh.10.9`) |
| Journal append `EPERM` on Mountpoint after first write | Residual | Run failed mid-plan on re-open of `journal.jsonl`; program/args/state remain durable |
| CLI without process-owned SubagentRuntime | Expected | Live spawn_agent needs gateway-wired runtime for full research-lite agent steps; durability of admit path is the SOE for this bead |
| Portal UI card for this CLI-launched run | Optional UIQA | Launch was guest CLI; UI path already GO in `lp-zuh.7.5` |

## How to re-verify (ops)

```bash
# Guest
grep -A6 '^workflow:' /var/lib/company-brain-backend/config.yaml
# expect state_dir: /mnt/vault
test -w /mnt/vault/workflows && mkdir -p /mnt/vault/workflows/_probe && rmdir /mnt/vault/workflows/_probe
# After LA pin with ENOSYS fix:
export LANYARD_CONFIG=/var/lib/company-brain-backend/config.yaml
lanyard-agent workflow run research-lite --budget 8 \
  --args '{"question":"GPU residual lp-zuh.10.5 re-verify"}'
ls -la /mnt/vault/wf_*/state.json

# External
aws s3 ls s3://lanyard-mocklab-vault-123456789012/tenants/<tenant>/vault/ | grep wf_
```

## Secret hygiene

- No tokens, passwords, AWS keys, or Relay secrets in this pack.
- Args question is synthetic lab content (GPU planning theme).
