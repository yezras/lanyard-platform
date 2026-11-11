# lp-zuh.10.1 — Web search residual live proof

**Bead:** `lp-zuh.10.1`  
**When:** 2026-08-14T16:47:03Z  
**Base URL:** `https://app.withlanyard.com/mocklab`  
**Verdict:** **PASS**

## Acceptance

- [x] Required search domains documented (`REQUIRED-DOMAINS.md`)
- [x] Create-time `domainAllowList` / SM expanded + CP redeployed (see `OPERATOR-APPLY.md`)
- [x] Live chat proof: non-error search results (or honest N/A)
- [x] Evidence under `artifacts/mocklab/live-qa/residuals/web-search/`

## Chat

- thread_id: `15e8c6c3-4061-42e6-94ea-7049a472b88d`
- marker: `lp-zuh.10.1-gpu-web-search-residual`
- send status: `200`

## web_search analysis

| Metric | Value |
|--------|-------|
| web_ok | `9` |
| web_errors | `0` |
| fetch_failed | `False` |
| event_count | `7` |

### Final preview (truncated)

```
(none)
```

### Tool event previews

```
[
  {
    "status": null,
    "preview": "MARKER lp-zuh.10.1-gpu-web-search-residual\nResearch current best practices for liquid cooling an NVIDIA H100/B200 GPU cluster.\nUse the web_search tool (required"
  },
  {
    "status": "running",
    "preview": "NVIDIA H100 B200 GPU cluster liquid cooling best practices rack power kW 2024\u2026"
  },
  {
    "status": "running",
    "preview": "NVIDIA B200 H100 rack power density kW liquid cooling immersion cooling"
  },
  {
    "status": "running",
    "preview": "GPU cluster liquid cooling coolant options water glycol immersion cooling die\u2026"
  },
  {
    "status": "complete",
    "preview": "Finished web_search"
  },
  {
    "status": "complete",
    "preview": "Finished web_search"
  },
  {
    "status": "complete",
    "preview": "Finished web_search"
  }
]
```

## Notes

- web_search returned non-error results after allowlist expand

## Screenshots

- `screenshots/01-auth-home.png`
- `screenshots/02-thread-ready.png`
- `screenshots/03-prompt-sent-api.png`
- `screenshots/04-after-turn.png`

## Secret hygiene

- No passwords, cookies, SM secret values, or API keys in this folder

## Create-time allowlist proof (Daytona vendor, no secrets)

After SM expand + CP redeploy + cold create, MockLab sandboxes echo:

```
domainAllowList=…,html.duckduckgo.com,duckduckgo.com,api.tavily.com,api.search.brave.com,api.firecrawl.dev
```

(alongside existing Relay / model / S3 hosts). Live thread `15e8c6c3-4061-42e6-94ea-7049a472b88d` shows **Finished web_search** complete events with **zero** `fetch failed`.

## Re-run

```bash
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
# Needs .env.mocklab-agent-dev (gitignored) + Playwright Chromium
python artifacts/mocklab/live-qa/residuals/web-search/run_residual_web_search_proof.py
```

Requires the live-qa harness tree on disk for auth helpers (lp-zuh.7.1) **or** an existing Playwright storage_state under `artifacts/mocklab/live-qa/.auth/`.

