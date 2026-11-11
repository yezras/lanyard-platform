# lp-zuh.10.5 — pilot evidence (workflow vault state_dir)

**Sandbox:** `7a300050-5316-44c9-b140-a6c51d3f66ce`  
**Run:** `wf_7fad97d2e324fa00`  
**S3 prefix:** `tenants/319d3808-e533-44db-bfdf-7b6ef8caaae1/vault/wf_7fad97d2e324fa00/`

## Guest config (excerpt)

```yaml
workflow:
  enabled: true
  agent_budget: 128
  max_active_runs: 16
  state_dir: /mnt/vault
  definition_roots:
    - /mnt/vault/workflows
```

## Checks

| Check | Result |
|-------|--------|
| Mountpoint R/W | WRITABLE_YES |
| `mkdir` `/mnt/vault/workflows` | WORKFLOW_MKDIR_OK |
| Hybrid `$BACKEND_HOME/state/workflows` | absent |
| S3 objects for run | program/args/state/journal present |
| Stop → start remount | REMOUNT_VISIBLE_OK |

## Companion files

- `guest-pre-stop.txt` — config + state + mkdir + hybrid check  
- `guest-after-remount.txt` — post stop/start listing  
- `s3-vault-root.txt` / `s3-run-dir.txt` — external durability  

Full narrative: [`artifacts/mocklab/live-qa/lp-zuh.10.5/RESULT.md`](../../mocklab/live-qa/lp-zuh.10.5/RESULT.md).
