# Residual `lp-kng.3` — Lab/staging Relay DNS (or lab Relay) for real WSS e2e

**Bead:** `lp-kng.3`  
**Epic:** `lp-kng` (Phase 0 residual from `lp-ctu` / `lp-4dk` / `lp-4l5`)  
**Date:** 2026-08-04  
**Status:** **Docs + diagnosis shipped; live DNS restore blocked by OPERATOR HOLD** → `needs_human=true`  
**No secrets** in this file (SM **names** and public DNS only).

Related: [spike-ctu-go-no-go.md](./spike-ctu-go-no-go.md), [spike-4dk-wss-relay.md](./spike-4dk-wss-relay.md), [spike-4l5-gateway-secret-inject.md](./spike-4l5-gateway-secret-inject.md), [gateway-env-contract.md](./gateway-env-contract.md).  
Hold: [OPERATOR-HOLD-LOCALHOST-ONLY.md](../../../deploy/environments/platform-staging/OPERATOR-HOLD-LOCALHOST-ONLY.md).

---

## 1. Operator summary (exact hosts)

| Host / URL | Role | Live status (2026-08-04 re-check) |
|------------|------|-----------------------------------|
| **`wss://relay.withlanyard.com`** | **Preferred product / pilot Relay** | **UNHEALTHY** — DNS fails before TCP (see §2) |
| **`relay.withlanyard.com`** | Public hostname for `domainAllowList` | CNAME present → **dead** staging ELB name (no A/AAAA) |
| **Lab path (while hold active)** | Dedicated lab Relay **or** human-gated staging restore | See §3–§4 — **do not** use loopback as Daytona target |

### What operators should use **today**

1. **Do not** point Daytona sandboxes or dual-run gateways at `wss://relay.withlanyard.com` expecting a live WSS edge — `getaddrinfo` fails (`Name or service not known`).
2. **Preferred future host (unchanged product contract):** `wss://relay.withlanyard.com` once DNS + ALB/ECS are healthy again.
3. **While OPERATOR HOLD is active**, pick **one** of:
   - **Option A — Lab Relay (recommended under hold):** stand up a **public** lab-only Relay and use an explicit lab host (see §3). Set create-time inject:
     - `GATEWAY_RELAY_URL=wss://<LAB_RELAY_HOST>`
     - `domainAllowList` **must include** that exact hostname (plus S3/etc. as needed)
   - **Option B — Human-gated staging restore:** lift hold → restore **only** the minimal Relay path (or full platform-staging) → re-point / re-verify `relay.withlanyard.com` → re-prove Daytona WSS (§5). **Requires human approval** — this bead does **not** `terraform apply`.
   - **Option C — Local compose only:** `ws://127.0.0.1:8787` / portal docker-compose Relay — **local developer smoke only**. **Not** reachable from managed Daytona sandboxes.

**Canonical lab host placeholder (when Option A is chosen):** operators should publish and document the real host they create, e.g.:

- Preferred lab name (if DNS owner allows a new record): **`relay-lab.withlanyard.com`** → `wss://relay-lab.withlanyard.com`
- Or an ephemeral public host (e.g. temporary ALB/NLB/ECS/EC2 or tunnel) whose **exact** hostname is written into the dual-run / spike notes for that run

Until Option A or B completes, there is **no** live WSS host for Daytona real-Relay e2e.

---

## 2. Route53 / DNS / ELB diagnosis (re-checked this bead)

### 2.1 Public DNS chain

| Query | Result |
|-------|--------|
| Apex NS `withlanyard.com` | Squarespace DNS (`nsa1`–`nsa4.squarespacedns.com`) — **not** Route53 in account `123456789012` |
| `dig +short relay.withlanyard.com CNAME` | `lanyard-platform-staging-relay-a-87559758.us-east-1.elb.amazonaws.com.` |
| `dig +short` A / AAAA for that ELB name | **empty** |
| `getaddrinfo(relay.withlanyard.com)` (host) | **FAIL** — `socket.gaierror: [Errno -2] Name or service not known` |
| Sandbox (prior spikes `lp-4dk` / `lp-4l5`) | Same CNAME; same **no A/AAAA** / `gaierror` before TCP |

**Failure mode:** name resolves as CNAME to a **non-existent** classic/ELBv2 DNS name → no usable address → **before TCP/TLS/WSS**. This is **infra DNS / missing ELB**, not a WSS client library bug.

### 2.2 AWS load balancers (profile `lanyard-main`, region `us-east-1`)

| Check | Result |
|-------|--------|
| Caller | account `123456789012` (terraform-style IAM user present) |
| `elbv2 describe-load-balancers` | **0** load balancers in region |
| `elbv2 … --names lanyard-platform-staging-relay-a` | **LoadBalancerNotFound** |
| Classic ELB matching staging relay | none observed for this residual check |
| Route53 hosted zones in this account | **none listed** for `withlanyard.com` (public DNS is Squarespace) |

### 2.3 Interpretation

| Fact | Implication |
|------|-------------|
| CNAME still published | DNS record was **not** cleaned up when staging Relay ELB was torn down |
| ELB name has no A/AAAA | ELB **does not exist** (consistent with cost teardown / OPERATOR HOLD) |
| Squarespace owns zone | Updating `relay.withlanyard.com` (or adding `relay-lab.withlanyard.com`) is an **operator DNS** step outside this account’s empty Route53 list |
| Platform TF `portal-dns-tls` can manage aliases | Only if zone/alias path is wired and hold is lifted; **do not apply under hold** |

### 2.4 Diagnosis commands (operators; no secrets)

```bash
# Public DNS
dig +short relay.withlanyard.com CNAME
dig +short relay.withlanyard.com A
dig +short lanyard-platform-staging-relay-a-87559758.us-east-1.elb.amazonaws.com. A
python3 -c "import socket; print(socket.getaddrinfo('relay.withlanyard.com', 443))"

# AWS (profile name only — never print secret values)
export AWS_PROFILE=lanyard-main AWS_DEFAULT_REGION=us-east-1
aws elbv2 describe-load-balancers \
  --query 'LoadBalancers[?contains(LoadBalancerName, `relay`)].{Name:LoadBalancerName,DNS:DNSName,State:State.Code}' \
  --output table
aws elbv2 describe-load-balancers --names lanyard-platform-staging-relay-a  # expect not found while hold active
```

Healthy target state (after restore or lab cutover):

1. CNAME or A/AAAA for the chosen host returns **usable addresses**
2. `getaddrinfo` succeeds on host **and** inside a thrifty Daytona sandbox
3. TCP `:443` connect + TLS + WSS upgrade to product path (historically `/relay` on platform Relay) succeeds or fails for **auth/protocol** reasons only — not DNS

---

## 3. Dedicated lab Relay path (maximum under hold)

### 3.1 Why lab-only

**OPERATOR HOLD (2026-07-26, still active):** platform-staging fixed network/compute is torn down for cost (residual target ~$5–20/mo). Agents must **not** `terraform apply` re-enabling VPC/NAT/interface endpoints/ALBs/ECS/RDS/CloudFront/staging document server, and must **not** `ecs update-service --desired-count 1` on `lanyard-platform-staging-*` without an explicit human lift of the hold.

Therefore this bead ships **lab path + runbook**, not a staging network restore.

### 3.2 Lab host contract (operators)

| Field | Lab value |
|-------|-----------|
| Public hostname | **Choose and document** — preferred name `relay-lab.withlanyard.com` if DNS owner can add a record; otherwise any stable public FQDN |
| WSS URL for inject | `wss://<LAB_RELAY_HOST>` (and path if product Relay expects `/relay` — use `wss://<LAB_RELAY_HOST>/relay` when matching platform Relay) |
| `domainAllowList` | exact hostname only, e.g. `relay-lab.withlanyard.com` (comma-separate S3 hosts when vault mount is also tested) |
| TLS | Public HTTPS terminating TLS (ACM or equivalent); clients use **wss://** only |
| Auth | Prefer throwaway lab instance secret for spikes; production CP register remains `lp-9my` when staging CP is available |
| Lifecycle | Ephemeral / lab cost envelope; delete when spike ends |

### 3.3 Local lab compose (developer host — not Daytona egress)

Optional compose snippet for **local** Relay process smoke (loopback / host network). Full snippet:

→ **[drafts/lab-relay-compose.yml](./drafts/lab-relay-compose.yml)**

Also existing monorepo stack: `portal/docker-compose.yml` service `relay` on host port **8787**.

```bash
# From portal/ (existing multi-service stack)
docker compose up -d --build relay
curl -sf http://127.0.0.1:8787/health

# Or relay-only draft (from repo root, adjust build context notes in file)
docker compose -f docs/plans/0008-daytona-agent-sandboxes/drafts/lab-relay-compose.yml up -d --build
curl -sf http://127.0.0.1:8787/health
```

**Limits of local compose for this residual:**

| Client | Can use `127.0.0.1:8787`? |
|--------|---------------------------|
| Developer laptop gateway / unit smoke | **Yes** |
| Managed **Daytona** sandbox | **No** — loopback is the sandbox itself, not the operator laptop |
| Real WSS e2e AC for `lp-kng.3` / dual-run | Needs **public** host (§3.2) or restored staging (§4) |

To expose a **public** lab Relay without restoring full platform-staging, operators may (human-chosen, cost-aware):

1. Tiny always-on or on-demand public compute + TLS in front of the Relay image  
2. Temporary reverse tunnel to local compose (hostname still must be on `domainAllowList`)  
3. Minimal dedicated module path (e.g. tier3 / portal-relay-service) **only if** explicitly approved outside the full staging hold scope  

Do **not** invent credentials in git. Do **not** commit SM values from `lanyard/staging/portal/daytona`.

---

## 4. Human-gated staging restore (blocked without lift)

### 4.1 Do not run under hold

```text
FORBIDDEN while OPERATOR HOLD is active (unless human explicitly lifts hold):
  - terraform apply on deploy/environments/platform-staging that re-enables network/compute
  - ecs update-service desired-count 1 on lanyard-platform-staging-*
  - recreate full ALB/ECS/RDS/NAT just to "green" dual-run
```

### 4.2 When hold is lifted — minimal restore checklist

Order is suggestive; follow deploy SoT under `lanyard-platform/deploy/` (never legacy company-brain-deploy checkout for new work).

1. **Human approval** written on bead / ops channel that hold is lifted for Relay (full stack vs Relay-only).  
2. Restore **Relay ALB + service** (portal-relay-service / platform-staging compose) with HTTPS ACM covering `relay.withlanyard.com` (or temporary host).  
3. **DNS:** update Squarespace (or move zone) so `relay.withlanyard.com` points at the **live** ALB DNS name (alias/CNAME). Remove stale CNAME to `…relay-a-87559758…` if that ELB stays gone.  
4. Verify §2.4 healthy target state from a laptop.  
5. Run thrifty Daytona re-prove (§5).  
6. Tear down or re-hold if cost policy requires — update this residual with new status.

Terraform references (offline-validated modules only; **not applied by this bead**):

- `deploy/environments/platform-staging/` — private root compose  
- `deploy/modules/portal-relay-service/`  
- `deploy/modules/portal-dns-tls/` — optional Route53 aliases when zone is in AWS  
- Runbooks: `deploy/references/runbooks/portal-compute-staging-apply.md`, `platform-staging-compose.md`

---

## 5. Thrifty Daytona re-prove (blocked until DNS healthy)

**Not run in this bead** — no live WSS endpoint. When Option A or B provides a healthy host, re-prove under **$10** hard cap (container class OK).

### 5.1 Preconditions

| Item | Value |
|------|--------|
| SM secret **name** | `lanyard/staging/portal/daytona` (`AWS_PROFILE=lanyard-main`, `us-east-1`) |
| Org / region | Tier **1**, target `us` (see prior spikes) |
| Isolation | **container** |
| Budget | One throwaway sandbox; `autoStopInterval` short; `autoDeleteInterval: 0` |
| Relay URL | `wss://relay.withlanyard.com` **or** lab `wss://<LAB_RELAY_HOST>` |
| Inject | Create-time `env`: `GATEWAY_RELAY_URL`, `GATEWAY_RELAY_ID`, `GATEWAY_RELAY_INSTANCE_ID`, `GATEWAY_RELAY_SECRET` (throwaway lab secret OK) |
| Allowlist | `domainAllowList: "<relay-hostname>"` (exact host used in URL) |

### 5.2 Probe matrix (record pass/fail)

| Step | Expect when healthy |
|------|---------------------|
| `getaddrinfo(<relay-host>)` in sandbox | **PASS** — at least one A/AAAA |
| TCP connect `:443` | **PASS** |
| TLS handshake | **PASS** |
| WSS upgrade (product path) | **PASS** or **auth fail** (401) if secret/instance unknown — still proves egress |
| `GATEWAY_RELAY_*` present in guest | **PASS** — length/fingerprint only in logs (never raw secret) |
| Hold ≥ few minutes / reconnect (optional) | Prefer reuse of `lp-4dk` mock methodology against **real** host |

### 5.3 Cleanup

`POST …/sandbox/{id}/stop` (ephemeral delete) → list filter spike label → leftover `[]`. Never commit API keys.

---

## 6. Tier 1 egress — pass/fail documentation

| Layer | Status | Evidence |
|-------|--------|----------|
| Create API accepts `domainAllowList: "relay.withlanyard.com"` | **PASS** | `lp-v2p`, `lp-4dk`, `lp-4l5` |
| Org Tier 1 essential-service defaults include custom Relay host | **UNKNOWN / not proven** | Tier 1 policy may still win after DNS is healthy — must re-test |
| Real TCP/TLS/WSS to product Relay under Tier 1 | **FAIL (blocked pre-TCP)** | DNS NXDOMAIN / no A on ELB CNAME target (`lp-4dk`, re-check §2 this bead) |
| Mock WSS hold + reconnect inside sandbox | **PASS** | `lp-4dk` (loopback — not product egress) |
| Inject + mock auth using `GATEWAY_RELAY_SECRET` | **PASS** | `lp-4l5` |
| **Verdict for dual-run / live WSS** | **FAIL until DNS + re-prove** | Escalate only after DNS healthy: if TCP blocked despite allowlist → org exception / tier / `lp-ccp` |

**Do not** treat sandbox-level allowlist acceptance as Tier 1 egress pass. **Do not** claim Tier 1 product egress pass until §5 matrix is green on a public Relay host.

---

## 7. Acceptance mapping (`lp-kng.3`)

| Criterion | Met? | Evidence |
|-----------|------|----------|
| Lab or staging Relay DNS resolves to live WSS **or** dedicated lab path documented with exact host | **Partial — lab path + preferred host documented; live DNS not restored** | §1, §3; live restore blocked by hold |
| Re-prove TCP/TLS/WSS + allowlist + `GATEWAY_RELAY_*` inject from thrifty Daytona | **Blocked** (no live host) | §5 checklist ready for operator when host exists |
| Document Tier 1 egress pass/fail | **Yes** | §6 |
| Notes under `docs/plans/0008-daytona-agent-sandboxes/` | **Yes** | this file + compose draft |
| No secrets in notes/git | **Yes** | SM name only; no key/secret values |
| No terraform apply re-enabling staging under hold | **Yes** | diagnosis only; hold doc linked |

**`needs_human`:** **true** — live restore or public lab Relay provisioning requires operator DNS (Squarespace) and/or explicit hold lift / lab spend approval.  
**`needs_ui_qa`:** **false**.

---

## 8. Recommended next human actions (ordered)

1. Decide **Option A (lab Relay)** vs **Option B (lift hold + restore staging Relay)**.  
2. If A: publish public host (prefer `relay-lab.withlanyard.com`), TLS, minimal Relay process; write the **exact** host into dual-run notes.  
3. If B: lift hold in writing → restore Relay ALB/service only if possible → fix Squarespace CNAME away from dead ELB → verify dig/getaddrinfo.  
4. Run §5 thrifty Daytona re-prove; update this file §2/§6 with timestamps (still no secrets).  
5. Close residual for dual-run when Tier 1 real WSS is **PASS** or escalated with org exception ticket.

---

## 9. Evidence index (this bead)

| Check | UTC-ish date | Result |
|-------|--------------|--------|
| Public CNAME `relay.withlanyard.com` | 2026-08-04 | staging ELB name `lanyard-platform-staging-relay-a-87559758.us-east-1.elb.amazonaws.com` |
| A/AAAA for CNAME target | 2026-08-04 | empty |
| `getaddrinfo` host | 2026-08-04 | fail errno -2 |
| ALB count `us-east-1` (`lanyard-main`) | 2026-08-04 | **0** |
| Named ELB `lanyard-platform-staging-relay-a` | 2026-08-04 | LoadBalancerNotFound |
| Route53 zones in account | 2026-08-04 | none for `withlanyard.com` (Squarespace NS) |
| Terraform apply | — | **not run** (hold) |
| Daytona live WSS spend | — | **not run** (no endpoint) |
