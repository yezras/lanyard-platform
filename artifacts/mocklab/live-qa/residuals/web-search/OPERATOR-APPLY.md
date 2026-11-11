# Operator apply — MockLab web_search egress (`lp-zuh.10.1`)

## Goal

Expand create-time Daytona `domainAllowList` so LA `web_search` (default DuckDuckGo)
succeeds from the guest under Tier-1 policy.

## Applied on staging MockLab CP (2026-08-14)

| Step | Result |
|------|--------|
| SM `lanyard/staging/portal/daytona` → `DAYTONA_DOMAIN_ALLOWLIST` | Merged web-search hosts (hostnames only; sibling keys never logged) |
| ECS `lanyard-platform-staging-cp` force-new-deployment | Rollout COMPLETED; new task ~12:42Z ET |
| Bound sandbox deleted | Forced next `ensure_online` **cold create** |
| Vendor create echo | New sandboxes include `html.duckduckgo.com,duckduckgo.com,api.tavily.com,api.search.brave.com,api.firecrawl.dev` |
| Live chat residual | **PASS** — thread `15e8c6c3-4061-42e6-94ea-7049a472b88d`; `Finished web_search` ×3; `web_errors=0`; `fetch_failed=false` |

**Do not commit SM secret blobs or API keys.** Hostnames are not secrets.

## Recipe (other envs)

1. Merge hosts from `REQUIRED-DOMAINS.md` / `DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST` into CP `DAYTONA_DOMAIN_ALLOWLIST`.
2. Redeploy CP so the task re-reads SM/env.
3. Destroy the bound sandbox (Daytona DELETE or instance deprovision). **Start-from-stopped does not rewrite `domainAllowList`.**
4. Wake via chat; confirm vendor GET sandbox lists search hosts.
5. Re-run `run_residual_web_search_proof.py` (or kitchen-sink tool web_search QA).

## Failure codes

| Signal | Fix |
|--------|-----|
| `fetch failed` / proxy unavailable | Hosts missing or sandbox not cold-created after expand |
| Tool refused / no web_search | Product/tool surface (not egress) |
| Paid provider 401 | Key missing in guest env — separate from allowlist |
