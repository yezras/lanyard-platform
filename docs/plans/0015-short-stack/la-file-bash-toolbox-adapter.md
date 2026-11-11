# 0015.27 — LA file/bash toolbox adapter

**Bead:** `lp-oop.27`  
**Epic:** `lp-oop` (plan 0015 / ADR 0012)  
**LA repo:** [LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent)

Cross-repo note: the live file/bash adapter lives in `lanyard-agent`, not Portal. This file records the LA PR + SHA so platform close evidence stays in-tree.

## Behavior

For the short-stack harness profile, v1 file tools call `ToolboxClient.execute` instead of the harness host filesystem or guest product tree:

| Tool | Guest argv |
|---|---|
| `bash` | `bash -lc <command>` |
| `read` | `cat -- <path>` or `sed -n <range>p` |
| `ls` | `ls -la -- <path>` |
| `grep` | `grep -R -n -I … -- <pattern> <path>` |
| `find` | `find <path> -name <pattern>` |

`ToolboxExec { sandbox_id, argv, cwd, timeout_ms }` → `{ stdout, stderr, exit_code }`. Types lockstep with `@lanyard/shared` (lp-oop.24 / `.25`). Tests use in-memory `FakeToolbox`. No live Daytona.

Product-install paths under `/opt/company-brain-backend` are rejected before exec.

`ensure_online(tenant, user)` bind is `lp-oop.28`.

## LA ship

| Field | Value |
|---|---|
| PR | https://github.com/LanyardBrain/lanyard-agent/pull/243 |
| SHA | `6bfd52210c194380041bc8581d836f078ed76378` |
| Branch | `beads/lp-oop.27-la-file-bash-toolbox-adapter` |
| Stacks on | LA #242 (`lp-oop.26`) |
