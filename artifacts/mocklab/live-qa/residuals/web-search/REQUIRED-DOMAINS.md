# Required domains — LA `web_search` on Daytona Tier-1 (`lp-zuh.10.1`)

**Bead:** `lp-zuh.10.1`  
**Parent residual:** live QA `lp-zuh.7.2` (`web_search` tool rows + `fetch failed` / proxy unavailable)  
**Normative catalog:** [production-network-allowlist.md §6](../../../../docs/plans/0008-daytona-agent-sandboxes/production-network-allowlist.md)  
**CP constant:** `DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST` in `portal/packages/control-plane/src/daytona-config.ts`

## Provider → hostname

| Priority | Provider | Env gate | Hostname(s) for `DAYTONA_DOMAIN_ALLOWLIST` | Endpoint |
|----------|----------|----------|--------------------------------------------|----------|
| 1 | Tavily | `TAVILY_API_KEY` | `api.tavily.com` | `POST https://api.tavily.com/search` |
| 2 | Brave | `BRAVE_API_KEY` / `BRAVE_SEARCH_API_KEY` | `api.search.brave.com` | `GET https://api.search.brave.com/res/v1/web/search` |
| 3 | Firecrawl | `FIRECRAWL_API_KEY` (cost-gated) | `api.firecrawl.dev` | `POST https://api.firecrawl.dev/v1/search` |
| 4 (default) | DuckDuckGo HTML | *(none)* | `html.duckduckgo.com`, `duckduckgo.com` | `GET https://html.duckduckgo.com/html/?q=…` |

**MockLab kitchen-sink default:** no paid search keys → **DuckDuckGo** path only. Still add optional paid hosts so enabling a key later does not require a second egress change.

## Not on this list

- Arbitrary result-page hosts (NVIDIA docs, news, CDNs) — SERP JSON/HTML is enough for structured cards.
- Bare `*` / open internet — rejected by CP parse; expands guest blast radius.
- Package mirrors — prebake snapshot.

## Create-time semantics

`domainAllowList` is set on Daytona **create** only. Expanding SM/env + redeploying CP does **not** rewrite an existing sandbox. After change:

1. Confirm CP task has new secret/env (`daytona_domain_allowlist_count` in boot logs).
2. Destroy bound sandbox (or instance deprovision) so `ensure_online` **cold creates**.
3. Vendor GET sandbox must echo the expanded `domainAllowList`.

## Merge helper

```ts
import {
  DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST,
  mergeDaytonaWebSearchDomainAllowList,
  formatDaytonaDomainAllowList,
} from "@lanyard/control-plane";

const value = formatDaytonaDomainAllowList(
  mergeDaytonaWebSearchDomainAllowList([
    "relay.withlanyard.com",
    "api.openai.com",
    "api.x.ai",
    // … S3 / etc.
  ]),
);
// → DAYTONA_DOMAIN_ALLOWLIST=…
```

## Related

- LA tool: external `lanyard-agent` `packages/agent-core/src/tools/web-search.ts` (lp-uxy.21.3)
- Portal UI: `docs/architecture/portal-web-search-firecrawl.md`
- New-tenant checklist §1.6 / §7.5: `artifacts/mocklab/live-qa/NEW-TENANT-CHECKLIST.md`
