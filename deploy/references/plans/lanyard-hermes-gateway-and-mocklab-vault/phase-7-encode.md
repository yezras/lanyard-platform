# Phase 7: Encode for every future tenant

**Bead:** `cbd-ukg.10`  
**Depends on:** `cbd-ukg.6`–`cbd-ukg.9` (as applicable)  
**Status:** implemented (docs + offline unit ExecStart guard)

## Goal

Make “Lanyard hermes + optional demo vault” the default operator path, not tribal knowledge.

## Work

1. Short section in `references/runbooks/pin-update.md` (or provision-runbook): hermes-lanyard only; never pin raw Nous for customer hosts.
2. Tenant template / mocklab INDEX: post-bootstrap checklist (relay env, gateway, optional `seed-demo-vault`).
3. Optional structural guard:
   - smoke or validate that hermes unit ExecStart path is `/opt/hermes-lanyard/bin/hermes`
   - fail example pins that point at non-hermes-lanyard install names if easy
4. Link this plan from `INDEX.md` only if layout policy requires it after merge.

## Done checklist

| Item | Where |
|------|--------|
| hermes-lanyard-only pin doctrine | `references/runbooks/pin-update.md` § Customer host Hermes pin |
| Bootstrap + single gateway unit callout | `references/provision-runbook.md` § 3 Host bootstrap |
| Post-bootstrap checklist (all tenants) | `templates/tenant/INDEX.md` |
| Example tenant checklist | `deployments/_example-tenant/INDEX.md` |
| mocklab required path + optional demo seeds | `deployments/mocklab/INDEX.md` |
| Offline ExecStart guard | `scripts/smoke-host-runtime-hardening.sh` (`/opt/hermes-lanyard/bin/hermes gateway`) |
| Demo seed = optional / mock-only | pin-update, provision-runbook, mocklab + template INDEX |
| No second gateway binary | Docs + unit template only `hermes-gateway` → hermes CLI |

## Acceptance

- [x] Operator docs state hermes-lanyard pin + bootstrap + restart
- [x] Demo seed documented as optional / mock-only
- [x] No second gateway binary invented in docs

## Offline verify

```bash
bash scripts/smoke-host-runtime-hardening.sh
# asserts ExecStart=/opt/hermes-lanyard/bin/hermes gateway
```

## Operator path (summary)

```text
pin hermes-lanyard (never raw Nous)
  → terraform apply (if pins changed)
  → sudo company-brain-bootstrap
  → GATEWAY_RELAY_* + secret → /home/hermes/.hermes/.env
  → sudo systemctl enable --now hermes-gateway
       ExecStart=/opt/hermes-lanyard/bin/hermes gateway

optional mock/lab only:
  seed-demo-vault.sh → seed-demo-hermes-projects.sh
```
