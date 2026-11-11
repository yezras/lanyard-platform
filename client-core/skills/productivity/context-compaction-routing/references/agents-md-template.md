# AGENTS.md Trigger Block

Copy into any client/project/pipeline `AGENTS.md` to make agents operating
under it apply query-conditioned compaction automatically.

```markdown
## Context Compaction (Query-Conditioned Filtering)

When handing retrieved context (MemPalace/RAG results, notes, prior-stage
output) from one pipeline stage to another, and the candidate set exceeds
~8 items:

1. Cast retrieval wide first (see `context-compaction-routing`
   references/wide-cast-retrieval.md).
2. Do NOT pass the full candidate set, or an LLM summary of it, straight to
   the downstream stage.
3. Delegate a compaction-filter step to a small/cheap model, scored against
   the SPECIFIC downstream task (not the original search query) — see
   references/compaction-invocation.md.
4. Pick the small model from the current session's active provider — see
   references/model-routing-table.md.
5. Pass forward only the filtered, source-attributed chunk set — never a
   paraphrase of it.
```

## Skip this pattern when

- Candidate set is small (under ~5 chunks) — pass everything through, filtering
  overhead isn't worth it
- Primary session provider is already a cheap model (e.g. deepseek) — the
  extra round-trip rarely pays for itself
