/**
 * Brain RPC required-method conformance (lp-k7g.11.3).
 *
 * Offline suite using FakeBackendRuntimeService / createFakeBrainRpcInvoker.
 * Covers acceptance criteria for phase-7 backend conformance without a live
 * Hermes host:
 *   - brain.ping returns success
 *   - brain.health returns status
 *   - vault.list / vault.stat / vault.read enforce ACLs (contributor vs admin)
 *   - settings.snapshot and projects.list return schema-valid responses
 *
 * Companion Python harness suite:
 *   contracts/backend-runtime-v1/harness/run_brain_rpc_conformance.py
 */

import { describe, expect, it } from "vitest";

import {
  REQUIRED_BRAIN_RPC_METHODS,
  assertRequiredBrainRpcMethods,
  backendContextFromSession,
  createFakeBrainRpcInvoker,
  type BackendRuntimeContext,
  type SettingsSnapshot,
} from "../src/index.js";

/** Contributor: day-to-day authoring under /Projects only. */
function contributorContext(
  overrides?: Partial<BackendRuntimeContext>,
): BackendRuntimeContext {
  return {
    ...backendContextFromSession({
      tenantId: "tenant_conformance",
      instanceId: "inst_conformance",
      userId: "user_contrib",
      sessionId: "sess_contrib",
      profileName: "contributor",
      pathPrefixes: ["/Projects"],
      roles: ["contributor"],
    }),
    ...overrides,
  };
}

/** Admin: full vault via path_prefixes ["/"]. */
function adminContext(
  overrides?: Partial<BackendRuntimeContext>,
): BackendRuntimeContext {
  return {
    ...backendContextFromSession({
      tenantId: "tenant_conformance",
      instanceId: "inst_conformance",
      userId: "user_admin",
      sessionId: "sess_admin",
      profileName: "admin",
      pathPrefixes: ["/"],
      roles: ["admin"],
    }),
    ...overrides,
  };
}

function seededOptions() {
  return {
    projects: [
      {
        id: "proj_legal",
        slug: "legal",
        name: "Legal",
        primary_path: "/Projects/Legal",
        folders: [
          { path: "/Projects/Legal", label: null, is_primary: true },
        ],
      },
    ],
    settings: {
      exported_at: "2026-07-12T00:00:00.000Z",
      source: "fake",
      backend_home: "/tmp/fake-backend-home",
      hermes_home: "/tmp/fake-backend-home",
      skills: [
        {
          id: "summarize",
          name: "summarize",
          enabled: true,
          path: "skills/summarize",
        },
      ],
      crons: [
        {
          id: "nightly",
          name: "Nightly",
          schedule: "0 6 * * *",
          enabled: true,
        },
      ],
      mcp_servers: [
        { name: "filesystem", transport: "stdio", enabled: true },
      ],
      models: [
        {
          provider: "openai",
          model: "gpt-4.1",
          is_active: true,
          connected: true,
        },
      ],
      integrations: [],
    } satisfies SettingsSnapshot,
    files: [
      {
        path: "/Projects/Legal/memo.md",
        content: "# Memo\n\nConformance test body.\n",
        mime_type: "text/markdown",
      },
      {
        path: "/Projects/Legal/exhibits/a.txt",
        content: "exhibit-a",
        mime_type: "text/plain",
      },
      {
        path: "/Secrets/key.txt",
        content: "super-secret",
        mime_type: "text/plain",
      },
    ],
  } as const;
}

// ---------------------------------------------------------------------------
// brain.ping
// ---------------------------------------------------------------------------

describe("conformance: brain.ping returns success", () => {
  it("pong + echo + instance_id + contract_version", async () => {
    const invoke = createFakeBrainRpcInvoker(seededOptions());
    const result = (await invoke({
      method: "brain.ping",
      params: { echo: "hello" },
      ctx: contributorContext(),
    })) as Record<string, unknown>;

    expect(result.pong).toBe(true);
    expect(result.echo).toBe("hello");
    expect(result.instance_id).toBe("inst_conformance");
    expect(result.contract_version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// brain.health
// ---------------------------------------------------------------------------

describe("conformance: brain.health returns status", () => {
  it("status enum + checks + versions + profile", async () => {
    const invoke = createFakeBrainRpcInvoker(seededOptions());
    const result = (await invoke({
      method: "brain.health",
      params: {},
      ctx: adminContext(),
    })) as Record<string, unknown>;

    expect(["ok", "degraded", "unavailable"]).toContain(result.status);
    expect(result.status).toBe("ok");
    expect(result.checks).toBeTypeOf("object");
    expect(result.versions).toBeTypeOf("object");
    expect(result.profile).toBe("admin");
    const versions = result.versions as Record<string, unknown>;
    expect(versions.brain_rpc).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// vault ACL: contributor vs admin
// ---------------------------------------------------------------------------

describe("conformance: vault.list/stat/read enforce ACLs", () => {
  it("contributor may list/stat/read under /Projects", async () => {
    const invoke = createFakeBrainRpcInvoker(seededOptions());
    const ctx = contributorContext();

    const listed = (await invoke({
      method: "vault.list",
      params: { path: "/Projects/Legal" },
      ctx,
    })) as {
      path: string;
      entries: { name: string; kind: string }[];
      truncated: boolean;
    };
    expect(listed.path).toBe("/Projects/Legal");
    expect(listed.truncated).toBe(false);
    expect(listed.entries.some((e) => e.name === "memo.md")).toBe(true);
    expect(listed.entries.some((e) => e.name === "exhibits")).toBe(true);

    const stat = (await invoke({
      method: "vault.stat",
      params: { path: "/Projects/Legal/memo.md" },
      ctx,
    })) as { kind: string; name: string; path: string };
    expect(stat.kind).toBe("file");
    expect(stat.name).toBe("memo.md");

    const body = (await invoke({
      method: "vault.read",
      params: { path: "/Projects/Legal/memo.md", max_bytes: 1_048_576 },
      ctx,
    })) as { content: string; kind: string; encoding: string; size_bytes: number };
    expect(body.kind).toBe("file");
    expect(body.encoding).toMatch(/utf-8|base64/);
    expect(body.content).toContain("Conformance test body");
    expect(body.size_bytes).toBeGreaterThan(0);
  });

  it("contributor is forbidden outside path prefixes", async () => {
    const invoke = createFakeBrainRpcInvoker(seededOptions());
    const ctx = contributorContext();

    await expect(
      invoke({
        method: "vault.list",
        params: { path: "/Secrets" },
        ctx,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    await expect(
      invoke({
        method: "vault.stat",
        params: { path: "/Secrets/key.txt" },
        ctx,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    await expect(
      invoke({
        method: "vault.read",
        params: { path: "/Secrets/key.txt" },
        ctx,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("admin pathPrefixes=/ can list root and read secrets", async () => {
    const invoke = createFakeBrainRpcInvoker(seededOptions());
    const ctx = adminContext();

    const root = (await invoke({
      method: "vault.list",
      params: { path: "/" },
      ctx,
    })) as { entries: { name: string }[] };
    const names = root.entries.map((e) => e.name);
    expect(names).toContain("Projects");
    expect(names).toContain("Secrets");

    const secret = (await invoke({
      method: "vault.read",
      params: { path: "/Secrets/key.txt" },
      ctx,
    })) as { content: string };
    expect(secret.content).toBe("super-secret");

    const stat = (await invoke({
      method: "vault.stat",
      params: { path: "/Secrets/key.txt" },
      ctx,
    })) as { kind: string };
    expect(stat.kind).toBe("file");
  });

  it("same path: admin allowed, contributor forbidden", async () => {
    const invoke = createFakeBrainRpcInvoker(seededOptions());
    const path = "/Secrets/key.txt";

    const adminStat = (await invoke({
      method: "vault.stat",
      params: { path },
      ctx: adminContext(),
    })) as { path: string };
    expect(adminStat.path).toBe(path);

    await expect(
      invoke({
        method: "vault.stat",
        params: { path },
        ctx: contributorContext(),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

// ---------------------------------------------------------------------------
// settings.snapshot + projects.list schema-valid responses
// ---------------------------------------------------------------------------

describe("conformance: settings.snapshot and projects.list schema-valid", () => {
  it("settings.snapshot has required fields and no secret-shaped keys", async () => {
    const invoke = createFakeBrainRpcInvoker(seededOptions());
    const snap = (await invoke({
      method: "settings.snapshot",
      params: {},
      ctx: contributorContext(),
    })) as SettingsSnapshot;

    expect(typeof snap.exported_at).toBe("string");
    expect(snap.exported_at.length).toBeGreaterThan(0);
    expect(snap.source).toBe("fake");
    expect(
      typeof snap.backend_home === "string" || typeof snap.hermes_home === "string",
    ).toBe(true);
    expect(Array.isArray(snap.skills)).toBe(true);
    expect(snap.skills?.[0]?.id).toBe("summarize");

    const blob = JSON.stringify(snap);
    expect(blob).not.toMatch(/"api_key"|"password"|"private_key"/i);
    expect(blob).not.toContain("super-secret");
  });

  it("projects.list has projects array + source + project id/name", async () => {
    const invoke = createFakeBrainRpcInvoker(seededOptions());
    const listed = (await invoke({
      method: "projects.list",
      params: { include_archived: false },
      ctx: contributorContext(),
    })) as {
      projects: { id: string; name: string; slug?: string }[];
      source: string;
    };

    expect(Array.isArray(listed.projects)).toBe(true);
    expect(typeof listed.source).toBe("string");
    expect(listed.source).toBe("fake");
    expect(listed.projects).toHaveLength(1);
    expect(listed.projects[0]?.id).toBe("proj_legal");
    expect(listed.projects[0]?.name).toBe("Legal");
  });
});

// ---------------------------------------------------------------------------
// Catalog coverage
// ---------------------------------------------------------------------------

describe("conformance: required method catalog", () => {
  it("FakeBrainRpcInvoker implements all seven required methods", async () => {
    const invoke = createFakeBrainRpcInvoker(seededOptions());
    assertRequiredBrainRpcMethods(invoke.supportedMethods());
    expect([...REQUIRED_BRAIN_RPC_METHODS].sort()).toEqual(
      [
        "brain.health",
        "brain.ping",
        "projects.list",
        "settings.snapshot",
        "vault.list",
        "vault.read",
        "vault.stat",
      ].sort(),
    );

    const ctx = adminContext();
    for (const method of REQUIRED_BRAIN_RPC_METHODS) {
      const params: Record<string, unknown> =
        method === "brain.ping"
          ? { echo: "catalog" }
          : method.startsWith("vault.")
            ? {
                path:
                  method === "vault.list"
                    ? "/Projects/Legal"
                    : "/Projects/Legal/memo.md",
              }
            : {};
      const result = await invoke({ method, params, ctx });
      expect(result).toBeTruthy();
    }
  });
});
