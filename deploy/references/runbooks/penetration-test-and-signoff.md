# Runbook: Independent penetration test and production security sign-off

**Status:** Process runbook (honest — does **not** claim a pen test has been executed)  
**Purpose:** Commission independent security testing, triage findings, and record residual risk / production sign-off without fabricating completion.  
**Related:** `references/threat-model-private-by-default.md`, `references/production-security-signoff.md`, `references/readiness-matrix.md`, `references/runbooks/security-e2e-acceptance.md`

---

## Principles

1. **No fake pen tests.** An agent session, internal checklist, or offline CI suite is **not** an independent penetration test.  
2. **Fail-closed marketing language.** Do not claim “production private-by-default certified,” “pen-test passed,” or “production ready” for Portal/relay security while G1/G2 or sign-off remains open.  
3. **Findings become work.** Critical/high findings open beads (or tickets) with owners and due dates; waivers are written, time-bounded, and approved.  
4. **Sign-off is a record**, stored in `references/production-security-signoff.md` (or a private ops copy of that template with the same fields).

---

## When to commission

| Gate | Minimum readiness before external test |
|------|----------------------------------------|
| Deploy P0/P1 private-by-default controls merged | `cbd-zzx` children for network, SSH/SSM, egress, secrets, URLs, IMDS, etc. closed or explicitly waived |
| LOCAL CI green | `policy-as-code-security.sh`, `security-acceptance-checklist.sh`, `validate-production-gates.sh` pass |
| Staging tenant available | Non-prod account or isolated staging with production-like `network_mode=production` |
| Scope freeze | Threat model version + in-scope URLs/accounts agreed in writing |

**Do not wait for product G1/G2 to be perfect** if the engagement is **scoped** to the deploy data-plane — but the report and sign-off must list Portal residual risk explicitly.

---

## Engagement checklist

### 1. Select independent tester

```text
[ ] External firm or independent internal red team **not** the implementers of the controls under test
[ ] NDA / SOW signed (private ops; not committed here)
[ ] Rules of engagement: accounts, IP ranges, time window, emergency contacts
[ ] Data handling: no vault content retained by tester after engagement without written approval
```

### 2. Scope (suggested default)

**In scope (deploy surface)**

- Staging Company Brain EC2 (private subnet, production network mode)  
- Security groups, IMDSv2, instance role, SSM access path  
- Artifact download/verify path (including attestation if enabled)  
- Relay wiring (secret storage, env injection) — **not** full Portal product auth design unless product joins  
- Snapshot/BPA posture (non-destructive where possible)  
- Optional Tailscale if enabled in staging  

**Out of scope (unless addendum)**

- Production customer vaults / live tenant data  
- Denial-of-service against shared production Portal  
- Physical / social engineering of employees  
- Full Portal control-plane source audit (separate product engagement)

**Explicit residual (always list)**

- G1 private control-plane boundary (product)  
- G2 relay credential lifecycle / replay resistance (product)  
- Tier 3 dedicated relay production-certified apply (module infra_ready only)

### 3. Inputs to provide tester

| Artifact | Location |
|----------|----------|
| Threat model | `references/threat-model-private-by-default.md` |
| Readiness / known blockers | `references/readiness-matrix.md` |
| LOCAL vs STAGING matrix | `references/runbooks/security-e2e-acceptance.md` |
| Isolation decision | `references/tenant-isolation-decision.md` |
| Staging access procedure | SSM-first; no public SSH unless break-glass lab |

### 4. During engagement

```text
[ ] Point of contact monitors GuardDuty / status alarms
[ ] Snapshot of staging before destructive tests
[ ] Daily debrief for critical findings
[ ] Stop condition: vault data exposure risk → halt and remediate
```

### 5. Deliverables from tester

```text
[ ] Written report: executive summary, findings (severity, repro, impact), retest notes
[ ] Evidence pack (private storage — not this git repo if customer data present)
[ ] Optional: retest after remediation window
```

---

## Triage findings into beads

For each finding:

| Step | Action |
|------|--------|
| 1 | Classify severity (Critical / High / Medium / Low / Informational) |
| 2 | Map to trust boundary in threat model |
| 3 | Create bead (or ticket): `bd create` with label `security`, `pen-test`, severity |
| 4 | Link parent epic `cbd-zzx` or follow-on epic |
| 5 | Critical/High: block production sign-off until fixed or formally waived |
| 6 | Medium: fix or time-bounded waiver (owner + expiry ≤ 90 days default) |
| 7 | Low/Info: backlog with no false “all clear” |

**Waiver template (private ticket or sign-off appendix)**

```text
Finding ID:
Severity:
Risk summary:
Why not fixed now:
Compensating controls:
Owner:
Expiry date:
Approver (Security + Eng lead):
```

---

## Residual risk acceptance (without pen test)

If leadership chooses to run limited production pilots **before** an independent pen test:

1. Complete LOCAL CI + STAGING S1–S8 as applicable (`security-e2e-acceptance.md`).  
2. Document residual risk in `references/production-security-signoff.md` § Residual risk acceptance.  
3. Status remains **NOT SIGNED** for “independent pen test complete.”  
4. Optional separate status: **RISK ACCEPTED FOR PILOT** with expiry and named approvers — **never** rewrite readiness G1/G2 to ready without product evidence.  
5. Schedule pen test date; open tracking bead if deferred.

This is **not** equivalent to production security certification.

---

## Production security sign-off flow

1. Threat model current for the release under review.  
2. LOCAL gates green in CI on the release commit.  
3. STAGING matrix completed for in-scope tenants.  
4. Independent pen test report received **or** residual risk acceptance recorded.  
5. Critical/High findings closed or waived.  
6. G1/G2 remain honest in `readiness-matrix.md` (still **blocked** until product clears).  
7. Fill `references/production-security-signoff.md` (or private copy): who / when / scope / evidence links.  
8. Only then may operators say “deploy data-plane private-by-default controls reviewed for &lt;scope&gt;” — still **not** “Portal production security ready” while G1/G2 blocked.

---

## CI / honesty hooks

| Check | Script / doc |
|-------|----------------|
| Sign-off template exists | `scripts/validate-production-gates.sh` |
| Readiness does not claim pen-test complete | `validate-production-gates.sh` + matrix language |
| Policy regressions | `scripts/policy-as-code-security.sh` |

---

## Anti-patterns

| Do not | Why |
|--------|-----|
| Commit pen-test reports with customer vault excerpts | Data handling / confidentiality |
| Mark `production-security-signoff.md` SIGNED without external test or written risk acceptance | False assurance |
| Flip readiness “Production Portal/relay security status: READY” after only deploy hardening | G1/G2 product gates |
| Treat `security-acceptance-checklist.sh` as pen test | Offline unit/static only |
