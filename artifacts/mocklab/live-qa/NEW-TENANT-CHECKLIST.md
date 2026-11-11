# New-tenant off-the-shelf config checklist (MockLab SOE)

**Bead:** `lp-zuh.7.8` (initial) · **Gate re-QA:** `lp-zuh.10.8` · **Zero-waiver:** `lp-zuh.11.6`  
**Parent epic:** `lp-zuh.7` / residuals `lp-zuh.10` / zero-waiver `lp-zuh.11` — MockLab kitchen-sink  
**Audience:** operators / implementers provisioning a **new tenant** to match MockLab
product posture (Lanyard Agent on Daytona + Portal kitchen-sink surfaces).  
**No secrets:** this file names env keys, paths, flags, and failure codes only.

Derived from live MockLab findings (`lp-zuh.7.1`–`lp-zuh.7.7`), residual fixes
(`lp-zuh.10.*`), durable vault (`lp-zuh.9.*`), kitchen-sink gate
[`kitchen-sink-go/RESULT.md`](./kitchen-sink-go/RESULT.md) (**GO_WITH_WAIVERS**), and
zero-waiver close gate [`zero-waiver-go/RESULT.md`](./zero-waiver-go/RESULT.md)
(**GO** — no silent waivers; MCP product N/A signed; OnlyOffice editor hard residual explicit).
Re-run child live-qa scripts after changing any required row.

| Source | What it proved / residual |
|--------|---------------------------|
| `lp-zuh.7.1` | Auth harness, env checklist shape |
| `lp-zuh.7.2` | Tool calling; `web_search` fetch failures (fixed `lp-zuh.10.1`); `rg` / `file` **binary_missing** (optional) |
| `lp-zuh.7.3` | Sub-agents fan-out (not `SUBAGENTS_DISABLED`) — keep green |
| `lp-zuh.7.4` | Cron create + hybrid `$BACKEND_HOME/cron/jobs.json`; fire residual |
| `lp-zuh.10.4` | Cron **vault** `state_dir` + live fire + stop/start survival — **GO** |
| `lp-zuh.7.5` | Workflows `research-lite` (not `WORKFLOWS_UNAVAILABLE`); durable run → `lp-zuh.10.5` |
| `lp-zuh.7.6` | Vault list/cwd; empty/permission residuals closed by `lp-zuh.9` + seed |
| `lp-zuh.7.7` | OnlyOffice residual → path `lp-zuh.10.3` (operator apply still for live editor host) |
| `lp-zuh.10.8` | **Kitchen-sink re-QA gate** matrix: required SOE green or waived |
| `lp-zuh.11.1`–`.11.5` | Snapshot pin + zero-waiver child packages (core / OO / MemPalace / MCP) |
| `lp-zuh.11.6` | **Zero-waiver close gate** — aggregate **GO** matrix |

**Related program:** durable S3 vault mount (`lp-zuh.6` / `lp-zuh.9.*`); vault seed
(`lp-zuh.9.5`); model-key inject (`lp-kng.7.1`).

---

## How to use

1. Copy this checklist into the change ticket for the new tenant.
2. For each row: mark **Done**, **N/A (optional)**, or **Blocked** with residual code.
3. Prefer MockLab as the reference SOE (same product path: LA + Daytona).
4. Never commit `.env.mocklab-agent-dev`, SM JSON, or live JWT / API keys.

**Legend**

| Mark | Meaning |
|------|---------|
| **R** | Required for kitchen-sink SOE parity with MockLab chat + tools + cron + workflows |
| **O** | Optional for pilot; required only when enabling that surface |
| **H** | Needs human / commercial / legal gate before production claim |

---

## 1. Agent config (kitchen-sink)

Goal: cold wake answers chat; builtins, sub-agents, workflows, and cron tools are
**not** disabled by config/capabilities honesty.

| # | Item | R/O | Gate (`lp-zuh.11.6`) | Verify | Failure if wrong |
|---|------|-----|----------------------|--------|------------------|
| 1.1 | `BACKEND_KIND=lanyard_agent` (product for MockLab-class tenants) | R | **GO** | CP instance + wake env; settings.snapshot `source=lanyard_agent` | Wrong kind → Hermes paths, missing LA tools |
| 1.2 | Agent snapshot pin real (`agent_snapshot_id` / `DAYTONA_DEFAULT_SNAPSHOT`) | R | **GO** (`lp-zuh.11.1`) | CP row; image has `company-brain-backend gateway` | `binary_missing` / gateway never starts |
| 1.3 | Sub-agents enabled (not `SUBAGENTS_DISABLED`) | R | **GO** (`lp-zuh.11.2` spawn complete + chip) | Chat fan-out spawns chips; no disabled copy | `lp-zuh.7.3` style fail; activity empty |
| 1.4 | Workflows enabled (not `WORKFLOWS_UNAVAILABLE`) | R | **GO** launch + vault durable (`lp-zuh.11.2` / `10.5`) | `/workflow run research-lite …` or Tools `$` | Slash refused; no workflow card |
| 1.5 | Builtin tools: bash / read / write / grep / find / catalog | R | **GO** (bash live `11.2`) | Tool progress rows on a research turn | Host refused / empty tool surface |
| 1.6 | `web_search` | **R** (kitchen-sink GO) | **GO** live (`11.2`) | Tool row emits; SERP hosts on `DAYTONA_DOMAIN_ALLOWLIST` (DDG default: `html.duckduckgo.com`,`duckduckgo.com`; optional Tavily/Brave/Firecrawl) — `lp-zuh.10.1` / [production-network-allowlist.md](../../../docs/plans/0008-daytona-agent-sandboxes/production-network-allowlist.md) §6 | `fetch failed` / proxy unavailable |
| 1.7 | MCP connectors | O | **PRODUCT_NA signed** (`lp-zuh.11.5` / human PR #488) | Lab path: `lab_echo` + fragment (`lp-zuh.10.6`); live empty honest until LA `lp-vw3`. Zero-waiver: [zero-waiver-go/mcp/](./zero-waiver-go/mcp/) | MCP absent is not alone a kitchen-sink fail (`mcp_unavailable`) |
| 1.8 | Capabilities honesty (no false `vault_editor` / `models.*` claims) | R | **GO** | `/api/context` + capabilities pin | UI promises edit/model paths that 4xx/SPA |
| 1.9 | MemPalace CLI on snapshot PATH when `mempalace.enabled` | O→R if enabled | **GO** live pin `lp-zuh.11.4` (ready ok + search; command-shim; UI re-proof `11.7`) | Guest `command -v mempalace`; ready `mempalace.ok` | `binary_missing` / mempalace_search errors |

\*MemPalace live clearance: `lp-zuh.11.4` (ready ok + search). Image command-shim in install-mempalace for next re-pin.

**Config anchors (non-secret):**

- Contract home: `$BACKEND_HOME` (e.g. `/var/lib/company-brain-backend`)
- LA config: `/etc/lanyard-agent/config.yaml` or projected `$BACKEND_HOME/config.yaml`
- Cron product path: `cron.state_dir=$BACKEND_HOME` → `$BACKEND_HOME/cron/jobs.json`
- Skills: via vault / `skills_roots` (LA does **not** require `$BACKEND_HOME/skills` tree)
- MCP (optional, lab): `/opt/lanyard/lab-mcp/lab_echo_server.py` + fragment
  `kitchen-sink-mcp.fragment.yaml`; default seed omits `mcp_servers` until LA Zod
  accepts it (`lp-vw3`). See [mcp-product-surface-mocklab.md](../../../docs/plans/0008-daytona-agent-sandboxes/mcp-product-surface-mocklab.md).

---

## 2. Vault mount (Bucket B)

Goal: guest sees a readable (and ideally writable) vault at `VAULT_ROOT`
(default `/mnt/vault`), backed by tenant `s3_vault_prefix`.

| # | Item | R/O | Gate (`lp-zuh.11.6`) | Verify | Failure if wrong |
|---|------|-----|----------------------|--------|------------------|
| 2.1 | CP `s3_vault_prefix` set (`tenants/{tenant_id}/vault/`) | R | **GO** | CP instance row | `vault_mount_failed` / ensure_online 502 |
| 2.2 | Platform vault bucket + IAM session policy for prefix | R | **GO** | STS assume + mount policy templates | AccessDenied on mount / S3 |
| 2.3 | Snapshot has `mount-s3` + FUSE (or pin-equivalent) | R | **GO** (`lp-zuh.11.1`) | Image bake / `lp-zuh.9.3` | Mount helper **binary_missing** |
| 2.4 | Wake injects short-lived AWS_* for mount only | R | **GO** | Entrypoint mount then gateway | Mount timeout → entrypoint fail-closed |
| 2.5 | `VAULT_ROOT=/mnt/vault` (or agreed path) readable before gateway | R | **GO*** | Entrypoint wait; `test -d -r` | Vault wait timeout |
| 2.6 | Writable vault for agent + Portal write paths | **R** (durable SOE) | **GO** (`lp-zuh.11.2`) | `touch`/`vault.write` under prefix | **permission_denied** / EACCES on write |
| 2.7 | Portal vault tree shows roots (ACL + BFF) | **R** (durable SOE) | **GO** (`lp-zuh.11.2`) | Vault UI + `GET /api/vault/tree` | Empty tree / SPA HTML fallback |

\*Gate note: entrypoint once fail-closed with “vault not writable” immediately after remount; re-check writability / restart gateway (ops race). MockLab durable vault SOE is **GO** after `lp-zuh.9.*` + seed.

**Normative refs:**  
[gateway-env-contract.md](../../../docs/plans/0008-daytona-agent-sandboxes/gateway-env-contract.md),  
[filesystem-layout.md](../../../contracts/backend-runtime-v1/filesystem-layout.md).

---

## 3. Env inject (Bucket C — wake)

Goal: same **names** as EC2 systemd; values re-injected every Daytona start.

| # | Variable / material | R/O | Notes |
|---|---------------------|-----|-------|
| 3.1 | `GATEWAY_RELAY_URL` | R | Platform relay WSS |
| 3.2 | `GATEWAY_RELAY_ID` = permanent `instance_id` | R | **Never** Daytona `sandbox_id` |
| 3.3 | `GATEWAY_RELAY_INSTANCE_ID` = same `instance_id` | R | Parity with 3.2 |
| 3.4 | `GATEWAY_RELAY_SECRET` | R | Wake inject each start; not in image |
| 3.5 | `BACKEND_HOME` | R | Ephemeral guest disk (not vault) |
| 3.6 | `BACKEND_KIND` | R | `lanyard_agent` for MockLab-class |
| 3.7 | `BACKEND_INSTALL_PATH` | R | Snapshot install tree |
| 3.8 | `VAULT_ROOT` | R | After mount ready |
| 3.9 | `BRAIN_TENANT_ID` | R | Tenant stamp / ACL context |
| 3.10 | `S3_VAULT_PREFIX` / mount helper env | O | Entrypoint helpers; agent uses `VAULT_ROOT` |
| 3.11 | Provider keys (see §7) | R | At least one live model path |
| 3.12 | Optional search keys (`FIRECRAWL_*`, `TAVILY_*`, `BRAVE_*`, …) | O | Only if web_search productized |

**Anti-patterns:** baking secrets into snapshot; putting `sandbox_id` in relay ids;
install-on-boot CLIs.

---

## 4. Skills seed

Goal: vault (or skills_roots) has discoverable skills so Settings + agent inventory
are non-empty for real tenants.

| # | Item | R/O | Verify | Failure if wrong |
|---|------|-----|--------|------------------|
| 4.1 | Seed under `s3_vault_prefix` (skills/, README, packs as product requires) | **R** (kitchen-sink SOE) | Portal tree / agent `ls` / settings.snapshot skills | **empty_vault**; no skill ids on cron |
| 4.2 | `skills_roots` / vault paths readable by agent UID | R if seeded | Agent can `read` skill SKILL.md | **EACCES** / permission_denied |
| 4.3 | Idempotent seed script (e.g. client-core `seed-vault` pattern) | O | Re-run does not wipe tenant data | Overwrite residual |
| 4.4 | Projects primary_path for Directory under vault | **R** (MockLab kitchen-sink, `lp-zuh.10.7` + zero-waiver **GO** `lp-zuh.11.2`) | `/api/agent/projects` ≥1 with `primary_path` under `VAULT_ROOT` | Empty projects or BACKEND_HOME cwd only |

**Gate (`lp-zuh.11.6` / prior `10.8`):** seed **GO** (AGENTS + skills + notes); settings skills from vault **GO**.  
Projects primary_path under vault is product path via entrypoint `ensure_default_projects` (`lp-zuh.10.7`); live pin **GO** at `/mnt/vault/Projects/Workspace` (`lp-zuh.11.2`).

MockLab seed lever (`lp-zuh.9.5` + `lp-zuh.10.7`):
- Filesystem: `deploy/scripts/seed-mocklab-s3-vault.sh` +
  `deploy/artifacts/mocklab-vault-seed/` (AGENTS.md gate, `skills/mocklab-research`,
  `Projects/Workspace/welcome.md`, `primary_path=/mnt/vault/Projects/Workspace`).
  Offline: `bash deploy/scripts/smoke-seed-mocklab-s3-vault.sh`. Live:
  `AWS_PROFILE=lanyard-main bash deploy/scripts/seed-mocklab-s3-vault.sh --use-mocklab-default`.
- Host registry: agent-gateway `ensure_default_projects` seeds
  `$BACKEND_HOME/projects.db` (Workspace → vault path) before gateway boot.
  Operator: `bash deploy/scripts/seed-mocklab-agent-projects.sh`.
  Offline: `bash deploy/scripts/smoke-seed-mocklab-agent-projects.sh`.
  Evidence: `artifacts/daytona-pilot/lp-zuh.10.7-projects/`.
Historical empty-tree residual: `lp-zuh.7.6` (pre-mount / pre-seed).

---

## 5. Cron + workflow `state_dir` / data dirs

### 5.1 Cron

| # | Item | R/O | Gate (`lp-zuh.11.6`) | Verify | Failure if wrong |
|---|------|-----|----------------------|--------|------------------|
| 5.1 | Product cron store under configured `cron.state_dir` (`…/cron/jobs.json`) | R | **GO** vault (`11.2`) | Settings snapshot path; create job 201 | Jobs invisible / wrong Hermes path |
| 5.2 | EC2 / always-on: `cron.state_dir=$BACKEND_HOME` (or default equivalent) | R | N/A MockLab Daytona | Not nested under `sessions/` | Snapshot ≠ ticker inventory |
| 5.2b | **Daytona kitchen-sink (post `lp-zuh.9`):** `cron.state_dir=/mnt/vault` | R | **GO** (`11.2`) | Guest config + `/mnt/vault/cron/jobs.json`; S3 durable | Hybrid `BACKEND_HOME` only — lost on stop without platform rematerialize |
| 5.2c | LA store must tolerate Mountpoint **no-rename** (ENOSYS) | R (Daytona vault) | **GO** live pin (`11.1` / `10.9` bake) | Create/update jobs without `rename` failure | `ENOSYS` on create — pin agent with overwrite fallback (`lp-zuh.10.4` / `10.9`) |
| 5.3 | Platform durable job registry rematerialize on `ensure_online` | R (Daytona ops fire) | Orthogonal (vault product store GO) | Platform SoT survives stop; optional guest rematerialize | Offline fire path blind |
| 5.4 | Platform schedule evaluator **or** guest ticker when online for fire | **R** for fire SOE | **GO** (`10.4`; UI durable `11.2`) | Live fire / `run` / tick | Never fires |
| 5.5 | Portal Settings → Scheduled Tasks list path | O | UI residual | UI folder / table after create | Create works, UI empty |

**MockLab evidence (`lp-zuh.7.4`):**  
`jobs.json=/var/lib/company-brain-backend/cron/jobs.json` (hybrid),  
`backend_home=hermes_home`, `state_dir=null`, API create 201; fire not forced.

**MockLab evidence (`lp-zuh.10.4` — vault + fire GO):**  
`cron.state_dir=/mnt/vault`, `jobs.json=/mnt/vault/cron/jobs.json`,  
job `09b7330db248` GPU capacity brief, guest ticker fire `last_status=ok`,  
output on vault + S3; survives Daytona stop/start. See  
[lp-zuh.10.4/RESULT.md](./lp-zuh.10.4/RESULT.md).

### 5.2 Workflows

| # | Item | R/O | Gate (`lp-zuh.11.6`) | Verify | Failure if wrong |
|---|------|-----|----------------------|--------|------------------|
| 5.6 | Workflows feature on host (definitions + runner) | R | **GO** (`11.2` card + launch) | research-lite card + stages | `WORKFLOWS_UNAVAILABLE` |
| 5.7 | Workflow run data dir writable | R | **GO** mkdir + vault run state (`10.5` / `11.2`) | Run under `workflow.state_dir` | **mkdir EACCES** mid-run |
| 5.8 | Prefer durable project/vault `.lanyard/workflows/` for **definitions** | O | `definition_roots=/mnt/vault/workflows` | Host-advertised list | Definitions only on ephemeral disk |
| 5.9 | Daytona kitchen-sink: durable workflow **run** state on vault (not hybrid BACKEND_HOME) | R | **GO** (`10.5` / `11.2`) | Guest `workflow.state_dir=/mnt/vault`; run dirs `/mnt/vault/wf_*`; S3 + remount | Hybrid host-only runs lost on stop |
| 5.9b | LA store must tolerate Mountpoint **no-rename** (ENOSYS) for workflow JSON admit | R (Daytona vault) | **GO** live pin (`11.1` bake; no ENOSYS on `11.2`) | Admit program/args/state without rename | ENOSYS on launch until pin bakes LA #241 |

**MockLab evidence (`lp-zuh.7.5` + gate):**  
Launch PASS historically; kitchen-sink config `workflow.state_dir=/mnt/vault` + guest
mkdir **GO** (`lp-zuh.9.6` / gate).

**MockLab evidence (`lp-zuh.10.5` — vault run state GO):**  
`workflow.state_dir=/mnt/vault`, research-lite run `wf_7fad97d2e324fa00` under
`/mnt/vault/wf_*` (program/args/state/journal), S3 durable, survives Daytona
stop/start remount; no hybrid BACKEND_HOME run store. See
[lp-zuh.10.5/RESULT.md](./lp-zuh.10.5/RESULT.md).  
Residual: bake workflow ENOSYS fallback in next agent-gateway pin (cron pin was
`lp-zuh.10.9` only); journal append `EPERM` residual on Mountpoint after admit.

---

## 6. OnlyOffice (BFF + web flags)

Customer-facing production edit may be **blocked** on free-track license policy
(`docs/plans/0004-…/decision-license-path.md`) — **H**. Lab / MockLab checklist below
is for “editor host mounts when product enables it.”

| # | Item | R/O | Gate (`lp-zuh.11.6`) | Verify | Failure if wrong |
|---|------|-----|----------------------|--------|------------------|
| 6.1 | Edge routes `/api/office/*` and vault content binary APIs to BFF | R for OO | **GO** mint JSON (`lp-zuh.11.3` auth **422**) | POST mint returns **JSON**, not SPA HTML | `mint_spa_html_fallback` |
| 6.2 | `VITE_ONLYOFFICE_EDITOR=true` at **SPA build** | R for OO | **EXPLICIT_HARD_RESIDUAL** operator (`11.3`) | `__LANYARD_FEATURE_FLAGS__` / editor host | Host never mounts |
| 6.3 | `VITE_ONLYOFFICE_DS_URL` HTTPS (non-loopback) | R for OO | **EXPLICIT_HARD_RESIDUAL** operator | Network fetch DocsAPI `api.js` | `https_required` / no DocsAPI |
| 6.4 | `VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS` aligned | R for OO | **EXPLICIT_HARD_RESIDUAL** operator | DS allowlist | Cross-origin DS fail |
| 6.5 | BFF `ONLYOFFICE_JWT_SECRET` matches Document Server | R for OO | Operator (needed for mint **201**) | Mint 200 with token presence | Mint 4xx/5xx |
| 6.6 | `ui.can.vault_edit=true` + host `vault_editor` affordance | R for OO | **GO** `vault_edit=true` (`11.3` / `12.5`); host affordance still residual | `/api/context` | Stuck on client preview |
| 6.7 | `features.vault_write` / vault binary path works | R for OO | Partial (tree GO; PUT may SPA-mask) | PUT/GET vault content not SPA | Cannot stage docx |
| 6.8 | Document Server topology + license track | H | **H** | ADR / license decision | Production claim blocked |
| 6.9 | Office callback status-2 → durable `vault.write` CAS | O (edit writeback) | **RESIDUAL** `write_unavailable` (`lp-zuh.12.5`); fix `lp-zuh.12.7` | Probe `onlyoffice-edit-writeback/` | Edit mint works; save never lands |

**MockLab OnlyOffice (`lp-zuh.7.7` → path `lp-zuh.10.3` → zero-waiver `lp-zuh.11.3` → writeback `lp-zuh.12.5`):**  
Platform mint path **GO** live: authenticated `missing_file`→**422 JSON**,
`ui.can.vault_edit=true` (**live**). Edit mint + callback route GO; durable status-2
writeback residual → **`lp-zuh.12.7`**. Editor DocsAPI still subject to HTTPS/SPA
residuals (`lp-zuh.12.2` / `lp-zuh.12.6`) — not silent green.

- Normative: [onlyoffice-mocklab-go-path.md](../../../docs/plans/0008-daytona-agent-sandboxes/onlyoffice-mocklab-go-path.md) (§13 writeback)
- Residual package: [residuals/onlyoffice/](./residuals/onlyoffice/)
- Writeback probe: [onlyoffice-edit-writeback/](./onlyoffice-edit-writeback/)
- Zero-waiver: [zero-waiver-go/onlyoffice/](./zero-waiver-go/onlyoffice/)
- Gate: [zero-waiver-go/RESULT.md](./zero-waiver-go/RESULT.md) (supersedes waived OO row in kitchen-sink-go)
- Lab writeback flag: `BFF_OFFICE_VAULT_EDIT=true` (**live true**; plain env, not SM)
- SPA rebuild: `VITE_ONLYOFFICE_EDITOR` + HTTPS `VITE_ONLYOFFICE_DS_URL` + allowlist

Unblock order remaining: (a) HTTPS DS + SPA residuals for DocsAPI host, (b) `lp-zuh.12.7`
CP put + `cp_s3` callback writer for durable save, (c) JWT align if mint regresses.

---

## 7. Model keys

Pilot SoT: **platform SM + wake inject** — not Portal paste-keys UI  
([pilot-model-keys-sm-inject-decision.md](../../../docs/plans/0008-daytona-agent-sandboxes/pilot-model-keys-sm-inject-decision.md)).

| # | Item | R/O | Verify | Failure if wrong |
|---|------|-----|--------|------------------|
| 7.1 | Secrets envelope in AWS SM for tenant/host | R | Envelope schema validate offline | Chat cannot call model |
| 7.2 | At least one provider key injected (`OPENAI_API_KEY`, `XAI_API_KEY`, `ANTHROPIC_API_KEY`, …) | R | Wake env / materialize | Inference 401 / empty replies |
| 7.3 | Optional `LITELLM_MASTER_KEY` / LiteLLM model_list non-secret | O | When LiteLLM in path | Router fail |
| 7.4 | Optional OAuth (`LANYARD_OAUTH_KEY` + `oauth.enc`) | O | Super Heavy / Codex tracks | OAuth models unavailable |
| 7.5 | Egress allowlist includes model API hosts **and** web_search SERP hosts when search is productized | R | Create-time `domainAllowList` / `DAYTONA_DOMAIN_ALLOWLIST` (cold create after expand) | Timeouts / `web_search` fetch failed (`lp-zuh.10.1`) |
| 7.6 | Settings honesty: no fake “configure models” without `models.*` | R | Settings UI disabledReason | User-facing lie |
| 7.7 | Multi-tenant key admin UI | H / deferred | Product follow-on | Do not block pilot |

---

## 8. Portal / tenant control plane (support)

| # | Item | R/O | Notes |
|---|------|-----|-------|
| 8.1 | Tenant slug + Portal route (`/mocklab` style) | R | Base URL for humans + live-qa |
| 8.2 | Agent user credentials (IdP / bootstrap) | R | Never commit; `.env.*` mode 0600 |
| 8.3 | CP gateway instance `runtime_kind=daytona` | R | MockLab product path |
| 8.4 | Relay registration for instance_id | R | Presence online after wake |
| 8.5 | BFF → CP ensure_online path | R | Cold chat wakes sandbox |
| 8.6 | CloudWatch / gateway log IAM for ops | O | Live QA used client wall clock when CW missing |

---

## 9. Snapshot binaries & tools (Bucket A)

Prebake — **no** apt/pip on boot.

| Binary / tool | R/O | Live residual if missing |
|---------------|-----|---------------------------|
| `company-brain-backend` (gateway) | R | Entrypoint **binary_missing** / die |
| `mount-s3` (+ FUSE) | R for durable vault | Mount fail → vault wait timeout |
| `bash`, core POSIX utils | R | Tool rows fail |
| `rg` (ripgrep) | O→R for grep tool quality | `ripgrep (rg) is not available…` (`lp-zuh.7.2`) |
| `file` | O | `file: command not found` |
| Python / product CLIs in pin | R as pin requires | Skill scripts fail |

---

## 10. Failure-mode catalog (operator)

Use these residual codes in tickets and RESULT.md files.

| Code | Typical signal | Likely fix |
|------|----------------|------------|
| `binary_missing` | `rg` / `file` / gateway / `mount-s3` not found | Bake into snapshot; bump pin |
| `mkdir_eacces` / `EACCES` | mkdir/write fails under vault or data dir | UID/GID, mount perms, writable prefix |
| `permission_denied` | vault write root:root; ACL deny | Mount uid, path_prefixes, seed ownership |
| `empty_vault` | tree 0 roots; no skills/README | Run seed (`lp-zuh.9.5`); check prefix |
| `vault_mount_failed` | ensure_online 502; s3_vault_prefix missing | CP prefix + IAM + mount inject |
| `vault_wait_timeout` | entrypoint exit before gateway | Mount order; wait sec; ready file |
| `env_missing` | entrypoint “required env … missing” | Bucket C wake inject |
| `relay_auth_fail` | never-connect; wrong instance id | Permanent instance_id; secret inject |
| `SUBAGENTS_DISABLED` | no chips; disabled copy | Agent kitchen-sink config |
| `WORKFLOWS_UNAVAILABLE` | slash refuse; no card | Enable workflows / definitions |
| `web_search_fetch_failed` | tool row error; egress | Merge `DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST` into CP `DAYTONA_DOMAIN_ALLOWLIST`; redeploy CP; **cold create** sandbox; optional paid keys |
| `mcp_unavailable` | empty MCP until LA `lp-vw3` + optional `LANYARD_ENTRY_SEED_MCP` (`lp-zuh.10.6` path) | Optional; residual package + lab_echo (no tokens) |
| `cron_path_diverge` | Settings ≠ jobs.json | `cron.state_dir=$BACKEND_HOME` |
| `cron_lost_on_stop` | jobs vanish after idle | Platform rematerialize registry |
| `cron_no_fire` | never runs while stopped | Platform schedule evaluator |
| `workflow_data_ephemeral` | runs under guest home only | Accept pilot residual or pin data root |
| `mint_spa_html_fallback` | office mint returns HTML | Edge route office APIs to BFF |
| `vault_content_spa_html` | vault binary API returns HTML | Same edge / method routing |
| `ui.can.vault_edit=false` | preview only | Capability + vault_write |
| `VITE_ONLYOFFICE_*` | no DocsAPI / host | Rebuild SPA with flags + HTTPS DS |
| `office_jwt_mismatch` | mint 4xx | Align BFF + DS secrets |
| `model_key_missing` | empty / 401 model calls | SM + inject (§7) |
| `settings_dishonest` | UI claims unsupported feature | Capability pin honesty |

---

## 11. Minimum green path (ordered)

For a **new tenant** aiming at MockLab kitchen-sink SOE:

1. **CP + Relay:** register instance (`runtime_kind=daytona`), permanent `instance_id`, secrets.
2. **Snapshot pin:** LA gateway image with mount helpers + tool binaries.
3. **Vault:** `s3_vault_prefix` + IAM + wake mount → `VAULT_ROOT` ready.
4. **Env inject:** Relay + `BACKEND_*` + model keys (Bucket C).
5. **Seed (recommended):** skills/README/projects under prefix.
6. **Agent kitchen-sink:** subagents + workflows + cron tools on.
7. **Cron state:** `$BACKEND_HOME/cron/jobs.json` + platform rematerialize + evaluator for fire.
8. **Portal smoke:** login → chat tool turn → subagent fan-out → workflow card → cron create → vault list.
9. **OnlyOffice (optional / gated):** edge + VITE + JWT + vault_edit after vault works.
10. **Evidence:** deposit under `artifacts/mocklab/live-qa/` (or tenant-named sibling); no secrets.

Offline monorepo guards still apply: `bash scripts/validate.sh` (docs/contracts only until product migrate beads ask otherwise).

---

## 12. Live-qa re-proof map

| Surface | Script / evidence |
|---------|-------------------|
| **Zero-waiver close gate** | [`zero-waiver-go/RESULT.md`](./zero-waiver-go/RESULT.md) (`lp-zuh.11.6`) |
| Core matrix | [`zero-waiver-go/core/`](./zero-waiver-go/core/) (`lp-zuh.11.2`) |
| OnlyOffice mint / editor residual | [`zero-waiver-go/onlyoffice/`](./zero-waiver-go/onlyoffice/) (`lp-zuh.11.3`) |
| MemPalace ready + search | [`zero-waiver-go/mempalace/`](./zero-waiver-go/mempalace/) (`lp-zuh.11.4`) |
| MCP product N/A signed | [`zero-waiver-go/mcp/`](./zero-waiver-go/mcp/) (`lp-zuh.11.5`) |
| Kitchen-sink gate (historical) | [`kitchen-sink-go/RESULT.md`](./kitchen-sink-go/RESULT.md) (`lp-zuh.10.8` GO_WITH_WAIVERS) |
| Durable vault post-mount | [`post-mount/`](./post-mount/) (`lp-zuh.9.6`) |
| Web search residual | [`residuals/web-search/`](./residuals/web-search/) (`lp-zuh.10.1`) |
| Cron vault fire | [`lp-zuh.10.4/`](./lp-zuh.10.4/) |
| OnlyOffice residual (pre zero-waiver) | [`residuals/onlyoffice/`](./residuals/onlyoffice/) (`lp-zuh.10.3`) |
| MCP honest residual (pre signed N/A) | [`residuals/mcp/`](./residuals/mcp/) (`lp-zuh.10.6`) |
| Auth / suite harness | sibling PRs under epic `lp-zuh.7` (when merged) |

Credentials: gitignored `.env.mocklab-agent-dev` only. Daytona guest probes need ops `DAYTONA_*` (never commit).

---

## 13. Acceptance

### `lp-zuh.7.8` (checklist creation)

- [x] Durable checklist committed at `artifacts/mocklab/live-qa/NEW-TENANT-CHECKLIST.md`
- [x] Covers: agent kitchen-sink, vault mount, env inject, skills seed, cron/workflow state_dir, OnlyOffice BFF/web flags, model keys
- [x] Required vs optional marked (R/O/H)
- [x] Failure modes include `mkdir`/EACCES, `binary_missing`, and live-qa residual codes
- [x] Optional docs pointer from MockLab deploy index
- [x] No secrets committed

### `lp-zuh.10.8` (kitchen-sink re-QA gate)

- [x] GO/NO-GO matrix under [`kitchen-sink-go/RESULT.md`](./kitchen-sink-go/RESULT.md)
- [x] R/O + Gate columns updated to match live re-QA / waivers
- [x] Open residuals named (`lp-zuh.10.5`, `10.7`, `10.9`, OO/MemPalace operator apply)
- [x] No secrets committed

### `lp-zuh.11.6` (zero-waiver close gate)

- [x] Aggregate matrix under [`zero-waiver-go/RESULT.md`](./zero-waiver-go/RESULT.md) (**GO**)
- [x] Every surface **GO**, **PRODUCT_NA signed**, or **EXPLICIT_HARD_RESIDUAL** (OO editor only) — no silent waivers
- [x] R/O + Gate columns updated to zero-waiver posture
- [x] MCP human sign-off recorded (`lp-zuh.11.5` / PR #488)
- [x] No secrets committed

---

## 14. Pointers

| Doc | Role |
|-----|------|
| [deploy/deployments/mocklab/INDEX.md](../../../deploy/deployments/mocklab/INDEX.md) | MockLab operator root |
| [gateway-env-contract.md](../../../docs/plans/0008-daytona-agent-sandboxes/gateway-env-contract.md) | Wake inject parity |
| [pilot-model-keys-sm-inject-decision.md](../../../docs/plans/0008-daytona-agent-sandboxes/pilot-model-keys-sm-inject-decision.md) | Model keys pilot SoT |
| [lanyard-agent-cron-portal.md](../../../docs/architecture/lanyard-agent-cron-portal.md) | Cron state_dir rules |
| [filesystem-layout.md](../../../contracts/backend-runtime-v1/filesystem-layout.md) | Path catalog |
| [backend-runtime-secrets.md](../../../docs/architecture/backend-runtime-secrets.md) | Envelope + env names |
| [local-secret-hygiene.md](../../../docs/runbooks/local-secret-hygiene.md) | Credential files |
