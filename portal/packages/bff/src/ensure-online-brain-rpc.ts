/**
 * Brain RPC path — ensure_online before invoke (lp-kng.2.9 stub / lp-7bk Phase 5).
 *
 * Call sites (when flag on + runtime_kind=daytona):
 * - Production invoker: before relay `invokeBrainRpc` (vault/settings/projects)
 * - G3.3 probes: GET /api/brain/ping and /api/brain/health before invokeBrainRpc
 *
 * Env: `ENSURE_ONLINE_ON_BRAIN_RPC` (bindings.ensureOnlineOnBrainRpc) —
 * **default off** (offline-safe — no Daytona wake).
 *
 * Same gate pattern as chat (`lp-kng.2.8`): flag → presence → ensure-online
 * only when `runtime_kind === "daytona"`. ControlPlaneRequestError is **not**
 * swallowed — callers map status → HTTP so failures surface to API clients.
 *
 * @see ./ensure-online-hook.ts
 * @see docs/plans/0008-daytona-agent-sandboxes/cp-internal-orchestrator-api.md
 * @see docs/plans/0008-daytona-agent-sandboxes/offline-piping.md
 */

import {
  ensureOnlineIfNeeded,
  type EnsureOnlineHookClient,
  type EnsureOnlineHookResult,
  type EnsureOnlineIfNeededInput,
} from "./ensure-online-hook.js";

export type EnsureOnlineBrainRpcClient = EnsureOnlineHookClient;

export type EnsureOnlineBrainRpcHookResult = EnsureOnlineHookResult;

export type EnsureOnlineBeforeBrainRpcInput = EnsureOnlineIfNeededInput;

/**
 * Maybe wake the sandbox before a Brain RPC host call.
 *
 * Does **not** catch ControlPlaneRequestError — callers map status → HTTP.
 */
export async function ensureOnlineBeforeBrainRpc(
  input: EnsureOnlineBeforeBrainRpcInput,
): Promise<EnsureOnlineBrainRpcHookResult> {
  return ensureOnlineIfNeeded(input);
}
