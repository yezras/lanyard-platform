import { afterEach, describe, expect, it, vi } from "vitest";

import { resetCsrfToken } from "./client.js";
import {
  createSettingsCron,
  fetchSettingsCronDetail,
  fetchSettingsHostContent,
  fetchSettingsHostList,
  fetchSettingsSnapshot,
  createSettingsCron,
  patchSettingsCron,
  patchSettingsSkill,
  refreshSettingsHealth,
} from "./settings.js";
import type { SettingsHealthCheckResponse, SettingsSnapshot } from "./types.js";

const snapshotFixture: SettingsSnapshot = {
  exported_at: "2026-07-01T08:00:00.000Z",
  skills: [
    {
      id: "post-meeting-triage",
      name: "Post-meeting triage",
      path: "skills/crm/post-meeting-triage",
      enabled: true,
    },
  ],
  crons: [
    {
      id: "vault-index",
      name: "Vault index refresh",
      schedule: "Daily at 3:00 AM",
      enabled: true,
      last_run_at: "2026-07-01T03:00:12.000Z",
      next_run_at: "2026-07-02T03:00:00.000Z",
    },
  ],
  mcp_servers: [{ name: "gmail", transport: "stdio", command: "gws" }],
  models: [{ provider: "xai", model: "grok-3", is_active: true, connected: true }],
  integrations: [{ id: "gmail", name: "Gmail", type: "mcp" }],
};

const healthFixture: SettingsHealthCheckResponse = {
  checked_at: "2026-07-01T08:05:00.000Z",
  integrations: [
    {
      id: "gmail",
      name: "Gmail",
      type: "mcp",
      status: "healthy",
      latency_ms: 40,
      checked_at: "2026-07-01T08:05:00.000Z",
      message: "Connection OK (mock)",
    },
  ],
};

function requestPath(input: RequestInfo | URL): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, "http://localhost").pathname;
}

describe("settings api", () => {
  afterEach(() => {
    resetCsrfToken();
    vi.unstubAllGlobals();
  });

  it("fetches the settings snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => snapshotFixture,
      }),
    );

    await expect(fetchSettingsSnapshot()).resolves.toEqual(snapshotFixture);

    expect(fetch).toHaveBeenCalledWith("/api/settings/snapshot", {
      credentials: "include",
    });
  });

  it("refreshes integration health", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(input);
      if (path === "/api/auth/csrf") {
        return Promise.resolve(
          new Response(JSON.stringify({ csrf_token: "token-1" }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(healthFixture), { status: 200 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshSettingsHealth()).resolves.toEqual(healthFixture);

    const healthCall = fetchMock.mock.calls.find(
      ([url]) => requestPath(url as string) === "/api/settings/health-check",
    );
    expect(healthCall?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({}),
    });
  });

  it("throws API errors with server message for snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      }),
    );

    await expect(fetchSettingsSnapshot()).rejects.toThrow("Unauthorized");
  });

  it("throws API errors with server message for health check", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/csrf") {
        return Promise.resolve(
          new Response(JSON.stringify({ csrf_token: "token-1" }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshSettingsHealth()).rejects.toThrow("Forbidden");
  });

  it("patches a skill enabled flag", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(input);
      if (path === "/api/auth/csrf") {
        return Promise.resolve(
          new Response(JSON.stringify({ csrf_token: "token-1" }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            skill: {
              id: "post-meeting-triage",
              name: "Post-meeting triage",
              enabled: false,
            },
            source: "fixture",
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(patchSettingsSkill("post-meeting-triage", false)).resolves.toMatchObject({
      skill: { id: "post-meeting-triage", enabled: false },
      source: "fixture",
    });

    const patchCall = fetchMock.mock.calls.find(
      ([url]) => requestPath(url as string) === "/api/settings/skills/post-meeting-triage",
    );
    expect(patchCall?.[1]).toMatchObject({
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify({ enabled: false }),
    });
  });

  it("patches a cron enabled flag", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/csrf") {
        return Promise.resolve(
          new Response(JSON.stringify({ csrf_token: "token-1" }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            cron: {
              id: "vault-index",
              name: "Vault index refresh",
              schedule: "Daily at 3:00 AM",
              enabled: false,
            },
            source: "fixture",
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(patchSettingsCron("vault-index", false)).resolves.toMatchObject({
      cron: { id: "vault-index", enabled: false },
    });

    const patchCall = fetchMock.mock.calls.find(
      ([url]) => requestPath(url as string) === "/api/settings/crons/vault-index",
    );
    expect(patchCall?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    });
  });

  it("patches cron instructions via body object (lp-lv9.5)", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/csrf") {
        return Promise.resolve(
          new Response(JSON.stringify({ csrf_token: "token-1" }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            cron: {
              id: "vault-index",
              name: "Vault index refresh",
              schedule: "Daily at 3:00 AM",
              enabled: true,
              prompt: "Updated prompt",
            },
            source: "fixture",
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      patchSettingsCron("vault-index", { prompt: "Updated prompt" }),
    ).resolves.toMatchObject({
      cron: { id: "vault-index", prompt: "Updated prompt" },
    });

    const patchCall = fetchMock.mock.calls.find(
      ([url]) => requestPath(url as string) === "/api/settings/crons/vault-index",
    );
    expect(patchCall?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ prompt: "Updated prompt" }),
    });
  });

  it("fetches settings host content by relative path (lp-a8u.8)", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            path: "skills/crm/post-meeting-triage/SKILL.md",
            content: "# Skill\n",
            mime_type: "text/markdown; charset=utf-8",
            encoding: "utf-8",
          }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchSettingsHostContent("skills/crm/post-meeting-triage/SKILL.md"),
    ).resolves.toMatchObject({
      path: "skills/crm/post-meeting-triage/SKILL.md",
      content: "# Skill\n",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/content?path=skills%2Fcrm%2Fpost-meeting-triage%2FSKILL.md",
      { credentials: "include" },
    );
  });

  it("fetches settings host directory listing (lp-75r.4)", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            path: "skills/crm/post-meeting-triage",
            entries: [
              {
                name: "SKILL.md",
                path: "skills/crm/post-meeting-triage/SKILL.md",
                kind: "file",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchSettingsHostList("skills/crm/post-meeting-triage"),
    ).resolves.toMatchObject({
      path: "skills/crm/post-meeting-triage",
      entries: [{ name: "SKILL.md", kind: "file" }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/list?path=skills%2Fcrm%2Fpost-meeting-triage",
      { credentials: "include" },
    );
  });

  it("creates a scheduled task via POST /api/settings/crons (lp-jzl.5)", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/csrf") {
        return Promise.resolve(
          new Response(JSON.stringify({ csrf_token: "token-1" }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            cron: {
              id: "weekly-digest",
              name: "Weekly digest",
              schedule: "Weekdays at 9:00 AM (America/New_York)",
              enabled: true,
              prompt: "Summarize vault changes",
            },
            source: "lanyard_agent",
          }),
          { status: 201 },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createSettingsCron({
        name: "Weekly digest",
        prompt: "Summarize vault changes",
        enabled: true,
        schedule: {
          kind: "cron",
          expr: "0 9 * * 1-5",
          display: "Weekdays at 9:00 AM (America/New_York)",
          timezone: "America/New_York",
        },
      }),
    ).resolves.toMatchObject({
      cron: { id: "weekly-digest", name: "Weekly digest", enabled: true },
      source: "lanyard_agent",
    });

    const postCall = fetchMock.mock.calls.find(
      ([url]) => requestPath(url as string) === "/api/settings/crons",
    );
    expect(postCall?.[1]).toMatchObject({
      method: "POST",
    });
    const body = JSON.parse(String((postCall?.[1] as RequestInit).body));
    expect(body).toMatchObject({
      name: "Weekly digest",
      prompt: "Summarize vault changes",
      enabled: true,
      schedule: {
        kind: "cron",
        expr: "0 9 * * 1-5",
        timezone: "America/New_York",
      },
    });
    // No raw user-typed cron field — expr comes from scheduleCodec encode.
    expect(body.schedule.expr).toBe("0 9 * * 1-5");
  });

  it("fetches cron job detail (lp-a8u.8)", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: "vault-index",
            name: "Vault index",
            command: "vault-index --full",
          }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSettingsCronDetail("vault-index")).resolves.toMatchObject({
      id: "vault-index",
      command: "vault-index --full",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/crons/vault-index/detail",
      { credentials: "include" },
    );
  });

  it("creates a scheduled task via POST /api/settings/crons (lp-jzl.9.1)", async () => {
    const created = {
      cron: {
        id: "st-weekly-digest",
        name: "Weekly digest",
        schedule: {
          kind: "cron",
          expr: "0 9 * * 1-5",
          display: "Weekdays at 9:00 AM (America/New_York)",
          timezone: "America/New_York",
        },
        enabled: true,
        path: "cron/jobs.json",
        prompt: "Summarize last week's vault changes for the team.",
      },
      source: "lanyard_agent",
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/csrf") {
        return Promise.resolve(
          new Response(JSON.stringify({ csrf_token: "token-1" }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(created), { status: 201 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createSettingsCron({
      name: "Weekly digest",
      prompt: "Summarize last week's vault changes for the team.",
      schedule: {
        kind: "cron",
        expr: "0 9 * * 1-5",
        display: "Weekdays at 9:00 AM (America/New_York)",
        timezone: "America/New_York",
      },
      enabled: true,
    });
    expect(result.cron.id).toBe("st-weekly-digest");
    expect(result.cron.name).toBe("Weekly digest");

    const call = fetchMock.mock.calls.find(
      ([url]) => requestPath(url as string) === "/api/settings/crons",
    );
    expect(call?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
    });
  });

  it("posts skill ids on create body (lp-jzl.9.2)", async () => {
    const created = {
      cron: {
        id: "st-skills",
        name: "With skills",
        schedule: { kind: "cron", expr: "0 9 * * 1", timezone: "UTC" },
        enabled: true,
        path: "cron/jobs.json",
        prompt: "Use skill",
        skills: ["post-meeting-triage"],
      },
      source: "lanyard_agent",
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/csrf") {
        return Promise.resolve(
          new Response(JSON.stringify({ csrf_token: "token-1" }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(created), { status: 201 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createSettingsCron({
      name: "With skills",
      prompt: "Use skill",
      schedule: { kind: "cron", expr: "0 9 * * 1", timezone: "UTC" },
      skills: ["post-meeting-triage"],
    });
    expect(result.cron.skills).toEqual(["post-meeting-triage"]);

    const call = fetchMock.mock.calls.find(
      ([url]) => requestPath(url as string) === "/api/settings/crons",
    );
    const body = JSON.parse(String(call?.[1]?.body ?? "{}")) as {
      skills?: string[];
    };
    expect(body.skills).toEqual(["post-meeting-triage"]);
  });
});
