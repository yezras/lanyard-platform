/**
 * lp-k8n — CP Daytona config schema loader (offline).
 * No live Daytona / AWS / secrets store required.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { isSecretKey, redactForLog } from "@lanyard/shared";

import {
  AGENT_SNAPSHOT_ID_MAX_LENGTH,
  assertDaytonaConfigReady,
  DAYTONA_DOMAIN_ALLOWLIST_ENTRY_MAX_LENGTH,
  DAYTONA_ENV,
  DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST,
  DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES,
  daytonaConfigLogSummary,
  daytonaConfigMissingKeys,
  DaytonaConfigError,
  formatDaytonaDomainAllowList,
  isDaytonaConfigReady,
  isDaytonaFailClosedEnv,
  isOfflineAgentSnapshotPlaceholder,
  isTenantOnDaytonaAllowlist,
  isValidAgentSnapshotPinShape,
  isValidDaytonaDomainAllowListEntry,
  loadDaytonaConfig,
  mergeDaytonaWebSearchDomainAllowList,
  OFFLINE_AGENT_SNAPSHOT_PLACEHOLDER,
  parseDaytonaDomainAllowList,
  parseEnvFlag,
  parseNonNegativeIntEnv,
  resolveAgentSnapshotId,
  resolveDaytonaAutoStopIntervalMinutes,
  resolveWarmPoolSize,
  type DaytonaConfig,
} from "../src/daytona-config.js";
import {
  DEFAULT_IDLE_GRACE_MS,
  DEFAULT_MID_TURN_MAX_HOLD_MS,
} from "../src/instance-orchestrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configSrc = readFileSync(
  join(__dirname, "../src/daytona-config.ts"),
  "utf8",
);
const serverSrc = readFileSync(join(__dirname, "../src/server.ts"), "utf8");
const indexSrc = readFileSync(join(__dirname, "../src/index.ts"), "utf8");

const FULL_ENV: NodeJS.ProcessEnv = {
  DAYTONA_ENABLED: "1",
  DAYTONA_API_KEY: "super-secret-daytona-key-do-not-log",
  DAYTONA_ORG_ID: "org_test_123",
  DAYTONA_REGION: "us",
  DAYTONA_DEFAULT_SNAPSHOT: "snap-agent-v1",
  DAYTONA_TENANT_ALLOWLIST: "tenant-a, tenant-b, tenant-a",
  DAYTONA_DOMAIN_ALLOWLIST:
    "relay.withlanyard.com, api.openai.com, api.x.ai, s3.amazonaws.com",
};

describe("DAYTONA_ENV catalog (lp-k8n + lp-ccp)", () => {
  it("documents the config keys + enable flag + autoStop + domain allowlist", () => {
    expect(DAYTONA_ENV.apiKey).toBe("DAYTONA_API_KEY");
    expect(DAYTONA_ENV.orgId).toBe("DAYTONA_ORG_ID");
    expect(DAYTONA_ENV.region).toBe("DAYTONA_REGION");
    expect(DAYTONA_ENV.defaultSnapshot).toBe("DAYTONA_DEFAULT_SNAPSHOT");
    expect(DAYTONA_ENV.tenantAllowlist).toBe("DAYTONA_TENANT_ALLOWLIST");
    expect(DAYTONA_ENV.domainAllowList).toBe("DAYTONA_DOMAIN_ALLOWLIST");
    expect(DAYTONA_ENV.enabled).toBe("DAYTONA_ENABLED");
    expect(DAYTONA_ENV.autoStopIntervalMinutes).toBe(
      "DAYTONA_AUTO_STOP_INTERVAL_MINUTES",
    );
    // lp-6bg warm path / pool flags
    expect(DAYTONA_ENV.warmPoolEnabled).toBe("DAYTONA_WARM_POOL_ENABLED");
    expect(DAYTONA_ENV.warmPoolTenantAllowlist).toBe(
      "DAYTONA_WARM_POOL_TENANT_ALLOWLIST",
    );
    expect(DAYTONA_ENV.warmPoolSize).toBe("DAYTONA_WARM_POOL_SIZE");
    expect(DAYTONA_ENV.archiveRestoreOnWake).toBe(
      "DAYTONA_ARCHIVE_RESTORE_ON_WAKE",
    );
    expect(DAYTONA_ENV.retainSandboxOnStop).toBe(
      "DAYTONA_RETAIN_SANDBOX_ON_STOP",
    );
  });

  it("source documents secrets pattern, offline scope, and domain allowlist", () => {
    expect(configSrc).toContain("DAYTONA_API_KEY");
    expect(configSrc).toContain("DAYTONA_DOMAIN_ALLOWLIST");
    expect(configSrc).toContain("never committed");
    expect(configSrc).toContain("Never log");
    expect(configSrc).toContain("lp-k8n");
    expect(configSrc).toContain("lp-ccp");
    expect(configSrc).toContain("production-network-allowlist.md");
  });
});

describe("production domain allowlist (lp-ccp)", () => {
  it("defaults empty (fail-closed; omit create field)", () => {
    expect(parseDaytonaDomainAllowList(undefined)).toEqual([]);
    expect(parseDaytonaDomainAllowList("")).toEqual([]);
    expect(parseDaytonaDomainAllowList("  ")).toEqual([]);
    expect(formatDaytonaDomainAllowList([])).toBeUndefined();
    expect(formatDaytonaDomainAllowList(null)).toBeUndefined();
    expect(formatDaytonaDomainAllowList(undefined)).toBeUndefined();

    const cfg = loadDaytonaConfig({}, { failClosed: false });
    expect(cfg.domainAllowList).toEqual([]);
    expect(formatDaytonaDomainAllowList(cfg.domainAllowList)).toBeUndefined();
  });

  it("parses comma-separated hosts, lowercases, and dedupes", () => {
    expect(
      parseDaytonaDomainAllowList(
        "relay.withlanyard.com, API.OpenAI.com, relay.withlanyard.com, api.x.ai",
      ),
    ).toEqual([
      "relay.withlanyard.com",
      "api.openai.com",
      "api.x.ai",
    ]);
    expect(
      formatDaytonaDomainAllowList([
        "relay.withlanyard.com",
        "api.openai.com",
      ]),
    ).toBe("relay.withlanyard.com,api.openai.com");
  });

  it("accepts limited left-most wildcards used for S3/ECR patterns", () => {
    expect(
      isValidDaytonaDomainAllowListEntry("*.s3.amazonaws.com"),
    ).toBe(true);
    expect(
      isValidDaytonaDomainAllowListEntry("*.dkr.ecr.us-east-1.amazonaws.com"),
    ).toBe(true);
    expect(
      parseDaytonaDomainAllowList(
        "s3.amazonaws.com,*.s3.us-east-1.amazonaws.com",
      ),
    ).toEqual(["s3.amazonaws.com", "*.s3.us-east-1.amazonaws.com"]);
  });

  it("rejects open-world * and invalid tokens (fail-closed shape)", () => {
    expect(isValidDaytonaDomainAllowListEntry("*")).toBe(false);
    expect(isValidDaytonaDomainAllowListEntry("https://api.openai.com")).toBe(
      false,
    );
    expect(isValidDaytonaDomainAllowListEntry("api.openai.com/v1")).toBe(false);
    expect(isValidDaytonaDomainAllowListEntry("")).toBe(false);
    expect(isValidDaytonaDomainAllowListEntry("not a host")).toBe(false);
    expect(DAYTONA_DOMAIN_ALLOWLIST_ENTRY_MAX_LENGTH).toBe(253);

    expect(() => parseDaytonaDomainAllowList("*")).toThrow(DaytonaConfigError);
    expect(() => parseDaytonaDomainAllowList("https://evil.example")).toThrow(
      /DAYTONA_DOMAIN_ALLOWLIST/,
    );
    expect(() =>
      parseDaytonaDomainAllowList("ok.example.com, *"),
    ).toThrow(/Invalid DAYTONA_DOMAIN_ALLOWLIST/);
  });

  it("loadDaytonaConfig applies DAYTONA_DOMAIN_ALLOWLIST", () => {
    const cfg = loadDaytonaConfig(FULL_ENV, { failClosed: true });
    expect(cfg.domainAllowList).toEqual([
      "relay.withlanyard.com",
      "api.openai.com",
      "api.x.ai",
      "s3.amazonaws.com",
    ]);
    expect(formatDaytonaDomainAllowList(cfg.domainAllowList)).toBe(
      "relay.withlanyard.com,api.openai.com,api.x.ai,s3.amazonaws.com",
    );
  });

  it("log summary is count-only (no host inventory dump)", () => {
    const cfg = loadDaytonaConfig(FULL_ENV, { failClosed: false });
    const summary = daytonaConfigLogSummary(cfg);
    expect(summary.daytona_domain_allowlist_count).toBe(4);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("relay.withlanyard.com");
    expect(serialized).not.toContain("api.openai.com");
    expect(serialized).not.toContain(FULL_ENV.DAYTONA_API_KEY!);
  });

  it("server wires domainAllowList into createDaytonaSdkClient (lp-ccp)", () => {
    expect(serverSrc).toContain("domainAllowList");
    expect(serverSrc).toContain("formatDaytonaDomainAllowList");
    expect(serverSrc).toContain("daytonaConfig.domainAllowList");
    expect(serverSrc).toContain("lp-ccp");
    expect(serverSrc).toContain("production-network-allowlist.md");
  });

  it("package index exports domain allowlist helpers", () => {
    expect(indexSrc).toContain("parseDaytonaDomainAllowList");
    expect(indexSrc).toContain("formatDaytonaDomainAllowList");
    expect(indexSrc).toContain("isValidDaytonaDomainAllowListEntry");
    expect(indexSrc).toContain("DAYTONA_DOMAIN_ALLOWLIST_ENTRY_MAX_LENGTH");
    expect(indexSrc).toContain("DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST");
    expect(indexSrc).toContain("mergeDaytonaWebSearchDomainAllowList");
  });
});

describe("LA web_search domain catalog (lp-zuh.10.1)", () => {
  it("catalog lists DDG default + optional paid SERP hosts", () => {
    expect(DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST).toEqual([
      "html.duckduckgo.com",
      "duckduckgo.com",
      "api.tavily.com",
      "api.search.brave.com",
      "api.firecrawl.dev",
    ]);
    for (const host of DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST) {
      expect(isValidDaytonaDomainAllowListEntry(host)).toBe(true);
    }
    // No open-world tokens
    expect(DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST).not.toContain("*");
  });

  it("mergeDaytonaWebSearchDomainAllowList appends + dedupes", () => {
    const merged = mergeDaytonaWebSearchDomainAllowList([
      "relay.withlanyard.com",
      "api.openai.com",
      "html.duckduckgo.com", // already present
    ]);
    expect(merged[0]).toBe("relay.withlanyard.com");
    expect(merged).toContain("api.openai.com");
    expect(merged).toContain("html.duckduckgo.com");
    expect(merged).toContain("api.firecrawl.dev");
    // single DDG entry after dedupe
    expect(
      merged.filter((h) => h === "html.duckduckgo.com"),
    ).toHaveLength(1);
    const formatted = formatDaytonaDomainAllowList(merged);
    expect(formatted).toContain("html.duckduckgo.com");
    expect(formatted).toContain("api.tavily.com");
  });

  it("merge rejects invalid extras", () => {
    expect(() =>
      mergeDaytonaWebSearchDomainAllowList(["relay.withlanyard.com"], ["*"]),
    ).toThrow(DaytonaConfigError);
  });

  it("config source documents MockLab residual lp-zuh.10.1", () => {
    expect(configSrc).toContain("DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST");
    expect(configSrc).toContain("lp-zuh.10.1");
    expect(configSrc).toContain("html.duckduckgo.com");
  });
});

describe("Daytona autoStop safety net (lp-4f2)", () => {
  it("DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES is 90", () => {
    expect(DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES).toBe(90);
  });

  it("keeps autoStop above idle grace and mid-turn max hold", () => {
    const autoStopMs = DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES * 60_000;
    expect(DEFAULT_IDLE_GRACE_MS).toBe(10 * 60 * 1000);
    expect(DEFAULT_MID_TURN_MAX_HOLD_MS).toBe(45 * 60 * 1000);
    expect(autoStopMs).toBeGreaterThan(DEFAULT_MID_TURN_MAX_HOLD_MS);
    expect(autoStopMs).toBeGreaterThan(DEFAULT_IDLE_GRACE_MS);
    // Invariant: 30m reaper < 45m mid-turn < 90m vendor autoStop
    expect(DEFAULT_IDLE_GRACE_MS).toBeLessThan(DEFAULT_MID_TURN_MAX_HOLD_MS);
    expect(DEFAULT_MID_TURN_MAX_HOLD_MS).toBeLessThan(autoStopMs);
  });

  it("resolveDaytonaAutoStopIntervalMinutes defaults to 90", () => {
    expect(resolveDaytonaAutoStopIntervalMinutes({})).toBe(90);
    expect(resolveDaytonaAutoStopIntervalMinutes({ NODE_ENV: "test" })).toBe(
      90,
    );
  });

  it("resolveDaytonaAutoStopIntervalMinutes honors env override", () => {
    expect(
      resolveDaytonaAutoStopIntervalMinutes({
        DAYTONA_AUTO_STOP_INTERVAL_MINUTES: "120",
      }),
    ).toBe(120);
    expect(
      resolveDaytonaAutoStopIntervalMinutes({
        DAYTONA_AUTO_STOP_INTERVAL_MINUTES: "0",
      }),
    ).toBe(0);
    // Invalid → default
    expect(
      resolveDaytonaAutoStopIntervalMinutes({
        DAYTONA_AUTO_STOP_INTERVAL_MINUTES: "nope",
      }),
    ).toBe(90);
    expect(
      resolveDaytonaAutoStopIntervalMinutes({
        DAYTONA_AUTO_STOP_INTERVAL_MINUTES: "-5",
      }),
    ).toBe(90);
  });

  it("parseNonNegativeIntEnv rejects empty/invalid", () => {
    expect(parseNonNegativeIntEnv(undefined)).toBeUndefined();
    expect(parseNonNegativeIntEnv("")).toBeUndefined();
    expect(parseNonNegativeIntEnv("  ")).toBeUndefined();
    expect(parseNonNegativeIntEnv("1.9")).toBe(1);
    expect(parseNonNegativeIntEnv("0")).toBe(0);
  });

  it("loadDaytonaConfig applies default autoStop and env override", () => {
    const defaulted = loadDaytonaConfig({}, { failClosed: false });
    expect(defaulted.autoStopIntervalMinutes).toBe(90);

    const overridden = loadDaytonaConfig(
      { DAYTONA_AUTO_STOP_INTERVAL_MINUTES: "75" },
      { failClosed: false },
    );
    expect(overridden.autoStopIntervalMinutes).toBe(75);
  });

  it("log summary includes autoStop minutes and never secrets", () => {
    const cfg = loadDaytonaConfig(FULL_ENV, { failClosed: false });
    const summary = daytonaConfigLogSummary(cfg);
    expect(summary.daytona_auto_stop_interval_minutes).toBe(90);
    expect(JSON.stringify(summary)).not.toContain(FULL_ENV.DAYTONA_API_KEY!);
  });

  it("server wires autoStopIntervalMinutes into createDaytonaSdkClient", () => {
    expect(serverSrc).toContain("autoStopIntervalMinutes");
    expect(serverSrc).toContain("daytonaConfig.autoStopIntervalMinutes");
    expect(serverSrc).toContain("lp-4f2");
  });
});

describe("parseEnvFlag / fail-closed env detection", () => {
  it("defaults off for empty/unset", () => {
    expect(parseEnvFlag(undefined)).toBe(false);
    expect(parseEnvFlag("")).toBe(false);
    expect(parseEnvFlag("0")).toBe(false);
    expect(parseEnvFlag("false")).toBe(false);
  });

  it("accepts 1|true|yes|on", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      expect(parseEnvFlag(v)).toBe(true);
    }
  });

  it("treats NODE_ENV=test and VITEST as non-fail-closed", () => {
    expect(isDaytonaFailClosedEnv({ NODE_ENV: "test" })).toBe(false);
    expect(isDaytonaFailClosedEnv({ VITEST: "true" })).toBe(false);
    expect(isDaytonaFailClosedEnv({ NODE_ENV: "production" })).toBe(true);
    expect(isDaytonaFailClosedEnv({ NODE_ENV: "development" })).toBe(true);
    expect(isDaytonaFailClosedEnv({})).toBe(true);
  });
});

describe("loadDaytonaConfig", () => {
  it("defaults enabled=false with empty fields (EC2-only boot)", () => {
    const cfg = loadDaytonaConfig({}, { failClosed: true });
    expect(cfg.enabled).toBe(false);
    expect(cfg.apiKey).toBe("");
    expect(cfg.orgId).toBe("");
    expect(cfg.region).toBe("");
    expect(cfg.defaultSnapshotId).toBe("");
    expect(cfg.tenantAllowlist).toEqual([]);
    expect(cfg.domainAllowList).toEqual([]);
    expect(isDaytonaConfigReady(cfg)).toBe(false);
  });

  it("loads full config and dedupes allowlist", () => {
    const cfg = loadDaytonaConfig(FULL_ENV, { failClosed: true });
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiKey).toBe(FULL_ENV.DAYTONA_API_KEY);
    expect(cfg.orgId).toBe("org_test_123");
    expect(cfg.region).toBe("us");
    expect(cfg.defaultSnapshotId).toBe("snap-agent-v1");
    expect(cfg.tenantAllowlist).toEqual(["tenant-a", "tenant-b"]);
    expect(cfg.domainAllowList).toContain("relay.withlanyard.com");
    expect(isDaytonaConfigReady(cfg)).toBe(true);
  });

  it("fails closed when enabled with missing keys in non-test env", () => {
    expect(() =>
      loadDaytonaConfig(
        {
          NODE_ENV: "production",
          DAYTONA_ENABLED: "true",
          // missing API key, org, region, snapshot
        },
        { failClosed: true },
      ),
    ).toThrow(DaytonaConfigError);

    expect(() =>
      loadDaytonaConfig(
        {
          NODE_ENV: "development",
          DAYTONA_ENABLED: "1",
          DAYTONA_API_KEY: "k",
          // still missing org/region/snapshot
        },
        { failClosed: true },
      ),
    ).toThrow(/DAYTONA_ORG_ID|DAYTONA_REGION|DAYTONA_DEFAULT_SNAPSHOT/);
  });

  it("allows incomplete config in test env even when enabled", () => {
    const cfg = loadDaytonaConfig(
      {
        NODE_ENV: "test",
        DAYTONA_ENABLED: "1",
      },
      // failClosed omitted → derived from NODE_ENV=test
    );
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiKey).toBe("");
    expect(isDaytonaConfigReady(cfg)).toBe(false);
  });

  it("error message names keys but never includes secret values", () => {
    const secret = "super-secret-value-xyz";
    try {
      loadDaytonaConfig(
        {
          DAYTONA_ENABLED: "1",
          DAYTONA_API_KEY: secret,
          // missing the rest
        },
        { failClosed: true },
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DaytonaConfigError);
      const msg = (err as Error).message;
      expect(msg).not.toContain(secret);
      expect(msg).toContain("DAYTONA_ORG_ID");
      expect(msg).toContain("DAYTONA_REGION");
      expect(msg).toContain("DAYTONA_DEFAULT_SNAPSHOT");
      // API key was present — not listed as missing
      expect(msg).not.toMatch(/missing:.*DAYTONA_API_KEY/);
    }
  });
});

describe("assertDaytonaConfigReady / missing keys", () => {
  it("lists all four required keys when empty", () => {
    const empty: DaytonaConfig = {
      enabled: true,
      apiKey: "",
      orgId: "",
      region: "",
      defaultSnapshotId: "",
      tenantAllowlist: [],
      domainAllowList: [],
      autoStopIntervalMinutes: DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES,
      warmPoolEnabled: false,
      warmPoolTenantAllowlist: [],
      warmPoolSize: 2,
      archiveRestoreOnWake: false,
      retainSandboxOnStop: true,
    };
    expect(daytonaConfigMissingKeys(empty)).toEqual([
      "DAYTONA_API_KEY",
      "DAYTONA_ORG_ID",
      "DAYTONA_REGION",
      "DAYTONA_DEFAULT_SNAPSHOT",
    ]);
    expect(() => assertDaytonaConfigReady(empty)).toThrow(DaytonaConfigError);
  });

  it("passes when all required keys present", () => {
    const cfg = loadDaytonaConfig(FULL_ENV, { failClosed: false });
    expect(() => assertDaytonaConfigReady(cfg)).not.toThrow();
  });
});

describe("allowlist + snapshot resolve", () => {
  it("denies all tenants when disabled or allowlist empty", () => {
    const disabled = loadDaytonaConfig({}, { failClosed: false });
    expect(isTenantOnDaytonaAllowlist(disabled, "tenant-a")).toBe(false);

    const enabledEmpty = loadDaytonaConfig(
      {
        DAYTONA_ENABLED: "1",
        DAYTONA_API_KEY: "k",
        DAYTONA_ORG_ID: "o",
        DAYTONA_REGION: "us",
        DAYTONA_DEFAULT_SNAPSHOT: "snap",
      },
      { failClosed: false },
    );
    expect(isTenantOnDaytonaAllowlist(enabledEmpty, "tenant-a")).toBe(false);
  });

  it("allows only listed tenant ids", () => {
    const cfg = loadDaytonaConfig(FULL_ENV, { failClosed: false });
    expect(isTenantOnDaytonaAllowlist(cfg, "tenant-a")).toBe(true);
    expect(isTenantOnDaytonaAllowlist(cfg, "tenant-b")).toBe(true);
    expect(isTenantOnDaytonaAllowlist(cfg, "tenant-c")).toBe(false);
    expect(isTenantOnDaytonaAllowlist(cfg, "")).toBe(false);
  });

  it("prefers instance snapshot over platform default", () => {
    const cfg = loadDaytonaConfig(FULL_ENV, { failClosed: false });
    expect(resolveAgentSnapshotId(cfg, "snap-instance")).toBe("snap-instance");
    expect(resolveAgentSnapshotId(cfg, null)).toBe("snap-agent-v1");
    expect(resolveAgentSnapshotId(cfg, "  ")).toBe("snap-agent-v1");
    const noDefault = loadDaytonaConfig(
      {
        DAYTONA_API_KEY: "k",
        DAYTONA_ORG_ID: "o",
        DAYTONA_REGION: "us",
      },
      { failClosed: false },
    );
    expect(resolveAgentSnapshotId(noDefault, null)).toBeNull();
  });
});

describe("agent_snapshot_id pin convention (lp-kng.2.7)", () => {
  it("exports canonical offline placeholder and max length", () => {
    expect(OFFLINE_AGENT_SNAPSHOT_PLACEHOLDER).toBe("offline:agent-default");
    expect(AGENT_SNAPSHOT_ID_MAX_LENGTH).toBe(256);
    expect(configSrc).toContain("lp-kng.2.7");
    expect(configSrc).toContain("agent-snapshot-pin.md");
    expect(configSrc).toContain("lp-4xa");
  });

  it("accepts offline placeholder as platform default (fake-ready)", () => {
    const cfg = loadDaytonaConfig(
      {
        DAYTONA_ENABLED: "1",
        DAYTONA_API_KEY: "k",
        DAYTONA_ORG_ID: "o",
        DAYTONA_REGION: "us",
        DAYTONA_DEFAULT_SNAPSHOT: OFFLINE_AGENT_SNAPSHOT_PLACEHOLDER,
      },
      { failClosed: false },
    );
    expect(cfg.defaultSnapshotId).toBe(OFFLINE_AGENT_SNAPSHOT_PLACEHOLDER);
    expect(isDaytonaConfigReady(cfg)).toBe(true);
    expect(resolveAgentSnapshotId(cfg, null)).toBe(
      OFFLINE_AGENT_SNAPSHOT_PLACEHOLDER,
    );
    expect(
      isOfflineAgentSnapshotPlaceholder(resolveAgentSnapshotId(cfg, null)),
    ).toBe(true);
  });

  it("instance offline pin overrides platform default", () => {
    const cfg = loadDaytonaConfig(
      {
        DAYTONA_DEFAULT_SNAPSHOT: OFFLINE_AGENT_SNAPSHOT_PLACEHOLDER,
      },
      { failClosed: false },
    );
    expect(resolveAgentSnapshotId(cfg, "offline:agent-canary")).toBe(
      "offline:agent-canary",
    );
    expect(isOfflineAgentSnapshotPlaceholder("offline:agent-canary")).toBe(
      true,
    );
    expect(isOfflineAgentSnapshotPlaceholder("snap-agent-v1")).toBe(false);
    expect(isOfflineAgentSnapshotPlaceholder(null)).toBe(false);
  });

  it("validates pin shape without requiring a live Daytona id", () => {
    expect(isValidAgentSnapshotPinShape(OFFLINE_AGENT_SNAPSHOT_PLACEHOLDER)).toBe(
      true,
    );
    expect(isValidAgentSnapshotPinShape("snap-agent-v1")).toBe(true);
    expect(isValidAgentSnapshotPinShape("  ")).toBe(false);
    expect(isValidAgentSnapshotPinShape("")).toBe(false);
    expect(isValidAgentSnapshotPinShape(null)).toBe(false);
    expect(isValidAgentSnapshotPinShape("a".repeat(257))).toBe(false);
    expect(isValidAgentSnapshotPinShape("a".repeat(256))).toBe(true);
    expect(isValidAgentSnapshotPinShape("bad\npin")).toBe(false);
  });
});

describe("no secrets in logs (lp-k8n)", () => {
  it("log summary never includes api key material", () => {
    const cfg = loadDaytonaConfig(FULL_ENV, { failClosed: false });
    const summary = daytonaConfigLogSummary(cfg);
    expect(summary.daytona_api_key).toBe("configured");
    expect(summary.daytona_org_id).toBe("configured");
    expect(summary.daytona_region).toBe("us");
    expect(summary.daytona_default_snapshot).toBe("configured");
    expect(summary.daytona_allowlist_count).toBe(2);
    expect(summary.daytona_domain_allowlist_count).toBe(4);
    expect(summary.daytona_ready).toBe(true);

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(FULL_ENV.DAYTONA_API_KEY!);
    expect(serialized).not.toContain("tenant-a");
    expect(serialized).not.toContain("tenant-b");
    expect(serialized).not.toContain("relay.withlanyard.com");
  });

  it("redactForLog strips api_key shaped fields; summary never carries the secret", () => {
    // Shared redaction matches secret *key names* (api_key), not env var names.
    // Callers must use daytonaConfigLogSummary — never log env maps wholesale.
    expect(isSecretKey("api_key")).toBe(true);
    expect(isSecretKey("apiKey")).toBe(true);

    const leaked = {
      msg: "boot",
      api_key: FULL_ENV.DAYTONA_API_KEY,
      apiKey: FULL_ENV.DAYTONA_API_KEY,
      ...daytonaConfigLogSummary(
        loadDaytonaConfig(FULL_ENV, { failClosed: false }),
      ),
    };
    const redacted = redactForLog(leaked) as Record<string, unknown>;
    expect(redacted.api_key).toBe("[REDACTED]");
    expect(redacted.apiKey).toBe("[REDACTED]");
    expect(redacted.daytona_api_key).toBe("configured");
    expect(JSON.stringify(redacted)).not.toContain(FULL_ENV.DAYTONA_API_KEY!);
  });
});

describe("CP wiring (lp-k8n)", () => {
  it("server loads Daytona config and logs only safe summary fields", () => {
    expect(serverSrc).toContain("loadDaytonaConfig");
    expect(serverSrc).toContain("daytonaConfigLogSummary");
    // Must not interpolate apiKey into log payloads.
    expect(serverSrc).not.toMatch(/log\.(info|error|warn|debug)\([^)]*apiKey/);
    expect(serverSrc).not.toContain("daytonaConfig.apiKey");
  });

  it("package index exports config surface", () => {
    expect(indexSrc).toContain("loadDaytonaConfig");
    expect(indexSrc).toContain("daytonaConfigLogSummary");
    expect(indexSrc).toContain("DAYTONA_ENV");
    expect(indexSrc).toContain("OFFLINE_AGENT_SNAPSHOT_PLACEHOLDER");
    expect(indexSrc).toContain("isValidAgentSnapshotPinShape");
    expect(indexSrc).toContain("isOfflineAgentSnapshotPlaceholder");
    expect(indexSrc).toContain("DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES");
    expect(indexSrc).toContain("resolveDaytonaAutoStopIntervalMinutes");
    expect(indexSrc).toContain("resolveWarmPoolSize");
    expect(indexSrc).toContain("createInMemoryWarmPool");
  });
});

describe("DAYTONA_WARM_POOL_SIZE (lp-vqr0.10)", () => {
  it("defaults to 2 and clamps to MockLab cap 0–2", () => {
    expect(resolveWarmPoolSize({})).toBe(2);
    expect(resolveWarmPoolSize({ DAYTONA_WARM_POOL_SIZE: "1" })).toBe(1);
    expect(resolveWarmPoolSize({ DAYTONA_WARM_POOL_SIZE: "2" })).toBe(2);
    expect(resolveWarmPoolSize({ DAYTONA_WARM_POOL_SIZE: "9" })).toBe(2);
    expect(resolveWarmPoolSize({ DAYTONA_WARM_POOL_SIZE: "0" })).toBe(0);
    expect(resolveWarmPoolSize({ DAYTONA_WARM_POOL_SIZE: "nope" })).toBe(2);
    const cfg = loadDaytonaConfig(
      { DAYTONA_WARM_POOL_SIZE: "1" },
      { failClosed: false },
    );
    expect(cfg.warmPoolSize).toBe(1);
    expect(daytonaConfigLogSummary(cfg).daytona_warm_pool_size).toBe(1);
  });
});
