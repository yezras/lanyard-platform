# Portal web search upgrade — Firecrawl / X / structured results

**Bead:** `lp-uxy.7` (parent epic `lp-uxy`)  
**Status:** monorepo contracts + Portal UI + secrets slots (2026-08-04)  
**Audience:** Portal, Hermes-Lanyard / Lanyard Agent tool authors, deploy operators  
**Related:** [`portal/artifacts/hermes-lanyard-tool-citations-contract.md`](../../portal/artifacts/hermes-lanyard-tool-citations-contract.md), [`backend-runtime-secrets.md`](backend-runtime-secrets.md), lp-95v.5 web citation chips

---

## 1. Clarification

**Omnibox Mode A** is an OS sandbox for host-impacting tool children — **not** a
Chrome-style search omnibox UI. Web search remains **host tools**
(`web_search`, Firecrawl, optional X, Tavily/Brave, …) with Portal labeling
("Searching the web" / "Browsing the web") and citation chips.

This monorepo does **not** ship a search engine. Backend agent products emit
tool_progress + citations; Portal renders them.

---

## 2. Provider stack (product intent)

| Provider | Tool ids (bare) | Role | Cost |
| --- | --- | --- | --- |
| Existing host `web_search` | `web_search`, `tavily_search`, `brave_search`, … | SERP-style hits | Provider-dependent |
| **Firecrawl** (primary upgrade) | `firecrawl_search`, `firecrawl_scrape`, `firecrawl_crawl`, `firecrawl_map`, `firecrawl_extract` | Crawl / scrape / map / extract → agent-usable page content | **Paid — cost-gated** |
| **X** (optional) | `x_search`, `twitter_search`, `x_keyword_search`, … | Social search hits | API-plan dependent |
| Optional SERP | `TAVILY_API_KEY`, `BRAVE_API_KEY` env | Existing host search tools | Provider-dependent |

**Not Firebase.** Firecrawl is the crawl/scrape product.

### Cost gate (normative)

- **Do not** call live paid Firecrawl unless `FIRECRAWL_API_KEY` is present in
  host env (materialized from SM).
- Git templates use placeholders only (`fc-placeholder-…`). Live SM **omits**
  the key until the pilot intentionally enables Firecrawl (budget sign-off).
- Portal UI + proof story work **entirely on fixtures** without any API key.
- New recurring cost when enabled: Firecrawl usage (per scrape/crawl volume).
  Optional: X API tier if `X_BEARER_TOKEN` is set.

---

## 3. Secrets / env slots

| Env name | Purpose | Live SM |
| --- | --- | --- |
| `FIRECRAWL_API_KEY` | Firecrawl API | Omit until cost-approved |
| `X_BEARER_TOKEN` | Optional X search | Omit until needed |
| `TAVILY_API_KEY` | Optional Tavily search | Omit until needed |
| `BRAVE_API_KEY` | Optional Brave search | Omit until needed |

Wiring:

- Envelope examples: `contracts/backend-runtime-v1/examples/secrets-envelope.*.json`
- Schema teaching keys: `secrets-envelope.schema.json` → `x-lanyard-recommended-env-keys`
- Host template: `deploy/litellm/env.secrets.example` (also co-materialized on
  agent hosts as `$BACKEND_HOME/.env.secrets` / `$HERMES_HOME/.env.secrets`)

Never commit real keys. Materialize mode `0600` only.

---

## 4. Host wire contract (structured results)

### Tool progress

Same as existing `portal_event: "tool_progress"`. Preferred tool ids:

| Phase | `tool_name` | Friendly Portal label |
| --- | --- | --- |
| Search | `firecrawl_search` / `web_search` / `x_search` | Searching the web |
| Scrape / crawl | `firecrawl_scrape` / `firecrawl_crawl` / `firecrawl_map` | Browsing the web |

On **complete**, put structured hits in **one** of:

1. **`result`** — JSON array or `{ "results": [ … ] }` (preferred; also works
   as fenced ```json)
2. **`metadata.search_results`** / `metadata.web_results` / `metadata.results`

Each hit:

```json
{
  "url": "https://example.com/page",
  "title": "Human title",
  "snippet": "Short excerpt for the card",
  "published_at": "2026-01-15",
  "content_summary": "Optional longer extract (Firecrawl scrape markdown truncated)",
  "provider": "firecrawl"
}
```

Aliases accepted by Portal: `link`/`href`/`path` for url; `description`/`summary`
for snippet; `markdown`/`content` for content_summary. Firecrawl nested
`data.metadata.sourceURL` / `description` is flattened. A URL-shaped `source`
field is **not** treated as the provider badge.

Firecrawl single-page scrape may be a **single object** (not array) with
`url` + `title` + `markdown`, or `{ data: { markdown, metadata: {…} } }`.
Wrapper objects that also carry a top-level `url` next to `results[]` do **not**
create an extra hit.

### Final answer citations

```json
{
  "op": "send",
  "chat_id": "<thread_id>",
  "content": "Answer markdown…",
  "metadata": {
    "citations": [
      {
        "path": "https://example.com/page",
        "title": "Human title",
        "snippet": "Optional excerpt for rich chip"
      }
    ]
  }
}
```

`path` (or `url`) must be the **exact** http(s) source URL. Portal opens it in
a new tab (never the vault document pane).

If the host omits structured citations, Portal still promotes:

- URLs from web tool results (structured titles when parseable)
- http(s) URLs already present in the final answer prose (lp-95v.5)

---

## 5. Portal presentation

| Surface | Behavior |
| --- | --- |
| Tool row | `Searching the web` / `Browsing the web`; expandable detail shows **card list** (title, host, snippet, provider badge) when results parse |
| Final answer | Rich web citation cards when `snippet` present; compact globe Token otherwise; both open exact URL |
| Story | `?story=web-search-results` — fixture-only, `data-cost-gated="true"` |
| Implementation | `portal/packages/web/src/features/chat/webCitations.ts`, `WebSearchResults.tsx`, `ChatMessageContent.tsx`, `ChatTimeline.tsx` |

---

## 6. Daytona Tier-1 egress (MockLab residual `lp-zuh.10.1`)

LA `web_search` dials **provider SERP hosts only** (not every result URL). On
managed Daytona Tier-1 sandboxes, create-time `domainAllowList` must include
those hosts or the tool emits `fetch failed` / proxy errors (live QA
`lp-zuh.7.2`).

| Provider (auto) | Hostnames for `DAYTONA_DOMAIN_ALLOWLIST` |
| --- | --- |
| DuckDuckGo (default, free) | `html.duckduckgo.com`, `duckduckgo.com` |
| Tavily | `api.tavily.com` |
| Brave | `api.search.brave.com` |
| Firecrawl search | `api.firecrawl.dev` |

CP catalog + merge helper: `DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST` /
`mergeDaytonaWebSearchDomainAllowList` in `@lanyard/control-plane`. Full
operator catalog: [`production-network-allowlist.md`](../plans/0008-daytona-agent-sandboxes/production-network-allowlist.md)
§6. Residual evidence: `artifacts/mocklab/live-qa/residuals/web-search/`.

**Create-time only:** expand SM/env → redeploy CP → **cold create** sandbox
(start-from-stopped keeps the old allowlist).

## 7. External product follow-ups (not this monorepo)

Backend agent source stays external by default:

- Hermes-Lanyard / Lanyard Agent: implement `firecrawl_*` / `x_search` tools
  that refuse to call Firecrawl when `FIRECRAWL_API_KEY` is unset.
- Emit structured `result` / `metadata.search_results` and final
  `metadata.citations` with titles + snippets.
- Pilot pin live QA against mocklab when key is intentionally provisioned.

---

## 8. Acceptance evidence

| Check | Location |
| --- | --- |
| Unit tests | `webCitations.test.ts`, `WebSearchResults.test.tsx`, `WebSearchResultsProofStory.test.tsx`, `ChatMessageContent.test.tsx` |
| Auth-free story | `/?story=web-search-results` |
| Manual / UI artifacts | `artifacts/ui/lp-uxy.7/` |
| Secrets slots | envelope examples + `env.secrets.example` (placeholders only) |
| Daytona egress allowlist | `production-network-allowlist.md` §6; `DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST` unit tests; MockLab residual `lp-zuh.10.1` |
