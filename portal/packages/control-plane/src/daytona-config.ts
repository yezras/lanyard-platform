/**
 * Control Plane configuration for the managed Daytona client (lp-k8n).
 *
 * Platform-only keys for the Instance Orchestrator → Daytona managed API path.
 * Tenants and the agent guest **never** receive these values (overview §4.3 / §4.11,
 * gateway-env-contract.md).
 *
 * Secrets follow the existing CP pattern: env / deploy secret store / SSM —
 * never committed to git. Values are never emitted in logs (G2b.2).
 *
 * Offline track: schema + loader + unit tests only. No live Daytona calls.
 * `DAYTONA_ENABLED` defaults **off** so EC2-only boots stay unchanged.
 *
 * Env catalog (document only — values never in repo):
 * - DAYTONA_ENABLED              — opt-in flag (1|true|yes|on); default off
 * - DAYTONA_API_KEY              — org API key (secret)
 * - DAYTONA_ORG_ID               — Daytona organization id
 * - DAYTONA_REGION               — default region for sandbox create
 * - DAYTONA_DEFAULT_SNAPSHOT     — platform default agent snapshot pin
 *                                  (offline placeholder ok; see lp-kng.2.7)
 * - DAYTONA_TENANT_ALLOWLIST     — comma-separated tenant_id allowlist
 * - DAYTONA_DOMAIN_ALLOWLIST     — comma-separated create-time egress hosts
 *                                  (Daytona `domainAllowList`; lp-ccp). Empty =
 *                                  fail-closed (omit field; no extra egress).
 * - DAYTONA_WEBHOOK_SECRET       — HMAC secret for POST /webhooks/daytona (lp-04r)
 * - DAYTONA_AUTO_STOP_INTERVAL_MINUTES — vendor autoStop safety net (lp-4f2);
 *                                  default 90 (above 10m reaper + 45m mid-turn)
 * - DAYTONA_WARM_POOL_ENABLED      — optional warm pool claim on cold path
 *                                  (lp-6bg stub; lp-vqr0.10 claim+replenish).
 *                                  Default off. Do not enable against the paid
 *                                  org from CI. Tests use real harness only.
 * - DAYTONA_WARM_POOL_TENANT_ALLOWLIST — comma-separated premium tenants for warm
 *                                  pool when enabled (empty = all tenants)
 * - DAYTONA_WARM_POOL_SIZE         — in-process pool cap (lp-vqr0.10). Default 2.
 *                                  MockLab spend ceiling is 2; values clamp to 0–2.
 * - DAYTONA_ARCHIVE_RESTORE_ON_WAKE — when bound sandbox is archived, try start
 *                                  restore before cold create (lp-6bg; default off)
 * - DAYTONA_RETAIN_SANDBOX_ON_STOP — keep sandbox_id after stop for start-from-stopped
 *                                  re-wake (lp-6bg; default on)
 *
 * Snapshot pin convention: docs/plans/0008-daytona-agent-sandboxes/agent-snapshot-pin.md
 * (`lp-kng.2.7`). Live image → ECR → Daytona snapshot → pin: Phase 2 `lp-4xa` /
 * `lp-1wa` / `lp-i7s`.
 *
 * Vendor autoStop policy: docs/plans/0008-daytona-agent-sandboxes/daytona-autostop-safety-net.md
 * (`lp-4f2`).
 * Wake strategy / warm pool: docs/plans/0008-daytona-agent-sandboxes/warm-pool-snapshot-wake.md
 * (`lp-6bg` stub, `lp-vqr0.10` claim + replenish).
 *
 * Production network allowlist (Relay, model APIs, S3, registries):
 * docs/plans/0008-daytona-agent-sandboxes/production-network-allowlist.md (`lp-ccp`).
 *
 * Rotation (API key): mint new key in Daytona console, dual-write to CP task
 * env / SSM SecureString, redeploy CP, retire old key. Never log the value.
 *
 * Rotation (webhook secret): mint in Daytona webhook endpoint settings, dual-write
 * to CP env / secrets store, redeploy CP. Never log the value.
 */

import {
  clampWarmPoolSize,
  DEFAULT_WARM_POOL_SIZE,
} from "./warm-pool.js";

/** Env var names (stable public contract for deploy / docs). */
export const DAYTONA_ENV = {
  enabled: "DAYTONA_ENABLED",
  apiKey: "DAYTONA_API_KEY",
  orgId: "DAYTONA_ORG_ID",
  region: "DAYTONA_REGION",
  defaultSnapshot: "DAYTONA_DEFAULT_SNAPSHOT",
  tenantAllowlist: "DAYTONA_TENANT_ALLOWLIST",
  /**
   * Create-time Daytona sandbox egress allowlist (lp-ccp).
   * Comma-separated hostnames / domain patterns for `domainAllowList`.
   * Empty = fail-closed (no extra egress granted by CP).
   */
  domainAllowList: "DAYTONA_DOMAIN_ALLOWLIST",
  /** Shared HMAC secret for webhook receiver (lp-04r). Optional until webhooks used. */
  webhookSecret: "DAYTONA_WEBHOOK_SECRET",
  /**
   * Create-time Daytona `autoStopInterval` in minutes (lp-4f2).
   * Vendor safety net above the CP idle reaper — not the primary stop path.
   */
  autoStopIntervalMinutes: "DAYTONA_AUTO_STOP_INTERVAL_MINUTES",
  /**
   * Optional warm pool on cold ensure_online (lp-6bg / lp-vqr0.10). Default off.
   * When on, claim a pre-created stopped id then start. Miss still cold_create.
   */
  warmPoolEnabled: "DAYTONA_WARM_POOL_ENABLED",
  /** Comma-separated tenant ids allowed to attempt warm pool (premium stub). */
  warmPoolTenantAllowlist: "DAYTONA_WARM_POOL_TENANT_ALLOWLIST",
  /**
   * In-process pool cap (lp-vqr0.10). Default 2. MockLab ceiling 2.
   */
  warmPoolSize: "DAYTONA_WARM_POOL_SIZE",
  /**
   * When bound sandbox is archived, try restore via start before cold create
   * (lp-6bg). Default off — archive is extended-idle cost tier only.
   */
  archiveRestoreOnWake: "DAYTONA_ARCHIVE_RESTORE_ON_WAKE",
  /**
   * Retain sandbox_id after idle/explicit stop for start-from-stopped re-wake
   * (lp-6bg / spike-bnd). Default on (`1` / unset). Set `0|false|no|off` to clear.
   */
  retainSandboxOnStop: "DAYTONA_RETAIN_SANDBOX_ON_STOP",
} as const;

/**
 * Default Daytona vendor auto-stop interval (minutes) on sandbox create (lp-4f2).
 *
 * Ordering (must hold):
 *   idle reaper grace (10m) < mid-turn max hold (45m) < **vendor autoStop (90m)**
 *
 * Primary cost control is the CP idle reaper (`DEFAULT_IDLE_GRACE_MS` = 10m).
 * Vendor autoStop only fires if the orchestrator is down or fails to stop.
 * Setting this **below** mid-turn max hold risks killing an open WSS mid-turn.
 */
export const DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES = 90;

/**
 * Canonical offline placeholder for `DAYTONA_DEFAULT_SNAPSHOT` /
 * `agent_snapshot_id` until Phase 2 registers a real Daytona snapshot
 * (`lp-1wa`). Fake client accepts this string as-is; live create will not
 * resolve it in a real org.
 *
 * Normative doc: agent-snapshot-pin.md (`lp-kng.2.7`).
 */
export const OFFLINE_AGENT_SNAPSHOT_PLACEHOLDER = "offline:agent-default";

/** Max length for snapshot pins (matches CP HTTP/registry field). */
export const AGENT_SNAPSHOT_ID_MAX_LENGTH = 256;

/**
 * Resolved Daytona platform config. `apiKey` is secret material — pass only
 * into the Daytona client constructor; never into logs or audit metadata.
 */
export type DaytonaConfig = {
  /**
   * When false, orchestrator must not call managed Daytona APIs.
   * Default false (fail-closed / gated).
   */
  enabled: boolean;
  /** Org API key for Daytona managed CP. Empty when unset. */
  apiKey: string;
  /** Daytona organization id. */
  orgId: string;
  /** Default region for sandbox create/start. */
  region: string;
  /**
   * Platform default agent snapshot pin when instance.agent_snapshot_id is null.
   * Offline: placeholder string ok (`OFFLINE_AGENT_SNAPSHOT_PLACEHOLDER`).
   * Live: Daytona snapshot id from image pipeline (`lp-4xa` / `lp-1wa`).
   * Convention: agent-snapshot-pin.md (`lp-kng.2.7`).
   */
  defaultSnapshotId: string;
  /**
   * Tenant ids allowed to use runtime_kind=daytona / ensure_online.
   * Empty list = deny all (fail closed) when enabled.
   */
  tenantAllowlist: readonly string[];
  /**
   * Create-time sandbox egress hosts for Daytona `domainAllowList` (lp-ccp).
   * Empty = fail-closed: omit field on create (no Lanyard-granted open egress).
   * Production set: Relay, model APIs, S3, registries — see
   * production-network-allowlist.md.
   */
  domainAllowList: readonly string[];
  /**
   * Create-time Daytona `autoStopInterval` in **minutes** (lp-4f2).
   * Safety net above CP idle reaper; default
   * {@link DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES} (90).
   * `0` disables vendor auto-stop when the API accepts it (not recommended
   * for pilot — removes the CP-down safety net).
   */
  autoStopIntervalMinutes: number;
  /**
   * Optional warm pool claim on cold wake path (lp-6bg / lp-vqr0.10).
   * Default false. When true, orchestrator claims from the in-process pool.
   */
  warmPoolEnabled: boolean;
  /**
   * Premium / flagged tenants allowed to attempt warm pool (lp-6bg).
   * Empty + warmPoolEnabled → all tenants may attempt.
   */
  warmPoolTenantAllowlist: readonly string[];
  /**
   * In-process pool cap (lp-vqr0.10). Clamped to 0–2 (MockLab spend).
   * Default 2 (`DEFAULT_WARM_POOL_SIZE`).
   */
  warmPoolSize: number;
  /**
   * Try archive restore (start while archived) before cold create (lp-6bg).
   * Default false.
   */
  archiveRestoreOnWake: boolean;
  /**
   * Retain sandbox_id after stop for start-from-stopped re-wake (lp-6bg).
   * Default true.
   */
  retainSandboxOnStop: boolean;
};

/** Non-secret startup / ops summary — safe for structured logs. */
export type DaytonaConfigLogSummary = {
  daytona_enabled: boolean;
  daytona_api_key: "configured" | "missing";
  daytona_org_id: "configured" | "missing";
  daytona_region: string | null;
  daytona_default_snapshot: "configured" | "missing";
  daytona_allowlist_count: number;
  /** Count of create-time egress hosts (lp-ccp); never the host list. */
  daytona_domain_allowlist_count: number;
  daytona_ready: boolean;
  /** Resolved vendor autoStop minutes (lp-4f2); never secret. */
  daytona_auto_stop_interval_minutes: number;
  /** lp-vqr0.10 warm pool flag (in-process claim; live org enable residual). */
  daytona_warm_pool_enabled: boolean;
  daytona_warm_pool_tenant_allowlist_count: number;
  /** Clamped MockLab cap (1–2). */
  daytona_warm_pool_size: number;
  daytona_archive_restore_on_wake: boolean;
  daytona_retain_sandbox_on_stop: boolean;
};

export class DaytonaConfigError extends Error {
  readonly code = "DAYTONA_CONFIG_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "DaytonaConfigError";
  }
}

/** Parse truthy env flag; empty/unset → false (fail-closed default). */
export function parseEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Parse retain-sandbox-on-stop env (lp-6bg). Unset → true (spike-bnd default).
 * Explicit falsy (`0|false|no|off`) → false.
 */
export function parseRetainSandboxOnStopEnv(
  value: string | undefined,
): boolean {
  if (value === undefined || value.trim() === "") return true;
  const v = value.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

/**
 * True when this process should enforce complete Daytona keys on enable.
 * Test / Vitest environments are exempt so unit tests can exercise partial
 * shapes without real secrets.
 */
export function isDaytonaFailClosedEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === "test") {
    return false;
  }
  const vitest = env.VITEST?.trim().toLowerCase();
  if (vitest === "true" || vitest === "1") {
    return false;
  }
  return true;
}

function parseAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Max length for a single domainAllowList entry (hostname / pattern).
 * Keeps mis-set env blobs from becoming multi-KB create bodies.
 */
export const DAYTONA_DOMAIN_ALLOWLIST_ENTRY_MAX_LENGTH = 253;

/**
 * Structural check for one create-time egress host / domain pattern (lp-ccp).
 *
 * Accepts exact hostnames and limited wildcards used by spikes
 * (e.g. `*.s3.amazonaws.com`, `*.dkr.ecr.us-east-1.amazonaws.com`).
 * Rejects open-world `"*"`, protocols, paths, spaces, and empty entries.
 * Does **not** contact DNS or Daytona.
 */
export function isValidDaytonaDomainAllowListEntry(
  entry: string | null | undefined,
): boolean {
  if (entry == null) return false;
  const host = entry.trim().toLowerCase();
  if (!host) return false;
  if (host.length > DAYTONA_DOMAIN_ALLOWLIST_ENTRY_MAX_LENGTH) return false;
  // Never allow fully open egress via a single-star token.
  if (host === "*") return false;
  // No scheme / path / port / userinfo — hostnames only.
  if (/[:/\s?#@[\]]/.test(host)) return false;
  // Wildcard only as a single left-most label: *.example.com
  if (host.includes("*")) {
    if (!/^\*\.([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host)) {
      return false;
    }
    return true;
  }
  // Hostname: labels + TLD (or multi-label like s3.amazonaws.com).
  // Also allow bare service hosts without forcing a public suffix list.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) {
    return false;
  }
  return true;
}

/**
 * Parse `DAYTONA_DOMAIN_ALLOWLIST` (comma-separated hosts) for create-time
 * Daytona `domainAllowList` (lp-ccp).
 *
 * Fail-closed shape:
 * - Empty / unset → `[]` (omit field on create; no Lanyard-granted egress)
 * - Invalid entries throw {@link DaytonaConfigError} (names the bad token only)
 * - Dedupes case-insensitively; normalizes to lowercase
 * - Rejects open-world `"*"` so operators cannot accidentally open all egress
 *
 * Pure; no I/O.
 */
export function parseDaytonaDomainAllowList(
  raw: string | undefined,
): string[] {
  if (!raw?.trim()) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  const invalid: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const host = trimmed.toLowerCase();
    if (!isValidDaytonaDomainAllowListEntry(host)) {
      // Keep a short, non-secret token for the error (truncate long blobs).
      invalid.push(
        trimmed.length > 64 ? `${trimmed.slice(0, 64)}…` : trimmed,
      );
      continue;
    }
    if (seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  if (invalid.length > 0) {
    throw new DaytonaConfigError(
      `Invalid ${DAYTONA_ENV.domainAllowList} entr${invalid.length === 1 ? "y" : "ies"}: ${invalid.join(", ")}. ` +
        `Use comma-separated hostnames or *.suffix patterns only (no schemes, paths, or bare *). ` +
        `See production-network-allowlist.md (lp-ccp).`,
    );
  }
  return out;
}

/**
 * Format domain allowlist for Daytona create body `domainAllowList`.
 * Returns `undefined` when empty so the SDK **omits** the field (fail-closed;
 * no open-world default).
 */
export function formatDaytonaDomainAllowList(
  domains: readonly string[] | null | undefined,
): string | undefined {
  if (!domains || domains.length === 0) {
    return undefined;
  }
  const joined = domains
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
    .join(",");
  return joined || undefined;
}

/**
 * LA `web_search` provider hosts for Daytona Tier-1 `domainAllowList` (lp-zuh.10.1).
 *
 * Source of truth: Lanyard Agent `packages/agent-core/src/tools/web-search.ts`
 * (lp-uxy.21.3). Provider selection (auto):
 * 1. Tavily when `TAVILY_API_KEY`
 * 2. Brave when `BRAVE_API_KEY` / `BRAVE_SEARCH_API_KEY`
 * 3. Firecrawl search when `FIRECRAWL_API_KEY` (cost-gated)
 * 4. else free DuckDuckGo HTML scrape (MockLab default)
 *
 * These are **provider API / SERP hosts only** — not open-world result-page
 * hosts. Append to Relay + model + S3 catalog; do not replace them.
 *
 * Catalog (not auto-injected): operators merge into `DAYTONA_DOMAIN_ALLOWLIST`
 * via CP env / SM. Empty allowlist still fail-closed.
 *
 * @see docs/plans/0008-daytona-agent-sandboxes/production-network-allowlist.md §6
 * @see docs/architecture/portal-web-search-firecrawl.md
 */
export const DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST = [
  /** Default free SERP (no key). GET https://html.duckduckgo.com/html/?q=… */
  "html.duckduckgo.com",
  /** DDG redirect host in result hrefs (`//duckduckgo.com/l/?uddg=…`). */
  "duckduckgo.com",
  /** Optional paid SERP — POST https://api.tavily.com/search */
  "api.tavily.com",
  /** Optional Brave Search — GET https://api.search.brave.com/res/v1/web/search */
  "api.search.brave.com",
  /** Optional Firecrawl search — POST https://api.firecrawl.dev/v1/search */
  "api.firecrawl.dev",
] as const;

/**
 * Merge web-search catalog hosts into an existing domain allowlist (dedupe,
 * lowercase). Pure helper for operators / tests — does **not** open egress by
 * default; callers must still set `DAYTONA_DOMAIN_ALLOWLIST` on CP.
 */
export function mergeDaytonaWebSearchDomainAllowList(
  existing: readonly string[] | null | undefined,
  extras: readonly string[] = DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of [...(existing ?? []), ...extras]) {
    const host = entry.trim().toLowerCase();
    if (!host || seen.has(host)) continue;
    if (!isValidDaytonaDomainAllowListEntry(host)) {
      throw new DaytonaConfigError(
        `Invalid web-search domainAllowList entry: ${host.slice(0, 64)}. ` +
          `See DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST (lp-zuh.10.1).`,
      );
    }
    seen.add(host);
    out.push(host);
  }
  return out;
}

/**
 * Parse optional non-negative integer env. Invalid / empty → undefined.
 * Used for `DAYTONA_AUTO_STOP_INTERVAL_MINUTES` (lp-4f2).
 */
export function parseNonNegativeIntEnv(
  value: string | undefined,
): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value.trim());
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

/**
 * Resolve create-time Daytona autoStop interval (minutes) from env (lp-4f2).
 * Unset / invalid → {@link DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES} (90).
 * Pure; no I/O.
 */
export function resolveDaytonaAutoStopIntervalMinutes(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return (
    parseNonNegativeIntEnv(env[DAYTONA_ENV.autoStopIntervalMinutes]) ??
    DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES
  );
}

/**
 * Resolve in-process warm pool cap (lp-vqr0.10). Unset / invalid → 2.
 * Clamped to 0–2 so MockLab cannot pre-create more than two boxes.
 */
export function resolveWarmPoolSize(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = parseNonNegativeIntEnv(env[DAYTONA_ENV.warmPoolSize]);
  if (parsed === undefined) return DEFAULT_WARM_POOL_SIZE;
  return clampWarmPoolSize(parsed);
}

/**
 * Load Daytona config from env (or a test map). Pure; does not log.
 *
 * When `enabled` is true and the process is a non-test env, missing required
 * keys throw {@link DaytonaConfigError} (fail closed). When disabled, missing
 * keys are allowed so EC2-only and offline boots stay unchanged.
 */
export function loadDaytonaConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { failClosed?: boolean } = {},
): DaytonaConfig {
  const enabled = parseEnvFlag(env[DAYTONA_ENV.enabled]);
  const config: DaytonaConfig = {
    enabled,
    apiKey: env[DAYTONA_ENV.apiKey]?.trim() ?? "",
    orgId: env[DAYTONA_ENV.orgId]?.trim() ?? "",
    region: env[DAYTONA_ENV.region]?.trim() ?? "",
    defaultSnapshotId: env[DAYTONA_ENV.defaultSnapshot]?.trim() ?? "",
    tenantAllowlist: parseAllowlist(env[DAYTONA_ENV.tenantAllowlist]),
    // lp-ccp: create-time egress hosts; empty = omit field (fail-closed).
    domainAllowList: parseDaytonaDomainAllowList(
      env[DAYTONA_ENV.domainAllowList],
    ),
    autoStopIntervalMinutes: resolveDaytonaAutoStopIntervalMinutes(env),
    warmPoolEnabled: parseEnvFlag(env[DAYTONA_ENV.warmPoolEnabled]),
    warmPoolTenantAllowlist: parseAllowlist(
      env[DAYTONA_ENV.warmPoolTenantAllowlist],
    ),
    warmPoolSize: resolveWarmPoolSize(env),
    archiveRestoreOnWake: parseEnvFlag(env[DAYTONA_ENV.archiveRestoreOnWake]),
    retainSandboxOnStop: parseRetainSandboxOnStopEnv(
      env[DAYTONA_ENV.retainSandboxOnStop],
    ),
  };

  const failClosed =
    options.failClosed !== undefined
      ? options.failClosed
      : isDaytonaFailClosedEnv(env);

  if (enabled && failClosed) {
    assertDaytonaConfigReady(config);
  }

  return config;
}

/**
 * Required fields for a live (or fake-backed) managed client when Daytona is
 * enabled. Does not check allowlist non-empty here — empty allowlist is a
 * deliberate fail-closed product posture (no tenants wake).
 */
export function daytonaConfigMissingKeys(config: DaytonaConfig): string[] {
  const missing: string[] = [];
  if (!config.apiKey) missing.push(DAYTONA_ENV.apiKey);
  if (!config.orgId) missing.push(DAYTONA_ENV.orgId);
  if (!config.region) missing.push(DAYTONA_ENV.region);
  if (!config.defaultSnapshotId) missing.push(DAYTONA_ENV.defaultSnapshot);
  return missing;
}

/** True when api key, org, region, and default snapshot are all present. */
export function isDaytonaConfigReady(config: DaytonaConfig): boolean {
  return daytonaConfigMissingKeys(config).length === 0;
}

/**
 * Fail closed: throw if required managed-client keys are missing.
 * Error messages name env vars only — never include secret values.
 */
export function assertDaytonaConfigReady(
  config: DaytonaConfig,
): asserts config is DaytonaConfig {
  const missing = daytonaConfigMissingKeys(config);
  if (missing.length > 0) {
    throw new DaytonaConfigError(
      `Daytona is enabled but required config is missing: ${missing.join(", ")}. ` +
        `Set these via env / secrets store (never commit values).`,
    );
  }
}

/**
 * Allowlist gate for tenant-scoped Daytona path. Empty allowlist → deny all
 * when enabled (fail closed). When disabled, returns false (path off).
 */
export function isTenantOnDaytonaAllowlist(
  config: DaytonaConfig,
  tenantId: string,
): boolean {
  if (!config.enabled) {
    return false;
  }
  const id = tenantId.trim();
  if (!id) {
    return false;
  }
  return config.tenantAllowlist.includes(id);
}

/**
 * True when the pin uses the Lanyard offline placeholder prefix (`offline:`).
 * Offline unit tests and fakes treat these as valid; live Daytona create will
 * not find them until Phase 2 replaces env pins with real snapshot ids.
 */
export function isOfflineAgentSnapshotPlaceholder(
  snapshotId: string | null | undefined,
): boolean {
  const id = snapshotId?.trim() ?? "";
  return id.startsWith("offline:");
}

/**
 * Structural check for a snapshot pin (platform default or instance field).
 * Does **not** verify the pin exists in Daytona (offline-safe).
 *
 * Rules (agent-snapshot-pin.md): non-empty after trim, ≤ 256 chars, no
 * newlines/control separators. Empty/whitespace → invalid.
 */
export function isValidAgentSnapshotPinShape(
  snapshotId: string | null | undefined,
): boolean {
  if (snapshotId == null) {
    return false;
  }
  const id = snapshotId.trim();
  if (!id || id.length > AGENT_SNAPSHOT_ID_MAX_LENGTH) {
    return false;
  }
  // Reject embedded newlines / other C0 controls (opaque but single-line).
  if (/[\u0000-\u001f\u007f]/.test(id)) {
    return false;
  }
  return true;
}

/**
 * Resolve snapshot pin: per-instance override, else platform default.
 * Returns null only when both are empty (caller should fail closed before create).
 *
 * Offline placeholders (`offline:…`) are valid resolved pins for fake clients.
 */
export function resolveAgentSnapshotId(
  config: DaytonaConfig,
  instanceSnapshotId: string | null | undefined,
): string | null {
  const fromInstance = instanceSnapshotId?.trim();
  if (fromInstance) {
    return fromInstance;
  }
  const fromDefault = config.defaultSnapshotId.trim();
  return fromDefault || null;
}

/**
 * Safe structured fields for logs / health. Never includes apiKey or raw
 * allowlist contents that could leak tenant inventory beyond a count.
 * Domain allowlist is count-only (lp-ccp) — host list is ops config, not secret,
 * but keep boot logs compact and avoid dumping full egress inventory.
 */
export function daytonaConfigLogSummary(
  config: DaytonaConfig,
): DaytonaConfigLogSummary {
  return {
    daytona_enabled: config.enabled,
    daytona_api_key: config.apiKey ? "configured" : "missing",
    daytona_org_id: config.orgId ? "configured" : "missing",
    daytona_region: config.region || null,
    daytona_default_snapshot: config.defaultSnapshotId
      ? "configured"
      : "missing",
    daytona_allowlist_count: config.tenantAllowlist.length,
    daytona_domain_allowlist_count: config.domainAllowList.length,
    daytona_ready: isDaytonaConfigReady(config),
    daytona_auto_stop_interval_minutes: config.autoStopIntervalMinutes,
    daytona_warm_pool_enabled: config.warmPoolEnabled,
    daytona_warm_pool_tenant_allowlist_count:
      config.warmPoolTenantAllowlist.length,
    daytona_warm_pool_size: config.warmPoolSize,
    daytona_archive_restore_on_wake: config.archiveRestoreOnWake,
    daytona_retain_sandbox_on_stop: config.retainSandboxOnStop,
  };
}
