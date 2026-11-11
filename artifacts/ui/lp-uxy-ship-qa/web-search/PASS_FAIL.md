# lp-uxy.15.8 — pass/fail

**Result: PASS_FIXTURE_PATH_FIRECRAWL_GATED**

- Base: `http://demo.localhost:3010`
- Shipped: lp-uxy.7
- Login: `dev@demo.local`
- firecrawl_key_present: False
- story_ok: True
- portal_ui_ok: True
- live_host_tools: False (agent refused — no web_search/firecrawl)
- live detail: host refused — no web_search/firecrawl tools

**Fix bead:** lp-uxy.18 (host tools residual)

Portal story richer results UI **PASS**. Firecrawl cost-gated (key absent) → fixture path.
Live LA does not expose search tools yet.
