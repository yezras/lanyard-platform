import { describe, expect, it, vi } from "vitest";
import {
  BackendRuntimeError,
  createAgentProjectsHandlers,
  createSettingsHandlers,
  createVaultHandlers,
} from "@lanyard/backend-runtime";

import {
  createProductionBackendRuntimeService,
  createRelayBrainRpcInvoker,
} from "../src/backend-runtime-compose.js";
import {
  BRAIN_RPC_CONTRACT_VERSION,
  buildBrainRpcRequest,
  stampBrainRpcAuth,
} from "../src/brain-rpc.js";
import type { RelayClient } from "../src/relay-client.js";

function makeCtx() {
  return {
    tenantId: "t1",
    instanceId: "i1",
    userId: "u1",
    sessionId: "s1",
    profile: {
      name: "contributor",
      pathPrefixes: ["/Projects"],
      hermesProfileAlias: "contributor",
    },
    roles: ["contributor"],
  };
}

describe("createRelayBrainRpcInvoker", () => {
  it("returns host result payload on successful relay delivery", async () => {
    const invokeBrainRpc = vi.fn().mockResolvedValue({
      ok: true as const,
      result: {
        type: "brain_rpc_result",
        contract_version: BRAIN_RPC_CONTRACT_VERSION,
        request_id: "req1",
        ok: true,
        result: {
          projects: [{ id: "p1", name: "A", primary_path: "/A" }],
          source: "brain_rpc",
        },
        error: null,
        meta: null,
      },
    });

    const invoker = createRelayBrainRpcInvoker({
      invokeBrainRpc,
    } as unknown as RelayClient);

    const raw = await invoker({
      method: "projects.list",
      params: { include_archived: false },
      ctx: makeCtx(),
    });

    expect(raw).toMatchObject({
      projects: [{ id: "p1", name: "A" }],
      source: "brain_rpc",
    });
    expect(invokeBrainRpc).toHaveBeenCalledOnce();
    const call = invokeBrainRpc.mock.calls[0]![0];
    expect(call.instanceId).toBe("i1");
    expect(call.tenantId).toBe("t1");
    expect(call.request.method).toBe("projects.list");
    expect(call.request.auth.subject.hermes_profile).toBe("contributor");
  });

  it("maps relay transport failure to BackendRuntimeError unavailable", async () => {
    const invoker = createRelayBrainRpcInvoker({
      invokeBrainRpc: vi.fn().mockResolvedValue({
        ok: false as const,
        status: 503,
        error: "gateway disconnected",
      }),
    } as unknown as RelayClient);

    await expect(
      invoker({
        method: "settings.snapshot",
        params: {},
        ctx: makeCtx(),
      }),
    ).rejects.toMatchObject({
      name: "BackendRuntimeError",
      code: "unavailable",
    });
  });

  it("maps host error frame to BackendRuntimeError", async () => {
    const invoker = createRelayBrainRpcInvoker({
      invokeBrainRpc: vi.fn().mockResolvedValue({
        ok: true as const,
        result: {
          type: "brain_rpc_result",
          contract_version: BRAIN_RPC_CONTRACT_VERSION,
          request_id: "req2",
          ok: false,
          result: null,
          error: {
            code: "forbidden",
            message: "path denied",
            retryable: false,
          },
          meta: null,
        },
      }),
    } as unknown as RelayClient);

    await expect(
      invoker({
        method: "projects.list",
        params: {},
        ctx: makeCtx(),
      }),
    ).rejects.toBeInstanceOf(BackendRuntimeError);
  });
});

describe("createProductionBackendRuntimeService", () => {
  it("lists projects via Brain RPC only (no local fixture port)", async () => {
    const invokeBrainRpc = vi.fn().mockImplementation(async (input: {
      request: { method: string };
    }) => {
      if (input.request.method === "projects.list") {
        return {
          ok: true as const,
          result: {
            type: "brain_rpc_result",
            contract_version: BRAIN_RPC_CONTRACT_VERSION,
            request_id: "r-list",
            ok: true,
            result: {
              projects: [
                {
                  id: "p_prod",
                  name: "Prod",
                  primary_path: "/Projects/Prod",
                },
              ],
              source: "brain_rpc",
            },
            error: null,
            meta: null,
          },
        };
      }
      throw new Error(`unexpected method ${input.request.method}`);
    });

    const service = createProductionBackendRuntimeService({
      invokeBrainRpc,
    } as unknown as RelayClient);
    const handlers = createAgentProjectsHandlers(service);
    const body = await handlers.list(makeCtx());

    expect(body.source).toBe("brain_rpc");
    expect(body.projects).toEqual([
      expect.objectContaining({ id: "p_prod", name: "Prod" }),
    ]);
  });

  it("loads settings.snapshot via Brain RPC", async () => {
    const invokeBrainRpc = vi.fn().mockResolvedValue({
      ok: true as const,
      result: {
        type: "brain_rpc_result",
        contract_version: BRAIN_RPC_CONTRACT_VERSION,
        request_id: "r-snap",
        ok: true,
        result: {
          exported_at: "2026-01-01T00:00:00.000Z",
          source: "brain_rpc",
          skills: [],
          crons: [],
          mcp_servers: [],
          models: [],
          integrations: [],
        },
        error: null,
        meta: null,
      },
    });

    const service = createProductionBackendRuntimeService({
      invokeBrainRpc,
    } as unknown as RelayClient);
    const handlers = createSettingsHandlers(service);
    const snap = await handlers.snapshot(makeCtx());

    expect(snap.source).toBe("brain_rpc");
    expect(snap.exported_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("creates projects via Brain RPC projects.create (lp-bih)", async () => {
    const invokeBrainRpc = vi.fn().mockImplementation(async (input: {
      request: { method: string; params?: Record<string, unknown> };
    }) => {
      const method = input.request.method;
      if (method === "brain.capabilities") {
        return {
          ok: true as const,
          result: {
            type: "brain_rpc_result",
            contract_version: BRAIN_RPC_CONTRACT_VERSION,
            request_id: "r-caps",
            ok: true,
            result: {
              schema_version: 1,
              brain_rpc_methods: ["projects.list", "projects.create"],
              features: { projects_list: true, projects_create: true },
            },
            error: null,
            meta: null,
          },
        };
      }
      if (method === "projects.create") {
        const name = String(input.request.params?.name ?? "");
        const folders = (input.request.params?.folders as string[]) ?? [];
        return {
          ok: true as const,
          result: {
            type: "brain_rpc_result",
            contract_version: BRAIN_RPC_CONTRACT_VERSION,
            request_id: "r-create",
            ok: true,
            result: {
              id: "p_new",
              name,
              slug: name.toLowerCase(),
              primary_path: folders[0] ?? null,
              folders: folders.map((path, i) => ({
                path,
                label: null,
                is_primary: i === 0,
              })),
            },
            error: null,
            meta: null,
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });

    const service = createProductionBackendRuntimeService({
      invokeBrainRpc,
    } as unknown as RelayClient);
    const handlers = createAgentProjectsHandlers(service);
    const created = await handlers.create(makeCtx(), {
      name: "Test",
      folders: ["/home/portal/Test"],
    });

    expect(created).toMatchObject({
      id: "p_new",
      name: "Test",
      primary_path: "/home/portal/Test",
    });
    expect(invokeBrainRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ method: "projects.create" }),
      }),
    );
  });

  it("refuses create when host does not advertise projects.create (lp-bih)", async () => {
    const invokeBrainRpc = vi.fn().mockImplementation(async (input: {
      request: { method: string };
    }) => {
      if (input.request.method === "brain.capabilities") {
        return {
          ok: true as const,
          result: {
            type: "brain_rpc_result",
            contract_version: BRAIN_RPC_CONTRACT_VERSION,
            request_id: "r-caps",
            ok: true,
            result: {
              schema_version: 1,
              brain_rpc_methods: ["projects.list"],
              features: { projects_list: true, projects_create: false },
            },
            error: null,
            meta: null,
          },
        };
      }
      throw new Error(`unexpected method ${input.request.method}`);
    });

    const service = createProductionBackendRuntimeService({
      invokeBrainRpc,
    } as unknown as RelayClient);
    const handlers = createAgentProjectsHandlers(service);

    await expect(
      handlers.create(makeCtx(), { name: "Test", folders: ["/home/portal/Test"] }),
    ).rejects.toMatchObject({
      name: "BackendRuntimeError",
      code: "method_not_found",
    });
    expect(invokeBrainRpc).not.toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ method: "projects.create" }),
      }),
    );
  });

  it("lists and reads vault via Brain RPC vault.list/read (no local fixture)", async () => {
    const invokeBrainRpc = vi.fn().mockImplementation(async (input: {
      request: { method: string; params?: Record<string, unknown> };
    }) => {
      const method = input.request.method;
      if (method === "vault.list") {
        return {
          ok: true as const,
          result: {
            type: "brain_rpc_result",
            contract_version: BRAIN_RPC_CONTRACT_VERSION,
            request_id: "r-vlist",
            ok: true,
            result: {
              path: "/Projects",
              entries: [
                {
                  name: "Prod",
                  path: "/Projects/Prod",
                  kind: "directory",
                },
              ],
              truncated: false,
              next_cursor: null,
            },
            error: null,
            meta: null,
          },
        };
      }
      if (method === "vault.stat") {
        return {
          ok: true as const,
          result: {
            type: "brain_rpc_result",
            contract_version: BRAIN_RPC_CONTRACT_VERSION,
            request_id: "r-vstat",
            ok: true,
            result: {
              name: "Projects",
              path: "/Projects",
              kind: "directory",
              mime_type: null,
              size_bytes: null,
              mtime: null,
            },
            error: null,
            meta: null,
          },
        };
      }
      if (method === "vault.read") {
        return {
          ok: true as const,
          result: {
            type: "brain_rpc_result",
            contract_version: BRAIN_RPC_CONTRACT_VERSION,
            request_id: "r-vread",
            ok: true,
            result: {
              path: "/Projects/Prod/readme.md",
              kind: "file",
              mime_type: "text/markdown",
              encoding: "utf-8",
              content: "# Host vault\n",
              size_bytes: 13,
            },
            error: null,
            meta: null,
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });

    const service = createProductionBackendRuntimeService({
      invokeBrainRpc,
    } as unknown as RelayClient);
    const vault = createVaultHandlers(service);

    const listed = await vault.list(makeCtx(), "/Projects");
    expect(listed.source).toBe("brain_rpc");
    expect(listed.entries).toEqual([
      expect.objectContaining({ path: "/Projects/Prod", kind: "directory" }),
    ]);

    const content = await vault.read(makeCtx(), "/Projects/Prod/readme.md");
    expect(content.source).toBe("brain_rpc");
    expect(content.content).toContain("Host vault");

    const methods = invokeBrainRpc.mock.calls.map(
      (c: [{ request: { method: string } }]) => c[0].request.method,
    );
    expect(methods).toContain("vault.list");
    expect(methods).toContain("vault.read");
  });

  it("vault tree soft-empties when host unavailable (fail-closed, no fixture)", async () => {
    const invokeBrainRpc = vi.fn().mockResolvedValue({
      ok: false as const,
      status: 503,
      error: "gateway disconnected",
    });

    const service = createProductionBackendRuntimeService({
      invokeBrainRpc,
    } as unknown as RelayClient);
    const vault = createVaultHandlers(service, { emptyOnUnavailable: true });
    const tree = await vault.tree(makeCtx());

    expect(tree.roots).toEqual([]);
    expect(tree.source).toBe("brain_rpc");
    expect(tree.unavailable).toBe(true);
  });
});

describe("stamp + build helpers still compose with invoker", () => {
  it("auth frame fields match BackendRuntimeContext", () => {
    const ctx = makeCtx();
    const auth = stampBrainRpcAuth({
      tenantId: ctx.tenantId,
      instanceId: ctx.instanceId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      rbac: {
        hermes_profile: ctx.profile.hermesProfileAlias!,
        allowed_path_prefixes: ctx.profile.pathPrefixes,
        role_names: ctx.roles,
      },
    });
    const request = buildBrainRpcRequest({
      method: "settings.snapshot",
      auth,
      params: {},
    });
    expect(request.auth.tenant_id).toBe("t1");
    expect(request.method).toBe("settings.snapshot");
  });
});
