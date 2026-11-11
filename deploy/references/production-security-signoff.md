# Production security sign-off record

**Document type:** Sign-off template + current status  
**Status: NOT SIGNED**

This file is the deploy-repo record for production security review of the **Company Brain deploy surface** (private-by-default). It is intentionally **not signed** until an independent penetration test is completed **or** explicit written residual-risk acceptance is recorded below by named approvers.

**Do not** edit the status line to SIGNED without completing the evidence sections. CI (`scripts/validate-production-gates.sh`) asserts this template exists and that readiness docs do not claim pen-test complete while status is NOT SIGNED.

---

## Current status (authoritative)

| Field | Value |
|-------|--------|
| **Overall status** | **NOT SIGNED** |
| Independent penetration test | **Not completed** (process: `references/runbooks/penetration-test-and-signoff.md`) |
| Residual risk acceptance for pilot | **Not recorded** (optional; still not a full sign-off) |
| Production Portal/relay security (G1/G2) | **BLOCKED** — see `references/readiness-matrix.md` |
| Private-by-default deploy controls (implementation) | Largely implemented; offline CI gates in place — **not** the same as signed production security |
| Last template review | 2026-07-12 |

**Forbidden claims while status is NOT SIGNED**

- “Penetration test passed / complete”  
- “Production private-by-default certified”  
- “Production Portal/relay security ready” (also blocked by G1/G2)  
- Marketing or customer language that implies third-party security validation of this deploy surface

---

## Sign-off record (fill when ready — leave blank while NOT SIGNED)

### Scope

```text
Release / git SHA:
Environments covered: (e.g. staging only / pilot tenant X / production)
In-scope modules:
  [ ] modules/company-brain-ec2
  [ ] modules/customer-gateway-relay (wiring only)
  [ ] modules/product-artifact-infra
  [ ] modules/security-observability
  [ ] templates/tenant
  [ ] bootstrap / artifacts contract
Out of scope (explicit):
  [ ] Portal control-plane product (G1)
  [ ] Relay credential lifecycle product (G2)
  [ ] Tier 3 dedicated relay production-certified apply (module infra_ready only)
  [ ] Other:
```

### Who / when

```text
Security reviewer (name / role):
Engineering lead (name / role):
Optional: customer security contact:
Sign-off date (UTC):
Next review date:
```

### Evidence checklist

```text
[ ] Threat model reviewed: references/threat-model-private-by-default.md (version/date: ____)
[ ] LOCAL CI green on release SHA:
      policy-as-code-security.sh
      security-acceptance-checklist.sh
      validate-production-gates.sh
[ ] STAGING matrix completed: references/runbooks/security-e2e-acceptance.md
[ ] Independent pen-test report (link to private store): __________________
    OR residual risk acceptance completed in section below
[ ] Critical/High findings closed or waived (bead IDs: ____)
[ ] readiness-matrix.md G1/G2 still honest (blocked unless product evidence)
[ ] No live secrets in git; production uses SSM/SM for relay secrets
```

### Decision

```text
[ ] APPROVED — deploy data-plane private-by-default controls accepted for scope above
[ ] APPROVED WITH WAIVERS — see waivers list
[ ] REJECTED — blockers: ____
```

**Approver signatures (name, date):**

```text
Security: __________________
Engineering: __________________
```

---

## Residual risk acceptance (optional pilot path)

Use only when leadership accepts operating **without** a completed independent pen test. This does **not** change overall template status to a full pen-test sign-off unless the table at top is explicitly updated under a separate process.

```text
Status: NOT RECORDED | RISK ACCEPTED FOR PILOT (circle one when used)
Pilot scope (tenants / accounts):
Expiry date (required if accepted):
Named approvers:
  Security:
  Engineering:
  Optional executive:
Accepted residual risks (bullet list):
  - Independent pen test not yet executed
  - G1 private control-plane product gate blocked
  - G2 relay lifecycle / replay resistance product gate blocked
  - Other:
Compensating controls:
Pen test scheduled date (required if deferred):
Tracking bead / ticket:
```

---

## History

| Date | Event | Actor |
|------|--------|-------|
| 2026-07-12 | Template created; status **NOT SIGNED**; no pen test commissioned in-repo | Deploy security epic cbd-zzx.22 |

---

## References

- Threat model: `references/threat-model-private-by-default.md`  
- Pen-test process: `references/runbooks/penetration-test-and-signoff.md`  
- E2E LOCAL/STAGING: `references/runbooks/security-e2e-acceptance.md`  
- Production gate runbook: `references/runbooks/production-security-gate.md`  
- Readiness matrix: `references/readiness-matrix.md`  
