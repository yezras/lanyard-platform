# Runbook: Readiness live proofs residual (G1.4 / G1a / G2 / G3)

**Bead:** `lp-t7q.7` (migrated `cbd-mta.6.*` live proof leaves)  
**Parent:** `lp-t7q` · Source epic `cbd-mta.6` (apply staging, execute live proofs, certify readiness honestly)  
**Status:** **BLOCKED residual ledger** — monorepo code, unit/integration tests, and offline smokes do **not** flip readiness-matrix gates to **ready**  
**Purpose:** Single operator-facing record of pass / fail / blocked notes for live security gates so matrix honesty cannot drift, and so agents never claim production clearance from harness presence alone.

**Source of truth for matrix status:** [`references/readiness-matrix.md`](../readiness-matrix.md)  
**Offline honesty:** `bash scripts/validate-production-gates.sh` · `bash scripts/smoke-readiness-live-proofs-residual.sh`  
**Product staging harnesses (Portal monorepo):** [`portal/docs/staging-proofs.md`](../../../portal/docs/staging-proofs.md)

---

## Honesty (read first)

| Claim | Truth |
|-------|--------|
| Product code / harness scripts for G1.4 / G3.4 exist in monorepo | **Yes** — `portal/scripts/staging-g1-cp-boundary-proof.sh`, `portal/scripts/staging-g3-brain-rpc-proof.sh` |
| Offline LOCAL substitutes (unit/integration / topology) exist | **Yes** — CP private-topology, service-auth, tenant-authz, relay lifecycle tests; `local-topology-proof.sh` |
| Live staging G1.4 / G1a / G2 S4 / G3.4 executed and recorded in this residual | **No** — all live rows **blocked** until operator-recorded evidence |
| Monorepo smokes / CI green ⇒ readiness-matrix **ready** | **No** — fail-closed; CI must never flip G1/G2/G3 |
| Production Portal/relay security ready | **No** — status **BLOCKED** while G1 and G2 live rows are blocked |
| This residual alone clears any matrix gate | **No** — documentation + honesty only |

**Rule:** `harness ready` ≠ `staging executed` ≠ matrix **ready**. Exit `2` from staging harnesses (missing `STAGING_*` env) is **fail-closed**, not a pass.

---

## Live gate ledger (pass / fail / blocked)

Record of **live** operator proof only. Product/LOCAL substitutes are listed under “LOCAL substitute” and **never** count as live pass.

| Gate ID | Item | Live status | LOCAL / product substitute | Operator path | Why still blocked / evidence note |
|---------|------|-------------|----------------------------|---------------|-----------------------------------|
| **G1.4** | Private control-plane boundary (public cannot reach CP; BFF+service auth works) | **blocked** | Portal OIDC + service-auth + private-topology tests; `local-topology-proof.sh`; harness fails closed without `STAGING_*` | `security-e2e-acceptance.md` § S9; `portal/docs/staging-proofs.md` G1.4; `staging-g1-cp-boundary-proof.sh` | Harness + product code exist; **no operator-recorded staging run** with exit 0 + evidence stub linked. Matrix G1 stays **blocked**. Source: `cbd-mta.6.2` / `cbd-hhj.1.4`. |
| **G1a** | Per-tenant authorization / isolation (live two-tenant elevation + cross-tenant deny) | **blocked** (live) · product path **ready** | Portal tenant path authz + schema-boundary + tenant-authz integration tests (Portal **#21**, cbd-mta.3.1) | Two-tenant OIDC session exercise + path/header/body cross-tenant negatives per `cbd-mta.6.2`; data-plane isolation: `tenant-isolation-decision.md` | Product middleware/schema ready; **live two-tenant staging proof not executed**. Do **not** claim production multi-tenant isolation from unit tests alone. |
| **G2** (S4) | Relay credential lifecycle register / rotate / revoke (live 4401) | **blocked** | Product register/rotate/revoke APIs + CP/relay tests; deploy `relay-secret-lifecycle.md` | `security-e2e-acceptance.md` § S4; Portal relay README manual staging | Product APIs/runbooks landed; **live staging revoke→4401 not recorded**. G2a replay resistance is product-ready separately; G2b log retention still product/ops blocked. Source: `cbd-mta.6.3`. |
| **G3.4** | Brain RPC customer-host E2E (≥1 authenticated host op) | **blocked** | Contract `brain-rpc-contract.md`; Hermes handlers; Portal BFF Brain RPC composition + unit path; harness fails closed without `STAGING_*` | `security-e2e-acceptance.md` § S10; `portal/docs/staging-proofs.md` G3.4; `staging-g3-brain-rpc-proof.sh`; sibling `lp-t7q.4` for BRAIN_RPC_ENABLED staging enable | Harness + monorepo Brain RPC wiring exist; **live host E2E not recorded**. Do not enable production vault/settings/projects from docs alone. Source: `cbd-mta.6.4` / `cbd-hhj.6.4`. |

### Related gates (honesty only; not flipped by this residual)

| Gate ID | Live status | Note |
|---------|-------------|------|
| **G2b** | **blocked** | Payload log / retention policy draft; enforcement incomplete for production claim |
| **G5** | **blocked** | Dual-BFF live proof **deferred** with reason — `portal-valkey-g5-enable.md` (`lp-t7q.8`) |
| **G6** | **blocked** | Multi-relay bus / shared jti staging not executed |
| **G7** | **blocked** (partial) | Private GH pins partial; ECR registry digests / S3 mirrors still open |
| **G8** | **infra_ready** | Modules present; not production-certified without staging apply + G1/G2/G7 |
| **PS-PT** | **blocked** | Pen-test not completed; `production-security-signoff.md` **NOT SIGNED** |

---

## Pass / fail / blocked semantics

| Live status | Meaning | Allowed matrix action |
|-------------|---------|------------------------|
| **pass** | Operator ran live procedure; exit 0 or checklist fully checked; **sanitized** evidence linked (no secrets) | May propose readiness-matrix flip to **ready** with review; re-run `validate-production-gates.sh` after intentional validator update |
| **fail** | Staging configured; one or more live checks failed | Keep matrix **blocked**; open remediation bead; do not claim ready |
| **blocked** | Staging not executed, env missing, or evidence not recorded | Matrix stays **blocked**; harness exit 2 / offline CI green does **not** change this |

**Monorepo unit/smoke green is never recorded as live pass.**

---

## What monorepo code and CI must not claim

| Non-claim | Why |
|-----------|-----|
| G1 / G1a / G2 / G3 matrix **ready** from merge of product PRs | Live proof is operator-owned (`cbd-mta.6.*` / this residual) |
| Staging harness existence = staging executed | Scripts exit **2** without `STAGING_*` (fail-closed) |
| mocklab chat smoke (`lp-t7q.5`) = G1/G3 ready | Chat path only; `brain_rpc` may still be off; not private-CP or multi-tenant isolation |
| Omnibox Mode A table (`lp-t7q.6`) = production security | Isolation cage residual; separate from G1/G2 |
| Valkey module / dual-instance CI (`lp-t7q.8`) = G5 ready | Explicit dual-BFF deferral |
| Offline `validate-production-gates.sh` green = production certified | Script **requires** G1/G2/G3 **blocked** until intentionally cleared with evidence |

---

## Operator execution order (when staging exists)

Do **not** mark the checklist complete from this residual alone.

```text
[ ] Complete staging-secrets-checklist.md (names only in git; secrets present ≠ matrix ready)
[ ] Apply / confirm private CP + public BFF edge per portal-compute-staging-apply / platform-staging-compose
[ ] G1.4: bash portal/scripts/staging-g1-cp-boundary-proof.sh with STAGING_* → expect exit 0; keep evidence stub
[ ] G1a: two-tenant live cross-tenant negatives + contributor non-elevation (manual + product tests as guide)
[ ] G2 S4: register → rotate → revoke; gateway 4401; SSM/SM only (relay-secret-lifecycle.md)
[ ] G3.4: bash portal/scripts/staging-g3-brain-rpc-proof.sh with session + BRAIN_RPC_ENABLED=1 → exit 0
[ ] Attach sanitized evidence to change ticket / private operator notes (no cookies, tokens, secrets)
[ ] Update THIS residual table rows to pass/fail with date + operator + artifact paths
[ ] Only then: intentional readiness-matrix flip + adjust validate-production-gates if production claim is true
[ ] Re-run: bash scripts/validate-production-gates.sh && bash scripts/smoke-readiness-live-proofs-residual.sh
```

### Evidence stub (no secrets)

```markdown
## Live proof evidence (lp-t7q.7 residual)

- Date (UTC):
- Operator:
- Environment (staging account / edge URL non-secret):
- Portal image digests / Hermes pin (non-secret):
- G1.4 result: pass | fail | blocked — harness exit / notes:
- G1a result: pass | fail | blocked — tenants exercised (slugs only):
- G2 S4 result: pass | fail | blocked — revoke observed 4401? (yes/no):
- G3.4 result: pass | fail | blocked — method exercised (e.g. brain.ping):
- Evidence paths (private):
- Explicit non-claims: no secrets committed; matrix not flipped without review
```

---

## Fail-closed demo (developer laptop)

```bash
# From monorepo portal/ — expect exit 2 FAIL CLOSED (not a staging pass)
bash scripts/staging-g1-cp-boundary-proof.sh; echo exit:$?
bash scripts/staging-g3-brain-rpc-proof.sh; echo exit:$?

# From monorepo deploy/ — expect exit 0 while G1/G2/G3 stay blocked in matrix
bash scripts/validate-production-gates.sh
bash scripts/smoke-readiness-live-proofs-residual.sh
```

---

## Coordination map (migrated leaves)

| Source bead | Residual ownership here |
|-------------|-------------------------|
| `cbd-mta.6` epic | Live proofs + honest certify |
| `cbd-mta.6.1` | Platform + tenant data plane live apply (prerequisite; not claimed done here) |
| `cbd-mta.6.2` | G1.4 + G1a live rows |
| `cbd-mta.6.3` | G2 (+ G2b note) live rows |
| `cbd-mta.6.4` | G3.4 live row |
| `cbd-mta.6.5` | Matrix reconcile + validators fail-closed (this residual + `validate-production-gates.sh`) |
| `cbd-mta.6.6` / `.7` | Pen-test + go/no-go — still **PS-PT blocked** / sign-off **NOT SIGNED** |

Sibling monorepo residuals (not substitutes for this ledger): `lp-t7q.4` (BRAIN_RPC_ENABLED staging enable), `lp-t7q.5` (mocklab chat smoke), `lp-t7q.6` (Omnibox table), `lp-t7q.8` (G5 dual-BFF deferral).

---

## Acceptance mapping (`lp-t7q.7`)

| Criterion | How satisfied |
|-----------|----------------|
| Each live gate has pass/fail/blocked note | § Live gate ledger — G1.4, G1a, G2, G3.4 each **blocked** with explicit notes |
| Validators remain fail-closed | `validate-production-gates.sh` requires G1/G2/G3 **blocked** + residual presence; staging harnesses exit 2 without env; offline smoke enforces residual honesty |
| No ready claims without evidence | Honesty tables + non-claims; matrix G1/G2/G3 stay **blocked**; CI does not flip ready |

---

## Offline validation (no AWS)

```bash
# From deploy/
bash scripts/smoke-readiness-live-proofs-residual.sh
bash scripts/validate-production-gates.sh
bash scripts/security-acceptance-checklist.sh
```

From Portal (harness fail-closed self-check only):

```bash
# expect exit 2 without STAGING_*
bash scripts/staging-g1-cp-boundary-proof.sh || true
bash scripts/staging-g3-brain-rpc-proof.sh || true
bash scripts/local-topology-proof.sh   # LOCAL partial + harness fail-closed check
```
