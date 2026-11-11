# Testing — lanyard hermes gateway + mocklab vault

## Offline (CI / local)

| Check | When |
|-------|------|
| `bash -n scripts/seed-demo-vault.sh` | After seed script lands |
| Optional smoke: seed into temp dir, assert tree | Phase 5 |
| `bash scripts/validate-compatibility.sh` | After pin file edits |
| Existing host unit smokes (`smoke-host-runtime-hardening`, omnibox) if unit template changes | Only if ExecStart changes |

## Live mocklab (operator)

| Step | Pass |
|------|------|
| Provenance | `/opt/hermes-lanyard/.seed/provenance.env` matches pin |
| Service | `systemctl is-active hermes-gateway` |
| Relay | Gateway logs show connected / no permanent 4401 |
| Chat | `https://app.withlanyard.com/mocklab` send “hello brain” → stream |
| Vault | List `/Projects/Legal`, `/Projects/Operations` |
| Directory | Hermes projects visible in portal when bound |

### Chat smoke formal close (`lp-t7q.5` / `cbd-mta.8.8.1`)

| Item | Status |
|------|--------|
| Login + stream + host path | **PASS** dated 2026-07-26 — [`deployments/mocklab/CHAT-SMOKE-CLOSE.md`](../../../deployments/mocklab/CHAT-SMOKE-CLOSE.md) |
| Offline doc guard | `bash deploy/scripts/smoke-mocklab-chat-smoke-close.sh` |
| Host-backed panes | **Not** closed here — `lp-t7q.4` / `.1` / `.2` / `.10` |
| Re-UIQA prerequisites | CP service running (tenant slug resolve) + Hermes host up — see pack § Post-proof environment note |

## Explicit non-claims

- Not production G1–G8 certification
- Not multi-tenant edge E2E (`cbd-mta.2.4`)
- Not Omnibox Mode A live (`cbd-o9s.16` / `lp-t7q.6`)
- Not host-backed Directory/Vault/Settings from chat alone
