import { access, constants as fsConstants } from "node:fs/promises";

import type { SettingsIntegration } from "./settings-snapshot.js";

export type IntegrationHealthStatus = "healthy" | "unhealthy";

export type IntegrationHealthResult = {
  id: string;
  name: string;
  type: string;
  status: IntegrationHealthStatus;
  latency_ms: number;
  checked_at: string;
  message: string;
};

export type SettingsHealthCheckResponse = {
  checked_at: string;
  integrations: IntegrationHealthResult[];
};

/** Deterministic mock health for CI fixture integrations. */
const UNHEALTHY_INTEGRATION_IDS = new Set(["slack", "notion"]);

export function mockIntegrationHealth(
  integrations: SettingsIntegration[],
  now: Date = new Date(),
): SettingsHealthCheckResponse {
  const checkedAt = now.toISOString();

  return {
    checked_at: checkedAt,
    integrations: integrations.map((integration, index) => {
      const unhealthy = UNHEALTHY_INTEGRATION_IDS.has(integration.id);
      return {
        id: integration.id,
        name: integration.name,
        type: integration.type,
        status: unhealthy ? "unhealthy" : "healthy",
        latency_ms: 40 + index * 17,
        checked_at: checkedAt,
        message: unhealthy
          ? "Connection check failed (mock)"
          : "Connection OK (mock)",
      };
    }),
  };
}

export type CheckIntegrationHealthOptions = {
  now?: () => Date;
  /**
   * When true, skip filesystem probes and use the deterministic mock
   * (fixture / CI path).
   */
  useMock?: boolean;
};

/**
 * Health for CLI/MCP integrations:
 * - CLI with path: healthy if binary is executable
 * - CLI without path: unhealthy (not found on PATH)
 * - MCP with path: healthy if command binary is executable
 * - MCP without path (URL-only): healthy if configured (name present)
 * - Fixture mock ids (slack/notion) stay unhealthy under useMock
 */
export async function checkIntegrationHealth(
  integrations: SettingsIntegration[],
  options: CheckIntegrationHealthOptions = {},
): Promise<SettingsHealthCheckResponse> {
  if (options.useMock) {
    return mockIntegrationHealth(integrations, options.now?.() ?? new Date());
  }

  const checkedAt = (options.now?.() ?? new Date()).toISOString();
  const results: IntegrationHealthResult[] = [];

  for (const integration of integrations) {
    const started = performance.now();
    const result = await probeIntegration(integration);
    results.push({
      id: integration.id,
      name: integration.name,
      type: integration.type,
      status: result.status,
      latency_ms: Math.max(0, Math.round(performance.now() - started)),
      checked_at: checkedAt,
      message: result.message,
    });
  }

  return { checked_at: checkedAt, integrations: results };
}

async function probeIntegration(
  integration: SettingsIntegration,
): Promise<{ status: IntegrationHealthStatus; message: string }> {
  const binPath = integration.path?.trim();
  const type = integration.type.toLowerCase();

  if (binPath) {
    try {
      await access(binPath, fsConstants.X_OK);
      return {
        status: "healthy",
        message: `Binary available at ${binPath}`,
      };
    } catch {
      return {
        status: "unhealthy",
        message: `Binary not executable: ${binPath}`,
      };
    }
  }

  if (type === "cli") {
    return {
      status: "unhealthy",
      message: integration.bin
        ? `CLI not found on PATH: ${integration.bin}`
        : "CLI path unknown",
    };
  }

  if (type === "mcp") {
    // URL-only / config-only MCP servers: treat as configured.
    return {
      status: "healthy",
      message: "MCP server configured (no local binary to probe)",
    };
  }

  // connectors / other types without a path: unknown → unhealthy
  return {
    status: "unhealthy",
    message: "No probe available for this integration",
  };
}
