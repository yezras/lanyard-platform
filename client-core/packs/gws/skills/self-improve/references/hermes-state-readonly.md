# Hermes `state.db` — read-only contract for self-improve

**Path:** `~/.hermes/state.db` (or profile-specific under `~/.hermes/profiles/<name>/`).

**Rule:** Open **read-only** only:

```python
import sqlite3, os
uri = f"file:{os.path.abspath(path)}?mode=ro"
conn = sqlite3.connect(uri, uri=True)
```

Never `INSERT`/`UPDATE`/`DELETE` on this file from self-improve tooling.

## Tables used

| Table | Purpose |
|-------|---------|
| `sessions` | `id`, `source`, `parent_session_id`, `started_at`, `ended_at`, `title` |
| `messages` | `id`, `session_id`, `role`, `content`, `tool_name`, `timestamp`, `active` |

Episode anchors: `episodes.first_message_id` / `last_message_id` → `messages.id`.

## Population filters (see SKILL.md Phase 1)

- **User-facing:** `source NOT IN ('cron','subagent')` AND `parent_session_id IS NULL`
- **Cron health:** `source = 'cron'`
- **Exclude:** session `id` prefix `cron_<self-improve-nightly-job-id>`; first user message contains `[self-improve-internal]`

## Helper script

```bash
python3 <Core>/skills/self-improve/scripts/self_improve_tools.py list-sessions \
  --window-start 2026-07-07T00:00:00+00:00 \
  --window-end 2026-07-08T00:00:00+00:00 \
  --population user \
  --exclude-cron-job-id <JOB_ID>
```

Schema reference: Hermes `hermes_state.py` (`SCHEMA_SQL`).