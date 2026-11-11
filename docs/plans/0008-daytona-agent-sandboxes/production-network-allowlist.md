# Production network allowlist (Daytona `domainAllowList`) — `lp-ccp`

**Status:** Config surface + docs (no live Daytona required).  
**Bead:** `lp-ccp` (Phase 8 hardening, parent `lp-3a1`)  
**Code:** `portal/packages/control-plane/src/daytona-config.ts`, `server.ts` → `createDaytonaSdkClient`  
**Related:** [cp-daytona-config.md](./cp-daytona-config.md), [spike-4dk-wss-relay.md](./spike-4dk-wss-relay.md), [spike-3en-s3-vault-mount.md](./spike-3en-s3-vault-mount.md), [gateway-env-contract.md](./gateway-env-contract.md), [residual-kng.3-relay-dns.md](./residual-kng.3-relay-dns.md)

## Purpose

Document the **production egress allowlist** for managed Daytona sandboxes and wire it through CP env → SDK create.

Under **Tier 1** org policy, sandbox outbound traffic is restricted. Create-time `domainAllowList` (comma-separated **string** on Daytona `POST /sandbox`) is the Lanyard control surface that grants only the hosts the agent gateway needs:

| Category | Why |
|----------|-----|
| **Relay (WSS)** | Long-lived `wss://` to product Relay (`GATEWAY_RELAY_URL`) |
| **Model APIs** | Provider HTTPS from guest (OpenAI / xAI / Anthropic / …) |
| **S3 / vault** | Mountpoint for Amazon S3 (`VAULT_ROOT`) regional endpoints |
| **Web search (LA)** | Provider SERP hosts for `web_search` under Tier 1 (`lp-zuh.10.1`) — see §6 |
| **Registries** | Only if guest must pull (prefer prebaked snapshot — usually **omit** at runtime) |

**Goal:** avoid unnecessary open egress. Never default to `*` or a broad “internet open” list in code.

## Fail-closed shape

| Rule | Behavior |
|------|----------|
| Unset / empty `DAYTONA_DOMAIN_ALLOWLIST` | `domainAllowList: []` → **omit** Daytona create field (no Lanyard-granted extra hosts) |
| Invalid entry (`*`, `https://…`, path, spaces) | `DaytonaConfigError` at load — names the bad token only |
| Default in code | **None** — operators must set production hosts explicitly |
| Logs | Count only (`daytona_domain_allowlist_count`); not the host list |
| Tenant allowlist | Orthogonal (`DAYTONA_TENANT_ALLOWLIST`) — who may use Daytona, not where sandboxes may dial |

Empty domain allowlist is the **most closed** Lanyard posture. Tier 1 org policy still applies when the field is set; create-time allowlist acceptance is not a substitute for live TCP/WSS proof ([spike-4dk](./spike-4dk-wss-relay.md), [residual-kng.3](./residual-kng.3-relay-dns.md)).

## Env surface

| Env | Secret? | Meaning |
|-----|---------|---------|
| `DAYTONA_DOMAIN_ALLOWLIST` | no | Comma-separated hostnames / `*.suffix` patterns for create-time `domainAllowList` |

Loaded by `loadDaytonaConfig` → `DaytonaConfig.domainAllowList`. Server boot:

```ts
createDaytonaSdkClient({
  config: daytonaConfig,
  domainAllowList: formatDaytonaDomainAllowList(daytonaConfig.domainAllowList),
  autoStopIntervalMinutes: daytonaConfig.autoStopIntervalMinutes,
  // …
});
```

Helpers (exported from `@lanyard/control-plane` package surface via `index.ts`):

- `parseDaytonaDomainAllowList(raw)` — parse + validate
- `formatDaytonaDomainAllowList(domains)` — API string or `undefined` when empty
- `isValidDaytonaDomainAllowListEntry(entry)` — structural check

Values live in deploy env / SSM — **never** commit environment-specific secrets. Hostnames themselves are not secrets.

## Production host catalog

Operators assemble a **minimal** comma-separated list from the tables below. Prefer exact hosts over wildcards; expand only when spikes prove a pattern is required.

### 1. Relay (required for product WSS)

| Hostname | Notes |
|----------|--------|
| `relay.withlanyard.com` | Default shared Relay (`DEFAULT_SHARED_RELAY_WSS_URL` / `wss://relay.withlanyard.com`). Spike path for create field: [spike-4dk](./spike-4dk-wss-relay.md), [spike-v2p](./spike-v2p-org-access.md). |
| `relay-<tenant-slug>.withlanyard.com` | Dedicated / Tier-3 style Relay when that hostname is the `GATEWAY_RELAY_URL` host — **exact** host used in the URL must appear on the allowlist. |

**WSS rule:** allowlist the **hostname only** (no `wss://`, no path). The host in `GATEWAY_RELAY_URL` and `domainAllowList` must match.

Live DNS for `relay.withlanyard.com` may still be blocked under operator hold — see [residual-kng.3-relay-dns.md](./residual-kng.3-relay-dns.md). Config + create wiring still apply offline.

### 2. Model / provider APIs

Guest process env carries provider keys via secrets envelope ([gateway-env-contract.md](./gateway-env-contract.md)); egress still needs hostnames:

| Hostname | Provider / use |
|----------|----------------|
| `api.openai.com` | OpenAI HTTP API |
| `api.x.ai` | xAI / Grok HTTP API |
| `api.anthropic.com` | Anthropic HTTP API |
| *(oauth hosts if used)* | e.g. provider OAuth endpoints — add **only** when the guest actually dials them |

Omit unused providers. Do not allowlist the public web “for convenience.”

### 3. S3 / vault (Mountpoint)

From [spike-3en](./spike-3en-s3-vault-mount.md): narrow allowlist (Relay only) blocked package/S3 install paths. Vault Mountpoint needs S3 API hosts for the **vault region**:

| Hostname / pattern | Notes |
|--------------------|--------|
| `s3.amazonaws.com` | Global / redirect endpoint |
| `s3.<region>.amazonaws.com` | Regional API (e.g. `s3.us-east-1.amazonaws.com`) |
| `*.s3.<region>.amazonaws.com` | Virtual-hosted–style bucket endpoints when required |
| `*.s3.amazonaws.com` | Broader S3 virtual-host pattern when regional alone is insufficient |

Prefer **prebaked `mount-s3` in the agent snapshot** so Debian package mirrors are **not** required at wake ([spike-ctu](./spike-ctu-go-no-go.md)).

### 4. Container registries (usually **not** at runtime)

| Hostname / pattern | When needed |
|--------------------|-------------|
| `<account>.dkr.ecr.<region>.amazonaws.com` | Guest pull from private ECR (rare — snapshot create is platform-side) |
| `*.dkr.ecr.<region>.amazonaws.com` | Multi-account / pattern if org policy requires |
| `public.ecr.aws` | Public ECR base pulls only if not prebaked |

**Prefer:** image → Daytona snapshot offline ([agent-gateway-ecr-push.md](./agent-gateway-ecr-push.md), [agent-snapshot-live-pin.md](./agent-snapshot-live-pin.md)). Runtime sandboxes start from the **snapshot pin**, so production `DAYTONA_DOMAIN_ALLOWLIST` often **omits** registries. Add them only if a guest path still pulls.

### 5. Explicitly out of production allowlist (avoid open egress)

| Do **not** add by default | Why |
|---------------------------|-----|
| Bare `*` | Rejected by config parse; would open all egress |
| `deb.debian.org` / security mirrors | Install-on-boot anti-pattern; prebake snapshot |
| Arbitrary CDN / “just in case” hosts | Expands blast radius if sandbox is compromised |
| Result-page / content CDN wildcards | `web_search` only needs **provider SERP** hosts (§6), not every hit URL |
| Internal CP / Postgres / SSM hosts | Agent is a **guest** — must not receive platform credentials or dial CP admin APIs |

### 6. Web search (LA `web_search` on Daytona Tier-1) — `lp-zuh.10.1`

Live MockLab QA (`lp-zuh.7.2`) showed `web_search` tool rows emit but **fetch failed** when search provider hosts were missing from create-time `domainAllowList`. Under Tier 1, guest HTTPS is mediated by Daytona’s egress proxy (`domainAllowList` is the CP control surface).

**Product source (LA, external repo):** `packages/agent-core/src/tools/web-search.ts` (lp-uxy.21.3). Auto provider order:

| Priority | Env gate | Provider | Create-time host(s) |
|----------|----------|----------|---------------------|
| 1 | `TAVILY_API_KEY` | Tavily SERP | `api.tavily.com` |
| 2 | `BRAVE_API_KEY` / `BRAVE_SEARCH_API_KEY` | Brave Search | `api.search.brave.com` |
| 3 | `FIRECRAWL_API_KEY` | Firecrawl search (cost-gated) | `api.firecrawl.dev` |
| 4 | *(none — MockLab default)* | DuckDuckGo HTML scrape | `html.duckduckgo.com`, `duckduckgo.com` |

**CP catalog constant (not auto-injected):** `DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST` + `mergeDaytonaWebSearchDomainAllowList()` in `@lanyard/control-plane` (`daytona-config.ts`). Operators **merge** these into `DAYTONA_DOMAIN_ALLOWLIST` next to Relay/model/S3 — empty env remains fail-closed.

| Hostname | Why |
|----------|-----|
| `html.duckduckgo.com` | Default free SERP HTML endpoint |
| `duckduckgo.com` | Redirect host in DDG result hrefs (`/l/?uddg=…`) |
| `api.tavily.com` | Optional paid SERP |
| `api.search.brave.com` | Optional Brave SERP |
| `api.firecrawl.dev` | Optional Firecrawl search API |

**Not required for SERP success:** arbitrary result-page hosts (NVIDIA docs, news sites, …). Structured results come from the provider JSON/HTML; guest need not fetch each citation URL. Bash/`curl` to open web remains Tier-1 limited by design.

**Create-time only:** changing SM/env updates the next **cold create**. Existing sandboxes keep their create-time allowlist. After expanding the list: redeploy CP (new task pulls SM), then **delete** (or deprovision) the bound sandbox so `ensure_online` cold-creates. Start-from-stopped does **not** rewrite `domainAllowList`.

MockLab residual evidence: [`artifacts/mocklab/live-qa/residuals/web-search/`](../../../artifacts/mocklab/live-qa/residuals/web-search/). Portal UI contract: [`portal-web-search-firecrawl.md`](../../architecture/portal-web-search-firecrawl.md).

## Example production values (illustrative)

Shared Relay + OpenAI + xAI + us-east-1 vault + LA web_search (DDG + optional paid), no registry pull:

```bash
# Deploy / SSM only — example hosts, not secrets
DAYTONA_DOMAIN_ALLOWLIST=relay.withlanyard.com,api.openai.com,api.x.ai,s3.amazonaws.com,s3.us-east-1.amazonaws.com,*.s3.us-east-1.amazonaws.com,html.duckduckgo.com,duckduckgo.com,api.tavily.com,api.search.brave.com,api.firecrawl.dev
```

Relay-only pilot (matches early spikes; vault/model/**web_search** will fail until expanded):

```bash
DAYTONA_DOMAIN_ALLOWLIST=relay.withlanyard.com
```

## Operator checklist

1. Choose Relay hostname(s) that match `GATEWAY_RELAY_URL` / `SHARED_RELAY_WSS_URL`.
2. Add only model API hosts for providers the guest is configured to call.
3. Add S3 regional hosts for the vault bucket region (Mountpoint).
4. Add LA web_search SERP hosts when product exposes `web_search` (§6 / `DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST`).
5. Skip registries unless guest pull is proven necessary.
6. Set `DAYTONA_DOMAIN_ALLOWLIST` on the Control Plane task / secrets map.
7. Redeploy CP; confirm boot log has `daytona_domain_allowlist_count` > 0 when expected.
8. Smoke: create sandbox (or ensure_online **cold create**) and confirm vendor record echoes `domainAllowList` including search hosts.
9. After an allowlist expansion: destroy the bound sandbox so create-time field is re-applied (start-from-stopped is insufficient).
10. Prove live WSS/TCP only when Relay DNS is healthy ([residual-kng.3](./residual-kng.3-relay-dns.md)).
11. Live chat: GPU research / `web_search` turn returns non-error results (or honest N/A if product disables search).

## Code map

| Piece | Location |
|-------|----------|
| Env name | `DAYTONA_ENV.domainAllowList` → `DAYTONA_DOMAIN_ALLOWLIST` |
| Parse / validate | `parseDaytonaDomainAllowList`, `isValidDaytonaDomainAllowListEntry` |
| Web-search catalog | `DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST`, `mergeDaytonaWebSearchDomainAllowList` (lp-zuh.10.1) |
| Create body | `DaytonaSdkClient.create` → `body.domainAllowList` when set |
| Boot wiring | `server.ts` → `formatDaytonaDomainAllowList(daytonaConfig.domainAllowList)` |
| Unit tests | `portal/packages/control-plane/test/daytona-config.test.ts` (lp-ccp + lp-zuh.10.1) |
| SDK field proof | `daytona-sdk-client.test.ts` (create body includes allowlist string) |

## Acceptance (`lp-ccp`)

- [x] Allowlist documented (this file) and applied (config surface + fail-closed empty default)
- [x] Relay WSS hostnames documented; `domainAllowList` wired via env into `createDaytonaSdkClient` / server boot
- [x] Unnecessary open egress avoided (no default open list; bare `*` rejected; prebake preferred over package mirrors)
- [x] Config parse unit tests (no live Daytona / no secrets)

## Out of scope

- Live Tier 1 TCP/WSS re-proof (depends on Relay DNS / operator hold)
- Org-level Daytona tier / exception changes (console / vendor support)
- Terraform invent of SSM parameter values
- Injecting allowlist into agent guest env (platform-only create param)
