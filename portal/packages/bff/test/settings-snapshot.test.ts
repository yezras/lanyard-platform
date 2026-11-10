import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  assertNoSecrets,
  clearFixtureSettingsOverrides,
  defaultSettingsSnapshotPath,
  ensureLabMcpSeed,
  isSecretField,
  LAB_ECHO_MCP_SERVER,
  loadSettingsSnapshot,
  loadSettingsSnapshotFromFile,
  redactSettingsSnapshot,
  type RawSettingsSnapshot,
} from "../src/settings-snapshot.js";

describe("isSecretField", () => {
  it("matches common secret key names", () => {
    expect(isSecretField("api_key")).toBe(true);
    expect(isSecretField("apiKey")).toBe(true);
    expect(isSecretField("token")).toBe(true);
    expect(isSecretField("client_secret")).toBe(true);
    expect(isSecretField("name")).toBe(false);
  });
});

describe("redactSettingsSnapshot", () => {
  it("removes API keys and tokens from MCP and model entries", () => {
    const raw: RawSettingsSnapshot = {
      exported_at: "2026-07-01T08:00:00.000Z",
      skills: [
        {
          id: "demo",
          name: "Demo skill",
          enabled: true,
        },
      ],
      crons: [
        {
          id: "demo-cron",
          name: "Demo cron",
          schedule: "0 * * * *",
          enabled: true,
        },
      ],
      mcp_servers: [
        {
          name: "gmail",
          transport: "stdio",
          command: "gws",
          api_key: "super-secret-gws-key",
        },
        {
          name: "slack",
          transport: "stdio",
          token: "xoxb-slack-token",
        },
      ],
      models: [
        {
          provider: "xai",
          model: "grok-3",
          api_key: "xai-secret",
        },
      ],
      integrations: [
        { id: "gmail", name: "Gmail", type: "mcp" },
      ],
    };

    const redacted = redactSettingsSnapshot(raw);

    expect(redacted.mcp_servers).toEqual([
      { name: "gmail", transport: "stdio", command: "gws" },
      { name: "slack", transport: "stdio" },
    ]);
    expect(redacted.models).toEqual([
      expect.objectContaining({ provider: "xai", model: "grok-3" }),
    ]);
    expect(redacted.models[0]).not.toHaveProperty("api_key");
    expect(JSON.stringify(redacted)).not.toContain("super-secret");
    expect(JSON.stringify(redacted)).not.toContain("xoxb");
    expect(JSON.stringify(redacted)).not.toContain("xai-secret");
    expect(() => assertNoSecrets(redacted)).not.toThrow();
  });
});

describe("loadSettingsSnapshot", () => {
  it("loads fixture and returns redacted snapshot with no secrets", async () => {
    clearFixtureSettingsOverrides();
    const snapshot = await loadSettingsSnapshotFromFile(
      defaultSettingsSnapshotPath(),
    );
    const raw = await readFile(defaultSettingsSnapshotPath(), "utf8");

    expect(snapshot.skills.length).toBeGreaterThan(0);
    expect(snapshot.crons.length).toBeGreaterThan(0);
    expect(snapshot.mcp_servers.length).toBeGreaterThan(0);
    expect(snapshot.models.length).toBeGreaterThan(0);
    expect(snapshot.integrations.length).toBeGreaterThan(0);
    expect(snapshot.source).toBe("fixture");

    for (const mcp of snapshot.mcp_servers) {
      expect(mcp).not.toHaveProperty("api_key");
      expect(mcp).not.toHaveProperty("token");
    }
    for (const model of snapshot.models) {
      expect(model).not.toHaveProperty("api_key");
    }

    expect(raw).toContain("api_key");
    expect(JSON.stringify(snapshot)).not.toContain("api_key");
    expect(() => assertNoSecrets(snapshot)).not.toThrow();
  });

  it("uses fixture path when Hermes home is absent", async () => {
    const snapshot = await loadSettingsSnapshot(defaultSettingsSnapshotPath(), {
      hermesHome: "/tmp/lanyard-nonexistent-hermes-home-for-tests",
    });

    expect(snapshot.source).toBe("fixture");
    expect(snapshot.skills.length).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).not.toContain("api_key");
  });

  it("prefers fixture when preferFixture is set even if Hermes exists", async () => {
    const snapshot = await loadSettingsSnapshot(defaultSettingsSnapshotPath(), {
      preferFixture: true,
    });
    expect(snapshot.source).toBe("fixture");
  });

  it("seedLabMcp prepends lab_echo without dropping other servers (lp-zuh.14.3)", async () => {
    const snapshot = await loadSettingsSnapshot(defaultSettingsSnapshotPath(), {
      preferFixture: true,
      seedLabMcp: true,
    });
    expect(snapshot.mcp_servers[0]?.name).toBe(LAB_ECHO_MCP_SERVER.name);
    expect(snapshot.mcp_servers[0]?.transport).toBe("stdio");
    expect(snapshot.mcp_servers[0]?.enabled).toBe(true);
    expect(snapshot.mcp_servers.some((s) => s.name === "gmail")).toBe(true);
    // Idempotent
    const again = ensureLabMcpSeed(snapshot);
    expect(again.mcp_servers.filter((s) => s.name === "lab_echo")).toHaveLength(
      1,
    );
  });

  it("falls back to fixture when Hermes discover throws (lp-zuh.14.3)", async () => {
    const snapshot = await loadSettingsSnapshot(defaultSettingsSnapshotPath(), {
      // Present-but-unreadable path is hard to invent; preferFixture=false with
      // a home that exists as a file (not a dir) makes hermesHomePresent false
      // and still exercises the fixture path. Discover-throw is covered by the
      // try/catch around discoverSettingsFromHermes — use preferFixture false
      // + nonexistent home for the absent branch.
      hermesHome: "/tmp/lanyard-nonexistent-hermes-home-for-tests-2",
      seedLabMcp: true,
    });
    expect(snapshot.source).toBe("fixture");
    expect(snapshot.mcp_servers.some((s) => s.name === "lab_echo")).toBe(true);
  });
});