# lp-uxy.7 — Web search / Firecrawl structured results

**Bead:** `lp-uxy.7`  
**Story:** `/?story=web-search-results`  
**Cost gate:** fixture-only — `data-firecrawl-live="false"` / `data-cost-gated="true"`  
**No live `FIRECRAWL_API_KEY` calls in this proof.**

## What this proves

1. Tool rows for `firecrawl_search` / `firecrawl_scrape` / `x_search` show
   expandable **structured cards** (title, host, snippet, provider badge).
2. Final answer **rich web citation chips** show title + snippet and open the
   exact external URL in a new tab (not the vault document pane).
3. Secrets slots documented for pilot (`FIRECRAWL_API_KEY`, `X_BEARER_TOKEN`, …)
   with placeholders only — never committed real keys.

## How to re-run

```bash
# Unit / RTL (from portal/)
pnpm --filter @lanyard/web test -- webCitations WebSearchResults ChatMessageContent

# Story (dev server)
# open http://localhost:5173/?story=web-search-results
```

## Files

| Path | Role |
| --- | --- |
| `web-search-results.json` | Machine-readable fixture evidence |
| `portal/packages/web/src/features/chat/WebSearchResultsProofStory.tsx` | Auth-free story |
| `docs/architecture/portal-web-search-firecrawl.md` | Normative provider + wire contract |

## Acceptance mapping

| Criterion | Evidence |
| --- | --- |
| Firecrawl (+ others) documented and secret-wired | docs + envelope examples + `env.secrets.example` |
| Chat shows structured results beyond bare URLs | story + unit tests + this artifact |
| Final answer cites sources with openable links | rich citation chips open `window.open(url)` |
| Playwright or manual evidence under `artifacts/ui/` | this directory + RTL story test |

## Review fix (recovery wave)

Snippet/metadata correctness:

- `resolveCitationList` **preserves** `snippet` on http(s) citations (rich final chips)
- Tool rows pass `metadata.search_results` through `ChatTimelineToolCall.metadata`
- Parse edge cases: Firecrawl `{data:{markdown,metadata}}`, wrapper `results[]` pollution,
  JSON-string metadata, empty arrays fallthrough, URL-shaped `source` ≠ provider badge
