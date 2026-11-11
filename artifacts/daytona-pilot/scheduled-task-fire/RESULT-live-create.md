# lp-jzl.8 — Live create + list (localhost pilot)

| Field | Value |
| --- | --- |
| **When (UTC)** | 2026-08-10 (session) |
| **Mode** | Live localhost pilot (not Daytona sandbox fire) |
| **Platform** | [lanyard-platform#355](https://github.com/LanyardBrain/lanyard-platform/pull/355) on `main` |
| **Agent** | [lanyard-agent#233](https://github.com/LanyardBrain/lanyard-agent/pull/233) on `main` |
| **Verdict** | **PASS** for create UI + create chat + list |

## Stack

| Component | Endpoint / note |
| --- | --- |
| Portal web | `http://127.0.0.1:3010` |
| Control plane | `http://127.0.0.1:3100` (health ok; Daytona/evaluator not required for create) |
| Relay | `http://127.0.0.1:8787` |
| Lanyard Agent gateway | `http://127.0.0.1:9100` |
| LiteLLM | `http://127.0.0.1:4001` |
| Product job store | `~/.lanyard-agent/cron/jobs.json` |

## Checks

| Check | Result |
| --- | --- |
| Settings → Scheduled tasks list | Visible (post `features.cron` / snapshot) |
| Settings → New scheduled task form | Creates job via Brain RPC `settings.patch` `cron.create` |
| Chat: agent `cronjob` **action=setup** | Opens Portal MCQ wizard (tool-driven, not NL hardcode) |
| Chat wizard complete → create | Job written; Settings inventory refresh |
| List both (UI + chat origins) | Multiple jobs present including smoke + user creates |

## Sample job ids present (redacted names only)

From local `jobs.json` after pilot work (ids only; no prompts):

- `st-smoke-scheduled-task-5077c7` (programmatic smoke create)
- `st-test-510252` and other `st-*` / chat-created rows as applicable
- Prior pilot fixtures (`la-vault-index`, etc.) still listed

## Explicitly not proven here

- Platform `fireScheduledTask` → `ensure_online` (Daytona cold/warm wake)
- Schedule evaluator due scan against platform SoT with live agent job runner
- Idle reaper stop + rematerialize after live fire

Those remain **§2 residual** in [EVIDENCE.md](./EVIDENCE.md) under OPERATOR HOLD / pilot CP wiring gaps.
