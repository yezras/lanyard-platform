# Threat model: private-by-default Company Brain deploy surface

**Status:** Living document (deploy-repo scope)  
**Last updated:** 2026-07-20 (`lp-k7g.10.5` — backend-neutral host/artifacts language)  
**Scope:** `company-brain-deploy` under `deploy/` — customer data-plane host, **backend artifact** supply chain, relay **wiring**, product-artifact infra, tenant isolation contracts, optional Omnibox Mode A tool-child cage.  
**Out of scope for this model’s implementation ownership:** Portal application/control-plane source, product G1/G2 crypto/session design (still threat-relevant as dependencies).  
**Method:** STRIDE-style per trust boundary; assets → adversaries → controls → residual risk.  
**Related:** `references/readiness-matrix.md`, `references/tenant-isolation-decision.md`, `references/runbooks/penetration-test-and-signoff.md`, `references/production-security-signoff.md`, `references/runbooks/omnibox-mode-a.md`, `contracts/backend-runtime-v1/`, `references/security-observability.md`

---

## 1. System context

```text
                    ┌─────────────────────────────────────────┐
                    │  Portal control plane / BFF / relay      │
                    │  (product-owned; G1/G2 gates)            │
                    └───────────────┬─────────────────────────┘
                                    │ WSS egress-only
┌──────────────┐    artifacts       │
│ Product S3 / │◄── instance role ──┤
│ ECR (OIDC)   │                    │
└──────────────┘                    v
                          ┌──────────────────────────────┐
   Operators (SSM/SSH/    │  Company Brain EC2           │
   optional Tailscale) ──►│  backend runtime + vault EBS │
                          │  private subnet              │
                          └──────────────────────────────┘
                                    │
                          encrypted EBS + DLM snapshots
```

**Backend artifacts** (pinned install on the host) include families that publish under the platform contract: `hermes_lanyard` (reference), `hermes_upstream`, `lanyard_agent`, and future kinds that ship `bin/company-brain-backend`. Hermes-specific residual risks are called out where still true.

**Primary assets**

| Asset | Sensitivity | Location |
|-------|-------------|----------|
| Customer vault / company brain content | Critical | Encrypted EBS on tenant EC2; DLM snapshots |
| Instance role credentials | High | IMDSv2 on host |
| Relay instance secret | High | SSM/SM (production); never git |
| Backend artifacts (Hermes-Lanyard / Lanyard Agent / …) + client-core | High (integrity) | Private S3 (or approved HTTPS); pins by URL+version+SHA-256 (+ optional Ed25519); layout `backends/<kind-slug>/` with temporary dual-write under legacy `hermes/` where still configured |
| Operator access paths | High | SSM, optional SSH CIDR, optional Tailscale |
| Terraform state / tfvars | High | Private operator storage (not this git repo) |
| Multi-tenant metadata | Medium–High | Account/VPC/KMS/log partition per isolation decision |
| Host / backend operational logs | Medium | Tenant log groups (`/company-brain/<slug>/host`); no vault dump by default |

---

## 2. Trust boundaries

| Boundary | Inside | Outside | Notes |
|----------|--------|---------|-------|
| TB-HOST | EC2 OS, backend runtime (`company-brain-backend` / migration `hermes-gateway`), vault volume | Network, AWS APIs, operators | Primary data-plane enclave |
| TB-VPC | Private subnet, SG, endpoints | Internet, other VPCs | Production: no public IP |
| TB-ACCOUNT | AWS account + IAM | Other accounts / AWS control plane | Production target: account-per-tenant (lanyard_hosted) or customer_account |
| TB-ARTIFACT | Signed/pinned **backend** + client-core release objects | Build CI, publishers, mirror attackers | SHA-256 always; attestation preferred production |
| TB-RELAY | Gateway dial to Portal relay | Portal product authn/authz | Deploy wires env only; product owns lifecycle |
| TB-GIT | This repository (no live secrets) | Operator laptops, CI | Examples use REPLACE_* only |
| TB-OPERATOR | SSM session / break-glass SSH / Tailscale | Compromised admin workstation | Least privilege + audit |

---

## 3. Adversaries (assumptions)

| Actor | Capability | Goals |
|-------|------------|-------|
| Internet scanner / bot | Unauthenticated public reachability | RCE, cryptomining, credential theft |
| Compromised dependency / malicious **backend** or client-core artifact | Supply chain poison | Persist on host; exfil vault |
| Malicious or compromised operator | Legitimate AWS/SSH/SSM | Cross-tenant access; secret theft |
| Neighbor tenant (shared-account mistake) | Same AWS account misuse | Read other tenant volumes/logs/roles |
| Portal relay attacker (stolen secret / replay) | Dial as customer gateway | Impersonate tenant session |
| Insider with S3/ECR publish rights | Push bad release | Backdoor backend artifact and/or client-core |
| Snapshot thief | Public snapshot share or copied AMI | Offline vault extract |

---

## 4. STRIDE by surface

### 4.1 Deploy surface (Terraform modules / tenant template)

| STRIDE | Threat | Mitigations in repo | Residual |
|--------|--------|---------------------|----------|
| Spoofing | Fake module source / floating `main` | Relative module sources; doctrine forbids floating main | Operator still chooses source in private trees |
| Tampering | Weak network defaults | `network_mode=production` forces no public IP; requires VPC/subnet | Lab mode still open if mis-selected |
| Repudiation | No apply audit | Ops: remote state + CloudTrail (account) | Not fully automated in module |
| Info disclosure | Secrets in git/examples | gitignore tfvars/state; SSM default; policy scans examples | Operator error outside CI |
| DoS | Mis-open SG world SSH | `0.0.0.0/0` SSH rejected | App-layer DoS N/A here |
| Elevation | Over-broad instance role | Artifact IAM scoped prefixes; production list prefixes | Optional CMK policy quality is ops-owned |

### 4.2 Host runtime (EC2 / backend)

| STRIDE | Threat | Mitigations | Residual |
|--------|--------|-------------|----------|
| Spoofing | IMDS credential theft from container/nested | IMDSv2 required; hop_limit=1; Omnibox baseline `--unshare-net` blocks IMDS from tool children when Mode A on | Host root compromise still wins |
| Tampering | Service as root / weak sandbox | Service user `company-brain` (migration: `hermes` via drop-in), systemd sandbox on `company-brain-backend.service` (legacy `hermes-gateway.service` optional), tool allowlists | SELinux often permissive on AL2023 — documented |
| Repudiation | Unaudited shell | Prefer SSM (account Session logs); backend profile RBAC seeds | Full session recording config is account-level |
| Info disclosure | World-readable secrets files; agent tool reads gateway `.env` | ensure-runtime-hardening 0600 paths under `BACKEND_HOME` / `/etc/company-brain/`; Omnibox `never_grant` + tmpfs home stubs + env scrub when Mode A on | Mis-copied env files; **Mode A default off** until staging; product hook must wrap tools. Hermes migration may still use `~/.hermes/.env` paths. |
| DoS | Disk/fill vault | Ops monitoring / status checks | Not fully productized |
| Elevation | Contributor → admin tools | Profile seeds + smoke; contributor deny list | **Backend product** must enforce profiles at runtime (Hermes-Lanyard reference loads them; other kinds must conform) |
| Elevation | Agent tool escapes process sandbox | Omnibox Mode A: `run-under-omnibox` / bubblewrap (`bwrap_inrepo`) for tool **children** only | **Shared-kernel residual** — see §4.2.1 |

#### 4.2.1 Omnibox Mode A (tool-child cage) — residual shared-kernel risk

**What it is:** Optional feature (`enable_omnibox` / `OMNIBOX_ENABLED`, default **off**) that runs host-impacting **backend tool children** under deploy-owned bubblewrap policies (`scripts/omnibox/`, `/usr/local/sbin/run-under-omnibox`). Does **not** replace `company-brain-backend` / legacy `hermes-gateway` ExecStart or introduce Omnigent server (Mode B out of scope).

**Hermes-true note:** Mode A was designed against Hermes host-impacting tools; deploy ships the same wrapper for any backend that honors `OMNIBOX_WRAPPER` when `OMNIBOX_ENABLED=1`.

**What it reduces:** FS read of gateway secrets and credential stores inside the tool box; default-deny network for caged tools; contributor vault narrowed to path_prefixes; secret-bearing env prefixes scrubbed.

**What it does not claim:**

| Non-claim | Why |
|-----------|-----|
| MicroVM / hardware isolation | bubblewrap shares the **host kernel** (user namespaces, mounts). Kernel RCE or userns escape can leave the cage. |
| Production pen-test pass | No independent test or production security sign-off is implied by Mode A docs/smokes. |
| Full substitute for profiles / allowlists | Backend product must still enforce profile matrix; Omnibox is an OS boundary for children. Hermes-Lanyard is the reference enforcement path. |
| Selective allowlisted egress complete | Baseline is full net unshare; phase-6 egress render is separate. |
| Production default-on | Flag stays false until staging validation (phase 9). |

**Break-glass:** operators set `OMNIBOX_ENABLED=0` in `/etc/company-brain/omnibox.env`, reload/restart gateway — see `references/runbooks/omnibox-mode-a.md`.

**Adversary note:** Treat compromised admin-session tools as high risk even with Omnibox; kernel and co-tenant-on-host assumptions remain. Prefer account-per-tenant isolation and least-privilege profiles for residual blast radius.

### 4.3 Network / access

| STRIDE | Threat | Mitigations | Residual |
|--------|--------|-------------|----------|
| Spoofing | Public SSH brute force | Empty SSH default; SSM-first; no public IP production | Break-glass CIDR still operator-chosen |
| Tampering | Open egress → C2 | Controlled egress mode; production forbids open | HTTPS 443 still broad without L7 firewall |
| Info disclosure | Public IP / metadata | Private subnet posture | NAT egress still leaves AWS-side identity |
| Elevation | Tailscale ACL too open | Default off; runbook ACL default-deny | Live ACL must be staging-verified |

### 4.4 Relay wiring (customer-gateway-relay)

| STRIDE | Threat | Mitigations | Residual |
|--------|--------|-------------|----------|
| Spoofing | ws:// / http:// MITM | TF validation https/wss only | TLS trust still depends on public PKI / product |
| Tampering | Secret in state | production rejects inline; SSM/SM refs | G2 lifecycle incomplete (product) |
| Replay | Stolen one-time secret reuse | Product G2a **blocked** | **Major residual** — do not claim production relay security |
| Info disclosure | Secret in backend / Hermes env file in tree | production rejects plaintext relay secrets; prefer SSM/SM; legacy `write_hermes_env_file` constraints still apply where Hermes env files are written | Host file after fetch still sensitive (`BACKEND_HOME/.env`, migration `~/.hermes/.env`) |
| Elevation | Shared relay pool isolation gaps | Tier 3 dedicated relay module (infra_ready ALB/ECS); isolation decision | Tier 3 not production-certified until operator apply + G2 |

### 4.5 Artifacts / supply chain (backend + client-core)

| STRIDE | Threat | Mitigations | Residual |
|--------|--------|-------------|----------|
| Tampering | Substituted **backend** or client-core tarball | SHA-256 pin on `backend_artifact_*` (and temporary `hermes_artifact_*` aliases); optional Ed25519 attestation; SecureTransport S3 | Publisher key compromise |
| Spoofing | Evil URL scheme | Reject http/ws; s3/https only | Compromised legitimate host |
| Info disclosure | Public bucket | Block public access; Object Lock option | Misconfigured bucket policy extras |
| Elevation | OIDC role too broad | Prefix-scoped publisher roles (`backends/<kind-slug>/`, dual-write `hermes/`, `client-core/`); existing OIDC provider only | Repo trust policies must stay tight; wrong kind published under a trusted prefix |

### 4.6 Multi-tenant isolation

| STRIDE | Threat | Mitigations | Residual |
|--------|--------|-------------|----------|
| Elevation | Shared unpartitioned account | Forbidden by decision; template `production_intent` checks | Interim VPC+KMS needs discipline |
| Info disclosure | Shared KMS / log groups | dedicated_kms_key_arn, log_group_prefix validations | Account factory not in this repo |
| Tampering | Cross-tenant snapshot share | EBS snapshot BPA defaults | Account-level BPA scope awareness |

### 4.7 Backup / restore

| STRIDE | Threat | Mitigations | Residual |
|--------|--------|-------------|----------|
| Tampering | Snapshot age silent fail | check-snapshot-age + optional alarm | Metric publisher must be scheduled |
| Info disclosure | Public snapshot | BPA block-all-sharing default | Cross-account copy policy ops-owned |
| DoS | Lost vault durability | DLM daily + restore script + drill runbook | Drill must actually run quarterly |

---

## 5. Dependency risks (honest)

These are **in scope for the threat model** but **not cleared by this deploy repo alone**:

1. **G1** — Authenticated private control-plane boundary (Portal product).  
2. **G2 / G2a / G2b** — Relay credential lifecycle, replay resistance, payload log retention (Portal product).  
3. **Independent penetration test** — process defined; execution external; sign-off **NOT SIGNED**.  
4. **L7 egress allowlisting** — catalog + policy templates ready; Network Firewall optional and staging-verified.  
5. **Backend runtime enforcement** of profiles/tool allowlists — host seeds present; product must honor them. Hermes-Lanyard is the reference implementation; other kinds must conform to `backend-runtime-v1` profiles.  
6. **Backend Omnibox pre-exec hook** — deploy ships wrapper + `OMNIBOX_*` env; backend product must invoke `OMNIBOX_WRAPPER` for host-impacting tools when `OMNIBOX_ENABLED=1` (Hermes-Lanyard contract; other kinds if they expose equivalent tools).  
7. **Shared-kernel Omnibox residual** — Mode A is bubblewrap, not microVM; not cleared by offline smokes or this document alone.

---

## 6. Control inventory (deploy-owned, testable offline)

| Control | Evidence |
|---------|----------|
| No public IP production | `modules/company-brain-ec2` local `associate_public_ip` |
| SSH optional + no 0.0.0.0/0 | `operator_ssh_cidrs` validation + dynamic ingress |
| Controlled egress | `egress_mode` + smoke-controlled-egress |
| IMDSv2 hop 1 | `metadata_options` |
| Encrypted EBS + snapshot BPA | root_block_device + `aws_ebs_snapshot_block_public_access` |
| S3 TLS only | product-artifact-infra SecureTransport deny |
| Relay secrets SSM default | customer-gateway-relay defaults + checks |
| URL scheme hardening | bootstrap + TF validations |
| Tier 3 infra_ready honesty | compose portal-relay + claim_production_ready hard-false + smoke |
| Policy-as-code CI | `scripts/policy-as-code-security.sh` |
| Acceptance checklist | `scripts/security-acceptance-checklist.sh` |
| Omnibox Mode A seeds + ensure dry-run | `scripts/smoke-omnibox.sh`, `scripts/ensure-omnibox.sh --dry-run` (default flag off; not microVM proof) |

---

## 7. Recommended pen-test focus areas

Prioritize when commissioning independent test (see pen-test runbook):

1. Production-like private subnet host: no public IP/SSH; SSM-only entry.  
2. Attempt open egress / SG drift / IMDS from any nested context.  
3. Artifact substitution (wrong SHA, bad signature, HTTP redirect).  
4. Relay secret extraction from state/tfvars/user_data/role.  
5. Cross-tenant access in interim shared-account layouts (if any remain).  
6. Snapshot/AMI exposure and restore path integrity.  
7. Tailscale (if enabled): ACL bypass, key leakage.  
8. Residual Portal relay replay (coordinate with product; expect G2 gaps).  
9. If Omnibox Mode A enabled: tool-child escape / userns issues; read of gateway `.env` from admin shell path; break-glass `OMNIBOX_ENABLED=0` behavior — **do not treat bwrap as microVM**.

---

## 8. Maintenance

- Update this document when adding trust boundaries or controls (new modules, firewall, account factory).  
- Link findings from pen tests into beads; do not mark production private-by-default **certified** until `references/production-security-signoff.md` is signed.  
- Offline CI must remain fail-closed on control regressions via policy-as-code scripts.
