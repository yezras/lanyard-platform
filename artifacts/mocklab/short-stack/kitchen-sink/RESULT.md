# lp-oop.34 — Kitchen-sink re-QA gate

**Bead:** `lp-oop.34`
**Parent epic:** `lp-oop` (short stack)
**When (UTC):** 20260817T175439Z
**Base URL (browser):** `http://127.0.0.1:3138/mocklab`
**Overall verdict:** **GO_WITH_WAIVERS**

Re-QA of kitchen-sink surfaces after short-stack dual-run landed.
Waivers are named. Guest path is still available (default `CHAT_DELIVERY=relay`,
live pin still guest-gateway). Live AWS is **not** flipped.

No secrets in this package.

---

## GO / NO-GO matrix

| # | Surface | Verdict | Evidence | Waiver / residual |
|---|---------|---------|----------|-------------------|
| 1 | **shell_auth** | **GO** | Playwright login + Agents/Vault/Tools | — |
| 2 | **harness chat send + stream** | **GO** | real-harness echo + SSE | — |
| 3 | **vault tree (no wake)** | **GO** | `GET /api/vault/tree` 200; `ensure_online_during_tree=0` | — |
| 4 | **tools nav + workflows UI** | **GO** | Tools / Workflows screenshots | Live launch held |
| 5 | **cron / scheduled tasks UI** | **GO** | Scheduled Tasks chrome | Live fire held (`lp-oop.32`) |
| 6 | **MCP** | **PRODUCT_NA (signed)** | Local fixture catalog is CI/dev, not live host; `lp-zuh.11.5` / PR #488 | `lp-vw3` |
| 7 | **guest path still available** | **GO** | `DEFAULT_CHAT_DELIVERY=relay`; dual-run persist; live pin `lanyard-la-main-*`; live HTTP `200` | — |
| 8 | **live tools / web_search / subagents / workflow fire** | **WAIVED** | Not re-run on harness; live tool-only snapshot held | Human pin + operator flip |
| 9 | **OnlyOffice editor host** | **EXPLICIT_HARD_RESIDUAL** | Carried `lp-zuh.11.3` | Operator SPA + HTTPS DS |
| 10 | **MemPalace** | **GO (carried guest)** | `lp-zuh.11.4` | Not a harness-path surface |
| 11 | **live MockLab chat_delivery flip** | **WAIVED** | Guest/Relay stays default | Operator runbook `lp-oop.29` |

**Legend:** **GO** = proven this re-QA. **WAIVED** / **PRODUCT_NA** / **EXPLICIT_HARD_RESIDUAL** = named, not silent.

---

## Guest path still available

| Check | Result |
|-------|--------|
| `default_chat_delivery=relay` | PASS |
| `parse_empty_is_relay` | PASS |
| `dual_run_persist` | PASS |
| `live_pin_guest_gateway` | PASS |
| `live_mocklab_http=200` | PASS |
| Live snapshot flipped to tool-only | **No** |
| Live `chat_delivery` flipped to harness | **No** |
| `FLIP_LIVE_*` | refused |

Default resolve remains instance > tenant > env > **relay**. Other tenants stay on guest-gateway + Relay.

---

## Honesty

| Claim | Truth |
|-------|--------|
| Kitchen-sink UI on local harness path | Yes |
| Live AWS MockLab `chat_delivery` flipped | **No** |
| Live tool-only snapshot pin | **No** — human gate held |
| Terraform apply / SM write | **No** |
| Secrets in evidence | **No** |

## Re-run

```bash
bash deploy/scripts/prove-mocklab-short-stack-kitchen-sink.sh
bash deploy/scripts/smoke-mocklab-short-stack-kitchen-sink.sh
```

## Artifact index

| Path | Purpose |
|------|---------|
| [RESULT.md](./RESULT.md) | This gate verdict |
| [REPORT.json](./REPORT.json) | Machine-readable matrix |
| [../../ui/lp-oop.34/](../../ui/lp-oop.34/) | Playwright screenshots + runner |
| [../RESULT.md](../RESULT.md) | Phase 8 hop / invariant honesty |
