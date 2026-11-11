# Staging proofs: G1.4 (private CP) and G3.4 (brain RPC E2E)

**Owner:** Portal product (this monorepo `portal/`)  
**Deploy companion:** `deploy/references/readiness-matrix.md` (matrix flip is **deploy/operator-owned** and must stay honest)  
**Live residual ledger (pass/fail/blocked):** [`deploy/references/runbooks/readiness-live-proofs-residual.md`](../../deploy/references/runbooks/readiness-live-proofs-residual.md) (`lp-t7q.7`, migrated `cbd-mta.6.*`) — G1.4 / G1a / G2 / G3.4 stay **blocked** until operator-recorded evidence  
**Beads:** `cbd-hhj.1.4` (G1.4), `cbd-hhj.6.4` (G3.4), monorepo residual `lp-t7q.7`

## Honesty rules

| Claim | When allowed |
|-------|----------------|
| Local topology properties (compose CP loopback, ADR, smoke bind) | After `bash scripts/local-topology-proof.sh` exits 0 or CI runs private-topology tests |
| Unit/integration service-auth / brain-rpc | After G1.2 / G3.3 code is on the branch under test and `pnpm test` is green |
| **Staging G1 / G3 ready** | Only after operator runs staging harnesses **exit 0** with full env against live staging and evidence is linked |
| readiness-matrix G1 / G3 → **ready** | Only with evidence links; **never** from harness existence alone |
| This PR alone proves staging | **No.** Harness + checklist only unless staging was actually executed |

Scripts **fail closed** when staging env is missing:

| Exit | Meaning |
|------|---------|
| `0` | Checks that were in scope for this run passed |
| `1` | Staging env present; one or more live checks failed |
| `2` | **FAIL CLOSED** — required staging env missing; staging was **not** executed |

`exit 2` is the expected result on a developer laptop without AWS staging. It is **not** a green staging proof.

---

## Prerequisites (do not skip)

### G1.4 — private control-plane boundary

| Item | Status / link |
|------|----------------|
| G1.1 Verified OIDC | Portal [PR #11](https://github.com/LanyardBrain/Portal/pull/11) (merged) |
| G1.2 BFF↔CP service auth | Portal [PR #13](https://github.com/LanyardBrain/Portal/pull/13) |
| G1.3 CP never on public ALB (product topology) | Portal [PR #13](https://github.com/LanyardBrain/Portal/pull/13) + `artifacts/portal-production-topology.md` + compose loopback in this repo |
| G1.3 deploy-side policy (when modules exist) | company-brain-deploy [PR #6](https://github.com/LanyardBrain/company-brain-deploy/pull/6) |
| G8 / staging Portal compute | company-brain-deploy G8 epic — **required for live public edge** |

### G3.4 — brain RPC customer-host E2E

| Item | Status / link |
|------|----------------|
| G3.1 RPC contract | company-brain-deploy [PR #4](https://github.com/LanyardBrain/company-brain-deploy/pull/4) → `references/brain-rpc-contract.md` |
| G3.2 Hermes host handlers | hermes-lanyard / hermes-agent Lanyard branch (`gateway/brain_rpc/`) |
| G3.3 Portal vertical slice | Portal [PR #14](https://github.com/LanyardBrain/Portal/pull/14) (`BRAIN_RPC_ENABLED`, `/api/brain/ping`, `/api/brain/health`) |
| Connected customer gateway in staging | Deploy + host bootstrap with relay secret lifecycle |

---

## What you can run without AWS (LOCAL partial evidence)

```bash
# From Portal monorepo root
bash scripts/local-topology-proof.sh

# Same properties via unit test (CI picks up with pnpm test)
pnpm --filter @lanyard/control-plane test -- private-topology

# When G1.2 / G3.3 code is present:
LOCAL_TOPOLOGY_RUN_UNIT_TESTS=1 bash scripts/local-topology-proof.sh
pnpm --filter @lanyard/control-plane test -- service-auth private-topology
pnpm --filter @lanyard/bff test -- brain-rpc
```

**Local proves:**

- [x] Topology ADR: private-only CP, BFF public API edge, service token name, fail-closed
- [x] `docker-compose.yml` publishes CP as `127.0.0.1:3100:3100` only
- [x] `scripts/docker-smoke.sh` publishes CP on loopback only
- [x] Staging harness scripts refuse to pass without `STAGING_*` env

**Local does not prove:**

- [ ] Public internet cannot reach staging CP
- [ ] BFF↔CP service auth in AWS
- [ ] Authenticated brain.ping through a real Hermes host

---

## Staging G1.4 checklist (operator)

### Preflight

```text
[ ] G1.1 / G1.2 / G1.3 PRs merged or staged together with this harness
[ ] Staging BFF is on a public (or shared-staging) edge URL
[ ] Control plane is private-only (no public ALB target group for CP)
[ ] CONTROL_PLANE_AUTH_MODE=production on CP
[ ] CONTROL_PLANE_SERVICE_TOKEN set on BFF + CP from secret store (not git)
[ ] Optional: SSM Session Manager / Tailscale path to private CP for C3 checks
```

### Run harness

```bash
export STAGING_BASE_URL='https://<staging-public-edge>'
# Optional but recommended for full G1.4 (base URL or …/health both accepted):
export STAGING_CP_PUBLIC_PROBE_URL='https://control-plane.<must-not-serve-cp>.example'
# Private CP (SSM port-forward example: http://127.0.0.1:13100)
export STAGING_CP_PRIVATE_URL='http://127.0.0.1:13100'
export CONTROL_PLANE_SERVICE_TOKEN='…'   # from secret manager; never commit
export STAGING_EXPECT_SERVICE_AUTH=1
export STAGING_EVIDENCE_DIR='./.data/staging-evidence'
mkdir -p "$STAGING_EVIDENCE_DIR"

bash scripts/staging-g1-cp-boundary-proof.sh
echo "exit=$?"
```

### Manual checklist (if harness cannot reach private CP)

```text
[ ] C1  Public BFF GET /health → 200
[ ] C2  Public probes of CP hostname/ALB → timeout, connection refused, or non-CP response
[ ] C3a Private CP GET /health → 200 (SSM/Tailscale/private net only)
[ ] C3b Anonymous POST /tenants → 401/403
[ ] C3c Service token header accepted for BFF-shaped traffic
[ ] C3d Spoofed service token → 401/403
[ ] Evidence stub written (no secrets) and linked from change ticket
[ ] readiness-matrix G1 remains **blocked** until evidence attached intentionally
```

### Fail-closed demo (no staging)

```bash
bash scripts/staging-g1-cp-boundary-proof.sh
# expect exit 2 and "FAIL CLOSED"
```

---

## Staging G3.4 checklist (operator)

### Preflight

```text
[ ] G3.1 contract frozen in company-brain-deploy
[ ] G3.2 Hermes brain_rpc handlers on the customer host image/tarball
[ ] G3.3 Portal PR #14 deployed: BRAIN_RPC_ENABLED=1 on staging BFF
[ ] Relay internal token configured; gateway connected for demo tenant
[ ] Operator has an authenticated Portal session cookie for that tenant
```

### Run harness

```bash
export STAGING_BASE_URL='https://<staging-public-edge>'
export STAGING_TENANT_HOST='<tenant-host-header-if-needed>'
export STAGING_SESSION_COOKIE='lanyard_session=…; lanyard_csrf=…'  # never commit
export STAGING_EXPECT_BRAIN_RPC=1
export STAGING_BRAIN_ECHO='g34-proof'
export STAGING_EVIDENCE_DIR='./.data/staging-evidence'

bash scripts/staging-g3-brain-rpc-proof.sh
echo "exit=$?"
```

### Manual checklist

```text
[ ] C0  BFF /health → 200
[ ] C1  Unauthenticated GET /api/brain/ping → 401/403/503 (never 200)
[ ] C2  Authenticated GET /api/brain/ping → 200 with ok/pong (live host)
[ ] C3  Authenticated GET /api/brain/health → 200
[ ] Residual: flag-off still returns 503 when BRAIN_RPC_ENABLED unset on a canary
[ ] Evidence stub linked; readiness-matrix G3 stays **blocked** until intentional flip
```

### Fail-closed demo (no staging)

```bash
bash scripts/staging-g3-brain-rpc-proof.sh
# expect exit 2 and "FAIL CLOSED"
```

---

## Evidence template (paste into ticket; no secrets)

```markdown
## Staging proof evidence

- Date (UTC):
- Operator:
- Portal SHA / image digests:
- Hermes pin / host version:
- G1.4 harness exit code:
- G3.4 harness exit code:
- Evidence dir / artifact paths:
- Public BFF URL (non-secret):
- Private CP reachability method (SSM / Tailscale / other):
- Notes / residuals:

### Explicit non-claims
- [ ] Did **not** paste tokens, cookies, or secrets
- [ ] Did **not** flip readiness-matrix without this evidence
- [ ] validate-production-gates.sh still honest after any matrix edit
```

---

## Coordination with readiness-matrix

| Gate | Product deliverable in this PR | Matrix status after this PR alone |
|------|--------------------------------|-------------------------------------|
| **G1** | Harness + local topology partial + checklists | **blocked** (staging not auto-proven) |
| **G3** | Harness + checklist; unit path when PR #14 merged | **blocked** until live E2E evidence |

Deploy agent / operators may add a **note** such as “Portal staging proof harness ready (`docs/staging-proofs.md`)” on the G1/G3 rows **without** changing status from **blocked**. Update the residual ledger rows in `deploy/references/runbooks/readiness-live-proofs-residual.md` only after live pass/fail evidence is recorded.

Never set G1/G3 to **ready** solely because these scripts exist. Offline deploy check: `bash deploy/scripts/smoke-readiness-live-proofs-residual.sh`.

---

## Script index

| Script | Purpose |
|--------|---------|
| `scripts/local-topology-proof.sh` | LOCAL partial G1 topology + harness fail-closed self-check |
| `scripts/staging-g1-cp-boundary-proof.sh` | Live G1.4 staging (exit 2 if no env) |
| `scripts/staging-g3-brain-rpc-proof.sh` | Live G3.4 staging E2E (exit 2 if no env) |
| `scripts/docker-smoke.sh` | Image health smoke; CP loopback publish |
| `packages/control-plane/test/private-topology.test.ts` | CI-enforced compose/ADR/smoke properties |

## Related docs

- `artifacts/portal-production-topology.md` — private CP design freeze
- `docs/brain-rpc.md` — G3.3 vertical slice (when PR #14 present)
- `docs/image-release.md` — image digests for staging pins
- company-brain-deploy `references/runbooks/security-e2e-acceptance.md` — LOCAL vs STAGING security suite
- company-brain-deploy `references/brain-rpc-contract.md` — RPC contract authority
