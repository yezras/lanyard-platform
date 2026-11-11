# lp-uxy.15.5 — NL job create from chat + Settings refresh ship QA

**Shipped feature:** lp-uxy.4 (NL cron create + Settings inventory refresh)
**Base URL:** `http://demo.localhost:3010`
**Login:** `dev@demo.local` / `local-dev-password`
**Method:** web-ui-testing (Playwright headless Chromium)
**Job marker (live):** `shipqa-nl-cron-20260805140007`

## Verdict

| Surface | Result |
|---------|--------|
| Portal UI story create (`?story=nl-cron-create-settings`) | **PASS** |
| Story capability-off honesty | **PASS** |
| Live NL create → Settings (LA host) | **FAIL** (product: no create tool) |
| Overall ship-qa for Portal consumer | **PASS** with host fix filed |

## Story fixture create mode

Deterministic proof of mutator → debounced inventory refresh → Crons row
without full page reload (shipped with lp-uxy.4).

- Chrome + Crons intro (“Create scheduled jobs by asking the agent…”)
- Jobs before: `(none)`
- Click **Simulate agent cronjob create**
- Jobs after: **Daily vault index** in probe + `crons-table`
- Proof state: `createSimulated=true`, `lastToolMutating=true`, snapshot fetches=3
- Shots: `01-story-create-before.png`, `02-story-create-after-refresh.png`

Assertions (Playwright):

```json
{
  "intro_visible": true,
  "intro_mentions_agent": true,
  "jobs_before": "(none)",
  "jobs_after": "Daily vault index",
  "table_has_new_job": true,
  "no_full_reload": true,
  "create_simulated": true,
  "last_tool_mutating": true,
  "snapshot_fetch_count": 3
}
```

## Story fixture capability-off

`?story=nl-cron-create-settings&mode=capability-off`

- `crons-capability-notice` visible (features.cron / cron_manager honesty)
- Seeded job **LA vault index refresh** still listed
- Shot: `03-story-capability-off.png`

## Live NL chat → Settings Crons (Lanyard Agent via Brain RPC)

| Check | Result |
|-------|--------|
| Login + Settings Crons list (baseline jobs present) | **PASS** |
| New chat + NL prompt to create unique job | **PASS** (sent) |
| Agent creates durable job | **FAIL** — no create tool |
| Settings shows new marker after soft/hard refresh | **FAIL** |

Baseline Settings Crons (list path works via Brain RPC):

- LA vault index refresh (Enabled)
- LA weekly digest (Disabled)
- LA manual start example (Enabled)

Assistant reply (shot `13-live-chat-after-response.png`):

> **Scheduled jobs are not configured** on this Lanyard host.
> No cron/job scheduling tool or surface is available (or implemented) in the
> Lanyard Agent environment. Cannot create `shipqa-nl-cron-20260805140007` or
> any other cron entry.

Settings Crons after soft refresh and hard reload: same three jobs; unique
marker absent (`14`–`15`). Live Settings also shows capability honesty notice
(features.cron / cron_manager not fully advertised) while still listing jobs.

Root cause (host product): Lanyard Agent does not expose a working NL
cron/job **create** tool in this environment, even though settings.snapshot
returns existing jobs. Portal consumer path (mutator → inventory refresh) is
proven by the story fixture.

## Fix bead

Filed from this QA: **lp-uxy.17** — LA expose cronjob create tool for NL job
create (live ship-qa residual). Related residual pin: **lp-86d.8**.

## Artifacts

| File | What |
|------|------|
| `01-story-create-before.png` | Story Crons empty before simulate |
| `02-story-create-after-refresh.png` | Daily vault index after simulate |
| `03-story-capability-off.png` | Capability honesty notice + seeded job |
| `10-live-settings-crons-before.png` | Live Settings baseline jobs |
| `11-live-chat-ready.png` | New chat composer |
| `12-live-prompt-sent.png` | NL create prompt sent |
| `13-live-chat-after-response.png` | Host “not configured / no tool” reply |
| `14-live-settings-crons-after.png` | Settings after soft path |
| `15-live-settings-crons-after-reload.png` | Settings after hard reload |
| `REPORT.json` | Machine-readable results |
| `RESULT.md` | This note |

## Notes

- Brain RPC was enabled (lp-uxy.15.1); Settings list shows LA-sourced jobs.
- Story path is the shipped Playwright surface for NL create → Settings refresh.
- Live path exercises host product create; residual is host-side, not Portal UI.
- No Portal code fix required for this bead; host follow-up is the fix bead.
