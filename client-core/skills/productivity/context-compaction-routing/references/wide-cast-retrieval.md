# Wide-Cast Retrieval (Before Compacting)

The compaction filter only works if the candidate set going into it is
generous. Narrow retrieval defeats the purpose — you'd be filtering an
already-thin set. Cast wide first using MemPalace, then compact.

## Mine (file away)

Get new/changed vault content into the palace before it's searchable:

```bash
mempalace mine "<client-root>" --wing "<slug>" --mode projects
```

- Idempotent for unchanged files — safe to re-run after any vault edit.
- `--dry-run` to preview without writing.
- Always run after `ob sync`, per the vault's mandatory sync rule.

## Search (wide cast)

Pull MORE candidates than you'd normally want for direct use — 15-20, not 5:

```bash
mempalace search "<broad topic query>" --wing <slug> --results 20
```

- Use the **topic/source** query here (what the retrieval is broadly about),
  not the specific downstream task — that distinction is exactly why a
  second compaction pass matters (see `compaction-invocation.md`).
- Prefer `--wing <slug>` (client-scoped) over unscoped search — noisier
  otherwise.
- Cross-client / methodology lookups: `--wing lanyard-company`.

## Query (natural-language, cross-note)

For open-ended "what did we decide/discuss" questions spanning multiple
notes, prefer the native `mcp_granola_query_granola_meetings`-style natural
language query pattern where available, or `mempalace search` with a broader
phrase and higher `--results` when only vault content (not meeting
transcripts) is in scope.

## Pitfalls

- **Fresh-mine search lag:** after a bulk `mine`, wing-scoped search can
  fail for ~30-60s while Chroma flushes. Retry once, or fall back to
  unscoped search.
- **Don't skip straight to top-5 similarity search** and call it done —
  that's the exact lossy pattern this whole skill exists to avoid.
