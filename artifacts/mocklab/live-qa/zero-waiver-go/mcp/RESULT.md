# lp-zuh.11.5 — Playwright zero-waiver: MCP lab path or product N/A

**Bead:** `lp-zuh.11.5`  
**Parent epic:** `lp-zuh.11` — MockLab kitchen-sink zero-waiver GO  
**When (UTC):** 2026-08-14T23:11:43Z  
**Base URL:** `https://app.withlanyard.com/mocklab`  
**Verdict:** **PRODUCT_NA_SIGNED_WAIVER**  
**Branch taken:** `product_na` (lab MCP **not** live-configured)  
**Fix bead (product):** [`lp-vw3`](https://github.com/LanyardBrain/lanyard-platform) · external LA [#239](https://github.com/LanyardBrain/lanyard-agent/issues/239)  
**Platform path:** `lp-zuh.10.6` (closed) — lab_echo + fragment + optional seed  
**needs_human:** **true** (product N/A waiver sign-off)  
**needs_ui_qa:** **true** (Tools → MCP screenshots)  

No secrets in this package (no passwords, JWT, CSRF, session tokens, SM values).

---

## Acceptance map

| # | Criterion | Result |
|---|-----------|--------|
| 1 | If lab MCP configured: one tool path works in settings/chat | **N/A this run** — `settings.snapshot.mcp_servers=[]`; Tools → MCP honest empty. Chat MCP tool path **not** exercised (would be a false GO). |
| 2 | Else: document product N/A (`lp-vw3`) as **accepted waiver** with **explicit** RESULT note (not silent) | **MET** — this file + [`PRODUCT-NA-SIGNOFF.md`](./PRODUCT-NA-SIGNOFF.md) + `REPORT.json` `human_signoff.required=true` |
| 3 | Prefer making lab MCP work if 10.6 already wired something | **Attempted / blocked honestly** — 10.6 platform path is ready (offline lab_echo GO; fragment + `LANYARD_ENTRY_SEED_MCP` helper). Enabling seed on current LA pin would brick gateway (strict Zod rejects `mcp_servers`). Prefer not force-merge. |
| 4 | Depends on snapshot pin (`lp-zuh.11.1`) | **Met** — live MockLab on pin `f4d947f3-…` / LA `0.0.0-main.9bcada6780d2` (see core matrix + snapshot evidence) |
| 5 | Playwright / live evidence | `screenshots/`, `REPORT.json`, offline probe log |

---

## Branch decision (explicit, not silent)

```text
settings.snapshot.mcp_count == 0
  AND Tools → MCP empty_honest
  AND LANYARD_ENTRY_SEED_MCP default off (strict-LA safe)
  AND lp-vw3 still OPEN
        │
        ▼
  PRODUCT_NA_SIGNED_WAIVER  ← this bead
  (kitchen-sink checklist 1.7 Optional / mcp_unavailable)
```

**Counterfactual (not taken):** if `mcp_count >= 1` and Tools → MCP listed servers, probe would branch to `lab_mcp_configured` and exercise chat `search_tool` / `use_tool` / `mcp__*` tool rows.

---

## Live evidence (2026-08-14)

| Signal | Result |
|--------|--------|
| Password login | Playwright OK; `GET /api/auth/me` **200** |
| `GET /api/settings/snapshot` | **200**, `source=lanyard_agent`, **`mcp_count=0`**, `mcp_servers=[]`, `skills_count=2` |
| Tools → MCP nav | Present (Skills / Workflows / **MCP** / Models / Integrations) |
| Tools → MCP body | **"No MCP servers in this snapshot."** (honest empty) |
| Chat MCP tool rows | **Not attempted** (empty inventory — product N/A branch) |
| Offline `lab_echo` stdio | **GO** — initialize `serverInfo.name=lab_echo`; tools/list `lab_echo`; tools/call echo `lp-zuh.11.5-mocklab-mcp-ok` |
| Entrypoint smoke | **PASS** (incl. default seed omits `mcp_servers`; optional `LANYARD_ENTRY_SEED_MCP=1` merge path) |

Machine-readable: [`REPORT.json`](./REPORT.json). Auto summary: [`RESULT.auto.md`](./RESULT.auto.md).

---

## Why lab MCP is not live-enabled (prefer path vs product N/A)

Platform path from `lp-zuh.10.6` **is** wired:

| Asset | Status |
|-------|--------|
| `deploy/daytona/agent-gateway/lab-mcp/lab_echo_server.py` | Present; offline probe GO |
| `deploy/daytona/agent-gateway/kitchen-sink-mcp.fragment.yaml` | Present; `mcp_servers.lab_echo` stdio |
| Entrypoint `maybe_seed_lab_mcp` / `LANYARD_ENTRY_SEED_MCP` | Present; **default off** |
| Dockerfile prebake `/opt/lanyard/lab-mcp/` | Present on agent-gateway image |
| Normative docs | [`mcp-product-surface-mocklab.md`](../../../../docs/plans/0008-daytona-agent-sandboxes/mcp-product-surface-mocklab.md) |

**Why not flip `LANYARD_ENTRY_SEED_MCP=1` on MockLab for this bead:**

1. LA pin `0.0.0-main.9bcada6780d2` still uses **strict Zod** without `mcp_servers` — merge **fails closed** on gateway boot.
2. No stdio MCP client / `registerHidden` → even a raw YAML list would not yield chat `mcp__*` tools.
3. Zero-waiver epic forbids silent green; **explicit product N/A** is the honest kitchen-sink outcome until `lp-vw3` lands.

See residual package: [`../../residuals/mcp/RESULT.md`](../../residuals/mcp/RESULT.md).

---

## Product N/A waiver (for human sign-off)

| Field | Value |
|-------|--------|
| Waiver code | `mcp_unavailable` / **product N/A** |
| Scope | MockLab kitchen-sink **optional** MCP inventory + chat MCP tool indicator |
| Checklist | NEW-TENANT §1.7 **O** (optional) — not alone a kitchen-sink fail |
| Owner to clear | Lanyard Agent product surface — bead **`lp-vw3`** / LA issue **#239** |
| Platform ready | lab_echo + fragment + optional seed (default off) |
| Silent? | **No** — RESULT + SIGN-OFF + REPORT `human_signoff.required=true` |
| Human gate | See [`PRODUCT-NA-SIGNOFF.md`](./PRODUCT-NA-SIGNOFF.md) |

**Proposed acceptance language for `lp-zuh.11.6` close gate:**

> MCP kitchen-sink row is **PRODUCT_NA** pending `lp-vw3`. Live MockLab advertises zero MCP servers with honest Tools → MCP empty. Platform lab path proven offline. Zero-waiver epic does **not** claim MCP chat GO.

---

## Screenshots

- `screenshots/00-pre-login.png` — sign-in
- `screenshots/00-post-password-login.png` — post-login shell
- `screenshots/01-auth-home.png` — authenticated home
- `screenshots/02-tools-overview.png` — Tools rail
- `screenshots/03-tools-mcp.png` — **Tools → MCP honest empty**
- `screenshots/04-agents-shell.png` — Agents shell (chat MCP not exercised)

## Logs / harness

- `run_zero_waiver_mcp_probe.py` — live branch probe
- `logs/lab-echo-offline-probe.jsonl` — offline JSON-RPC transcript
- `logs/report-sanitized.json` — redacted REPORT copy
- `REPORT.json` — machine summary

## Re-run

```bash
set -a; source .env.mocklab-agent-dev; set +a
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
# optional: LP_ZUH115_FORCE_LOGIN=1
python artifacts/mocklab/live-qa/zero-waiver-go/mcp/run_zero_waiver_mcp_probe.py
```

After `lp-vw3` + pin with MCP support: set `LANYARD_ENTRY_SEED_MCP=1` (lab only), cold wake, re-run — expect branch `lab_mcp_configured` and verdict `LAB_MCP_PATH_GO`.

## Secret hygiene

- No passwords, JWT, CSRF, or session values written.
- `.env.mocklab-agent-dev` never copied into artifacts.
- Auth storage_state remains gitignored under `artifacts/ui/.auth/`.
- Email addresses redacted in REPORT body samples.

---

## Relationship to kitchen-sink waiver

| Prior state | This bead |
|-------------|-----------|
| `lp-zuh.10.6` HONEST_RESIDUAL_CLOSED (platform path) | Re-affirmed offline GO |
| Kitchen-sink GO `WAIVED (honest optional)` MCP | Elevated to **explicit PRODUCT_NA_SIGNED_WAIVER** for zero-waiver epic |
| Silent empty MCP | **Forbidden** — RESULT + human_signoff + sign-off doc |
| Live non-empty MCP | Still blocked on **`lp-vw3`** |
