# Runbook: Omnibox Mode A — phase 0 spike and tool choice

**Status:** Spike complete (lab evidence + locked decision)  
**Bead:** `cbd-o9s.6`  
**Epic:** `cbd-o9s` (omnibox-hermes-mode-a)  
**Plan:** `references/plans/omnibox-hermes-mode-a/phase-0-spike.md`  
**Scope:** Mode A only — prove OS isolation for agent tool children; lock backend tool. **No Mode B / Omnigent server.**

---

## Goal

Prove that a command running as the Company Brain service identity can be OS-caged so that:

1. Host secrets (e.g. gateway `.env`) are not readable inside the sandbox.
2. Non-allowlisted egress fails.
3. Granted paths remain writable.

Choose one backend for `run-under-omnibox` (phase 2+):

| Option | Tool id | Meaning |
|--------|---------|---------|
| 1 | `omnigent_cli` | Omnigent Omnibox CLI/library as the sandbox launcher |
| 2 | `bwrap_inrepo` | Deploy-owned bubblewrap wrapper (+ optional local egress proxy later) |

No production tenant install in this phase.

---

## Decision record (locked)

```json
{
  "tool": "bwrap_inrepo",
  "version": "bubblewrap 0.9.0 (lab: Ubuntu package bubblewrap 0.9.0-1ubuntu0.1); pin host package on AL2023 via ensure script",
  "invoke_template": "bwrap --die-with-parent --unshare-user --unshare-pid --unshare-net --proc /proc --dev /dev --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib [--ro-bind /lib64 /lib64 if present] --ro-bind /etc/ld.so.cache /etc/ld.so.cache --tmpfs /tmp --tmpfs /home --dir /home/hermes --dir /home/hermes/.hermes --bind ${VAULT_GRANT} /opt/company-brain --bind ${WORKSPACE} /var/lib/company-brain/omnibox/workspaces/${PROFILE} --chdir ${WORKDIR} -- ${CMD...}",
  "known_gaps": [
    "Selective L7/domain egress allowlist is not native to bwrap; phase-0 uses --unshare-net (default-deny all net). Phase 6 must add deploy-owned egress proxy or equivalent when allowlisted model/relay/processor HTTPS is required inside the box.",
    "Shared-kernel residual risk (bwrap \u2260 microVM); document in phase 7 threat model \u2014 not closed by this spike.",
    "No hermes Unix user on the lab host; isolation proven as unprivileged lab user (uid 1000). Staging (phase 9) must re-run as User=hermes on AL2023 AMI.",
    "Omnigent CLI not installed / not exercised end-to-end; rejected for Mode A MVP on packaging and product-boundary grounds (see Rationale).",
    "seccomp filter profile not applied in spike; optional hardening for phase 2/3 if AL2023 supports without breaking curl/openssl children.",
    "Credential placeholder injection (real secrets outside box) not implemented in spike; gateway EnvironmentFile remains outside Omnibox view via never_grant + env scrub in wrapper."
  ]
}
```

| Field | Value |
|-------|--------|
| **tool** | `bwrap_inrepo` |
| **version** | bubblewrap **0.9.0** (lab evidence); host pin via distro package in `ensure-omnibox` (phase 3) |
| **invoke_template** | See JSON above; phase-2 wrapper wraps this as `run-under-omnibox --profile \u2026 -- cmd\u2026` |
| **known_gaps** | Selective egress, shared kernel, hermes-user staging retest, no Omnigent runtime proof, seccomp optional, credential inject deferred |

**Mode B:** Not explored as a deliverable. Omnigent server / session host / multi-device UI remain out of scope.

---

## Rationale (tool choice)

| Criterion | `omnigent_cli` | `bwrap_inrepo` (chosen) |
|-----------|----------------|-------------------------|
| Mode A fit (wrap tool children only) | Omnibox lives inside Omnigent harness/session stack (`omnigent.inner.*`, `sandbox.bwrap`); not a thin standalone `omnibox exec -- cmd` contract for Hermes gateway | Direct: one shell wrapper owns argv \u2192 bwrap |
| Deploy ownership | Pulls alpha product (PyPI `omnigent` 0.5.1, Apache-2.0) with large dep surface (server, UI SDKs, many harness extras) | Company-brain-deploy owns policy YAML + `run-under-omnibox`; dependency is distro `bubblewrap` only |
| Mode B coupling risk | Same binary family as Omnigent server / host sessions \u2014 easy to drift into second control plane | No Omnigent process; gateway stays Hermes |
| Lab availability | **Not installed** on spike host; install script pulls full stack | **Installed:** `/usr/bin/bwrap` bubblewrap 0.9.0 |
| Isolation properties needed for MVP | FS grants + egress + credential proxy exist in Omnigent but require adopting their agent/os_env model | FS deny + net deny + granted RW **proven** on lab (table below); selective egress deferred to phase 6 (already planned) |
| Laziness / subtract | Preferred only if stable thin CLI existed; package is meta-harness, not library-only Omnibox | Matches plan principles: wrap tools, do not replace gateway |

**Revisit triggers (not now):** If phase 6 egress proxy becomes costlier than pinning a stable Omnigent *library-only* Omnibox API with a clear non-server invoke path, re-open decision with a new spike. Until then Mode A ships `bwrap_inrepo`.

---

## Lab environment (what was run)

| Item | Value |
|------|--------|
| Host | Linux `spark-0a00` 6.17.0-1018-nvidia aarch64 (Ubuntu) |
| Date | 2026-07-15 |
| User | `operator` (uid 1000); **no** `hermes` user on this host |
| bubblewrap | `/usr/bin/bwrap` \u2014 `bubblewrap 0.9.0` (`bubblewrap 0.9.0-1ubuntu0.1 arm64`) |
| User namespaces | `kernel.unprivileged_userns_clone = 1`; `bwrap --unshare-user \u2026 /bin/true` \u2192 OK |
| Omnigent | `omnigent` / `omnibox` **not on PATH**; not installed under `/opt` or operator home |
| Omnigent packaging (static) | PyPI `omnigent==0.5.1` (alpha); console scripts `omnigent` / `omni`; Omnibox implemented as in-process bwrap backends (`omnigent/inner/bwrap_sandbox.py`, `omnigent/sandbox/bwrap.py`) \u2014 inspected from wheel metadata only, **not executed** |
| Hermes | Local operator CLI at `~/.local/bin/hermes` (not Company Brain gateway under test) |

Honesty: full Omnigent Omnibox CLI was **not** exercised. Decision uses (a) proven bwrap isolation, (b) static package/architecture review rejecting Omnigent as Mode A MVP backend.

---

## Pass / fail table

| # | Check | Expected | Result | Evidence |
|---|--------|----------|--------|----------|
| 1 | Denied read of secrets path inside sandbox | non-zero; no secret content | **PASS** | `cat` of unbound host secret path \u2192 `No such file or directory` (rc=1). Simulated never_grant: empty `/home/hermes/.hermes` (tmpfs) \u2192 `cat /home/hermes/.hermes/.env` fails; host file still contains `SECRET=should-not-leak` outside box |
| 2 | Denied curl / network to non-allowlisted host | curl fails | **PASS** | With `--unshare-net`: `curl https://example.com` \u2192 `Could not resolve host` (rc=6); `curl http://1.1.1.1` \u2192 `Network is unreachable` (rc=7) |
| 3 | Allowed write under granted path | write visible on host grant | **PASS** | Wrote `spike-ok` under bound workspace and `ok` under bound vault-like path; host files updated |
| 4 | Recorded invoke line for wrapper design | documented template | **PASS** | See Decision record `invoke_template` and \u00a7 Wrapper design input |
| 5 | Omnigent CLI isolation suite | N/A if absent | **SKIP (documented)** | Binary not installed; not a Mode A deliverable to install server stack |
| 6 | Mode B / Omnigent server | not delivered | **PASS (out of scope)** | No server units, no session host, no Omnigent UI wiring |

### Commands (reproducible core)

```bash
SPIKE=/tmp/omnibox-mode-a-spike-repro
rm -rf "$SPIKE"
mkdir -p "$SPIKE"/{opt/company-brain,workspace}
echo "vault" > "$SPIKE/opt/company-brain/AGENTS.md"

bwrap \
  --die-with-parent \
  --unshare-user \
  --unshare-pid \
  --unshare-net \
  --proc /proc \
  --dev /dev \
  --ro-bind /usr /usr \
  --ro-bind /bin /bin \
  --ro-bind /lib /lib \
  --ro-bind /etc/ld.so.cache /etc/ld.so.cache \
  --tmpfs /tmp \
  --tmpfs /home \
  --dir /home/hermes \
  --dir /home/hermes/.hermes \
  --bind "$SPIKE/opt/company-brain" /opt/company-brain \
  --bind "$SPIKE/workspace" /var/lib/company-brain/omnibox/workspaces/admin \
  --chdir /opt/company-brain \
  /bin/sh -c '
    cat /home/hermes/.hermes/.env; echo secret_rc=$?
    echo ok > /opt/company-brain/.write-test; cat /opt/company-brain/.write-test; echo write_rc=$?
    curl -sS --max-time 2 https://example.com; echo curl_rc=$?
  '
# Expect: secret_rc=1, write_rc=0, curl_rc=6 (or similar non-zero)
# Optional on x86_64 hosts: add --ro-bind /lib64 /lib64 when /lib64 exists
```

---

## Wrapper design input (for phase 2)

Hermes (or a pre-exec hook) must call a **single** entrypoint:

```bash
run-under-omnibox \
  --profile admin|contributor \
  [--path-prefix PREFIX]... \
  [--workdir PATH] \
  -- command [args...]
```

Backend (locked): build bwrap argv from `/etc/company-brain/omnibox/{profile}.yaml` + runtime egress file (phase 6).

### Minimal never_grant set (policy seeds, phase 1)

- `/home/hermes/.hermes/.env`
- `/home/hermes/.ssh`
- `/root`
- AWS/credential stores (e.g. `~/.aws`, instance role is not a path \u2014 block IMDS via net policy)
- Do **not** bind the gateway service home secrets into the box; prefer tmpfs stub dirs if paths must exist

### Minimal grants

| Profile | RW grants (shape) |
|---------|-------------------|
| admin | `/opt/company-brain` (or path_prefixes), `/var/lib/company-brain/omnibox/workspaces/admin` |
| contributor | vault path_prefixes only, `/var/lib/company-brain/omnibox/workspaces/contributor` |

### Network posture (phased)

| Phase | Behavior |
|-------|----------|
| 0\u20132 baseline | `--unshare-net` \u2192 no egress (proves deny) |
| 6+ | Drop full net unshare **or** share net only to a local egress proxy; allowlist model + relay + approved processors; block `169.254.169.254` and private ranges by default |

### Env scrub

Child must not inherit real `GATEWAY_*` / API keys from the gateway process. Phase 2 wrapper should clear secret-bearing env and only pass an explicit allowlist.

---

## Hermes pre-exec surface (open question status)

Plan open question #1: exact Hermes pre-exec hook. **Not blocking for tool choice.**

Phase 0 finding for later beads:

- Deploy can ship `OMNIBOX_WRAPPER=/usr/local/sbin/run-under-omnibox` and `OMNIBOX_ENABLED=0|1` without product changes.
- Phase 5 may need a small hermes-lanyard hook if the gateway cannot wrap `shell_exec` via env alone.
- Do **not** bwrap the long-lived `hermes-gateway` systemd process \u2014 only tool children.

---

## Explicit non-deliverables (this phase)

- Omnigent server unit, host registration, or multi-device UI
- Production `enable_omnibox=true`
- MicroVM / Daytona / E2B / Modal
- Contributor shell allowlist change
- Live AL2023 AMI proof (deferred to phase 9; lab was Ubuntu aarch64)

---

## Next phases (blocked until this decision)

| Phase | Bead | Uses this decision |
|-------|------|--------------------|
| 1 Policy seeds | `cbd-o9s.7` | YAML grants shaped for bwrap binds, not Omnigent session schema |
| 2 Wrapper CLI | `cbd-o9s.8` | Implements `bwrap_inrepo` invoke_template |
| 3 Ensure + smoke | `cbd-o9s.9` | Require `bwrap` package; fail-closed when required |
| 6 Egress render | `cbd-o9s.12` | Closes selective-allowlist gap |

---

## Operator note

This file is **spike evidence and a locked design decision**, not a production enable runbook. Operator enable/verify/break-glass lands in phase 7 (`references/runbooks/omnibox-mode-a.md`).
