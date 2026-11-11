# Compaction Sub-Agent Invocation

## Why not `delegate_task`

`delegate_task` subagents inherit the parent session's model. Hermes DOES
support a model override for delegation, but only as a **global**
`config.yaml` setting (`delegation.model` / `delegation.provider`) that
applies to every subagent, always — there's no per-call model parameter.
That's fine if you want ALL delegation routed to one fixed cheap model
forever, but wrong for THIS pattern, where the small model must vary by
whichever provider the primary session is currently on. So: spawn a pinned
one-shot Hermes process instead.

## The call

```bash
hermes chat -q "<compaction prompt>" -m <small_model> --provider <small_provider> -t file -Q
```

- `-m` / `--provider` — from `model-routing-table.md`, matched to the
  *current* primary session's provider (not model name).
- `-t file` — the task is pure text reasoning over pasted candidates, no
  tool access needed. Minimal toolset = faster cold start. Omit entirely if
  even `file` isn't needed.
- `-Q` — quiet mode, clean stdout for parsing (no banner/spinner noise).

## Prompt shape

```
Downstream task: <the SPECIFIC task the next stage will do with this context,
e.g. "Write the Investment section justifying platform-tier + first-workflow
pricing for Acme Corp's SOW.">

Candidate chunks (with IDs):
[1] "<chunk text>" (source: notes/discovery-call.md)
[2] "<chunk text>" (source: pricing.md)
... (up to ~20)

Return ONLY the IDs of chunks that are load-bearing for the downstream task
above, one per line, each followed by a 5-10 word reason. Drop chunks that
are topically related but not actually needed to write this specific output.
```

Key discipline: state the **downstream task**, not the original retrieval
query. Those two are often different — that gap is exactly what this
compaction pass is filtering for.

## Parsing the result

Sub-agent stdout should be a short list of `[N] reason` lines. Parse the IDs,
reassemble the filtered set using the ORIGINAL chunk text + source
attribution — never hand the sub-agent's paraphrase forward, only its
selection. Use `templates/candidate-chunk-list.md` for the candidate-list
format so IDs and source attribution stay consistent call to call.

## Verified example (tested 2026-07-02)

A real end-to-end run against the live Lanyard vault confirmed the pattern:

```bash
# 1. Wide-cast retrieval (see wide-cast-retrieval.md)
mempalace search "client status pipeline stage deal risk churn revenue" --results 20

# 2. Compaction call — primary session was on openrouter, so per
#    model-routing-table.md the sub-agent was pinned to deepseek/deepseek-v4-flash
hermes chat -q "$PROMPT" -m deepseek/deepseek-v4-flash --provider openrouter -t file -Q
```

Out of 12 representative candidates (mixing real client signals with
deliberately-irrelevant strategy/research noise), the sub-agent correctly kept
only the load-bearing ones and dropped the rest.

## Verification (do this before trusting it blind)

1. Run once with a >10-chunk candidate set; confirm the returned filtered
   set is materially smaller and every ID maps back to a real chunk.
2. Spot-check a few runs: compare the downstream agent's output citations
   against the filtered set to confirm nothing load-bearing got dropped.
3. **Don't trust the echoed `-m`/`--provider` flags alone** — confirm the
   call actually landed on the intended model by checking the session
   record it prints (`session_id: ...`):
   ```bash
   hermes sessions export /tmp/check.jsonl --session <session_id>
   grep -o '"model": *"[^"]*"' /tmp/check.jsonl | head -1
   ```
   Or run `scripts/verify-compaction-model.sh <session_id> <expected_model>`
   for the same check as a one-liner.

## Common failure: this is not a native Hermes routing feature

If you find yourself expecting `delegate_task(model=...)` per-call — it
doesn't exist. This whole invocation pattern exists BECAUSE that gap is
real. Don't reach for `delegate_task` here.
