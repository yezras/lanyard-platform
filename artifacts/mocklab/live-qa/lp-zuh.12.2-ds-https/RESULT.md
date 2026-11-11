# lp-zuh.12.2 — DS HTTPS + browser-reachable Document Server for MockLab

**Bead:** `lp-zuh.12.2`  
**Parent epic:** `lp-zuh.12` — OnlyOffice MockLab/staging editor GO  
**When (UTC):** 2026-08-18  
**Verdict:** **`HTTP_GO_HTTPS_BLOCKED`** — editor GO **not** claimed

No secrets in this package (no JWT, passwords, CSRF, session tokens, SM values).

---

## Acceptance map

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Document Server publicly reachable over **HTTPS** (ACM/CloudFront/custom hostname) **or** lab-documented exception | **Blocked + documented** — HTTP ALB healthy; no `:443` listener; no `docs*.withlanyard.com`. Options A/B/C in runbook §6. |
| 2 | Health + `api.js` **200** over that origin | **HTTP origin GO** (`/healthcheck` 200, `api.js` 200, ~65KB `application/javascript`). **HTTPS origin fail** (curl timeout). |
| 3 | `BFF_OFFICE_DOCUMENT_SERVER_HOSTS` allowlist updated | **Live** still ALB DNS only. **Compose** updated so when `document_server_public_hostname` is set, allowlist becomes `<public-hostname>,<alb-dns>`. DNS-TLS regional SAN now accepts Docs hostname. |
| 4 | Evidence: curl/`api.js` + config notes (no JWT secrets) | This package + `logs/curl-probe.json` |

**Editor GO:** not claimed (SPA `https_required` + missing HTTPS Docs origin).

---

## Live probe (this bead)

| Signal | Value |
|--------|-------|
| Host | `lanyard-platform-staging-docs-al-238458258.us-east-1.elb.amazonaws.com` |
| `GET http://…/healthcheck` | **200** |
| `GET http://…/web-apps/apps/api/documents/api.js` | **200** (65363 bytes, `application/javascript`) |
| `GET https://…/healthcheck` | **000 / timeout** (no public :443) |
| `docs.withlanyard.com` / `docs.staging.withlanyard.com` | unresolved / unreachable |
| AWS apply from this agent | **Not available** — caller principal lists empty ELB/ACM/Route53 in this account context |

Re-run:

```bash
bash deploy/scripts/probe-staging-document-server-https.sh \
  --out artifacts/mocklab/live-qa/lp-zuh.12.2-ds-https/logs/curl-probe.json
```

---

## Config notes (no secrets)

| Item | Value / action |
|------|----------------|
| Live BFF allowlist host | `lanyard-platform-staging-docs-al-238458258.us-east-1.elb.amazonaws.com` |
| After HTTPS hostname apply | Compose injects `BFF_OFFICE_DOCUMENT_SERVER_HOSTS=<docs-host>,<alb-dns>` |
| SPA DS URL (sibling `lp-zuh.12.1`) | Must be `https://<docs-host>` (non-loopback http rejected) |
| Edge CSP | `onlyoffice_document_server_origins=["https://<docs-host>"]` |
| Preferred operator path | Docs hostname + regional ACM SAN + `document_server_enable_https=true` — [staging-document-server.md §6](../../../../deploy/references/runbooks/staging-document-server.md) |
| Alternatives | CloudFront HTTPS→HTTP ALB origin; lab tunnel/loopback only (not MockLab GO) |

---

## Repo changes shipped with this bead

1. `portal-dns-tls`: `document_server_hostname` included in regional ACM SANs.
2. `platform-staging`: passes Docs public hostname into dns-tls; dual BFF allowlist on cutover.
3. Runbook §6 + probe script + this evidence package.
4. Offline smokes assert HTTPS wiring contracts.

Live HTTPS listener / Route53 alias / ACM issue remain **operator-owned apply** in the staging account.

---

## Secret hygiene

- No passwords, JWT, CSRF, or session values.
- `.env.mocklab-agent-dev` never copied.
- Probe records status codes / byte sizes / content-types only.
