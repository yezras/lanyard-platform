# lp-uxy.15.8 — web search Firecrawl / richer results UI ship QA

**Shipped feature:** lp-uxy.7 (Web search upgrade: richer results, Firecrawl / X)
**Base URL:** `http://demo.localhost:3010`
**Login:** `dev@demo.local` / `local-dev-password`
**Method:** web-ui-testing (Playwright headless Chromium)
**When:** 2026-08-05T14:19:58.024442+00:00
**FIRECRAWL_API_KEY present (non-placeholder):** `False`

## Verdict

| Surface | Result |
|---------|--------|
| Portal UI story (`?story=web-search-results`) | **PASS** |
| Live agent web search (LA host) | **FAIL host tools** (no web_search/firecrawl) |
| Overall ship-qa for Portal consumer | **PASS_FIXTURE_PATH_FIRECRAWL_GATED** |

## Acceptance mapping

- [x] story-cost-gate: data-firecrawl-live=false data-cost-gated=true
- [x] story-structured-cards: cards=5 snippet=True firecrawl_badge=True scrape=True
- [x] story-rich-citations: rich=true url=https://en.wikipedia.org/wiki/2026_FIFA_World_Cup count=3 open_ok=True
- [x] story-tool-labels: Searching the web / Browsing the web (or firecrawl_scrape) visible
- [x] live-login-home: re-run live
- [x] live-prompt-sent: web search prompt sent
- [x] live-firecrawl-gated: FIRECRAWL_API_KEY absent (cost-gated). Fixture story normative. Live host refused: no web_search/firecrawl tools — fix bead lp-uxy.18. live (no Firecrawl key): host refused — no web_search/firecrawl tools; structured_ui=False citation=False
- [x] live-response-captured: preview_len=157

## Story fixture (`?story=web-search-results`)

Deterministic richer-results proof (shipped with lp-uxy.7). **Cost-gated fixture path**
when `FIRECRAWL_API_KEY` is absent (this environment: key **absent**).

- Root `data-firecrawl-live="false"` / `data-cost-gated="true"`
- Tool rows: Searching the web / Browsing the web (`firecrawl_search` / `firecrawl_scrape` / `x_search`)
- Structured cards: title + host + snippet + **Firecrawl** provider badge
- Scrape panel: page content summary
- Final answer **rich** web citation chips (`data-citation-rich="true"`) open exact external URL

Assertions (Playwright):

```json
{
  "data_firecrawl_live": "false",
  "data_cost_gated": "true",
  "tool_panel": true,
  "results_panel": true,
  "answer_panel": true,
  "result_card_count": 5,
  "fixture_title": true,
  "snippet_visible": true,
  "firecrawl_badge": true,
  "scrape_content": true,
  "x_result": true,
  "scrape_panel": true,
  "citation_rich": "true",
  "citation_url": "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
  "citation_count": 3,
  "citation_opens_external": true,
  "opened": [
    {
      "url": "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
      "target": "_blank",
      "features": "noopener,noreferrer"
    }
  ],
  "tool_labels": true
}
```

Shots: `01`–`04` under this directory.

## Live web search (Lanyard Agent via Brain RPC)

| Check | Result |
|-------|--------|
| Login + New chat + composer send | OK |
| brain_rpc / kind | True / lanyard_agent |
| Searching the web / tool activity | False (host refused: no tools) |
| Structured result cards in chat | False |
| Rich web citation chips | False |
| Firecrawl badge / tool id | False |

Live assertions:

```json
{
  "brain_rpc_enabled": true,
  "backend_kind": "lanyard_agent",
  "firecrawl_key_present": false,
  "saw_searching_label": false,
  "saw_structured_results_ui": false,
  "saw_rich_citation": false,
  "saw_firecrawl_badge_or_tool": false,
  "final_text_preview": "Running a command\nNo web_search or firecrawl tools available in this environment. Cannot perform live web search or cite current sources.\n10:19 AM\n\u00b7\ngrok-4.5",
  "host_refused_no_tools": true
}
```

**Note:** FIRECRAWL_API_KEY absent (cost-gated). Fixture story is the normative
richer-results proof per lp-uxy.7.

Live agent reply (shot `12-live-chat-after-response.png`):

> No web_search or firecrawl tools available in this environment. Cannot perform
> live web search or cite current sources.

Root cause (host product): Lanyard Agent does not expose `web_search` / Firecrawl
tools in this environment. Portal consumer richer-results UI is proven by the
story fixture.

Per lp-uxy.7 cost gate: do **not** call live paid Firecrawl unless `FIRECRAWL_API_KEY`
is present. Portal UI + proof story work entirely on fixtures without any API key.

## Fix bead

Filed from this QA: **lp-uxy.18** — LA expose web_search / structured search tools
for live richer results UI (discovered-from lp-uxy.15.8). Portal story remains PASS;
Firecrawl remains cost-gated without `FIRECRAWL_API_KEY`.

## Artifacts

| File | What |
|------|------|
| `01-story-tool-rows.png` | Story tool rows (search/scrape/x) |
| `02-story-structured-results.png` | Structured result cards + Firecrawl badge |
| `03-story-rich-citations.png` | Rich final citation chips |
| `04-story-full-page.png` | Full story page |
| `10-live-home.png` … `15-live-final.png` | Live LA web search attempt |
| `REPORT.json` | Machine-readable results |
| `RESULT.md` | This note |
| `PASS_FAIL.md` | Short verdict |

## Screenshots

- `01-story-tool-rows.png`
- `02-story-structured-results.png`
- `03-story-rich-citations.png`
- `04-story-full-page.png`
- `10-live-home.png`
- `11-live-prompt-sent.png`
- `10-live-home.png`
- `11-live-prompt-sent.png`
- `12-live-chat-after-response.png`
- `13-live-tools-expanded.png`
- `15-live-final.png`

## Notes

- Brain RPC dependency: lp-uxy.15.1 (enabled; `kind=lanyard_agent`).
- Story path is the shipped Playwright surface for richer results when Firecrawl is gated.
- No Portal code fix required for this bead; host follow-up is **lp-uxy.18**.
