# lp-uxy.6 — Agent sandbox: cwd path ACL proof + Omnibox Mode A wrap status

**Bead:** `lp-uxy.6` (parent epic `lp-uxy`)  
**Status:** documented + unit/live probes (2026-08-04)  
**Priority:** P1 security / UX honesty  
**Related:** deploy Omnibox Mode A (`cbd-o9s.*`), LA path ACL (`lac-yt3.4` / `lac-ple.10.1`), Daytona VM isolation epic `lp-kng`, headless fail-closed `lp-p37.6`, threat model §4.2.1

---

## 1. Executive summary

Sandboxing is **layered and host-enforced**. Portal only stamps
`working_directory` / chat project context. Path ACL and Omnibox are backend /
deploy concerns.

| Layer | What it does | Pilot default |
|-------|----------------|---------------|
| Portal stamp | Sends selected project `primary_path` as chat cwd context | On (parity phase 3) |
| LA file-tool path ACL | Denies `read`/`ls`/`grep`/`find` outside vault ∧ project | On in LA agent-core |
| LA bash tool | Forces **cwd** into project/vault; does **not** parse argv paths | Escapes via absolute / `..` commands |
| Profile capabilities | `shell_exec` is **admin-only** in runtime contract | Contributor has no shell_exec |
| Omnibox Mode A | bubblewrap tool-child cage when `OMNIBOX_ENABLED=1` | **Default OFF** on host |
| HL product wrap | Prefixes local shell with `run-under-omnibox` when enabled | **Shipped** on HL main (`cbd-o9s.17`) |
| LA Omnibox wrap | Same product hook | **Not present** (residual) |
| Daytona / VM | Shared-kernel escape → separate epic | `lp-kng` (not this bead) |

**Bottom line for pilot pins:** file tools are confined; **admin shell can leave the project tree** unless Omnibox is on *and* the backend actually wraps spawn (HL only today). Shared kernel residual remains even with Omnibox.

---

## 2. Claimed backends / pins probed

Probes run from developer checkouts adjacent to this monorepo (not customer
staging). No secrets committed.

| Backend | Checkout SHA (probe day) | Notes |
|---------|--------------------------|--------|
| **Lanyard Agent (LA)** | `e0e2032533c9fce2ff7306831f74b4244b241d05` | `packages/agent-core` tools-sandbox + live createV1Tools probe |
| **Hermes-Lanyard (HL)** | `72f6acac87e5bbf2bf0271f3ecc3128a3fd5462b` (main tip); Omnibox wrap landed at `4596ecd5876edfc509e7bbbf970a2bec1be5a882` (`cbd-o9s.17` / PR #6) | `tests/agent/test_omnibox.py` + plan_local_shell_wrap unit probe |
| **Deploy (this monorepo)** | branch of this PR | `bash deploy/scripts/smoke-omnibox.sh`, argv builder `--self-test`, path-escape negative script |

Joint GO historical evidence still marks `host.sandbox_enforced` as **unit**
provenance (`artifacts/mocklab/lp-rt5/joint-go-evidence-*.json`). This bead adds
honest shell residual documentation and monorepo-owned negative automation.

---

## 3. What is blocked vs escapable

### 3.1 Lanyard Agent (`lanyard_agent`)

| Probe | Result | Mechanism |
|-------|--------|-----------|
| File `read` `../` sibling under vault but outside `primary_path` | **BLOCKED** | `ProjectPathEscapeError` |
| File `read` absolute path outside `vault_root` | **BLOCKED** | `VaultPathEscapeError` |
| File `ls`/`grep`/`find` path escape | **BLOCKED** | tools-sandbox unit suite |
| Symlink whose realpath leaves root | **BLOCKED** when target exists | realpath re-check (`lac-ple.10.1`) |
| Shell `pwd` with projectRoot set | **OK** — cwd = project root | spawnHook clamps cwd |
| Shell `cat <absolute outside project/vault>` | **ESCAPABLE** | bash is cwd-only; argv not path-parsed |
| Shell `cat ../sibling` | **ESCAPABLE** | same |
| Shell `head /etc/passwd` | **ESCAPABLE** | same |
| Omnibox wrap of bash | **N/A** | no `OMNIBOX_*` product hook in LA tree |

**Automated unit proof (claimed backend):**

```bash
# from lanyard-agent
pnpm --filter @lanyard/agent-core exec vitest run test/tools-sandbox.test.ts
# 32 passed (probe day)
```

**Live negative probe (2026-08-04, createV1Tools with vault+projectRoot):**

| Call | Status |
|------|--------|
| `read ../sib.txt` | DENY `ProjectPathEscapeError` |
| `read $outside/secret.txt` | DENY `VaultPathEscapeError` |
| `bash cat $outside/secret.txt` | **OK** returned `SECRET` |
| `bash cat ../sib.txt` | **OK** returned sibling content |
| `bash head -1 /etc/passwd` | **OK** returned passwd line |
| `bash pwd` | OK project path |

### 3.2 Hermes-Lanyard (`hermes_lanyard`)

| Probe | Result | Mechanism |
|-------|--------|-----------|
| Omnibox **off** (`OMNIBOX_ENABLED=0` / unset) | shell_exec / terminal argv **passthrough** (no cage) | product design + deploy default |
| Omnibox **on** + host-impacting tool | argv becomes `$OMNIBOX_WRAPPER --profile … -- <cmd>` | `agent/omnibox.py` + `tools/environments/local.py` + process_registry |
| Vault-only tools | not wrapped | host-impacting registry |
| Unknown profile when enabled | **fail-closed deny** (no bare command) | unit tests |
| Empty wrapper when enabled | **fail-closed deny** | unit tests |
| File-tool project primary_path ACL (LA-parity) | **Not the same LA agent-core ACL** | HL uses vault/profile/path_prefixes + optional Omnibox path grants |
| Admin `shell_exec` without Omnibox | **Host-visible** (subject to headless approval / allowlists) | residual admin blast radius |

**Automated unit proof:**

```bash
# from hermes-lanyard
pytest tests/agent/test_omnibox.py -q   # 25 passed (probe day)
```

**Unit wrap probe:**

```text
OMNIBOX_ENABLED=0 → WrapDecision(wrap=False, reason=omnibox_disabled, argv=bare)
OMNIBOX_ENABLED=1 + admin → argv starts with /usr/local/sbin/run-under-omnibox --profile admin --
```

### 3.3 Deploy / monorepo (this repo)

| Probe | Result |
|-------|--------|
| Policy seeds + ensure dry-run | PASS (`smoke-omnibox.sh`) |
| Argv builder self-test (shell_exec wrap shape) | PASS |
| Project path escape negative (pure contract mirror) | PASS (`test-project-path-escape.py`) |
| Live bubblewrap on customer host | **Not claimed** here (needs stage host + `enable_omnibox=true`) |

---

## 4. Omnibox Mode A — wrap status (acceptance)

### Proven wrap (Hermes-Lanyard product)

- **Owner (product):** hermes-lanyard — `agent/omnibox.py`, wired from
  `tools/environments/local.py` (`_maybe_omnibox_wrap_argv`) and
  `tools/process_registry.py` for background/PTY shells.
- **Landed:** `cbd-o9s.17` commit `4596ecd5876edfc509e7bbbf970a2bec1be5a882`
  (merge PR #6 on HL main).
- **Deploy contract:** `deploy/references/omnibox-mode-a-hermes-hook.md` +
  `deploy/scripts/omnibox/build-shell-exec-argv.py` + systemd drop-in
  `OMNIBOX_ENABLED=0` by default.

### Explicit residuals + owners

| Residual | Owner | Notes |
|----------|--------|-------|
| Default **OFF** — pilot hosts do not cage shell until operators set `enable_omnibox` / `OMNIBOX_ENABLED=1` | **Deploy / ops** | intentional until staging table (`lp-t7q.6`) |
| Live gateway isolation on **staging host** not re-proven in this bead | **Ops** (`lp-t7q.6`) | offline smokes ≠ production pen-test |
| **Lanyard Agent** does not implement Omnibox argv rewrite | **LA product** | residual until LA honors `OMNIBOX_*` or Daytona isolation |
| Shared **host kernel** (bubblewrap userns) | **Platform** | not MicroVM; see threat model §4.2.1 + epic **`lp-kng`** |
| Admin session with `shell_exec` is high blast radius even with Omnibox | **Profiles / RBAC** | prefer contributor for day-to-day; least privilege |
| LA bash absolute-path escape when shell is allowed | **LA product** | file tools blocked; shell argv not path-ACL'd |

Hook contract updated in-repo so residual text no longer claims “product PR
required” for HL; it records **landed wrap + residual defaults**.

---

## 5. Residuals operators must accept (pilot)

1. **Not a hard jail.** Portal stamp + LA file ACL ≠ OS isolation.
2. **Admin shell** can read host paths on LA today; on HL when Omnibox is off.
3. **Omnibox default off** — enabling is an operator/staging action, not Portal UI.
4. **Shared kernel** — kernel RCE / userns escape leave Omnibox; multi-tenant
   strength needs account isolation and/or Daytona VM path (**`lp-kng`**).
5. **Headless dangerous actions** — separate fail-closed work `lp-p37.6` (HL);
   does not replace path ACL or Omnibox.

Optional future (out of this bead’s required acceptance): default-deny shell for
Portal sessions unless operator opts in (already true for **contributor**
profile — no `shell_exec` capability in contract seeds).

---

## 6. Automated negative tests (monorepo)

```bash
# Always offline (monorepo):
python3 deploy/scripts/omnibox/test-project-path-escape.py
python3 deploy/scripts/omnibox/build-shell-exec-argv.py --self-test
bash deploy/scripts/smoke-omnibox.sh

# Full probe + evidence (optional external checkouts):
LANYARD_AGENT_ROOT=../lanyard-agent \
HERMES_LANYARD_ROOT=../hermes-lanyard \
  bash deploy/scripts/prove-sandbox-path-acl.sh
# Evidence: artifacts/security/lp-uxy.6/path-acl-evidence-*.json
```

`test-project-path-escape.py` is the monorepo-owned **automated negative test**
for project path escape semantics (prefix traps, `..`, absolute outside,
project tighter than vault). When `LANYARD_AGENT_ROOT` is set, the prove script
also runs LA `tools-sandbox.test.ts` (claimed LA backend suite).

---

## 7. New recurring costs

None introduced by this bead.

| Item | Cost impact |
|------|-------------|
| API keys / extra LLM judge | none |
| Firecrawl / X search | documented + Portal UI (lp-uxy.7); live Firecrawl cost-gated on `FIRECRAWL_API_KEY` |
| Daytona vCPU | none here; tracked under `lp-kng` |
| Omnibox enable on host | CPU overhead for bwrap children only when flag on; no new SaaS |

---

## 8. Non-claims

- Not AWS staging Omnibox live table (see `lp-t7q.6`)
- Not production security sign-off / pen-test pass
- Not Daytona multi-tenant VM isolation (epic `lp-kng`)
- Not a claim that LA bash is path-ACL safe
- No secrets, tokens, or `.env.mocklab-agent-dev` contents in git

---

## 9. Acceptance mapping

| Criterion | Evidence |
|-----------|----------|
| Written report: blocked vs escapable on pilot pin | this document §§3–5 |
| Omnibox Mode A: proven wrap **or** residual with owner | §4 (HL proven unit wrap; residual default-off + LA missing + shared kernel) |
| ≥1 automated negative test for project path escape | `deploy/scripts/omnibox/test-project-path-escape.py` (+ LA tools-sandbox when root set) |
