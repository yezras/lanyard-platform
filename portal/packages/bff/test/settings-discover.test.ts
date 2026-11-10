import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  discoverSettingsFromHermes,
  discoverWorkflows,
  hermesHomePresent,
  humanizeCronExpression,
  resolveHermesHome,
} from "../src/settings-discover.js";
import {
  assertNoSecrets,
  clearFixtureSettingsOverrides,
  loadSettingsSnapshot,
  patchSettingsActiveModel,
  patchSettingsCron,
  patchSettingsMcp,
  patchSettingsSkill,
  redactSettingsSnapshot,
} from "../src/settings-snapshot.js";
import { checkIntegrationHealth } from "../src/settings-health.js";

async function makeTempHermes(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "hermes-settings-"));
  await mkdir(path.join(root, "skills", "crm", "post-meeting-triage"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "skills", "crm", "post-meeting-triage", "SKILL.md"),
    `---
name: post-meeting-triage
description: demo
---
# Skill
`,
    "utf8",
  );
  await mkdir(path.join(root, "skills", "disabled-skill"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "disabled-skill", "SKILL.md"),
    `---
name: disabled-skill
---
`,
    "utf8",
  );

  await mkdir(path.join(root, "cron"), { recursive: true });
  await writeFile(
    path.join(root, "cron", "jobs.json"),
    JSON.stringify({
      jobs: [
        {
          id: "job-1",
          name: "Vault index",
          schedule_display: "0 3 * * *",
          enabled: true,
          last_run_at: "2026-07-01T03:00:12.000Z",
          next_run_at: "2026-07-02T03:00:00.000Z",
        },
        {
          id: "job-2",
          name: "Paused job",
          schedule: { kind: "cron", expr: "0 1 * * *" },
          enabled: false,
        },
      ],
      updated_at: "2026-07-01T00:00:00.000Z",
    }),
    "utf8",
  );

  await writeFile(
    path.join(root, "config.yaml"),
    `
model:
  provider: xai-oauth
  default: grok-4.5
providers:
  ollama:
    model: local-model
    api_key: should-not-leak
mcp_servers:
  granola:
    url: https://mcp.example.com/mcp
    auth: secret-auth-blob
    enabled: true
  local-tool:
    command: echo
    transport: stdio
    token: secret-token
skills:
  disabled:
    - disabled-skill
known_plugin_toolsets:
  cli:
    - demo-cli
`,
    "utf8",
  );

  await writeFile(
    path.join(root, "auth.json"),
    JSON.stringify({
      active_provider: "xai-oauth",
      providers: {
        "xai-oauth": { api_key: "secret" },
      },
    }),
    "utf8",
  );

  await writeFile(
    path.join(root, "provider_models_cache.json"),
    JSON.stringify({
      "xai-oauth": { models: ["grok-4.5", "grok-3"] },
    }),
    "utf8",
  );

  const binDir = path.join(root, "bin");
  await mkdir(binDir, { recursive: true });
  const toolPath = path.join(binDir, "demo-tool");
  await writeFile(toolPath, "#!/bin/sh\necho ok\n", "utf8");
  await chmod(toolPath, 0o755);

  return root;
}

describe("resolveHermesHome", () => {
  it("uses BACKEND_HOME when only preferred is set", () => {
    expect(
      resolveHermesHome(
        { BACKEND_HOME: "/var/lib/company-brain-backend" },
        () => "/home/x",
      ),
    ).toBe(path.resolve("/var/lib/company-brain-backend"));
  });

  it("accepts equal BACKEND_HOME and HERMES_HOME dual-write", () => {
    expect(
      resolveHermesHome(
        {
          BACKEND_HOME: "/var/lib/company-brain-backend",
          HERMES_HOME: "/var/lib/company-brain-backend",
        },
        () => "/home/x",
      ),
    ).toBe(path.resolve("/var/lib/company-brain-backend"));
  });

  it("falls back to HERMES_HOME when BACKEND_HOME is unset", () => {
    expect(
      resolveHermesHome({ HERMES_HOME: "/tmp/custom-hermes" }, () => "/home/x"),
    ).toBe(path.resolve("/tmp/custom-hermes"));
  });

  it("defaults to ~/.hermes when neither env is set", () => {
    expect(resolveHermesHome({}, () => "/home/x")).toBe(
      path.join("/home/x", ".hermes"),
    );
  });

  it("throws when BACKEND_HOME and HERMES_HOME conflict", () => {
    expect(() =>
      resolveHermesHome(
        { BACKEND_HOME: "/a", HERMES_HOME: "/b" },
        () => "/home/x",
      ),
    ).toThrow(/BACKEND_HOME|conflicts/i);
  });
});

describe("discoverSettingsFromHermes", () => {
  it("discovers skills, crons, mcp, models, and integrations from temp Hermes home", async () => {
    const hermesHome = await makeTempHermes();
    const pathDir = path.join(hermesHome, "path-bin");
    await mkdir(pathDir, { recursive: true });
    const pathCli = path.join(pathDir, "gws");
    await writeFile(pathCli, "#!/bin/sh\n", "utf8");
    await chmod(pathCli, 0o755);

    const raw = await discoverSettingsFromHermes({
      hermesHome,
      pathEnv: pathDir,
      pathCliNames: ["gws", "missing-cli"],
      now: () => new Date("2026-07-08T12:00:00.000Z"),
    });

    expect(raw.source).toBe("hermes");
    expect(raw.hermes_home).toBe(path.resolve(hermesHome));
    expect(raw.exported_at).toBe("2026-07-08T12:00:00.000Z");

    expect(raw.skills.map((s) => s.name).sort()).toEqual([
      "disabled-skill",
      "post-meeting-triage",
    ]);
    const triage = raw.skills.find((s) => s.name === "post-meeting-triage");
    expect(triage?.path).toBe("skills/crm/post-meeting-triage");
    expect(triage?.enabled).toBe(true);
    expect(raw.skills.find((s) => s.name === "disabled-skill")?.enabled).toBe(
      false,
    );

    expect(raw.crons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "job-1",
          name: "Vault index",
          schedule: "Daily at 3:00 AM",
          path: "cron/jobs.json",
          enabled: true,
          last_run_at: "2026-07-01T03:00:12.000Z",
          next_run_at: "2026-07-02T03:00:00.000Z",
        }),
        expect.objectContaining({
          id: "job-2",
          enabled: false,
          schedule: "Daily at 1:00 AM",
        }),
      ]),
    );

    expect(raw.mcp_servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "granola",
          transport: "http",
          command: "https://mcp.example.com/mcp",
        }),
        expect.objectContaining({
          name: "local-tool",
          transport: "stdio",
          command: "echo",
        }),
      ]),
    );
    expect(JSON.stringify(raw.mcp_servers)).not.toContain("secret");

    expect(raw.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "xai-oauth",
          model: "grok-4.5",
          is_active: true,
          connected: true,
        }),
        expect.objectContaining({
          provider: "ollama",
          model: "local-model",
          connected: true,
        }),
        expect.objectContaining({
          provider: "xai-oauth",
          model: "grok-3",
          is_active: false,
          connected: true,
        }),
      ]),
    );
    expect(raw.models.filter((m) => m.is_active)).toHaveLength(1);
    expect(JSON.stringify(raw.models)).not.toContain("should-not-leak");
    expect(JSON.stringify(raw)).not.toContain("api_key");

    expect(raw.integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "demo-tool",
          type: "cli",
          bin: "demo-tool",
        }),
        expect.objectContaining({
          name: "gws",
          type: "cli",
          bin: "gws",
          path: pathCli,
        }),
        expect.objectContaining({
          name: "granola",
          type: "mcp",
        }),
      ]),
    );

    const redacted = redactSettingsSnapshot(raw);
    expect(() => assertNoSecrets(redacted)).not.toThrow();
  });

  it("reports hermes home presence", async () => {
    const hermesHome = await makeTempHermes();
    expect(await hermesHomePresent(hermesHome)).toBe(true);
    expect(await hermesHomePresent(`${hermesHome}-missing`)).toBe(false);
  });

  it("loadSettingsSnapshot prefers discovery when Hermes is present", async () => {
    const hermesHome = await makeTempHermes();
    const snapshot = await loadSettingsSnapshot("/tmp/unused-fixture.json", {
      hermesHome,
      discoverOptions: {
        pathEnv: "",
        pathCliNames: [],
      },
    });
    expect(snapshot.source).toBe("hermes");
    expect(snapshot.hermes_home).toBe(path.resolve(hermesHome));
    expect(snapshot.skills.length).toBeGreaterThan(0);
    expect(() => assertNoSecrets(snapshot)).not.toThrow();
  });
});

describe("humanizeCronExpression", () => {
  it("humanizes common patterns", () => {
    expect(humanizeCronExpression("0 3 * * *")).toBe("Daily at 3:00 AM");
    expect(humanizeCronExpression("*/15 * * * *")).toBe("Every 15 minutes");
    expect(humanizeCronExpression("@hourly")).toBe("Hourly");
  });
});

describe("patchSettings skill/cron", () => {
  it("writes skill disabled list and cron enabled into Hermes home", async () => {
    const hermesHome = await makeTempHermes();

    const skillResult = await patchSettingsSkill("post-meeting-triage", false, {
      snapshotPath: "/tmp/unused.json",
      hermesHome,
    });
    expect(skillResult.source).toBe("hermes");
    expect(skillResult.skill.enabled).toBe(false);

    const afterSkill = await discoverSettingsFromHermes({ hermesHome });
    expect(
      afterSkill.skills.find((s) => s.name === "post-meeting-triage")?.enabled,
    ).toBe(false);

    const cronResult = await patchSettingsCron("job-1", false, {
      snapshotPath: "/tmp/unused.json",
      hermesHome,
    });
    expect(cronResult.source).toBe("hermes");
    expect(cronResult.cron.enabled).toBe(false);

    const afterCron = await discoverSettingsFromHermes({ hermesHome });
    expect(afterCron.crons.find((c) => c.id === "job-1")?.enabled).toBe(false);

    const mcpResult = await patchSettingsMcp("granola", false, {
      snapshotPath: "/tmp/unused.json",
      hermesHome,
    });
    expect(mcpResult.source).toBe("hermes");
    expect(mcpResult.mcp.enabled).toBe(false);

    const afterMcp = await discoverSettingsFromHermes({ hermesHome });
    expect(afterMcp.mcp_servers.find((s) => s.name === "granola")?.enabled).toBe(
      false,
    );

    const modelResult = await patchSettingsActiveModel(
      "xai-oauth",
      "grok-3",
      {
        snapshotPath: "/tmp/unused.json",
        hermesHome,
      },
    );
    expect(modelResult.source).toBe("hermes");
    expect(modelResult.model).toMatchObject({
      provider: "xai-oauth",
      model: "grok-3",
      is_active: true,
    });

    const afterModel = await discoverSettingsFromHermes({ hermesHome });
    const active = afterModel.models.find((m) => m.is_active);
    expect(active).toMatchObject({ provider: "xai-oauth", model: "grok-3" });
  });

  it("applies fixture overrides when preferFixture", async () => {
    clearFixtureSettingsOverrides();
    const { defaultSettingsSnapshotPath } = await import(
      "../src/settings-snapshot.js"
    );
    const fixturePath = defaultSettingsSnapshotPath();

    const skillResult = await patchSettingsSkill("post-meeting-triage", false, {
      snapshotPath: fixturePath,
      preferFixture: true,
    });
    expect(skillResult.source).toBe("fixture");
    expect(skillResult.skill.enabled).toBe(false);

    const snapshot = await loadSettingsSnapshot(fixturePath, {
      preferFixture: true,
    });
    expect(
      snapshot.skills.find((s) => s.id === "post-meeting-triage")?.enabled,
    ).toBe(false);

    clearFixtureSettingsOverrides();
  });

  it("discovers workflow defs under .lanyard/workflows (lp-vnz.5)", async () => {
    const hermesHome = await makeTempHermes();
    await mkdir(path.join(hermesHome, ".lanyard", "workflows"), {
      recursive: true,
    });
    await writeFile(
      path.join(
        hermesHome,
        ".lanyard",
        "workflows",
        "fizzbuzz-algorithm-test-report.yaml",
      ),
      "name: fizzbuzz\n",
      "utf8",
    );

    const workflows = await discoverWorkflows(hermesHome);
    expect(workflows).toEqual([
      expect.objectContaining({
        id: "fizzbuzz-algorithm-test-report",
        name: "fizzbuzz-algorithm-test-report",
        path: ".lanyard/workflows/fizzbuzz-algorithm-test-report.yaml",
        enabled: true,
      }),
    ]);

    const snapshot = await discoverSettingsFromHermes({ hermesHome });
    expect(snapshot.workflows?.map((w) => w.id)).toContain(
      "fizzbuzz-algorithm-test-report",
    );
  });
});

describe("checkIntegrationHealth", () => {
  it("probes CLI binaries on disk", async () => {
    const hermesHome = await makeTempHermes();
    const toolPath = path.join(hermesHome, "bin", "demo-tool");

    const health = await checkIntegrationHealth(
      [
        {
          id: "demo-tool",
          name: "demo-tool",
          type: "cli",
          bin: "demo-tool",
          path: toolPath,
        },
        {
          id: "missing",
          name: "missing",
          type: "cli",
          bin: "missing",
        },
        {
          id: "granola",
          name: "granola",
          type: "mcp",
        },
      ],
      { now: () => new Date("2026-07-08T12:00:00.000Z") },
    );

    expect(health.checked_at).toBe("2026-07-08T12:00:00.000Z");
    expect(health.integrations.find((i) => i.id === "demo-tool")?.status).toBe(
      "healthy",
    );
    expect(health.integrations.find((i) => i.id === "missing")?.status).toBe(
      "unhealthy",
    );
    expect(health.integrations.find((i) => i.id === "granola")?.status).toBe(
      "healthy",
    );
  });
});
