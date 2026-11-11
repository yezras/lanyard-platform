/**
 * Frozen 0017 InMemoryDaytona SLO harness (lp-vqr0.5 / T9).
 *
 * Hillclimb ruler for `time_to_agent_ready_ms` by product path. Fake clock,
 * InMemoryDaytona only. Changing {@link SLO_WAKE_PATHS} or
 * {@link SLO_LATENCY_BUCKETS} requires updating
 * docs/plans/0017-sandbox-first-chat-speed/testing.md.
 */

import type { DaytonaClient } from "./daytona-client.js";
import { InMemoryDaytonaClient } from "./in-memory-daytona-client.js";
import {
  createInMemoryOrchestratorInstanceStore,
  createInstanceOrchestrator,
  type InstanceOrchestratorDeps,
  type OrchestratorInstanceRecord,
} from "./instance-orchestrator.js";
import {
  createInMemoryWarmPool,
  replenishWarmPool,
  type WarmPool,
} from "./warm-pool.js";
import {
  ORCHESTRATOR_LATENCY_BUCKETS,
  OrchestratorMetrics,
  orchestratorLatencyBucket,
  type OrchestratorLatencyBucket,
  type OrchestratorWakePath,
} from "./orchestrator-metrics.js";

/**
 * Product wake paths the 0017 ruler records.
 * Distinct from the full orchestrator path catalog (archive_restore, joined, …).
 */
export const SLO_WAKE_PATHS = [
  "already_online",
  "start_from_stopped",
  "cold_create",
  "warm_pool",
] as const;

export type SloWakePath = (typeof SLO_WAKE_PATHS)[number];

/**
 * Histogram buckets for `time_to_agent_ready_ms`.
 * Same edges as {@link ORCHESTRATOR_LATENCY_BUCKETS} so the <5s start-from-stopped
 * stop and the 15s chat-POST budget stay one table.
 */
export const SLO_LATENCY_BUCKETS = ORCHESTRATOR_LATENCY_BUCKETS;

export type SloLatencyBucket = OrchestratorLatencyBucket;

/** Offline stop: InMemoryDaytona start_from_stopped Send < 5s on the fake clock. */
export const SLO_START_FROM_STOPPED_BUDGET_MS = 5_000;

/**
 * Programmed InMemoryDaytona costs charged by advancing the fake clock.
 * Numbers follow spike-bnd p50 (start 2.8s) and a cold create that is
 * distinguishable from start without sleeping real minutes.
 */
export const SLO_FAKE_COSTS_MS = {
  create: 15_000,
  start: 2_800,
} as const;

/** Repeats per path so the printed histogram has counts, not a single row. */
export const SLO_HARNESS_SAMPLES_PER_PATH = 3;

const SNAPSHOT = "snap-slo-agent-v1";

export class FakeClock {
  private ms: number;

  constructor(startMs = 1_700_000_000_000) {
    this.ms = startMs;
  }

  nowMs(): number {
    return this.ms;
  }

  now(): Date {
    return new Date(this.ms);
  }

  advance(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    this.ms += deltaMs;
  }
}

export type SloSample = {
  path: SloWakePath;
  time_to_agent_ready_ms: number;
  bucket: SloLatencyBucket;
  /** Path label the orchestrator actually emitted for this Send. */
  orchestrator_path: OrchestratorWakePath;
  create_count_on_send: number;
};

export type SloPathHistogram = {
  path: SloWakePath;
  n: number;
  p50: number;
  p95: number;
  buckets: Record<SloLatencyBucket, number>;
};

export type SloHarnessReport = {
  metric: "time_to_agent_ready_ms";
  clock: "fake";
  daytona: "fake";
  samples: SloSample[];
  by_path: Record<SloWakePath, SloPathHistogram>;
};

export function isSloWakePath(value: string): value is SloWakePath {
  return (SLO_WAKE_PATHS as readonly string[]).includes(value);
}

function emptyBuckets(): Record<SloLatencyBucket, number> {
  const out = {} as Record<SloLatencyBucket, number>;
  for (const b of SLO_LATENCY_BUCKETS) {
    out[b] = 0;
  }
  return out;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return Math.round(a + (b - a) * (idx - lo));
}

export function summarizeSloSamples(samples: SloSample[]): SloHarnessReport {
  const by_path = {} as Record<SloWakePath, SloPathHistogram>;
  for (const path of SLO_WAKE_PATHS) {
    const times = samples
      .filter((s) => s.path === path)
      .map((s) => s.time_to_agent_ready_ms)
      .sort((a, b) => a - b);
    const buckets = emptyBuckets();
    for (const ms of times) {
      const bucket = orchestratorLatencyBucket(ms);
      buckets[bucket] += 1;
    }
    by_path[path] = {
      path,
      n: times.length,
      p50: percentile(times, 50),
      p95: percentile(times, 95),
      buckets,
    };
  }
  return {
    metric: "time_to_agent_ready_ms",
    clock: "fake",
    daytona: "fake",
    samples,
    by_path,
  };
}

/**
 * T9 printer. Reviewers rerun the vitest that logs this string.
 */
export function formatSloHistogram(report: SloHarnessReport): string {
  const lines: string[] = [
    "# 0017 InMemoryDaytona SLO histogram (T9)",
    `# metric=${report.metric} clock=${report.clock} daytona=${report.daytona}`,
    `# buckets=${SLO_LATENCY_BUCKETS.join(" ")}`,
    "# Changing buckets requires updating docs/plans/0017-sandbox-first-chat-speed/testing.md",
    [
      "path".padEnd(20),
      "n".padStart(3),
      "p50".padStart(8),
      "p95".padStart(8),
      "histogram",
    ].join(" "),
  ];
  for (const path of SLO_WAKE_PATHS) {
    const row = report.by_path[path];
    const hist = SLO_LATENCY_BUCKETS.filter((b) => (row.buckets[b] ?? 0) > 0)
      .map((b) => `${b}:${row.buckets[b]}`)
      .join(",") || "-";
    lines.push(
      [
        path.padEnd(20),
        String(row.n).padStart(3),
        String(row.p50).padStart(8),
        String(row.p95).padStart(8),
        hist,
      ].join(" "),
    );
  }
  lines.push(
    `# SLO start_from_stopped p50 < ${SLO_START_FROM_STOPPED_BUDGET_MS}ms`,
  );
  return `${lines.join("\n")}\n`;
}

function clockedDaytona(
  inner: InMemoryDaytonaClient,
  clock: FakeClock,
): DaytonaClient {
  return {
    create: async (params) => {
      clock.advance(SLO_FAKE_COSTS_MS.create);
      return inner.create(params);
    },
    start: async (sandboxId) => {
      clock.advance(SLO_FAKE_COSTS_MS.start);
      return inner.start(sandboxId);
    },
    stop: (sandboxId) => inner.stop(sandboxId),
    archive: (sandboxId) => inner.archive(sandboxId),
    get: (sandboxId) => inner.get(sandboxId),
    list: (filter) => inner.list(filter),
  };
}

function seedRecord(
  instanceId: string,
  tenantId: string,
  overrides: Partial<OrchestratorInstanceRecord> = {},
): OrchestratorInstanceRecord {
  return {
    instance_id: instanceId,
    tenant_id: tenantId,
    runtime_kind: "daytona",
    presence: "offline",
    sandbox_id: null,
    agent_snapshot_id: SNAPSHOT,
    s3_vault_prefix: `tenants/${tenantId}/vault/`,
    last_activity_at: null,
    mid_turn: false,
    revoked_at: null,
    ...overrides,
  };
}

function idsFor(path: SloWakePath, sampleIndex: number): {
  instanceId: string;
  tenantId: string;
} {
  const seq = String(SLO_WAKE_PATHS.indexOf(path) * 10 + sampleIndex + 1).padStart(
    12,
    "0",
  );
  return {
    instanceId: `aaaaaaaa-aaaa-4000-8000-${seq}`,
    tenantId: `bbbbbbbb-bbbb-4000-8000-${seq}`,
  };
}

const ORCHESTRATOR_WAKE_PATHS: readonly OrchestratorWakePath[] = [
  "cold_create",
  "cold_create_env_expired",
  "start_from_stopped",
  "archive_restore",
  "warm_pool",
  "cold",
  "warm",
  "already_online",
  "joined",
  "ec2_short_circuit",
  "unknown",
];

function isOrchestratorWakePath(value: string): value is OrchestratorWakePath {
  return (ORCHESTRATOR_WAKE_PATHS as readonly string[]).includes(value);
}

function dominantWakePath(
  wakeByPath: Record<string, number>,
): OrchestratorWakePath {
  let best = "unknown";
  let n = -1;
  for (const [path, count] of Object.entries(wakeByPath)) {
    if (count > n) {
      best = path;
      n = count;
    }
  }
  return isOrchestratorWakePath(best) ? best : "unknown";
}

async function measureSend(input: {
  path: SloWakePath;
  sampleIndex: number;
  prepare?: (ctx: {
    fake: InMemoryDaytonaClient;
    store: ReturnType<typeof createInMemoryOrchestratorInstanceStore>;
    instanceId: string;
    pool: WarmPool;
  }) => Promise<void>;
  orchDeps?: Pick<
    InstanceOrchestratorDeps,
    "warmPoolEnabled" | "warmPool" | "scheduleWarmPoolReplenish"
  >;
}): Promise<SloSample> {
  const { instanceId, tenantId } = idsFor(input.path, input.sampleIndex);
  const clock = new FakeClock();
  const fake = new InMemoryDaytonaClient({
    defaultRegion: "us",
    now: () => clock.now(),
  });
  const store = createInMemoryOrchestratorInstanceStore([
    seedRecord(instanceId, tenantId),
  ]);
  const pool = input.orchDeps?.warmPool ?? createInMemoryWarmPool({ cap: 1 });
  if (input.prepare) {
    await input.prepare({ fake, store, instanceId, pool });
  }

  const metrics = new OrchestratorMetrics();
  const orch = createInstanceOrchestrator({
    daytona: clockedDaytona(fake, clock),
    instances: store,
    defaultSnapshotId: SNAPSHOT,
    defaultRegion: "us",
    metrics,
    now: () => clock.now(),
    ...input.orchDeps,
  });

  const createsBefore = fake.getCreateCount();
  const t0 = clock.nowMs();
  const result = await orch.ensureOnline(instanceId);
  const time_to_agent_ready_ms = clock.nowMs() - t0;
  if (result.presence !== "online") {
    throw new Error(
      `SLO harness ${input.path}: presence=${result.presence}, expected online`,
    );
  }
  return {
    path: input.path,
    time_to_agent_ready_ms,
    bucket: orchestratorLatencyBucket(time_to_agent_ready_ms),
    orchestrator_path: dominantWakePath(metrics.snapshot().wake_by_path),
    create_count_on_send: fake.getCreateCount() - createsBefore,
  };
}

async function sampleAlreadyOnline(sampleIndex: number): Promise<SloSample> {
  return measureSend({
    path: "already_online",
    sampleIndex,
    prepare: async ({ fake, store, instanceId }) => {
      const created = await fake.create({
        snapshotId: SNAPSHOT,
        labels: { instance_id: instanceId },
      });
      const rec = await store.get(instanceId);
      if (!rec) throw new Error("missing instance");
      store.seed({
        ...rec,
        presence: "online",
        sandbox_id: created.sandboxId,
      });
    },
  });
}

async function sampleStartFromStopped(sampleIndex: number): Promise<SloSample> {
  return measureSend({
    path: "start_from_stopped",
    sampleIndex,
    prepare: async ({ fake, store, instanceId }) => {
      const created = await fake.create({
        snapshotId: SNAPSHOT,
        labels: { instance_id: instanceId },
      });
      await fake.stop(created.sandboxId);
      const rec = await store.get(instanceId);
      if (!rec) throw new Error("missing instance");
      store.seed({
        ...rec,
        presence: "offline",
        sandbox_id: created.sandboxId,
      });
    },
  });
}

async function sampleColdCreate(sampleIndex: number): Promise<SloSample> {
  return measureSend({
    path: "cold_create",
    sampleIndex,
  });
}

async function sampleWarmPool(sampleIndex: number): Promise<SloSample> {
  const pool = createInMemoryWarmPool({ cap: 1 });
  const scheduled: Array<() => Promise<void>> = [];
  return measureSend({
    path: "warm_pool",
    sampleIndex,
    orchDeps: {
      warmPoolEnabled: true,
      warmPool: pool,
      scheduleWarmPoolReplenish: (task) => {
        scheduled.push(task);
      },
    },
    prepare: async ({ fake, pool: seeded }) => {
      await replenishWarmPool({
        daytona: fake,
        pool: seeded,
        snapshotId: SNAPSHOT,
        region: "us",
      });
    },
  });
}

/**
 * Drive InMemoryDaytona through the four frozen paths and return the histogram.
 * Warm-pool samples claim via the orchestrator (lp-vqr0.10), not a harness bind.
 */
export async function runSloHarness(options?: {
  samplesPerPath?: number;
}): Promise<SloHarnessReport> {
  const n = options?.samplesPerPath ?? SLO_HARNESS_SAMPLES_PER_PATH;
  const samples: SloSample[] = [];
  for (let i = 0; i < n; i += 1) {
    samples.push(await sampleAlreadyOnline(i));
    samples.push(await sampleStartFromStopped(i));
    samples.push(await sampleColdCreate(i));
    samples.push(await sampleWarmPool(i));
  }
  return summarizeSloSamples(samples);
}
