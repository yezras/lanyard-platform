/**
 * lp-uxy.3 — Lanyard Agent cron under LA home + Brain RPC Settings path.
 * lp-uxy.4 — NL job creation (agent cronjob) + Settings inventory refresh path.
 *
 * Offline fixture proof (mocklab-equivalent pin):
 * - Jobs projected at $BACKEND_HOME/cron/jobs.json (never ~/.hermes)
 * - settings.snapshot includes crons when present
 * - Portal BFF can toggle via settings.patch cron.set_enabled
 * - Capability flags stay honest when dedicated cron RPCs are absent
 * - Agent NL create writes durable job under LA home; snapshot lists it
 * - Clear failure when product cron / agent create is disabled
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BackendRuntimeError } from "../src/errors.js";
import {
  LANYARD_AGENT_FIXTURE_BACKEND_HOME,
  applySettingsPatch,
  backendContextFromSession,
  createLanyardAgentFakeBackendRuntimeService,
  createSettingsCron,
  createSettingsHandlers,
  cronCreateUpdateIsAdvertised,
  cronPatchIsAdvertised,
  getSettingsSnapshot,
  parseSettingsPatchInput,
  patchSettingsCron,
  uiStateFromCapabilities,
  type BackendRuntimeContext,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const EXAMPLES = join(
  REPO_ROOT,
  "contracts",
  "backend-runtime-v1",
  "examples",
);

function testContext(): BackendRuntimeContext {
  return backendContextFromSession({
    tenantId: "tenant_demo",
    instanceId: "inst_la",
    userId: "user_1",
    sessionId: "sess_la",
    profileName: "admin",
    pathPrefixes: [],
    roles: ["admin"],
  });
}

function isHermesInstallHome(path: string | null | undefined): boolean {
  if (!path) return false;
  const n = path.replace(/\\/g, "/");
  return (
    n === "~/.hermes" ||
    n.endsWith("/.hermes") ||
    n.includes("/.hermes/") ||
    n === "/home/hermes/.hermes"
  );
}

describe("lp-uxy.3 LA cron under LA home (not Hermes)", () => {
  it("contract fixtures use LA backend_home and never Hermes install home", () => {
    const jobs = JSON.parse(
      readFileSync(join(EXAMPLES, "lanyard-agent.cron.jobs.json"), "utf8"),
    ) as { jobs: Array<{ id: string }> };
    expect(jobs.jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs.jobs.some((j) => j.id.startsWith("la-"))).toBe(true);

    const snapWire = JSON.parse(
      readFileSync(
        join(EXAMPLES, "brain-rpc.settings-snapshot.lanyard-agent.result.json"),
        "utf8",
      ),
    ) as {
      result: {
        backend_home: string;
        hermes_home?: string;
        source: string;
        crons: Array<{ id: string; path?: string }>;
      };
    };
    const home = snapWire.result.backend_home;
    expect(home).toBe("/var/lib/lanyard-agent");
    expect(isHermesInstallHome(home)).toBe(false);
    expect(isHermesInstallHome(snapWire.result.hermes_home)).toBe(false);
    expect(snapWire.result.source).toBe("lanyard_agent");
    expect(snapWire.result.crons.length).toBeGreaterThanOrEqual(1);
    for (const c of snapWire.result.crons) {
      expect(c.path).toBe("cron/jobs.json");
    }

    const baselineCaps = JSON.parse(
      readFileSync(join(EXAMPLES, "capabilities.lanyard-agent.json"), "utf8"),
    ) as { features: { cron: boolean }; ui_affordances: { cron_manager: string } };
    expect(baselineCaps.features.cron).toBe(false);
    expect(baselineCaps.ui_affordances.cron_manager).toBe("unsupported");

    const cronCaps = JSON.parse(
      readFileSync(
        join(EXAMPLES, "capabilities.lanyard-agent.cron.json"),
        "utf8",
      ),
    ) as {
      features: { cron: boolean };
      brain_rpc_methods: string[];
      ui_affordances: { cron_manager: string };
    };
    expect(cronCaps.features.cron).toBe(true);
    expect(cronCaps.brain_rpc_methods).toEqual(
      expect.arrayContaining(["cron.list", "cron.patch"]),
    );
    expect(cronCaps.ui_affordances.cron_manager).toBe("supported");
  });

  it("settings.snapshot includes crons under LA BACKEND_HOME", async () => {
    const service = createLanyardAgentFakeBackendRuntimeService();
    const ctx = testContext();
    const snap = await getSettingsSnapshot(service, ctx);

    expect(snap.source).toBe("lanyard_agent");
    expect(snap.backend_home).toBe(LANYARD_AGENT_FIXTURE_BACKEND_HOME);
    expect(isHermesInstallHome(snap.backend_home)).toBe(false);
    expect(isHermesInstallHome(snap.hermes_home)).toBe(false);
    expect(snap.crons?.length).toBe(3);
    expect(snap.crons?.map((c) => c.id)).toEqual([
      "la-vault-index",
      "la-weekly-digest",
      "la-manual-start",
    ]);
    for (const c of snap.crons ?? []) {
      expect(c.path).toBe("cron/jobs.json");
    }
    // lp-su0: host job state surfaces for start-job Status indicator
    expect(snap.crons?.find((c) => c.id === "la-manual-start")?.state).toBe(
      "running",
    );
  });

  it("Portal Settings path can list and toggle LA crons via settings.patch", async () => {
    const service = createLanyardAgentFakeBackendRuntimeService({
      supportPatchSettings: true,
      advertiseDedicatedCronRpcs: false,
    });
    const ctx = testContext();
    const caps = await service.capabilities(ctx);

    // Honest: no dedicated cron RPCs → features.cron false
    expect(caps.kind).toBe("lanyard_agent");
    expect(caps.features.cron).toBe(false);
    expect(caps.features.settings_patch).toBe(true);
    expect(caps.brain_rpc_methods).not.toContain("cron.list");
    expect(caps.brain_rpc_methods).not.toContain("cron.patch");
    expect(caps.brain_rpc_methods).toContain("settings.patch");
    // settings.patch still advertises cron enable path
    expect(cronPatchIsAdvertised(caps)).toBe(true);

    const handlers = createSettingsHandlers(service);
    const before = await handlers.snapshot(ctx);
    expect(before.crons?.find((c) => c.id === "la-vault-index")?.enabled).toBe(
      true,
    );

    const patched = await patchSettingsCron(service, ctx, "la-vault-index", {
      enabled: false,
    });
    expect(patched.cron.id).toBe("la-vault-index");
    expect(patched.cron.enabled).toBe(false);
    expect(patched.source).toBe("fake");

    const after = await getSettingsSnapshot(service, ctx, {
      params: { include: ["crons"] },
    });
    expect(after.crons?.find((c) => c.id === "la-vault-index")?.enabled).toBe(
      false,
    );

    // Direct applySettingsPatch path (same op Settings BFF uses)
    const reenable = await applySettingsPatch(service, ctx, {
      op: "cron.set_enabled",
      cronId: "la-vault-index",
      enabled: true,
    });
    expect(reenable.cron?.enabled).toBe(true);
  });

  it("capability flags honest: cron_manager unsupported without dedicated RPCs", async () => {
    const service = createLanyardAgentFakeBackendRuntimeService({
      advertiseDedicatedCronRpcs: false,
    });
    const caps = await service.capabilities(testContext());
    const ui = uiStateFromCapabilities(caps);

    expect(caps.features.cron).toBe(false);
    expect(caps.ui_affordances?.cron_manager).toBe("unsupported");
    expect(ui.can.cron_manage).toBe(false);
    // Settings edit still on via settings.patch
    expect(ui.can.settings_edit).toBe(true);
  });

  it("when dedicated cron RPCs advertised, features.cron and cron_manager are true", async () => {
    const service = createLanyardAgentFakeBackendRuntimeService({
      advertiseDedicatedCronRpcs: true,
    });
    const caps = await service.capabilities(testContext());
    const ui = uiStateFromCapabilities(caps);

    expect(caps.features.cron).toBe(true);
    expect(caps.brain_rpc_methods).toEqual(
      expect.arrayContaining(["cron.list", "cron.patch"]),
    );
    expect(caps.ui_affordances?.cron_manager).toBe("supported");
    expect(ui.can.cron_manage).toBe(true);

    const snap = await getSettingsSnapshot(service, testContext());
    expect(snap.crons?.length).toBeGreaterThan(0);
    expect(snap.backend_home).toBe(LANYARD_AGENT_FIXTURE_BACKEND_HOME);
  });

  it("never claims Hermes install home for LA-created job store paths", async () => {
    const service = createLanyardAgentFakeBackendRuntimeService();
    const snap = await service.settingsSnapshot(testContext());
    const home = snap.backend_home ?? "";
    expect(home.length).toBeGreaterThan(0);
    expect(home).toMatch(/lanyard-agent/);
    expect(isHermesInstallHome(home)).toBe(false);
    // Job path is contract-relative under BACKEND_HOME, not an absolute Hermes path
    for (const c of snap.crons ?? []) {
      expect(c.path).not.toMatch(/\.hermes/);
      expect(c.path).toBe("cron/jobs.json");
    }
  });

  it("lp-su0: empty LA inventory still has Settings path when patch advertised", async () => {
    const service = createLanyardAgentFakeBackendRuntimeService({
      supportPatchSettings: true,
      advertiseDedicatedCronRpcs: false,
      settings: {
        exported_at: "2026-08-04T12:00:00.000Z",
        source: "lanyard_agent",
        backend_home: LANYARD_AGENT_FIXTURE_BACKEND_HOME,
        hermes_home: LANYARD_AGENT_FIXTURE_BACKEND_HOME,
        skills: [],
        crons: [],
        mcp_servers: [],
        models: [],
        integrations: [],
      },
    });
    const ctx = testContext();
    const caps = await service.capabilities(ctx);
    const snap = await getSettingsSnapshot(service, ctx);

    expect(snap.source).toBe("lanyard_agent");
    expect(snap.crons).toEqual([]);
    expect(caps.features.cron).toBe(false);
    expect(cronPatchIsAdvertised(caps)).toBe(true);
  });
});

describe("lp-uxy.4 NL job creation + Settings refresh (LA pin)", () => {
  it("agent cronjob create writes durable job under LA home (not Hermes)", async () => {
    const service = createLanyardAgentFakeBackendRuntimeService({
      // Product path: features.cron still false; agent tools write jobs.json.
      advertiseDedicatedCronRpcs: false,
      supportPatchSettings: true,
    });
    const ctx = testContext();
    const before = await getSettingsSnapshot(service, ctx);
    const beforeIds = new Set((before.crons ?? []).map((c) => c.id));
    expect(beforeIds.has("daily-nl-created")).toBe(false);

    const created = service.createCronJobFromAgent({
      id: "daily-nl-created",
      name: "Daily NL-created job",
      schedule: "0 9 * * *",
      enabled: true,
      next_run_at: "2026-08-05T09:00:00.000Z",
    });

    expect(created.id).toBe("daily-nl-created");
    expect(created.path).toBe("cron/jobs.json");
    expect(created.path).not.toMatch(/\.hermes/);

    const after = await getSettingsSnapshot(service, ctx);
    expect(isHermesInstallHome(after.backend_home)).toBe(false);
    expect(after.backend_home).toBe(LANYARD_AGENT_FIXTURE_BACKEND_HOME);
    const found = after.crons?.find((c) => c.id === "daily-nl-created");
    expect(found).toBeDefined();
    expect(found?.name).toBe("Daily NL-created job");
    expect(found?.schedule).toBe("0 9 * * *");
    expect(found?.path).toBe("cron/jobs.json");
    // Seed jobs still present
    expect(after.crons?.some((c) => c.id === "la-vault-index")).toBe(true);
  });

  it("Settings snapshot after agent create lists the new job (refresh path input)", async () => {
    const service = createLanyardAgentFakeBackendRuntimeService();
    const handlers = createSettingsHandlers(service);
    const ctx = testContext();

    service.createCronJobFromAgent({
      id: "weekly-report",
      name: "Weekly report",
      schedule: "0 10 * * 1",
    });

    // Portal GET /api/settings/snapshot → settings.snapshot (same as inventory refresh)
    const snap = await handlers.snapshot(ctx);
    expect(snap.crons?.map((c) => c.id)).toEqual(
      expect.arrayContaining(["la-vault-index", "weekly-report"]),
    );
  });

  it("fails clearly when product cron / agent create is disabled (capability.cron off)", () => {
    const service = createLanyardAgentFakeBackendRuntimeService({
      supportAgentCronCreate: false,
      advertiseDedicatedCronRpcs: false,
    });

    expect(service.supportAgentCronCreate).toBe(false);

    try {
      service.createCronJobFromAgent({
        id: "should-fail",
        name: "Should fail",
        schedule: "0 0 * * *",
      });
      expect.fail("expected BackendRuntimeError");
    } catch (err) {
      expect(err).toBeInstanceOf(BackendRuntimeError);
      const e = err as BackendRuntimeError;
      expect(e.code).toBe("not_implemented");
      expect(e.message).toMatch(/Cron job creation is unavailable/i);
      expect(e.message).toMatch(/capability\.cron/i);
    }
  });
});

describe("lp-jzl.3 Brain RPC cron.create / cron.update (Portal without chat tool)", () => {
  it("creates full scheduled task via settings.patch cron.create under LA jobs.json path", async () => {
    const service = createLanyardAgentFakeBackendRuntimeService({
      advertiseDedicatedCronRpcs: true,
      supportPatchSettings: true,
    });
    const ctx = testContext();
    const caps = await service.capabilities(ctx);
    expect(caps.features.cron).toBe(true);
    expect(cronCreateUpdateIsAdvertised(caps)).toBe(true);

    const created = await createSettingsCron(service, ctx, {
      name: "Weekly digest",
      prompt: "Summarize last week's vault changes for the team.",
      enabled: true,
      schedule: {
        kind: "cron",
        expr: "0 9 * * 1-5",
        display: "Weekdays at 9:00 AM (America/New_York)",
        timezone: "America/New_York",
      },
    });

    expect(created.cron.name).toBe("Weekly digest");
    expect(created.cron.path).toBe("cron/jobs.json");
    expect(created.cron.prompt).toMatch(/Summarize/);
    expect(created.cron.enabled).toBe(true);
    expect(created.cron.schedule).toEqual(
      expect.objectContaining({
        kind: "cron",
        expr: "0 9 * * 1-5",
        timezone: "America/New_York",
      }),
    );
    expect(isHermesInstallHome(created.cron.path)).toBe(false);

    const snap = await getSettingsSnapshot(service, ctx);
    expect(snap.crons?.some((c) => c.id === created.cron.id)).toBe(true);
    expect(snap.backend_home).toBe(LANYARD_AGENT_FIXTURE_BACKEND_HOME);
  });

  it("stores skill ids from snapshot inventory on cron.create (lp-jzl.9.2)", async () => {
    const service = createLanyardAgentFakeBackendRuntimeService({
      advertiseDedicatedCronRpcs: true,
      supportPatchSettings: true,
    });
    const ctx = testContext();

    // Inventory source of truth: settings.snapshot skills (same as Settings).
    const snapBefore = await getSettingsSnapshot(service, ctx, {
      params: { include: ["skills"] },
    });
    const inventoryIds = (snapBefore.skills ?? []).map((s) => s.id);
    expect(inventoryIds).toContain("post-meeting-triage");

    const created = await createSettingsCron(service, ctx, {
      id: "st-skills-attach",
      name: "Skill-bound digest",
      prompt: "Run post-meeting triage on the vault inbox.",
      enabled: true,
      schedule: {
        kind: "cron",
        expr: "0 9 * * 1",
        display: "Weekly on Monday at 9:00 AM (UTC)",
        timezone: "UTC",
      },
      // Attach skill ids from inventory — no separate registry.
      skills: ["post-meeting-triage"],
    });

    expect(created.cron.id).toBe("st-skills-attach");
    expect(created.cron.skills).toEqual(["post-meeting-triage"]);
    expect(created.cron.path).toBe("cron/jobs.json");

    const snap = await getSettingsSnapshot(service, ctx, {
      params: { include: ["crons", "skills"] },
    });
    const job = snap.crons?.find((c) => c.id === "st-skills-attach");
    expect(job?.skills).toEqual(["post-meeting-triage"]);

    // cron.update can replace skills list
    const handlers = createSettingsHandlers(service);
    const updated = await handlers.patchCron(ctx, "st-skills-attach", {
      skills: [],
    });
    expect(updated.cron.skills).toEqual([]);
  });

  it("updates name, prompt, schedule, enabled via cron.update", async () => {
    const service = createLanyardAgentFakeBackendRuntimeService({
      advertiseDedicatedCronRpcs: true,
    });
    const ctx = testContext();
    const handlers = createSettingsHandlers(service);

    const created = await handlers.createCron(ctx, {
      id: "st-update-me",
      name: "Original",
      instructions: "Original prompt",
      schedule: { kind: "cron", expr: "0 9 * * 1", timezone: "UTC" },
    });
    expect(created.cron.id).toBe("st-update-me");

    const updated = await handlers.patchCron(ctx, "st-update-me", {
      name: "Renamed task",
      prompt: "Updated instructions",
      enabled: false,
      schedule: {
        kind: "cron",
        expr: "30 18 * * 0,6",
        display: "Weekends at 6:30 PM (America/New_York)",
        timezone: "America/New_York",
      },
    });

    expect(updated.cron.name).toBe("Renamed task");
    expect(updated.cron.prompt).toBe("Updated instructions");
    expect(updated.cron.enabled).toBe(false);
    expect(updated.cron.schedule).toEqual(
      expect.objectContaining({
        expr: "30 18 * * 0,6",
        timezone: "America/New_York",
      }),
    );

    // enabled-only still uses cron.set_enabled
    const toggled = await handlers.patchCron(ctx, "st-update-me", {
      enabled: true,
    });
    expect(toggled.cron.enabled).toBe(true);
  });

  it("honest capabilities: settings_patch alone does not advertise create", async () => {
    const service = createLanyardAgentFakeBackendRuntimeService({
      advertiseDedicatedCronRpcs: false,
      supportPatchSettings: true,
    });
    const ctx = testContext();
    const caps = await service.capabilities(ctx);

    expect(caps.features.settings_patch).toBe(true);
    expect(caps.features.cron).toBe(false);
    expect(cronPatchIsAdvertised(caps)).toBe(true); // enable still ok
    expect(cronCreateUpdateIsAdvertised(caps)).toBe(false);

    await expect(
      createSettingsCron(service, ctx, {
        name: "Should fail",
        prompt: "nope",
        schedule: "0 9 * * *",
      }),
    ).rejects.toMatchObject({
      code: "method_not_found",
    });
  });

  it("fails closed when host implements patch but not create/update", async () => {
    const service = createLanyardAgentFakeBackendRuntimeService({
      advertiseDedicatedCronRpcs: true,
      supportCronCreateUpdate: false,
    });
    const ctx = testContext();
    // Capability gate passes (features.cron) but host refuses implement
    expect(cronCreateUpdateIsAdvertised(await service.capabilities(ctx))).toBe(
      true,
    );

    await expect(
      applySettingsPatch(service, ctx, {
        op: "cron.create",
        name: "x",
        prompt: "y",
        schedule: "0 0 * * *",
      }),
    ).rejects.toMatchObject({ code: "not_implemented" });
  });

  it("contract examples for cron.create / cron.update are well-formed", () => {
    const createReq = JSON.parse(
      readFileSync(
        join(EXAMPLES, "brain-rpc.settings-patch.cron-create.request.json"),
        "utf8",
      ),
    ) as { method: string; params: Record<string, unknown> };
    const createRes = JSON.parse(
      readFileSync(
        join(EXAMPLES, "brain-rpc.settings-patch.cron-create.result.json"),
        "utf8",
      ),
    ) as { result: { op: string; cron: { id: string; schedule: unknown } } };
    const updateReq = JSON.parse(
      readFileSync(
        join(EXAMPLES, "brain-rpc.settings-patch.cron-update.request.json"),
        "utf8",
      ),
    ) as { params: Record<string, unknown> };

    expect(createReq.method).toBe("settings.patch");
    expect(createReq.params.op).toBe("cron.create");
    expect(createRes.result.op).toBe("cron.create");
    expect(createRes.result.cron.id).toBeTruthy();
    expect(createRes.result.cron.schedule).toEqual(
      expect.objectContaining({ timezone: "America/New_York" }),
    );
    expect(updateReq.params.op).toBe("cron.update");
    expect(updateReq.params.cron_id).toBeTruthy();

    // Domain parse accepts create wire body
    const parsed = parseSettingsPatchInput(createReq.params);
    expect(parsed.op).toBe("cron.create");
  });
});
