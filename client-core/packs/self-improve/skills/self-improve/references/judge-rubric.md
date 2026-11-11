# Judge rubric — self-improve episode scoring

The judge subprocess (Grok 4.3 via `hermes chat -q`, prompt tagged `[self-improve-internal]`) receives per episode: the transcript (tool results truncated) + the Phase 4 behavioral feature block. It returns STRICT JSON only.

## Output contract

```json
{
  "verdict": "success | friction | failure | abandoned",
  "score": 0.0,
  "failure_attribution": "<enum below or null>",
  "attribution_detail": {
    "component_name": "<specific skill/cron/mcp/connector name>",
    "evidence": ["<short quote from transcript>", "..."],
    "reasoning": "<2-3 sentences>",
    "precedence_source": "explicit | behavioral | inference"
  }
}
```

## Verdicts

| Verdict | Definition |
|---|---|
| `success` | Goal achieved with no user corrections. One clarifying question by the AGENT asked proactively does not disqualify. |
| `friction` | Goal eventually achieved but the user had to correct, rephrase, or re-steer ≥1 time, or the agent burned visible retry loops / tool errors on the way. |
| `failure` | Goal not achieved; user gave up on THIS approach or output was wrong/unusable and session moved on. |
| `abandoned` | Episode ends on an unresolved user turn; session dies mid-goal. Distinguish from "user satisfied and left" — a completed deliverable followed by silence is `success`. |

Score: 1.0 clean one-shot success → 0.0 total failure. Friction typically 0.4–0.7 scaled by wasted turns.

## Precedence (binding)

1. **Explicit user feedback** in transcript ("perfect", "that's wrong", "forget it") — overrides everything.
2. **Behavioral features** (corrections, retries, abandonment) — override your own impression.
3. **Judge inference** — only where 1 and 2 are silent or ambiguous (e.g. distinguishing "5 turns because agent failed" from "5 turns because the task legitimately evolved" — evolution is NOT friction).

Record which level decided in `precedence_source`.

## failure_attribution enum

Name the **component responsible**, not the symptom. Required for `friction`/`failure`/`abandoned`; null for `success`.

| Enum value | Use when |
|---|---|
| `skill-instructions` | A skill was loaded and followed but its instructions were wrong/stale/incomplete (name it) |
| `skill-missing` | No skill existed for a clearly recurring task shape; agent improvised badly |
| `tool-failure` | A Hermes tool or CLI errored / behaved unexpectedly (gws, wacli, ob, sqlite3, ...) |
| `mcp-failure` | MCP server unavailable, auth-expired, or returned bad data (granola, etc.) |
| `memory-recall` | MemPalace/memory returned stale, wrong, or empty recall that misdirected the agent |
| `memory-missing` | Durable fact should have been in memory/AGENTS.md but wasn't; user had to re-explain |
| `cron-dependency` | Episode failed because an upstream cron job hadn't run or ran broken |
| `model-capability` | The model itself reasoned poorly despite correct context and working tools |
| `context-routing` | Agent read the wrong files / skipped AGENTS.md discovery / flooded context |
| `user-ambiguity` | The request was genuinely under-specified; no component at fault. NOT a component fix — at most a docs improvement |
| `external-system` | Third-party system (API outage, rate limit, permission change) outside the brain's control |

## Attribution discipline

- Point at the most **upstream** cause: if stale memory led the agent to call the wrong tool, that's `memory-recall`, not `tool-failure`.
- Evidence quotes are mandatory — an attribution without a transcript quote will be discarded by the orchestrator.
- If torn between two components, pick the one whose repair would have prevented the episode; note the runner-up in `reasoning`.
- Be conservative with `model-capability`: it's the attribution of last resort, and it generates no auto-fix (only model-routing proposals).
