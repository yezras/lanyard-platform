# Omnibox Mode A — Hermes shell / host-tool hook contract

**Bead:** `cbd-o9s.11` (phase 5); product wrap status refreshed under **`lp-uxy.6`**  
**Status:** Deploy contract **defined** (host env + argv builder in this repo). **Hermes-Lanyard product wrap landed** (`cbd-o9s.17`, `agent/omnibox.py` on HL main) — still **default OFF** on host (`OMNIBOX_ENABLED=0`). Lanyard Agent does **not** implement the wrap (residual).  
**Backend:** `bwrap_inrepo` via `run-under-omnibox` (phases 0–2).  
**Related:** `scripts/omnibox/`, `references/runbooks/omnibox-mode-a-spike.md`, `references/hermes-profile-rbac.md`, `modules/company-brain-ec2/systemd/hermes-gateway.service.d/omnibox.conf`, monorepo report `docs/security/lp-uxy.6-agent-sandbox-path-acl-omnibox.md`.

---

## 1. Goal

When `OMNIBOX_ENABLED=1`, **host-impacting** agent tools (especially `shell_exec`) must exec:

```text
$OMNIBOX_WRAPPER --profile <admin|contributor> [--path-prefix …] -- <command…>
```

with session profile and path prefixes from Portal → relay inject (`source.profile` / subject path prefixes). Vault-only tools stay on existing in-process paths unless they shell out.

---

## 2. Ownership split

| Layer | Owner | Deliverable |
|-------|--------|-------------|
| Policy seeds + wrapper + ensure + bootstrap flag | **This repo** | phases 1–4 |
| Env on gateway unit (`OMNIBOX_*`) | **This repo** | systemd drop-in + `omnibox.env` |
| Host-impacting tool registry + argv builder | **This repo** | `scripts/omnibox/host-impacting-tools.json`, `build-shell-exec-argv.py` |
| Actually wrapping tool children before spawn | **Hermes-Lanyard product** | **landed** `cbd-o9s.17` (see residual below) |
| Operator runbook / threat model | phase 7 (`cbd-o9s.13`) | **not** this doc |

### Product wrap status + residual (lp-uxy.6)

**Hermes-Lanyard — product wrap landed** (external runtime, not vendored here):

| Item | Value |
|------|--------|
| Bead | `cbd-o9s.17` |
| Commit | `4596ecd5876edfc509e7bbbf970a2bec1be5a882` (PR #6 on HL main) |
| Module | `agent/omnibox.py` |
| Spawn hooks | `tools/environments/local.py` (`_maybe_omnibox_wrap_argv`), `tools/process_registry.py` |
| Unit proof | `pytest tests/agent/test_omnibox.py` |

When `OMNIBOX_ENABLED=1`, host-impacting local shell (`terminal` / `shell_exec`) is rewritten to:

```text
$OMNIBOX_WRAPPER --profile <admin|contributor> [--path-prefix …] -- <command…>
```

**Residuals (owners):**

| Residual | Owner |
|----------|--------|
| Host **default OFF** (`OMNIBOX_ENABLED=0` / `enable_omnibox=false`) — deploy env alone does not cage shell until operators enable | **Deploy / ops** |
| Live staging gateway table not claimed by offline smokes | **Ops** (`lp-t7q.6`) |
| **Lanyard Agent** has no Omnibox argv rewrite | **LA product** |
| Shared-kernel bubblewrap (not MicroVM) | **Platform** / epic **`lp-kng`** |
| Admin `shell_exec` blast radius even with wrap | **Profiles / RBAC** |

`agent/shell_hooks.py` `pre_tool_call` remains complementary deny/approve behavior — **not** a substitute for Mode A isolation. Offline smokes in this repo prove **contract + argv shape** (+ HL unit wrap when `HERMES_LANYARD_ROOT` is set via `prove-sandbox-path-acl.sh`); they do **not** replace host-level staging proof.

---

## 3. Host environment (already provisioned in phase 4)

Systemd drop-in: `modules/company-brain-ec2/systemd/hermes-gateway.service.d/omnibox.conf`  
Host file: `/etc/company-brain/omnibox.env` (from user_data / bootstrap).

| Variable | Meaning | Default |
|----------|---------|---------|
| `OMNIBOX_ENABLED` | Feature flag; hook **must no-op** when `0` / unset / empty | `0` |
| `OMNIBOX_WRAPPER` | Absolute path to wrapper binary | `/usr/local/sbin/run-under-omnibox` |
| `OMNIBOX_CONFIG_DIR` | Policy + registry dir | `/etc/company-brain/omnibox` |
| `OMNIBOX_POLICY_DIR` | Optional override for `{profile}.yaml` (wrapper) | same as config dir when installed |
| `OMNIBOX_ARGV_BUILDER` | Optional path to deploy argv helper | `/usr/local/sbin/omnibox-build-shell-exec-argv` after ensure |

**Do not** change `hermes-gateway` `ExecStart` to Omnigent or wrap the long-lived process.

Break-glass: set `OMNIBOX_ENABLED=0` in `/etc/company-brain/omnibox.env`, `systemctl daemon-reload && systemctl restart hermes-gateway`.

---

## 4. Session context → wrapper argv

### 4.1 Session source (Portal / relay)

| Field | Source | Notes |
|-------|--------|-------|
| `profile` | Relay inject `source.profile` / brain-rpc `auth.subject.hermes_profile` | Must be `admin` or `contributor` for MVP |
| `path_prefixes` | Portal role `path_prefixes` stamped on subject | Vault-root-relative or absolute under vault |

Do **not** trust browser-supplied elevated profile or prefixes.

### 4.2 Fail-closed profile resolution

| Input profile | When `OMNIBOX_ENABLED=1` |
|---------------|--------------------------|
| `admin` | Use `--profile admin` |
| `contributor` | Use `--profile contributor` |
| Missing / empty / null | **Fail-closed:** treat as `contributor` (least-privilege grants). Do not elevate to admin. |
| Unknown string | **Deny** host-impacting tool (error; do not run bare command) |

Contributor shell remains denied by tool allowlist / profile capabilities; Omnibox does not grant shell to contributor.

### 4.3 Which tools wrap

Deploy registry: `scripts/omnibox/host-impacting-tools.json` (install → `$OMNIBOX_CONFIG_DIR/host-impacting-tools.json`).

| Class | Examples | Omnibox when enabled? |
|-------|----------|------------------------|
| Host-impacting | `shell_exec`, `terminal`, `system_ops`, `gateway_config` (if they spawn host commands) | **Yes** |
| Vault-only | `vault_read`, `vault_write`, `vault_search`, `vault_delete`, `chat` | **No** (unless implementation shells out) |
| Model / network on gateway | model HTTP, relay WSS | **No** (gateway process network already controlled) |

If a vault tool shells out to a host binary, treat that child as host-impacting.

### 4.4 Argv template

```bash
# OMNIBOX_ENABLED=1, host-impacting, session contributor + prefix:
"$OMNIBOX_WRAPPER" \
  --profile contributor \
  --path-prefix /Projects/Legal \
  -- \
  /bin/cat /opt/company-brain/Projects/Legal/note.md

# OMNIBOX_ENABLED=0: pass through command only (no wrapper).
```

Rules:

1. Hook only when `OMNIBOX_ENABLED` is truthy (`1`, `true`, `yes` — case-insensitive).
2. One `--path-prefix` flag per prefix (repeatable).
3. Always put `--` before the original command argv.
4. Never pass gateway secret env into the child beyond what the wrapper scrubs (wrapper unsets secret-bearing prefixes per policy).
5. Missing `OMNIBOX_WRAPPER` when enabled + host-impacting → **fail closed** (do not run bare command).

### 4.5 Deploy argv builder (offline + optional product helper)

```text
scripts/omnibox/build-shell-exec-argv.py
# ensure install: /usr/local/sbin/omnibox-build-shell-exec-argv
```

stdin JSON → stdout JSON with `argv` list. Used by offline tests and as a reference implementation for Hermes. Product may reimplement the same rules in-process.

---

## 5. Config-only surface (insufficient alone)

Hermes `cli-config.yaml` `hooks:` / `agent/shell_hooks.py` can observe `pre_tool_call` and **block** dangerous tools. That is complementary deny-list behavior, **not** Mode A isolation:

- Block ≠ OS cage (no never_grant / unshare-net).
- Hooks cannot today rewrite the spawn argv to `run-under-omnibox`.

Deploy may still seed documentation-only hook notes; **do not** claim config-only Omnibox for shell without the product wrap PR.

---

## 6. Verification

### Offline (this repo)

```bash
bash scripts/smoke-omnibox.sh
# includes phase-5: contributor session → argv contains --profile contributor
python3 scripts/omnibox/build-shell-exec-argv.py --self-test
```

### Runtime (after product hook + phase 9)

| Check | Expect |
|-------|--------|
| Admin shell under Omnibox | Cannot `cat /home/hermes/.hermes/.env` inside box |
| Contributor shell | Still denied by allowlist before wrap |
| `OMNIBOX_ENABLED=0` | Prior bare shell behavior (break-glass) |
| Vault read/write | Works without wrapper when in-process |

---

## 7. Acceptance mapping (phase 5)

| Criterion | Deploy status |
|-----------|---------------|
| Hook only when `OMNIBOX_ENABLED` | **Specified + tested** in argv builder; **HL product honors flag** (`cbd-o9s.17`) |
| Profile from session source | **Specified + tested** (incl. missing → contributor) |
| Vault-only tools skip Omnibox | **Specified + tested** via host-impacting registry |
| Live gateway wrap on customer host | **Residual** — default OFF; staging table `lp-t7q.6`; pin HL ≥ `4596ecd58` |
| LA product wrap | **Residual** — not implemented |

---

## 8. Non-goals

- Mode B / Omnigent server
- Wrapping `hermes-gateway` systemd process
- Default `enable_omnibox=true` (stays false until phase 9)
- Rewriting phase-7 operator runbook (`references/runbooks/omnibox-mode-a.md` — parallel bead)
- Contributor shell allowlist change
