# Candidate Chunk List — Template

Copy this format when building the candidate list for a compaction prompt
(see `references/compaction-invocation.md`). One line of context per chunk,
stable numeric ID, explicit source path — never bare text with no provenance.

```
[1] (source: <wing>/<file>.md) <one-line paraphrase or key excerpt of the chunk's content>
[2] (source: <wing>/<file>.md) <...>
...
[N] (source: <wing>/<file>.md) <...>
```

Rules:
- IDs are the ONLY thing the sub-agent should reference back — never ask it
  to reproduce or rewrite chunk content.
- Always carry the source path through, even in the paraphrase — this is
  what lets you reassemble the filtered set with real attribution afterward.
- Cap around 15-20 chunks per call; above that, split into two compaction
  calls rather than growing one prompt indefinitely.
