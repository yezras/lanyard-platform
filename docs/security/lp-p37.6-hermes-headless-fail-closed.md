# lp-p37.6 — Hermes headless dangerous actions fail closed

**Status:** implemented in hermes-lanyard (external runtime)  
**Bead:** `lp-p37.6` (parent epic `lp-p37`)  
**Priority:** P0 security (July 2026 audit)

## Problem

Hermes dangerous shell approval (`check_dangerous_command` /
`check_all_command_guards`) and `execute_code` approval
(`check_execute_code_guard`) returned **approved** in local non-interactive
non-gateway contexts. Unattended or prompt-injected sessions could therefore
run host-impacting shell commands or arbitrary Python unless the operator had
explicitly enabled yolo / `approvals.mode: off`.

## Fix (hermes-lanyard)

Implementation lives in **LanyardBrain/hermes-lanyard** (backend runtime is
external to this monorepo by design):

| Item | Value |
|------|--------|
| Branch | `beads/lp-p37.6-p0-security-make-hermes-headless-dangero` |
| Commit | `256f77e1cad80a46784ba53eee0e0f59dcb2e737` |
| PR | https://github.com/LanyardBrain/hermes-lanyard/pull/23 |

### Policy

- **Default deny** when no interactive CLI (`HERMES_INTERACTIVE`), gateway, or
  ask surface is present — for dangerous shell patterns and for `execute_code`
  on host-reaching backends (`local`, `ssh`, Docker with host bind mounts).
- **Cron** continues to use `approvals.cron_mode` (default `deny`).
- **Trusted opt-ins** (documented in Hermes security guide):
  - `--yolo` / `/yolo` / `HERMES_YOLO_MODE` (session/process)
  - `approvals.mode: off` (global recoverable-approval bypass)
  - `approvals.noninteractive_mode: approve` (**new**, headless-only opt-in;
    default `deny`)
  - `approvals.cron_mode: approve` (cron-only)
- **Isolated sandboxes** (Docker without host mounts, Singularity, Modal,
  Daytona, `vercel_sandbox`) still skip the host-impact guards.

### Key code

- `tools/approval.py` — `_get_noninteractive_approval_mode()`,
  `_run_approval_gate(fail_closed_when_no_human=True)` for dangerous shell,
  headless branch of `check_all_command_guards` and `check_execute_code_guard`
- `hermes_cli/config.py` — default `approvals.noninteractive_mode: deny`
- `website/docs/user-guide/security.md` — headless / noninteractive section

### Verification

```text
pytest tests/tools/test_headless_fail_closed.py \
       tests/tools/test_execute_code_approval_cluster.py \
       tests/tools/test_cron_approval_mode.py \
       tests/tools/test_request_tool_approval.py \
       tests/acp/test_approval_isolation.py \
       tests/tools/test_approval.py -q
# 398 passed
```

## Platform follow-ups

- Pin / ship a hermes-lanyard runtime artifact that includes commit
  `256f77e1c` (or later) before declaring staging/production remediated.
- Operators who rely on headless automation for dangerous actions must set
  an explicit trusted mode; silent auto-approve is no longer the default.
