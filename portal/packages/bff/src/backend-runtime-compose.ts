/**
 * BFF composition: BackendRuntimeService via Brain RPC (production) or local
 * fixture/Hermes ports (offline tests).
 *
 * Beads: lp-t7q.1 (projects.list + settings.snapshot), lp-t7q.2 (vault.list /
 * vault.stat / vault.read), lp-bih (projects.create expansion) — wire
 * createProductionHermesBackendRuntimeService + invokeBrainRpc when
 * BRAIN_RPC_ENABLED; keep hermes-projects / settings-snapshot / vault FS-fixture
 * for offline tests when the flag is off. Local hermes CLI create is dev-only.
 *
 * lp-kng.2.9 / lp-7bk: ensure_online before each Brain RPC invoke when flag on
 * (default off). Wake failures map to BackendRuntimeError so vault/settings/
 * projects API clients see HTTP errors (not silent host invoke).
 *
 * lp-96v: signal-activity on Brain RPC invoke when SIGNAL_ACTIVITY_ENABLED
 * (default off). Best-effort store write only — no Daytona; never blocks invoke.
 */

import {
  BackendRuntimeError,
  createProductionHermesBackendRuntimeService,
  type BackendRuntimeContext,
  type BackendRuntimeService,
  type BrainRpcInvoker,
} from "@lanyard/backend-runtime";

import {
  buildBrainRpcRequest,
  isBrainRpcHostOk,
  stampBrainRpcAuth,
} from "./brain-rpc.js";
import { ControlPlaneRequestError } from "./control-plane-client.js";
import type { EnsureOnlineHookClient } from "./ensure-online-hook.js";
import { ensureOnlineBeforeBrainRpc } from "./ensure-online-brain-rpc.js";
import {
  mapControlPlaneWakeFailure,
  wakeFailureToBackendFields,
} from "./ensure-online-errors.js";
import type { RelayClient } from "./relay-client.js";
import {
  signalActivityIfNeeded,
  type SignalActivityHookClient,
} from "./signal-activity.js";

/** Options for production Brain RPC invoker (lp-kng.2.9 / lp-7bk ensure_online gate). */
export type RelayBrainRpcInvokerOptions = {
  /**
   * When true, call CP ensure_online before invokeBrainRpc (daytona only).
   * Must stay false offline / default.
   */
  ensureOnlineEnabled?: boolean;
  /**
   * When true, POST CP signal-activity on each Brain RPC invoke (lp-96v).
   * Best-effort; default false.
   */
  signalActivityEnabled?: boolean;
  /**
   * Required when ensureOnlineEnabled or signalActivityEnabled is true
   * (real auth client or test fake).
   */
  authClient?: EnsureOnlineHookClient & Partial<SignalActivityHookClient>;
};

/**
 * Map CP ensure-online / presence failures to BackendRuntimeError so BFF
 * vault/settings/projects handlers can surface HTTP status to API clients
 * (lp-7bk / lp-mrh). Uses shared wake failure table: timeout, Daytona down,
 * vault mount, etc. with retryable + wake_code in details.
 */
export function controlPlaneEnsureOnlineToBackendError(
  error: ControlPlaneRequestError,
  method: string,
): BackendRuntimeError {
  const mapped = mapControlPlaneWakeFailure(error);
  const fields = wakeFailureToBackendFields(mapped);
  return new BackendRuntimeError(fields.code, fields.message, {
    retryable: fields.retryable,
    details: {
      method,
      ...fields.details,
    },
  });
}

/**
 * Map BFF relay Brain RPC transport → {@link BrainRpcInvoker} used by
 * HermesBackendRuntimeService (returns host result payload or throws).
 *
 * When ensureOnlineEnabled: CP ensure_online runs **before** relay invoke
 * (vault/settings/projects host paths — lp-7bk). Failures throw and never
 * reach invokeBrainRpc.
 *
 * When signalActivityEnabled: CP signal-activity runs best-effort after
 * ensure_online (lp-96v) — store-only idle timer refresh; never Daytona.
 */
export function createRelayBrainRpcInvoker(
  relayClient: RelayClient,
  options: RelayBrainRpcInvokerOptions = {},
): BrainRpcInvoker {
  return async ({ method, params, ctx }) => {
    if (options.ensureOnlineEnabled) {
      if (!options.authClient) {
        throw new BackendRuntimeError(
          "internal",
          "ensure_online enabled for Brain RPC but authClient was not provided",
          { retryable: false, details: { method } },
        );
      }
      try {
        await ensureOnlineBeforeBrainRpc({
          enabled: true,
          authClient: options.authClient,
          instanceId: ctx.instanceId,
        });
      } catch (error) {
        if (error instanceof ControlPlaneRequestError) {
          throw controlPlaneEnsureOnlineToBackendError(error, method);
        }
        throw error;
      }
    }

    // lp-96v: refresh idle timer from Brain RPC activity (best-effort).
    // Awaits the store write but never throws (signalActivityIfNeeded swallows CP errors).
    if (
      options.signalActivityEnabled &&
      options.authClient &&
      typeof options.authClient.signalActivity === "function"
    ) {
      await signalActivityIfNeeded({
        enabled: true,
        authClient: options.authClient as SignalActivityHookClient,
        instanceId: ctx.instanceId,
        source: "brain_rpc",
      });
    }

    const auth = stampBrainRpcAuth({
      tenantId: ctx.tenantId,
      instanceId: ctx.instanceId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      rbac: {
        hermes_profile: ctx.profile.hermesProfileAlias ?? ctx.profile.name,
        allowed_path_prefixes: [...ctx.profile.pathPrefixes],
        role_names: [...ctx.roles],
      },
    });

    const request = buildBrainRpcRequest({
      method,
      auth,
      params,
      timeoutMs: ctx.timeoutMs,
    });

    const delivered = await relayClient.invokeBrainRpc({
      instanceId: ctx.instanceId,
      tenantId: ctx.tenantId,
      request,
    });

    if (!delivered.ok) {
      const code =
        delivered.status === 504
          ? "timeout"
          : delivered.status === 502 ||
              delivered.status === 503 ||
              delivered.status === 404
            ? "unavailable"
            : "internal";
      throw new BackendRuntimeError(code, delivered.error, {
        retryable: true,
        details: { method, reason: delivered.reason },
      });
    }

    const frame = delivered.result;
    if (!isBrainRpcHostOk(frame)) {
      const err = frame.error;
      throw new BackendRuntimeError(
        err?.code ?? "internal",
        err?.message ?? "The agent could not complete that request.",
        {
          retryable: err?.retryable,
          details: {
            method,
            ...(err?.details && typeof err.details === "object"
              ? (err.details as Record<string, unknown>)
              : {}),
          },
        },
      );
    }

    return frame.result ?? {};
  };
}

/**
 * Production BackendRuntimeService: projects.list, settings.snapshot, and
 * vault.list/stat/read only via Brain RPC (no local projects.db / config.yaml /
 * FS-fixture vault fallback).
 */
export function createProductionBackendRuntimeService(
  relayClient: RelayClient,
  options: RelayBrainRpcInvokerOptions = {},
): BackendRuntimeService {
  return createProductionHermesBackendRuntimeService({
    invokeBrainRpc: createRelayBrainRpcInvoker(relayClient, options),
  });
}

export type { BackendRuntimeContext, BackendRuntimeService, BrainRpcInvoker };
