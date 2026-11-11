# Fake Daytona full wake / stop / re-wake (lp-cbv)

**Status:** Integration tests shipped (CI offline; no live Daytona).  
**Bead:** `lp-cbv`  
**Parent epic:** `lp-zuh` (Phase 10: Proof and cost report)  
**Depends on:** `lp-0y3` (idle reaper), `lp-y3j` (BFF chat ensure_online before deliver)

## Purpose

Prove the **core orchestrator + BFF hooks** lifecycle without managed Daytona or paid network:

| Step | Meaning | Surface under test |
|------|---------|-------------------|
| **Wake** | `offline` → `ensure_online` → sandbox started → `online` | CP `InstanceOrchestrator` + real harness; HTTP `POST …/ensure-online` |
| **Deliver** | Chat/message path refreshes activity (and mid_turn) | CP `signal-activity`; BFF `ensureOnlineBeforeChatDeliver` + `signalActivityIfNeeded` before/around deliver-inbound |
| **Idle stop** | Past 30 min grace → reaper stops sandbox | CP `reapIdle` / `createIdleReaperJob` + real harness `stop` |
| **Re-wake** | Next ensure_online after stop → online again | Default (`lp-6bg`): **start-from-stopped** (binding retained after idle_stop); cold create when binding cleared or sandbox gone |

Identity rules ([identity-model.md](./identity-model.md)):

- **Keep** across the cycle: `instance_id`, `tenant_id`, `s3_vault_prefix`, snapshot pin.
- **Ephemeral compute:** Daytona sandbox may be stopped/started; `sandbox_id` **retained** after stop by default (`lp-6bg`) so re-wake reuses the id; new id only on cold create.

## Tests (CI)

| Package | File | Runner |
|---------|------|--------|
| `@lanyard/control-plane` | `portal/packages/control-plane/test/wake-stop-rewake.integration.test.ts` | `pnpm --filter @lanyard/control-plane test` (also recursive `pnpm test` in CI) |
| `@lanyard/bff` | `portal/packages/bff/test/wake-stop-rewake.integration.test.ts` | `pnpm --filter @lanyard/bff test` |

**Constraints:** real harness / fake CP only; injectable clock for grace; no secrets; no live Daytona org key.

### Control-plane coverage

1. **Orchestrator lifecycle** — cold wake → deliver `signalActivity` → reap within grace (skip) → past grace (stop, **retain** `sandbox_id`) → start-from-stopped re-wake; vault prefix stable.
2. **Warm re-wake** — stop compute with retained `sandbox_id` → `start` without second `create`.
3. **Idle reaper job** — deliver delays stop; `runOnce` past grace stops.
4. **HTTP hooks** — ensure-online → signal-activity → reaper stop → presence offline → ensure-online re-wake; explicit stop path; service-token gated app.

### BFF coverage

1. **Hook cycle** — offline deliver wakes; online skips; simulated idle stop; next deliver re-wakes; activity signals without Daytona.
2. **Chat send call site** — `ENSURE_ONLINE_ON_CHAT` path orders ensure before deliver-inbound on cold and post-idle messages.

## Acceptance (`lp-cbv`)

- [x] CI can run tests (vitest offline; portal recursive `pnpm test`)
- [x] Wake, deliver, idle stop, re-wake covered

## Out of scope / follow-ups

| Item | Bead |
|------|------|
| Staging wall-clock ~30 min idle + re-wake | `lp-8sn` |
| Staging chat cold wake returns agent reply | `lp-wvx` |
| Daytona vendor autoStop safety net config | `lp-4f2` |

## Related

- [idle-reaper.md](./idle-reaper.md) — 30m grace + job
- [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md) — HTTP catalog
- [presence-state-machine.md](./presence-state-machine.md) — presence transitions
- [offline-piping.md](./offline-piping.md) — fake-only offline track
