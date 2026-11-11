-- self-improve eval database schema
-- Canonical copy: ~/Core/skills/self-improve/references/schema.sql
-- Deploy target: <VaultRoot>/evals.db
-- Rules: WAL mode, append-only (INSERT; the only UPDATEs allowed are fixes.status transitions).
-- Hermes state.db is NEVER written; episodes anchor to its message ids read-only.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO schema_version (version) VALUES (1);

-- One row per nightly run
CREATE TABLE IF NOT EXISTS eval_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  window_start TEXT NOT NULL,          -- ISO8601 window over state.db sessions
  window_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed')),
  sessions_seen INTEGER DEFAULT 0,
  episodes_created INTEGER DEFAULT 0,
  fixes_applied INTEGER DEFAULT 0,
  fixes_proposed INTEGER DEFAULT 0,
  notes TEXT                            -- error detail on failure
);

-- Task episodes segmented out of user-facing sessions
CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eval_run_id INTEGER NOT NULL REFERENCES eval_runs(id),
  session_id TEXT NOT NULL,             -- state.db sessions.id
  session_source TEXT,                  -- tui | slack | telegram | ...
  first_message_id INTEGER NOT NULL,    -- state.db messages.id anchors
  last_message_id INTEGER NOT NULL,
  goal_summary TEXT,                    -- one-line inferred goal
  features_json TEXT NOT NULL DEFAULT '{}',  -- behavioral features (Phase 4)
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id);
CREATE INDEX IF NOT EXISTS idx_episodes_run ON episodes(eval_run_id);

-- Judge verdicts. Append-only: corrections insert a new row pointing at the old one.
CREATE TABLE IF NOT EXISTS verdicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES episodes(id),
  eval_run_id INTEGER NOT NULL REFERENCES eval_runs(id),
  verdict TEXT NOT NULL
    CHECK (verdict IN ('success','friction','failure','abandoned')),
  score REAL CHECK (score BETWEEN 0.0 AND 1.0),
  failure_attribution TEXT,             -- component enum, see judge-rubric.md; NULL on success
  attribution_detail_json TEXT DEFAULT '{}',  -- evidence quotes, judge reasoning, precedence source
  judge_model TEXT,
  supersedes_verdict_id INTEGER REFERENCES verdicts(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_verdicts_episode ON verdicts(episode_id);
CREATE INDEX IF NOT EXISTS idx_verdicts_attribution ON verdicts(failure_attribution);

-- Nightly mechanical cron health (Population 2; never judged)
CREATE TABLE IF NOT EXISTS cron_health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eval_run_id INTEGER NOT NULL REFERENCES eval_runs(id),
  job_id TEXT NOT NULL,
  job_name TEXT,
  ran INTEGER NOT NULL DEFAULT 0,       -- 0/1
  exit_clean INTEGER,                   -- 0/1, NULL if not run
  delivered INTEGER,                    -- 0/1
  tool_errors INTEGER DEFAULT 0,
  session_id TEXT,                      -- state.db session of the run, if found
  detail_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cron_health_job ON cron_health(job_id, created_at);

-- Fixes: auto-applied or proposed. status transitions are the ONLY permitted UPDATEs.
CREATE TABLE IF NOT EXISTS fixes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eval_run_id INTEGER NOT NULL REFERENCES eval_runs(id),
  episode_id INTEGER REFERENCES episodes(id),      -- NULL for cron-failure fixes
  cron_health_id INTEGER REFERENCES cron_health(id),
  component_type TEXT NOT NULL
    CHECK (component_type IN ('skill','cron','mcp','memory','connector','cli','config','docs')),
  component_name TEXT NOT NULL,          -- e.g. 'gws-gmail-send', 'daily-client-task-update'
  failure_signature TEXT NOT NULL,       -- normalized signature for regression matching
  tier TEXT NOT NULL CHECK (tier IN ('auto','proposal')),
  diagnosis TEXT NOT NULL,
  diff TEXT,                             -- unified diff (revertible); required when tier='auto'
  verification_evidence TEXT,            -- repro + passing re-run output; required when tier='auto'
  watch_condition TEXT,                  -- e.g. 'skill gws-gmail-send invoked'
  watch_until TEXT,                      -- date, +7 nights from apply
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','approved','rejected','applied','validated','regressed','reverted')),
  status_updated_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fixes_component ON fixes(component_type, component_name);
CREATE INDEX IF NOT EXISTS idx_fixes_status ON fixes(status, watch_until);

-- Circuit breaker: frozen components are propose-only until a human lifts the freeze
CREATE TABLE IF NOT EXISTS component_freezes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_type TEXT NOT NULL,
  component_name TEXT NOT NULL,
  reason TEXT NOT NULL,                  -- 'auto-patched 2x in 7d' | 'regressed fix'
  frozen_at TEXT DEFAULT (datetime('now')),
  lifted_at TEXT,                        -- set by human only
  UNIQUE (component_type, component_name, frozen_at)
);
