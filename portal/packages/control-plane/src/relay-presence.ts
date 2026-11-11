/**
 * Relay presence port for ensure_online (lp-rr5).
 *
 * After Daytona sandbox reaches `started`, the orchestrator waits until Relay
 * reports the gateway instance connected (WSS handshake complete) before
 * promoting presence to `online`. Sandbox start alone is not sufficient.
 *
 * Live adapter: GET `{relay}/internal/instances/:id/owner` → `connected`.
 * Tests: {@link FakeRelayPresence}.
 *
 * Timeout / kill / recreate policy: see
 * docs/plans/0008-daytona-agent-sandboxes/relay-connected-wait.md
 */

/** Result of one connected check (no secrets). */
export type RelayConnectedStatus = {
  instance_id: string;
  connected: boolean;
};

/**
 * Minimal port: is the gateway for `instance_id` connected on Relay?
 * Implementations must not throw for "not connected"; only for hard failures
 * (network down may throw — orchestrator treats throw as not connected for
 * that poll unless the wait helper rethrows after deadline).
 */
export type RelayPresence = {
  /**
   * Return whether Relay currently has a connected (handshake-complete)
   * session for this permanent `instance_id` (not sandbox_id).
   */
  isConnected(instanceId: string): Promise<boolean>;
};

/** Default poll interval while waiting for Relay connect (ms). */
export const DEFAULT_RELAY_CONNECT_POLL_INTERVAL_MS = 250;

/**
 * Default per-attempt wait for Relay connected after sandbox Started.
 * Overall ensure_online still bounded by wait_timeout_ms (outer race).
 */
export const DEFAULT_RELAY_CONNECT_TIMEOUT_MS = 45_000;

/**
 * How many kill+recreate cycles after the first never-connect wait fails.
 * Policy: **one** recreate then fail (2 connect-wait attempts total).
 */
export const RELAY_CONNECT_RECREATE_ATTEMPTS = 1;

export type WaitForRelayConnectedOptions = {
  /** Max time to wait for this attempt (ms). */
  timeoutMs: number;
  /** Poll interval (ms). @default DEFAULT_RELAY_CONNECT_POLL_INTERVAL_MS */
  pollIntervalMs?: number;
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock (tests). */
  now?: () => number;
};

/**
 * Poll {@link RelayPresence.isConnected} until true or timeout.
 * Returns true when connected; false when timeout elapsed without connect.
 * Soft-fails individual poll throws until deadline; rethrows last error if
 * every poll threw and none returned a boolean false.
 */
export async function waitForRelayConnected(
  relay: RelayPresence,
  instanceId: string,
  options: WaitForRelayConnectedOptions,
): Promise<boolean> {
  const id = instanceId?.trim();
  if (!id) {
    return false;
  }
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_RELAY_CONNECT_TIMEOUT_MS;
  const pollIntervalMs =
    options.pollIntervalMs !== undefined && options.pollIntervalMs >= 0
      ? options.pollIntervalMs
      : DEFAULT_RELAY_CONNECT_POLL_INTERVAL_MS;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());

  const deadline = now() + timeoutMs;
  let lastError: unknown = null;
  let sawSoftDisconnect = false;

  while (now() < deadline) {
    try {
      if (await relay.isConnected(id)) {
        return true;
      }
      lastError = null;
      sawSoftDisconnect = true;
    } catch (err) {
      // Soft-fail a single poll (relay blip); keep waiting until deadline.
      lastError = err;
    }
    const remaining = deadline - now();
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(pollIntervalMs, remaining));
  }

  // Final check after deadline.
  try {
    if (await relay.isConnected(id)) {
      return true;
    }
    sawSoftDisconnect = true;
  } catch (err) {
    lastError = err;
  }

  // If the port only ever threw (API hard-down), surface the last error so
  // callers can distinguish never-connect vs relay-unreachable.
  if (lastError != null && !sawSoftDisconnect) {
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError));
  }
  return false;
}

/** Options for {@link FakeRelayPresence}. */
export type FakeRelayPresenceOptions = {
  /** Instance ids that start connected. */
  initiallyConnected?: Iterable<string>;
  /**
   * Fixed delay before isConnected returns (simulates slow poll).
   */
  defaultPollDelayMs?: number;
};

/**
 * In-memory Relay presence for unit tests (lp-rr5). No network.
 *
 * Control connect timing with {@link markConnected}, {@link markDisconnected},
 * {@link connectAfterMs}, or {@link connectAfterPolls}.
 */
export class FakeRelayPresence implements RelayPresence {
  private readonly connected = new Set<string>();
  private readonly connectAtMs = new Map<string, number>();
  /** Polls required before auto-connect (separate from method name). */
  private readonly pollsUntilConnect = new Map<string, number>();
  private readonly pollCounts = new Map<string, number>();
  private readonly pollDelayMs: number;
  private readonly now: () => number;
  private pollTotal = 0;
  private throwOnPoll: Error | string | null = null;

  constructor(
    options: FakeRelayPresenceOptions & { now?: () => number } = {},
  ) {
    for (const id of options.initiallyConnected ?? []) {
      this.connected.add(id);
    }
    this.pollDelayMs = Math.max(0, options.defaultPollDelayMs ?? 0);
    this.now = options.now ?? (() => Date.now());
  }

  /** Mark instance connected (simulates gateway WSS + handshake). */
  markConnected(instanceId: string): void {
    const id = instanceId.trim();
    this.connected.add(id);
    this.connectAtMs.delete(id);
    this.pollsUntilConnect.delete(id);
  }

  /** Mark instance disconnected. */
  markDisconnected(instanceId: string): void {
    const id = instanceId.trim();
    this.connected.delete(id);
    this.connectAtMs.delete(id);
    this.pollsUntilConnect.delete(id);
    this.pollCounts.delete(id);
  }

  /**
   * Auto-connect this instance after `ms` from now (wall clock via `now`).
   * Useful for "connects during wait" tests.
   */
  connectAfterMs(instanceId: string, ms: number): void {
    const id = instanceId.trim();
    this.connected.delete(id);
    this.connectAtMs.set(id, this.now() + Math.max(0, ms));
    this.pollsUntilConnect.delete(id);
  }

  /**
   * Auto-connect after `n` isConnected polls for this instance
   * (0 = first poll succeeds).
   */
  connectAfterPolls(instanceId: string, n: number): void {
    const id = instanceId.trim();
    this.connected.delete(id);
    this.connectAtMs.delete(id);
    this.pollsUntilConnect.set(id, Math.max(0, Math.floor(n)));
    this.pollCounts.set(id, 0);
  }

  /** Next isConnected call throws (simulates Relay API down). One-shot. */
  throwOnce(error: Error | string = "fake relay unavailable"): void {
    this.throwOnPoll = error;
  }

  /** Test helper: total isConnected calls. */
  getPollCount(): number {
    return this.pollTotal;
  }

  async isConnected(instanceId: string): Promise<boolean> {
    if (this.pollDelayMs > 0) {
      await new Promise<void>((r) => setTimeout(r, this.pollDelayMs));
    }
    this.pollTotal += 1;
    if (this.throwOnPoll != null) {
      const err = this.throwOnPoll;
      this.throwOnPoll = null;
      throw err instanceof Error ? err : new Error(err);
    }
    const id = instanceId.trim();

    const afterPolls = this.pollsUntilConnect.get(id);
    if (afterPolls !== undefined) {
      const count = (this.pollCounts.get(id) ?? 0) + 1;
      this.pollCounts.set(id, count);
      // connect after N polls means success on poll number N+1 (0 → first poll).
      if (count > afterPolls) {
        this.connected.add(id);
        this.pollsUntilConnect.delete(id);
      }
    }

    const at = this.connectAtMs.get(id);
    if (at !== undefined && this.now() >= at) {
      this.connected.add(id);
      this.connectAtMs.delete(id);
    }

    return this.connected.has(id);
  }
}

/** Options for HTTP Relay presence client. */
export type HttpRelayPresenceOptions = {
  /** Relay HTTP base URL (not WSS), e.g. http://relay:8787 */
  baseUrl: string;
  /** Value for x-relay-internal-token. */
  internalToken: string;
  /** Injectable fetch (tests). @default global fetch */
  fetchFn?: typeof fetch;
  /** Request timeout ms. @default 5_000 */
  requestTimeoutMs?: number;
};

const RELAY_INTERNAL_TOKEN_HEADER = "x-relay-internal-token";

/**
 * Live Relay presence via GET /internal/instances/:id/owner → connected.
 * No secrets in responses; token is only sent as header.
 */
export function createHttpRelayPresence(
  options: HttpRelayPresenceOptions,
): RelayPresence {
  const base = options.baseUrl.replace(/\/$/, "");
  const token = options.internalToken;
  const fetchFn = options.fetchFn ?? fetch;
  const requestTimeoutMs =
    options.requestTimeoutMs !== undefined && options.requestTimeoutMs > 0
      ? options.requestTimeoutMs
      : 5_000;

  return {
    async isConnected(instanceId: string): Promise<boolean> {
      const id = instanceId.trim();
      if (!id) return false;
      const url = `${base}/internal/instances/${encodeURIComponent(id)}/owner`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const res = await fetchFn(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            [RELAY_INTERNAL_TOKEN_HEADER]: token,
          },
          signal: controller.signal,
        });
        if (!res.ok) {
          // Treat non-OK as disconnected so wait can continue across blips.
          return false;
        }
        const body = (await res.json()) as { connected?: boolean };
        return Boolean(body.connected);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Type guard for injected ports. */
export function isRelayPresence(value: unknown): value is RelayPresence {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RelayPresence).isConnected === "function"
  );
}
