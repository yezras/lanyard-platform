/**
 * Product readiness is two independent flags (0017 / lp-vqr0.4 / T3).
 *
 * Presence `online` means `agent_ready` (Relay connected, or harness
 * reachable). `vault_writable` is Mountpoint first-write. Chat Send and
 * presence promotion must not wait on the vault flag. File tools may.
 *
 * Normative design:
 *   docs/plans/0017-sandbox-first-chat-speed/overview.md
 */

import type { InstancePresence } from "./types.js";

/** Closed pair: agent path vs vault path. Do not fold into one `online`. */
export type InstanceReadiness = {
  /** Guest Relay connected, or short-stack harness reachable. */
  agent_ready: boolean;
  /** Mountpoint accepted a write. File tools may wait; chat must not. */
  vault_writable: boolean;
};

/** Presence `online` is agent_ready. Other states are not. */
export function agentReadyFromPresence(
  presence: InstancePresence,
): boolean {
  return presence === "online";
}

/**
 * Parse a vault-writable flag from store / JSON / Postgres BOOLEAN.
 * Only explicit true (or 1) is writable. Missing / unknown is false.
 */
export function parseVaultWritable(value: unknown): boolean {
  return value === true || value === 1 || value === "true" || value === "t";
}

/** Build the two flags. Presence is the agent_ready source of truth. */
export function instanceReadiness(
  presence: InstancePresence,
  vaultWritable: unknown,
): InstanceReadiness {
  return {
    agent_ready: agentReadyFromPresence(presence),
    vault_writable: parseVaultWritable(vaultWritable),
  };
}

/**
 * Guest (or fake) Mountpoint write probe. Implementations must not throw for
 * "not writable"; only hard failures throw.
 */
export type VaultWritableProbe = {
  isWritable(instanceId: string): Promise<boolean>;
};

/** Default poll interval while waiting for vault writable (ms). */
export const DEFAULT_VAULT_WRITABLE_POLL_INTERVAL_MS = 250;

/**
 * Default wait for file-tool callers. Chat / ensure_online must not use this
 * budget. Mountpoint first-write can take minutes (lp-puzc).
 */
export const DEFAULT_VAULT_WRITABLE_TIMEOUT_MS = 120_000;

export type WaitUntilVaultWritableOptions = {
  /** Max time to wait (ms). */
  timeoutMs: number;
  /** Poll interval (ms). @default DEFAULT_VAULT_WRITABLE_POLL_INTERVAL_MS */
  pollIntervalMs?: number;
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock (tests). */
  now?: () => number;
};

export function isVaultWritableProbe(
  value: unknown,
): value is VaultWritableProbe {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as VaultWritableProbe).isWritable === "function"
  );
}

/**
 * Poll {@link VaultWritableProbe.isWritable} until true or timeout.
 * Returns true when writable; false when the deadline elapsed.
 * Soft-fails individual poll throws until deadline; rethrows last error if
 * every poll threw and none returned a boolean false.
 */
export async function waitUntilVaultWritable(
  probe: VaultWritableProbe,
  instanceId: string,
  options: WaitUntilVaultWritableOptions,
): Promise<boolean> {
  const id = instanceId?.trim();
  if (!id) {
    return false;
  }
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_VAULT_WRITABLE_TIMEOUT_MS;
  const pollIntervalMs =
    options.pollIntervalMs !== undefined && options.pollIntervalMs >= 0
      ? options.pollIntervalMs
      : DEFAULT_VAULT_WRITABLE_POLL_INTERVAL_MS;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());

  const deadline = now() + timeoutMs;
  let lastError: unknown = null;
  let sawSoftNotWritable = false;

  while (now() < deadline) {
    try {
      if (await probe.isWritable(id)) {
        return true;
      }
      lastError = null;
      sawSoftNotWritable = true;
    } catch (err) {
      lastError = err;
    }
    const remaining = deadline - now();
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(pollIntervalMs, remaining));
  }

  try {
    if (await probe.isWritable(id)) {
      return true;
    }
    sawSoftNotWritable = true;
  } catch (err) {
    lastError = err;
  }

  if (lastError != null && !sawSoftNotWritable) {
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError));
  }
  return false;
}

/** Options for {@link FakeVaultWritableProbe}. */
export type FakeVaultWritableProbeOptions = {
  /** Instance ids that start writable. */
  initiallyWritable?: Iterable<string>;
  /** Fixed delay before isWritable returns. */
  defaultPollDelayMs?: number;
};

/**
 * In-memory Mountpoint probe for unit tests (lp-vqr0.4). No S3 / FUSE.
 *
 * Default is not writable so T3 can prove presence online without a write.
 */
export class FakeVaultWritableProbe implements VaultWritableProbe {
  private readonly writable = new Set<string>();
  private readonly pollsUntilWritable = new Map<string, number>();
  private readonly pollCounts = new Map<string, number>();
  private readonly pollDelayMs: number;
  private pollTotal = 0;
  private throwOnPoll: Error | string | null = null;

  constructor(options: FakeVaultWritableProbeOptions = {}) {
    for (const id of options.initiallyWritable ?? []) {
      this.writable.add(id);
    }
    this.pollDelayMs = Math.max(0, options.defaultPollDelayMs ?? 0);
  }

  markWritable(instanceId: string): void {
    const id = instanceId.trim();
    this.writable.add(id);
    this.pollsUntilWritable.delete(id);
  }

  markNotWritable(instanceId: string): void {
    const id = instanceId.trim();
    this.writable.delete(id);
    this.pollsUntilWritable.delete(id);
    this.pollCounts.delete(id);
  }

  /** Become writable after `polls` isWritable calls for this id. */
  writableAfterPolls(instanceId: string, polls: number): void {
    const id = instanceId.trim();
    this.writable.delete(id);
    this.pollsUntilWritable.set(id, Math.max(0, polls));
    this.pollCounts.set(id, 0);
  }

  getPollCount(): number {
    return this.pollTotal;
  }

  throwNext(err: Error | string): void {
    this.throwOnPoll = err;
  }

  async isWritable(instanceId: string): Promise<boolean> {
    const id = instanceId.trim();
    this.pollTotal += 1;
    if (this.pollDelayMs > 0) {
      await new Promise<void>((r) => setTimeout(r, this.pollDelayMs));
    }
    if (this.throwOnPoll) {
      const err = this.throwOnPoll;
      this.throwOnPoll = null;
      throw err instanceof Error ? err : new Error(err);
    }
    const until = this.pollsUntilWritable.get(id);
    if (until !== undefined) {
      const n = (this.pollCounts.get(id) ?? 0) + 1;
      this.pollCounts.set(id, n);
      if (n >= until) {
        this.writable.add(id);
        this.pollsUntilWritable.delete(id);
      }
    }
    return this.writable.has(id);
  }
}
