# Runbook: Security E2E acceptance (LOCAL vs STAGING)

**Status:** Operator procedure — private-by-default acceptance  
**Purpose:** Separate **offline CI gates** from **staging-required** live tests so CI never needs AWS credentials while production onboarding still has a complete checklist.  
**Related:** `scripts/policy-as-code-security.sh`, `scripts/security-acceptance-checklist.sh`, `scripts/validate-production-gates.sh`, `scripts/check-staging-secrets-checklist.sh`, `references/production-security-signoff.md`, `references/runbooks/staging-secrets-checklist.md`

---

## Summary matrix

| Check | LOCAL (CI / no AWS) | STAGING (live AWS + optional Tailscale) | Owner |
|-------|---------------------|------------------------------------------|--------|
| Production forces `associate_public_ip=false` | **Automated** — policy-as-code | Confirm instance has no public IP / uses private subnet | Deploy |
| Production requires `vpc_id` + `subnet_id` | **Automated** — HCL preconditions asserted | Plan/apply with real private placement | Deploy |
| No public SSH by default (`operator_ssh_cidrs=[]`) | **Automated** | Confirm no port 22 SG rule when empty | Deploy |
| SSH `0.0.0.0/0` rejected | **Automated** | N/A (plan fails) | Deploy |
| Controlled egress (no protocol=-1 world in production) | **Automated** — policy + `smoke-controlled-egress.sh` | Optional: packet path / VPC endpoints work for S3/SSM | Deploy |
| Insecure `http://` / `ws://` rejected | **Automated** — TF validations + bootstrap smokes | N/A | Deploy |
| IMDSv2 hop limit = 1 | **Automated** | Optional: `curl` IMDS from instance fails without token; hop path | Deploy |
| S3 `SecureTransport` deny | **Automated** — product-artifact policy | Optional: non-TLS S3 API denied | Deploy |
| Relay secrets default SSM (not plaintext TF) | **Automated** | Create SecureString; instance role GetParameter; Hermes dials | Deploy + Portal |
| Tier 3 dedicated relay infra_ready (compose + honesty) | **Automated** — `smoke-tier3-dedicated-relay.sh` | Operator apply per tenant; WSS dial + /health | Deploy |
| Snapshot BPA + EBS encryption | **Automated** | Confirm volume encrypted; BPA account state | Deploy |
| Example tfvars free of live secrets | **Automated** | N/A | Deploy |
| Artifact attestation path | **Automated** — `smoke-artifact-attestation.sh` | Production: `REQUIRE_ARTIFACT_ATTESTATION=1` with release pubkey | Deploy |
| RBAC admin/contributor profiles | **Automated** — `smoke-hermes-profiles.sh` | On host: profiles present; contributor elevation blocked | Deploy |
| Restore scripts + DLM runbook | **Automated** (presence + bash -n) | Quarterly drill: `restore-from-snapshot.sh` in staging | Deploy + Ops |
| Production G1/G2 honesty (no false ready) | **Automated** — `validate-production-gates.sh` | Staging evidence + intentional matrix flip only | Product + Deploy |
| Independent pen test / sign-off | **Docs only** — template NOT SIGNED | Commission external test or written residual risk | Security + leadership |
| **Relay secret revocation E2E** | Product automated substitute (Portal tests) | **STAGING-REQUIRED** — revoke → gateway **4401** | Portal + Deploy |
| **Live Tailscale ACL** | Documented only | **STAGING-REQUIRED** when Tailscale enabled | Ops |
| **Live Network Firewall / L7 domain deny** | Documented only | **STAGING-REQUIRED** when firewall used | Ops + Deploy |
| **SSM Session Manager session** | Documented only | **STAGING-REQUIRED** — private subnet session works | Deploy |
| **Portal private control-plane (G1)** | Honesty **blocked** in matrix; product tests (Portal **#11**/**#13**); residual ledger `readiness-live-proofs-residual.md` (`lp-t7q.7`) | **STAGING-REQUIRED** (G1.4) — public cannot reach CP; BFF+service auth works | Portal product + operator |
| **Per-tenant authz (G1a live)** | Product **ready**; live proof **blocked** in residual | **STAGING-REQUIRED** — two-tenant cross-tenant deny / no elevation | Portal product + operator |
| **Relay credential lifecycle (G2)** | Honesty **blocked** in matrix; product APIs (Portal **#7**/**#9**/**#10**) + runbooks (**#12**, deploy **#6**); residual G2 **blocked** | **STAGING-REQUIRED** (S4) — register/rotate/revoke live | Portal product + operator |
| **Brain RPC (G3)** | Honesty **blocked** in matrix; contract + Hermes **#2** + Portal **#14** / monorepo; residual G3.4 **blocked** | **STAGING-REQUIRED** (G3.4) — ≥1 customer-host op E2E | Portal + Hermes + operator |

---

## LOCAL suite (run in CI)

From repository root, no credentials:

```bash
bash scripts/policy-as-code-security.sh
bash scripts/security-acceptance-checklist.sh
bash scripts/validate-production-gates.sh
bash scripts/smoke-readiness-live-proofs-residual.sh
bash scripts/check-staging-secrets-checklist.sh
bash scripts/smoke-controlled-egress.sh
bash scripts/smoke-artifact-attestation.sh
bash scripts/smoke-hermes-profiles.sh
bash scripts/smoke-bootstrap-inject.sh
```

CI workflow: `.github/workflows/ci.yml` runs the policy and acceptance scripts on every PR/push.

Before STAGING rows (S4 / S9 / S10), complete `references/runbooks/staging-secrets-checklist.md` (GitHub + AWS SM/SSM + task env). **Secrets present ≠ matrix ready.**

**Pass criteria:** all scripts exit 0. Failures are regressions of deploy-owned private-by-default contracts.

---

## STAGING-required procedures

These cannot be honestly asserted offline. Record results in the change ticket and, for production go-live, in `references/production-security-signoff.md` (status remains **NOT SIGNED** until external pen test or explicit residual-risk acceptance — see `references/runbooks/penetration-test-and-signoff.md`).

### S1 — Network placement

```text
[ ] Tenant apply with network_mode=production, real vpc_id + private subnet_id
[ ] Instance associate_public_ip_address = false (console / describe-instances)
[ ] No public IPv4 on primary ENI
[ ] Operator access via SSM Session Manager (terraform output ssm_start_session_command)
```

### S2 — SSH posture

```text
[ ] operator_ssh_cidrs empty → no tcp/22 ingress on hermes SG
[ ] Break-glass: non-empty RFC-5737-style operator CIDR + key → SSH only from that CIDR
[ ] Confirm 0.0.0.0/0 still rejected at plan time
```

### S3 — Controlled egress + endpoints

```text
[ ] egress_mode controlled (or null → controlled): SG shows TCP 443 (and approved ports), not protocol=-1 world
[ ] Optional: create_s3_gateway_endpoint / SSM interface endpoints; artifact pull + ssm session succeed without public IP
[ ] Hermes reaches portal relay over WSS (443) only
```

### S4 — Relay secret lifecycle (G2 staging proof; operator-owned)

Product register/rotate/revoke APIs and runbooks exist (Portal **#7**/**#9**/**#10**/**#12**, deploy **#6** / `relay-secret-lifecycle.md`). Automated product tests are a **staging-proof substitute** only — they do **not** flip readiness-matrix G2. Execute live staging when env is available:

```text
[ ] Secret created as SSM SecureString outside Terraform
[ ] Instance role can GetParameter; host loads GATEWAY_RELAY_SECRET without secret in tfvars/state
[ ] Register path exercised (control-plane instances/register → host secret seed)
[ ] STAGING-REQUIRED revocation: deprovision or per-instance revoke + relay kill-switch; gateway **4401**
[ ] Optional rotate path: new secret dual-accept / grace then old secret fails
[ ] Record evidence in change ticket; flip readiness G2 only after intentional review (validate-production-gates stays fail-closed until then)
```

Product manual sequence (when live Portal + gateway available): Portal `packages/relay/README.md` § “Manual staging procedure”.

### S5 — Tailscale (only if enable_tailscale=true)

```text
[ ] Auth key from SSM/SM only (never tfvars/user_data plaintext)
[ ] ACL default-deny; only operator tags reach node
[ ] SSM remains primary; Tailscale is secondary
[ ] DERP vs UDP 41641 documented for the tenant VPC
```

Runbook: `references/runbooks/tailscale-operator-access.md`

### S6 — Firewall / data processors (when L7 controls enabled)

```text
[ ] Network Firewall or proxy domain allowlist matches approved_processor_ids
[ ] New processor onboarding followed data-processor-onboarding.md
```

### S7 — Attestation + bootstrap

```text
[ ] Production: REQUIRE_ARTIFACT_ATTESTATION=1 with release Ed25519 pubkey
[ ] Bootstrap verifies SHA-256 + signature; bad signature fails closed
[ ] Provenance under /opt/company-brain/.seed/
```

### S8 — Backup restore drill

```text
[ ] check-snapshot-age.sh reports age within RPO band
[ ] restore-from-snapshot.sh dry-run then restore in non-prod account
[ ] Record RTO/RPO in dlm-restore-drill.md drill log
```

### S9 — Private control-plane boundary (G1.4 staging proof)

```text
[ ] Control plane not reachable on a public listener / public ALB
[ ] Browser/API edge is BFF only; BFF presents service credential to CP
[ ] Production auth mode: unauthenticated CP admin/internal rejected
[ ] OIDC (or equivalent) verified for human login path as designed
[ ] Evidence linked from readiness-matrix G1 row before any **ready** flip
```

Product harness (LOCAL substitute, not matrix flip): Portal control-plane OIDC/service-auth/private-topology tests (Portal **#11**/**#13**). Topology ADR: Portal `artifacts/portal-production-topology.md`.

### S10 — Brain RPC customer-host op (G3.4 staging proof)

```text
[ ] Hermes host with brain RPC handlers connected via authenticated relay WSS
[ ] Portal BRAIN_RPC_ENABLED=1; ≥1 op succeeds (e.g. brain.ping / brain.health)
[ ] Flag off / disconnected gateway fail closed (503), no silent local vault fallback
[ ] Prefer real published Hermes + client-core pins when available (G7.H2/C2 still open without pins)
[ ] Evidence linked from readiness-matrix G3 row before any **ready** flip
```

Product harness (LOCAL substitute): Portal `docs/brain-rpc.md` tests; Hermes handlers hermes-agent **#2**. Contract: `references/brain-rpc-contract.md`.

---

## What CI will never claim

| Claim | Why offline CI cannot assert it |
|-------|----------------------------------|
| Live relay revocation works end-to-end | Needs control-plane + running gateway |
| Tailscale ACL correct in production tailnet | Needs live Tailscale API/ACL |
| Network Firewall rules match production traffic | Needs AWS Network Firewall + traffic |
| Independent pen test passed | External engagement; see sign-off template |
| G1/G2 production Portal security ready | Product + **staging**; matrix stays **blocked** until intentional flip with evidence (`readiness-live-proofs-residual.md`) |
| G3 production vault/settings/projects ready | Needs G3.4 staging E2E; contract/tests alone insufficient; residual G3.4 **blocked** until operator evidence |
| Real Hermes/client-core pin coordinates | Publish workflows may exist; **no invented digests** (G7.H2 / G7.C2) |

---

## Failure handling

| Layer | On failure |
|-------|------------|
| LOCAL script fails in CI | Block merge; fix module/docs regression |
| STAGING check fails | Block tenant production cutover; open bead; do not flip readiness rows |
| Sign-off still NOT SIGNED | Do **not** market production “private-by-default certified”; residual risk only with written acceptance |

---

## References

- Policy-as-code: `scripts/policy-as-code-security.sh`
- Acceptance checklist driver: `scripts/security-acceptance-checklist.sh`
- Production honesty: `scripts/validate-production-gates.sh`, `references/readiness-matrix.md`
- Threat model: `references/threat-model-private-by-default.md`
- Pen test process: `references/runbooks/penetration-test-and-signoff.md`
- Sign-off record: `references/production-security-signoff.md`
