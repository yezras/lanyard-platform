import { describe, expect, it, vi } from "vitest";

import {
  resolveAgentWritePolicy,
  type ActivePathOwnership,
} from "@lanyard/shared";

import {
  BackendRuntimeError,
  FakeBackendRuntimeService,
  VAULT_LIST_METHOD,
  VAULT_LIST_PAGE_LIMIT,
  VAULT_READ_METHOD,
  VAULT_WRITE_INLINE_DEFAULT_MAX_BYTES,
  VAULT_WRITE_METHOD,
  backendContextFromSession,
  createFakeBackendRuntimeService,
  createFakeBrainRpcInvoker,
  createProductionHermesBackendRuntimeService,
  createVaultHandlers,
  filterVaultEntriesByAcl,
  getVaultTree,
  isVaultPathAllowedByPrefixes,
  listVaultEntries,
  normalizeVaultWirePath,
  parseAgentVaultWriteBody,
  parseBrowserVaultWriteBody,
  parseCallbackVaultWriteBody,
  readVaultContent,
  resolveAclPrefixes,
  vaultErrorToHttp,
  vaultWriteInputToWireParams,
  vaultWriteIsAdvertised,
  writeVaultContent,
  writeVaultFromBrowser,
  writeVaultFromCallback,
  type BackendRuntimeContext,
} from "../src/index.js";

function testContext(
  overrides?: Partial<BackendRuntimeContext>,
): BackendRuntimeContext {
  return {
    ...backendContextFromSession({
      tenantId: "tenant_demo",
      instanceId: "inst_1",
      userId: "user_1",
      sessionId: "sess_1",
      profileName: "contributor",
      pathPrefixes: ["/Projects/A"],
      roles: ["contributor"],
    }),
    ...overrides,
  };
}

const SAMPLE_FILES = [
  {
    path: "/Projects/A/README.md",
    content: "# Team A\n",
    mime_type: "text/markdown",
  },
  {
    path: "/Projects/A/notes.md",
    content: "kickoff notes",
    mime_type: "text/markdown",
  },
  {
    path: "/Projects/A/Subfolder/detail.md",
    content: "nested",
    mime_type: "text/markdown",
  },
  {
    path: "/Projects/B/secret.md",
    content: "secret",
    mime_type: "text/markdown",
  },
];

describe("normalizeVaultWirePath", () => {
  it("normalizes leading slash and trims", () => {
    expect(normalizeVaultWirePath("Projects/A")).toBe("/Projects/A");
    expect(normalizeVaultWirePath(" /Projects/A/ ")).toBe("/Projects/A");
    expect(normalizeVaultWirePath("/")).toBe("/");
  });

  it("rejects empty and .. segments", () => {
    expect(() => normalizeVaultWirePath("")).toThrow(BackendRuntimeError);
    expect(() => normalizeVaultWirePath("/a/../b")).toThrow(/Invalid vault path/);
  });

  it("projects host absolute Clients/Projects paths (lp-vnz.3)", () => {
    expect(
      normalizeVaultWirePath(
        "/home/operator/Lanyard/Clients/Active/Acme/AGENTS.md",
      ),
    ).toBe("/Clients/Active/Acme/AGENTS.md");
    expect(
      normalizeVaultWirePath("/opt/company-brain/Projects/Legal/memo.md"),
    ).toBe("/Projects/Legal/memo.md");
    // multi-root host folder without vault top-level — keep absolute
    expect(normalizeVaultWirePath("/home/u/Core/README.md")).toBe(
      "/home/u/Core/README.md",
    );
    expect(
      normalizeVaultWirePath(
        "/mnt/vault/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
      ),
    ).toBe("/workflows/runs/wf_03e3fb5b2224a1d2/state.json");
  });
});

describe("listVaultEntries / readVaultContent (FakeBackend)", () => {
  it("lists directory entries under ACL prefix", async () => {
    const service = createFakeBackendRuntimeService({ files: SAMPLE_FILES });
    const body = await listVaultEntries(
      service,
      testContext(),
      "/Projects/A",
    );
    expect(body.source).toBe("brain_rpc");
    expect(body.path).toBe("/Projects/A");
    const paths = body.entries.map((e) => e.path);
    expect(paths).toContain("/Projects/A/README.md");
    expect(paths).toContain("/Projects/A/Subfolder");
    expect(paths).not.toContain("/Projects/B/secret.md");
  });

  it("reads file content with source tag", async () => {
    const service = createFakeBackendRuntimeService({ files: SAMPLE_FILES });
    const body = await readVaultContent(
      service,
      testContext(),
      "/Projects/A/notes.md",
    );
    expect(body.source).toBe("brain_rpc");
    expect(body.kind).toBe("file");
    expect(body.encoding).toBe("utf-8");
    expect(body.content).toContain("kickoff");
    expect(body.mime_type).toBe("text/markdown");
  });

  it("reads workflow state.json from a guest /mnt/vault citation path (lp-oop.38.22)", async () => {
    const state = '{"run_id":"wf_03e3fb5b2224a1d2","status":"running"}\n';
    const service = createFakeBackendRuntimeService({
      files: [
        {
          path: "/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
          content: state,
          mime_type: "application/json",
        },
      ],
    });
    const ctx = testContext({
      profile: {
        ...testContext().profile,
        pathPrefixes: ["/"],
      },
    });
    const body = await readVaultContent(
      service,
      ctx,
      "/mnt/vault/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
    );
    expect(body.path).toBe("/workflows/runs/wf_03e3fb5b2224a1d2/state.json");
    expect(body.content).toBe(state);
    expect(() => JSON.parse(body.content)).not.toThrow();
  });

  it("denies paths outside ACL", async () => {
    const service = createFakeBackendRuntimeService({ files: SAMPLE_FILES });
    await expect(
      listVaultEntries(service, testContext(), "/Projects/B"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("passes cursor through to vault.list and preserves pagination metadata", async () => {
    const invoke = vi.fn().mockResolvedValue({
      path: "/Projects/A",
      entries: [
        {
          name: "page-two.md",
          path: "/Projects/A/page-two.md",
          kind: "file",
          mime_type: "text/markdown",
        },
      ],
      truncated: true,
      next_cursor: "page-3",
    });
    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });

    const body = await listVaultEntries(
      service,
      testContext(),
      "/Projects/A",
      { cursor: "page-2" },
    );

    expect(body.source).toBe("brain_rpc");
    expect(body.truncated).toBe(true);
    expect(body.next_cursor).toBe("page-3");
    expect(body.entries.map((entry) => entry.path)).toEqual([
      "/Projects/A/page-two.md",
    ]);
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "vault.list",
        params: expect.objectContaining({
          path: "/Projects/A",
          cursor: "page-2",
          limit: VAULT_LIST_PAGE_LIMIT,
        }),
      }),
    );
  });
});

describe("ACL helpers (deny-empty + prefix match)", () => {
  it("empty prefixes deny all paths", () => {
    expect(isVaultPathAllowedByPrefixes([], "/Projects/A")).toBe(false);
    expect(isVaultPathAllowedByPrefixes([], "/")).toBe(false);
    expect(resolveAclPrefixes([])).toEqual([]);
    expect(resolveAclPrefixes(["", "  "])).toEqual([]);
  });

  it("filters host entries outside ACL", () => {
    const filtered = filterVaultEntriesByAcl(
      ["/Projects/A"],
      [
        {
          name: "notes.md",
          path: "/Projects/A/notes.md",
          kind: "file",
        },
        {
          name: "secret.md",
          path: "/Projects/B/secret.md",
          kind: "file",
        },
      ],
    );
    expect(filtered.map((e) => e.path)).toEqual(["/Projects/A/notes.md"]);
  });
});

describe("getVaultTree", () => {
  it("builds ACL roots from path prefixes via vault.list", async () => {
    const service = createFakeBackendRuntimeService({ files: SAMPLE_FILES });
    const tree = await getVaultTree(service, testContext());
    expect(tree.source).toBe("brain_rpc");
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0]?.path).toBe("/Projects/A");
    const childPaths = (tree.roots[0]?.children ?? []).map((c) => c.path);
    expect(childPaths).toContain("/Projects/A/README.md");
    expect(childPaths).toContain("/Projects/A/Subfolder");
  });

  it("returns empty roots without walking / when pathPrefixes empty (BUG-1)", async () => {
    const invoke = vi.fn().mockResolvedValue({
      path: "/",
      entries: [
        { name: "Projects", path: "/Projects", kind: "directory" },
      ],
      truncated: false,
    });
    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });
    const tree = await getVaultTree(
      service,
      testContext({
        profile: {
          name: "none",
          pathPrefixes: [],
          hermesProfileAlias: "none",
        },
      }),
    );
    expect(tree.roots).toEqual([]);
    expect(tree.source).toBe("brain_rpc");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("re-filters host list leakage outside ACL (BUG-2)", async () => {
    const invoke = vi.fn().mockImplementation(async ({ method, params }) => {
      if (method === "vault.stat") {
        return {
          name: "A",
          path: "/Projects/A",
          kind: "directory",
          mime_type: null,
          size_bytes: null,
          mtime: null,
        };
      }
      if (method === "vault.list") {
        const path = (params as { path?: string }).path ?? "/";
        if (path === "/Projects/A") {
          // Misbehaving host includes a sibling outside ACL.
          return {
            path: "/Projects/A",
            entries: [
              {
                name: "notes.md",
                path: "/Projects/A/notes.md",
                kind: "file",
                mime_type: "text/markdown",
              },
              {
                name: "secret.md",
                path: "/Projects/B/secret.md",
                kind: "file",
                mime_type: "text/markdown",
              },
            ],
            truncated: false,
            next_cursor: null,
          };
        }
        return { path, entries: [], truncated: false };
      }
      throw new Error(`unexpected ${method}`);
    });

    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });

    const listed = await listVaultEntries(
      service,
      testContext(),
      "/Projects/A",
    );
    expect(listed.entries.map((e) => e.path)).toEqual([
      "/Projects/A/notes.md",
    ]);

    const tree = await getVaultTree(service, testContext());
    const blob = JSON.stringify(tree);
    expect(blob).toContain("/Projects/A/notes.md");
    expect(blob).not.toContain("/Projects/B/secret.md");
  });

  it("soft-empties tree on unavailable when emptyOnUnavailable", async () => {
    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: async () => {
        throw new BackendRuntimeError("unavailable", "gateway down", {
          retryable: true,
          details: { method: VAULT_LIST_METHOD },
        });
      },
    });
    const tree = await getVaultTree(service, testContext(), {
      emptyOnUnavailable: true,
    });
    expect(tree.roots).toEqual([]);
    expect(tree.source).toBe("brain_rpc");
    expect(tree.unavailable).toBe(true);
  });

  it("throws unavailable when emptyOnUnavailable is false", async () => {
    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: async () => {
        throw new BackendRuntimeError("unavailable", "gateway down", {
          retryable: true,
        });
      },
    });
    await expect(getVaultTree(service, testContext())).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("lists all top-level siblings before deep expansion (lp-8ty multi-sibling budget)", async () => {
    // Repro: DFS would spend the entire node budget inside Archive/* and never
    // emit Education, Relationships, skills, etc. BFS sibling-first must list
    // every top-level name even when maxNodes is tight.
    const topLevel = [
      "Archive",
      "Business",
      "Clients",
      "Education",
      "Relationships",
      "skills",
      "dev",
      "New Word Document.docx",
    ];
    const archiveDeepFiles = Array.from(
      { length: 40 },
      (_, i) => `deep-${String(i).padStart(3, "0")}.md`,
    );

    const invoke = vi.fn().mockImplementation(async ({ method, params }) => {
      if (method === "vault.list") {
        const path = (params as { path?: string }).path ?? "/";
        if (path === "/") {
          return {
            path: "/",
            entries: topLevel.map((name) => {
              const isFile = name.endsWith(".docx");
              return {
                name,
                path: `/${name}`,
                kind: isFile ? "file" : "directory",
                mime_type: isFile
                  ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  : null,
              };
            }),
            truncated: false,
            next_cursor: null,
          };
        }
        if (path === "/Archive") {
          // One nested dir that itself has many files (DFS trap).
          return {
            path: "/Archive",
            entries: [
              {
                name: "old",
                path: "/Archive/old",
                kind: "directory",
              },
            ],
            truncated: false,
            next_cursor: null,
          };
        }
        if (path === "/Archive/old") {
          return {
            path: "/Archive/old",
            entries: archiveDeepFiles.map((name) => ({
              name,
              path: `/Archive/old/${name}`,
              kind: "file",
              mime_type: "text/markdown",
            })),
            truncated: false,
            next_cursor: null,
          };
        }
        // Other top-level dirs: a couple of shallow children each.
        const base = path.replace(/\/$/, "");
        const name = base.split("/").filter(Boolean).pop() ?? "x";
        return {
          path: base,
          entries: [
            {
              name: `${name}-readme.md`,
              path: `${base}/${name}-readme.md`,
              kind: "file",
              mime_type: "text/markdown",
            },
          ],
          truncated: false,
          next_cursor: null,
        };
      }
      if (method === "vault.stat") {
        const path = (params as { path?: string }).path ?? "/";
        return {
          name: path.split("/").filter(Boolean).pop() ?? path,
          path,
          kind: "directory",
          mime_type: null,
          size_bytes: null,
          mtime: null,
        };
      }
      throw new Error(`unexpected ${method}`);
    });

    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });
    const admin = testContext({
      profile: {
        name: "admin",
        pathPrefixes: ["/"],
        hermesProfileAlias: "admin",
      },
    });

    // Budget that DFS would blow on Archive alone (1 Archive + 1 old + 40 files
    // = 42, plus other roots). With maxNodes=20, DFS used to stop mid-Archive
    // and omit Education+; BFS must still return every top-level name.
    const tree = await getVaultTree(service, admin, {
      maxNodes: 20,
      maxDepth: 8,
    });

    const rootNames = tree.roots.map((r) => r.name);
    for (const name of topLevel) {
      expect(rootNames).toContain(name);
    }
    expect(tree.roots).toHaveLength(topLevel.length);
    expect(tree.truncated).toBe(true);
    expect(tree.truncated_reason).toBe("max_nodes");
    // Deep Archive children may be partial/absent — honesty via truncated.
    const archive = tree.roots.find((r) => r.name === "Archive");
    expect(archive?.kind).toBe("directory");
  });

  it("sets truncated=false when the full tree fits under maxNodes", async () => {
    const service = createFakeBackendRuntimeService({ files: SAMPLE_FILES });
    const tree = await getVaultTree(service, testContext(), {
      maxNodes: 500,
    });
    expect(tree.truncated).toBe(false);
    expect(tree.truncated_reason).toBeUndefined();
  });

  it("expands a directory's siblings together under BFS (no silent mid-sibling drop without truncated)", async () => {
    // Parent with many immediate children; tight budget after roots must set
    // truncated rather than pretend the listing is complete.
    const siblingCount = 15;
    const invoke = vi.fn().mockImplementation(async ({ method, params }) => {
      if (method === "vault.list") {
        const path = (params as { path?: string }).path ?? "/";
        if (path === "/Projects/A") {
          return {
            path: "/Projects/A",
            entries: Array.from({ length: siblingCount }, (_, i) => ({
              name: `sib-${String(i).padStart(2, "0")}.md`,
              path: `/Projects/A/sib-${String(i).padStart(2, "0")}.md`,
              kind: "file",
              mime_type: "text/markdown",
            })),
            truncated: false,
            next_cursor: null,
          };
        }
        return { path, entries: [], truncated: false };
      }
      if (method === "vault.stat") {
        return {
          name: "A",
          path: "/Projects/A",
          kind: "directory",
          mime_type: null,
          size_bytes: null,
          mtime: null,
        };
      }
      throw new Error(`unexpected ${method}`);
    });

    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });

    // Root consumes 1; remaining 5 of maxNodes=6 attach as children → truncated.
    const tree = await getVaultTree(service, testContext(), {
      maxNodes: 6,
      maxDepth: 4,
    });
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0]?.path).toBe("/Projects/A");
    const kids = tree.roots[0]?.children ?? [];
    expect(kids.length).toBe(5);
    expect(kids.length).toBeLessThan(siblingCount);
    expect(tree.truncated).toBe(true);
    expect(tree.truncated_reason).toBe("max_nodes");
  });
});

describe("createVaultHandlers + production Brain RPC", () => {
  it("routes list/read/tree through invokeBrainRpc vault.* methods", async () => {
    const invoke = vi.fn().mockImplementation(async ({ method, params }) => {
      if (method === "vault.list") {
        const path = (params as { path?: string }).path ?? "/";
        if (path === "/Projects/A") {
          return {
            path: "/Projects/A",
            entries: [
              {
                name: "notes.md",
                path: "/Projects/A/notes.md",
                kind: "file",
                mime_type: "text/markdown",
              },
            ],
            truncated: false,
            next_cursor: null,
          };
        }
        if (path === "/") {
          return {
            path: "/",
            entries: [
              { name: "Projects", path: "/Projects", kind: "directory" },
            ],
            truncated: false,
          };
        }
        return { path, entries: [], truncated: false };
      }
      if (method === "vault.stat") {
        return {
          name: "A",
          path: "/Projects/A",
          kind: "directory",
          mime_type: null,
          size_bytes: null,
          mtime: null,
        };
      }
      if (method === "vault.read") {
        return {
          path: "/Projects/A/notes.md",
          kind: "file",
          mime_type: "text/markdown",
          encoding: "utf-8",
          content: "host notes",
          size_bytes: 10,
        };
      }
      throw new Error(`unexpected ${method}`);
    });

    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });
    const handlers = createVaultHandlers(service);

    const listed = await handlers.list(testContext(), "/Projects/A");
    expect(listed.source).toBe("brain_rpc");
    expect(listed.entries[0]?.path).toBe("/Projects/A/notes.md");

    const content = await handlers.read(
      testContext(),
      "/Projects/A/notes.md",
    );
    expect(content.content).toBe("host notes");
    expect(content.source).toBe("brain_rpc");

    const tree = await handlers.tree(testContext());
    expect(tree.source).toBe("brain_rpc");
    expect(tree.roots[0]?.path).toBe("/Projects/A");

    const methods = invoke.mock.calls.map(
      (c: [{ method: string }]) => c[0].method,
    );
    expect(methods).toContain("vault.list");
    expect(methods).toContain("vault.read");
    expect(methods).toContain("vault.stat");
  });

  it("vaultRequireBrainRpc blocks local vault port in production composition", async () => {
    const localList = vi.fn().mockResolvedValue({
      path: "/",
      entries: [],
      truncated: false,
    });
    // Production helper forces vaultRequireBrainRpc; even if a vault port were
    // passed via HermesBackendRuntimeService options it would be stripped —
    // construct production service without invoker path is impossible (required).
    // Prove require flag: Hermes without invoker + vaultRequireBrainRpc.
    const { HermesBackendRuntimeService } = await import("../src/index.js");
    const service = new HermesBackendRuntimeService({
      vaultRequireBrainRpc: true,
      vault: {
        listVault: localList,
        statVault: async () => {
          throw new Error("no");
        },
        readVault: async () => {
          throw new Error("no");
        },
      },
    });
    await expect(
      service.listVault(testContext(), { path: "/" }),
    ).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringMatching(/vaultRequireBrainRpc|Brain RPC/),
    });
    expect(localList).not.toHaveBeenCalled();
  });
});

describe("vaultErrorToHttp", () => {
  it("maps forbidden / not_found / unavailable", () => {
    expect(
      vaultErrorToHttp(
        new BackendRuntimeError("forbidden", "denied", {
          details: { method: VAULT_LIST_METHOD },
        }),
      ).status,
    ).toBe(403);
    expect(
      vaultErrorToHttp(
        new BackendRuntimeError("not_found", "missing", {
          details: { method: VAULT_READ_METHOD },
        }),
      ).status,
    ).toBe(404);
    const unavail = vaultErrorToHttp(
      new BackendRuntimeError("unavailable", "down"),
    );
    expect(unavail.status).toBe(503);
    expect(unavail.body.unavailable).toBe(true);
  });
});

describe("fixtures contain no real customer data", () => {
  it("fake sample paths are generic demo labels only", () => {
    // Guard: vault fixtures used by tests must stay synthetic.
    for (const f of SAMPLE_FILES) {
      expect(f.path).toMatch(/^\/Projects\/[AB]\//);
      expect(f.content).not.toMatch(/@|api[_-]?key|sk-|password/i);
    }
  });
});

describe("FakeBackendRuntimeService vault ACL smoke", () => {
  it("admin prefix / sees both teams", async () => {
    const service = new FakeBackendRuntimeService({ files: SAMPLE_FILES });
    const admin = testContext({
      profile: {
        name: "admin",
        pathPrefixes: ["/"],
        hermesProfileAlias: "admin",
      },
      roles: ["admin"],
    });
    const body = await listVaultEntries(service, admin, "/Projects");
    const names = body.entries.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(["A", "B"]));
  });
});

// ---------------------------------------------------------------------------
// vault.write capability-gated handlers (lp-5q6.19)
// ---------------------------------------------------------------------------

describe("vaultWriteIsAdvertised", () => {
  it("requires method and does not advertise when vault_write is false", () => {
    expect(
      vaultWriteIsAdvertised({
        features: { vault_write: true },
        brain_rpc_methods: ["vault.write"],
      }),
    ).toBe(true);
    expect(
      vaultWriteIsAdvertised({
        features: { vault_write: false },
        brain_rpc_methods: ["vault.write"],
      }),
    ).toBe(false);
    expect(
      vaultWriteIsAdvertised({
        features: { vault_write: true },
        brain_rpc_methods: ["vault.read"],
      }),
    ).toBe(false);
  });
});

describe("parseBrowserVaultWriteBody vs parseCallbackVaultWriteBody", () => {
  const inlineOk = {
    path: "/Projects/A/notes.md",
    mode: "create_new",
    encoding: "utf-8",
    content: "hello",
    size_bytes: 5,
    idempotency_key: "browser-write-1",
    mime_type: "text/markdown",
  };

  it("browser accepts inline content and rejects content_ref", () => {
    const parsed = parseBrowserVaultWriteBody(inlineOk);
    expect(parsed.path).toBe("/Projects/A/notes.md");
    expect(parsed.content).toBe("hello");
    expect(parsed.mode).toBe("create_new");

    expect(() =>
      parseBrowserVaultWriteBody({
        ...inlineOk,
        content: undefined,
        encoding: undefined,
        content_ref: {
          kind: "bff_spool",
          id: "spool_1",
        },
        size_bytes: 100,
      }),
    ).toThrow(/content_ref is reserved for Document Server/);
  });

  it("callback accepts content_ref; both reject client tenant stamps", () => {
    const cb = parseCallbackVaultWriteBody({
      path: "/Projects/A/proposal.docx",
      mode: "replace_if_match",
      if_match: "rev-abc",
      content_ref: {
        kind: "bff_spool",
        id: "spool_oo_1",
        content_sha256:
          "3166947fcedaacedd8f581c2d3ce26e6cab784618c72785e6d7f587d725f460a",
      },
      size_bytes: 18432,
      idempotency_key: "oo-callback-1",
      mime_type:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(cb.contentRef?.kind).toBe("bff_spool");
    expect(cb.ifMatch).toBe("rev-abc");

    expect(() =>
      parseBrowserVaultWriteBody({
        ...inlineOk,
        tenant_id: "evil_tenant",
      }),
    ).toThrow(/must not include tenant_id/);

    expect(() =>
      parseCallbackVaultWriteBody({
        path: "/Projects/A/x.md",
        mode: "create_new",
        encoding: "utf-8",
        content: "x",
        size_bytes: 1,
        idempotency_key: "k",
        session_id: "client_forged",
      }),
    ).toThrow(/must not include session_id/);
  });

  it("rejects host filesystem paths and size_bytes mismatch", () => {
    expect(() =>
      parseBrowserVaultWriteBody({
        ...inlineOk,
        path: "/home/ubuntu/secret.md",
      }),
    ).toThrow(/host filesystem paths are forbidden/);

    expect(() =>
      parseBrowserVaultWriteBody({
        ...inlineOk,
        size_bytes: 99,
      }),
    ).toThrow(/does not match decoded content length/);
  });
});

describe("writeVaultFromBrowser / writeVaultFromCallback", () => {
  function writeEnabledFake(files = SAMPLE_FILES) {
    return new FakeBackendRuntimeService({
      files,
      supportWriteVault: true,
    });
  }

  it("allowed write creates file under ACL and stamps via ctx only", async () => {
    const service = writeEnabledFake();
    const ctx = testContext();
    const body = await writeVaultFromBrowser(service, ctx, {
      path: "/Projects/A/new.md",
      mode: "create_new",
      encoding: "utf-8",
      content: "# New\n",
      size_bytes: 6,
      idempotency_key: "create-new-1",
      mime_type: "text/markdown",
    });
    expect(body.path).toBe("/Projects/A/new.md");
    expect(body.created).toBe(true);
    expect(body.source).toBe("brain_rpc");
    expect(body.revision.kind).toBe("content_hash");
    expect(body.revision.token).toMatch(/^sha256:/);
    // lp-ye4.8: optional commit metadata (clients may ignore)
    expect(body.commit?.kind).toBe("file_create");
    expect(body.commit?.operation_id).toMatch(/^op_/);
    expect(body.commit?.operation_id).not.toBe(body.revision.token);
    expect(body.commit?.advances_artifact_head).toBe(true);

    // Read back
    const read = await readVaultContent(service, ctx, "/Projects/A/new.md");
    expect(read.content).toBe("# New\n");
  });

  it("forbidden path outside ACL", async () => {
    const service = writeEnabledFake();
    await expect(
      writeVaultFromBrowser(service, testContext(), {
        path: "/Projects/B/evil.md",
        mode: "create_new",
        encoding: "utf-8",
        content: "nope",
        size_bytes: 4,
        idempotency_key: "forbidden-1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("missing capability → method_not_found", async () => {
    const service = createFakeBackendRuntimeService({
      files: SAMPLE_FILES,
      supportWriteVault: false,
    });
    await expect(
      writeVaultFromBrowser(service, testContext(), {
        path: "/Projects/A/x.md",
        mode: "create_new",
        encoding: "utf-8",
        content: "x",
        size_bytes: 1,
        idempotency_key: "no-cap-1",
      }),
    ).rejects.toMatchObject({
      code: "method_not_found",
      details: { method: VAULT_WRITE_METHOD },
    });
  });

  it("revision conflict on replace_if_match", async () => {
    const service = writeEnabledFake();
    const ctx = testContext();
    const current = service.getFileRevision("/Projects/A/notes.md");
    expect(current).not.toBeNull();
    const headsBefore = service.listArtifactHeads().length;
    const eventsBefore = service.listLedgerEvents().length;

    await expect(
      writeVaultFromBrowser(service, ctx, {
        path: "/Projects/A/notes.md",
        mode: "replace_if_match",
        if_match: "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        encoding: "utf-8",
        content: "stale write",
        size_bytes: 11,
        idempotency_key: "cas-fail-1",
        mime_type: "text/markdown",
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      details: { reason: "revision_mismatch" },
    });

    // Conflict recorded as operation_rejected; heads do not advance (lp-ye4.8)
    expect(service.listLedgerEvents().length).toBe(eventsBefore + 1);
    const rejected = service.listLedgerEvents().at(-1)!;
    expect(rejected.kind).toBe("operation_rejected");
    expect(rejected.result.reason).toBe("revision_mismatch");
    expect(rejected.advances_artifact_head).toBe(false);
    expect(rejected.advances_workspace_head).toBe(false);
    expect(service.listArtifactHeads().length).toBe(headsBefore);

    // Matching CAS succeeds
    const ok = await writeVaultFromBrowser(service, ctx, {
      path: "/Projects/A/notes.md",
      mode: "replace_if_match",
      expected_revision: {
        token: current!.token,
        kind: current!.kind,
      },
      encoding: "utf-8",
      content: "updated notes",
      size_bytes: 13,
      idempotency_key: "cas-ok-1",
      mime_type: "text/markdown",
    });
    expect(ok.created).toBe(false);
    expect(ok.revision.token).not.toBe(current!.token);
    expect(ok.commit?.kind).toBe("file_replace");
    expect(ok.commit?.operation_id).toMatch(/^op_/);
    expect(service.getArtifactHead("/Projects/A/notes.md")?.operation_id).toBe(
      ok.commit?.operation_id,
    );
  });

  it("oversized inline payload → payload_too_large", async () => {
    const service = writeEnabledFake();
    const big = "x".repeat(VAULT_WRITE_INLINE_DEFAULT_MAX_BYTES + 1);
    await expect(
      writeVaultFromBrowser(service, testContext(), {
        path: "/Projects/A/big.md",
        mode: "create_new",
        encoding: "utf-8",
        content: big,
        size_bytes: big.length,
        idempotency_key: "too-big-1",
      }),
    ).rejects.toMatchObject({ code: "payload_too_large" });
  });

  it("callback content_ref write resolves staged bytes", async () => {
    const service = new FakeBackendRuntimeService({
      files: SAMPLE_FILES,
      supportWriteVault: true,
      resolveContentRef: (ref) => {
        if (ref.id === "spool_lab_1") {
          return { content: "office-bytes", encoding: "utf-8" };
        }
        return null;
      },
    });
    const current = service.getFileRevision("/Projects/A/notes.md")!;
    const body = await writeVaultFromCallback(service, testContext(), {
      path: "/Projects/A/notes.md",
      mode: "replace_if_match",
      if_match: current.token,
      content_ref: { kind: "bff_spool", id: "spool_lab_1" },
      size_bytes: 12,
      idempotency_key: "callback-1",
      mime_type:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(body.size_bytes).toBe(12);
    expect(body.idempotent_replay).toBe(false);
    expect(body.commit?.kind).toBe("file_replace");
    expect(body.commit?.operation_id).toMatch(/^op_/);
    const eventsAfterFirst = service.listLedgerEvents().length;

    // Idempotent replay
    const replay = await writeVaultFromCallback(service, testContext(), {
      path: "/Projects/A/notes.md",
      mode: "replace_if_match",
      if_match: current.token,
      content_ref: { kind: "bff_spool", id: "spool_lab_1" },
      size_bytes: 12,
      idempotency_key: "callback-1",
      mime_type:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.revision.token).toBe(body.revision.token);
    // Same commit metadata; no second ledger append (lp-ye4.8)
    expect(replay.commit?.operation_id).toBe(body.commit?.operation_id);
    expect(replay.commit?.kind).toBe(body.commit?.kind);
    expect(service.listLedgerEvents().length).toBe(eventsAfterFirst);
  });

  it("vaultErrorToHttp maps conflict with revision tokens", () => {
    const mapped = vaultErrorToHttp(
      new BackendRuntimeError("conflict", "revision_mismatch", {
        details: {
          method: VAULT_WRITE_METHOD,
          reason: "revision_mismatch",
          expected_revision_token: "exp",
          actual_revision_token: "act",
        },
      }),
    );
    expect(mapped.status).toBe(409);
    expect(mapped.body.code).toBe("conflict");
    expect(mapped.body.reason).toBe("revision_mismatch");
    expect(mapped.body.expected_revision_token).toBe("exp");
    expect(mapped.body.actual_revision_token).toBe("act");
  });

  it("handlers.writeBrowser routes through production Brain RPC invoker", async () => {
    const invoke = createFakeBrainRpcInvoker({
      files: SAMPLE_FILES,
      supportWriteVault: true,
    });
    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });
    const handlers = createVaultHandlers(service);
    const result = await handlers.writeBrowser(testContext(), {
      path: "/Projects/A/via-rpc.md",
      mode: "create_new",
      encoding: "utf-8",
      content: "via brain rpc",
      size_bytes: 13,
      idempotency_key: "rpc-write-1",
      mime_type: "text/markdown",
    });
    expect(result.source).toBe("brain_rpc");
    expect(result.created).toBe(true);
    expect(result.path).toBe("/Projects/A/via-rpc.md");
  });
});

describe("write_checkpoint origin policy and source_path (lp-ye4.10)", () => {
  const checkpointBody = {
    path: "/Projects/A/.lanyard/checkpoints/notes.md/run-42.md",
    mode: "write_checkpoint",
    source_path: "/Projects/A/notes.md",
    encoding: "utf-8",
    content: "agent staged rewrite",
    size_bytes: 20,
    idempotency_key: "agent-checkpoint-1",
    mime_type: "text/markdown",
    create_parents: true,
  };

  it("browser and callback parsers reject write_checkpoint (origin policy)", () => {
    expect(() => parseBrowserVaultWriteBody(checkpointBody)).toThrow(
      /write_checkpoint is not allowed for origin browser/,
    );
    expect(() => parseCallbackVaultWriteBody(checkpointBody)).toThrow(
      /write_checkpoint is not allowed for origin document_server_callback/,
    );
  });

  it("agent parser accepts write_checkpoint and requires distinct source_path", () => {
    const parsed = parseAgentVaultWriteBody(checkpointBody);
    expect(parsed.mode).toBe("write_checkpoint");
    expect(parsed.path).toBe(
      "/Projects/A/.lanyard/checkpoints/notes.md/run-42.md",
    );
    if (parsed.mode !== "write_checkpoint") {
      throw new Error("expected write_checkpoint mode");
    }
    expect(parsed.sourcePath).toBe("/Projects/A/notes.md");

    expect(() =>
      parseAgentVaultWriteBody({
        ...checkpointBody,
        source_path: undefined,
      }),
    ).toThrow(/requires source_path/);

    expect(() =>
      parseAgentVaultWriteBody({
        ...checkpointBody,
        source_path: checkpointBody.path,
      }),
    ).toThrow(/source_path must differ from path/);

    expect(() =>
      parseAgentVaultWriteBody({
        path: "/Projects/A/notes.md",
        mode: "create_new",
        encoding: "utf-8",
        content: "x",
        size_bytes: 1,
        idempotency_key: "no-source-on-create",
        source_path: "/Projects/A/other.md",
      }),
    ).toThrow(/source_path is only valid when mode is write_checkpoint/);
  });

  it("vaultWriteInputToWireParams emits source_path only for checkpoint", () => {
    const wire = vaultWriteInputToWireParams({
      path: checkpointBody.path,
      mode: "write_checkpoint",
      sourcePath: "/Projects/A/notes.md",
      encoding: "utf-8",
      content: "agent staged rewrite",
      sizeBytes: 20,
      idempotencyKey: "agent-checkpoint-1",
      mimeType: "text/markdown",
      createParents: true,
    });
    expect(wire.mode).toBe("write_checkpoint");
    expect(wire.source_path).toBe("/Projects/A/notes.md");

    const createWire = vaultWriteInputToWireParams({
      path: "/Projects/A/new.md",
      mode: "create_new",
      encoding: "utf-8",
      content: "x",
      sizeBytes: 1,
      idempotencyKey: "k",
    });
    expect(createWire.source_path).toBeUndefined();
  });

  it("FakeBackend write_checkpoint creates destination without advancing source", async () => {
    const service = new FakeBackendRuntimeService({
      files: SAMPLE_FILES,
      supportWriteVault: true,
    });
    const ctx = testContext();
    const sourceBefore = service.getFileRevision("/Projects/A/notes.md");
    expect(sourceBefore).not.toBeNull();
    const sourceContentBefore = await readVaultContent(
      service,
      ctx,
      "/Projects/A/notes.md",
    );

    const params = parseAgentVaultWriteBody(checkpointBody);
    const result = await writeVaultContent(service, ctx, params, {
      origin: "agent",
    });

    expect(result.path).toBe(checkpointBody.path);
    expect(result.created).toBe(true);
    expect(result.write_kind).toBe("checkpoint");
    expect(result.source_path).toBe("/Projects/A/notes.md");
    expect(result.revision.kind).toBe("content_hash");
    // lp-ye4.8: write_checkpoint → file_checkpoint ledger kind
    expect(result.commit?.kind).toBe("file_checkpoint");
    expect(result.commit?.operation_id).toMatch(/^op_/);
    expect(result.commit?.operation_id).not.toBe(result.revision.token);
    const checkpointHead = service.getArtifactHead(checkpointBody.path);
    expect(checkpointHead?.operation_id).toBe(result.commit?.operation_id);
    expect(checkpointHead?.head_kind).toBe("checkpoint");
    expect(checkpointHead?.source_path).toBe("/Projects/A/notes.md");
    // Canonical path must not gain a new artifact head from checkpoint.
    expect(service.getArtifactHead("/Projects/A/notes.md")).toBeUndefined();

    const checkpointRead = await readVaultContent(
      service,
      ctx,
      checkpointBody.path,
    );
    expect(checkpointRead.content).toBe("agent staged rewrite");

    // Canonical source path revision and body unchanged.
    const sourceAfter = service.getFileRevision("/Projects/A/notes.md");
    expect(sourceAfter?.token).toBe(sourceBefore!.token);
    const sourceContentAfter = await readVaultContent(
      service,
      ctx,
      "/Projects/A/notes.md",
    );
    expect(sourceContentAfter.content).toBe(sourceContentBefore.content);

    // Idempotent replay converges (same revision + commit metadata).
    const replay = await writeVaultContent(service, ctx, params, {
      origin: "agent",
    });
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.revision.token).toBe(result.revision.token);
    expect(replay.commit?.operation_id).toBe(result.commit?.operation_id);
    expect(service.getFileRevision("/Projects/A/notes.md")?.token).toBe(
      sourceBefore!.token,
    );
  });

  it("checkpoint source_path outside ACL is forbidden", async () => {
    const service = new FakeBackendRuntimeService({
      files: SAMPLE_FILES,
      supportWriteVault: true,
    });
    const params = parseAgentVaultWriteBody({
      path: "/Projects/A/.lanyard/checkpoints/evil.md/run-1.md",
      mode: "write_checkpoint",
      // source is under /Projects/B — not in contributor ACL
      source_path: "/Projects/B/secret.md",
      encoding: "utf-8",
      content: "nope",
      size_bytes: 4,
      idempotency_key: "acl-source-fail",
    });
    await expect(
      writeVaultContent(service, testContext(), params, { origin: "agent" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("Brain RPC invoker accepts write_checkpoint wire frames", async () => {
    const invoke = createFakeBrainRpcInvoker({
      files: SAMPLE_FILES,
      supportWriteVault: true,
    });
    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });
    const ctx = testContext();
    const backend = invoke.backend;
    const before = backend.getFileRevision("/Projects/A/notes.md")!;

    // Route through Brain RPC wire frame (agent parser + fake writeVault).
    const result = (await invoke({
      method: "vault.write",
      params: {
        path: "/Projects/A/.lanyard/checkpoints/notes.md/run-rpc.md",
        mode: "write_checkpoint",
        source_path: "/Projects/A/notes.md",
        encoding: "utf-8",
        content: "rpc checkpoint",
        size_bytes: 14,
        idempotency_key: "rpc-checkpoint-1",
        mime_type: "text/markdown",
      },
      ctx,
    })) as {
      write_kind?: string;
      source_path?: string;
      path?: string;
    };

    expect(result.write_kind).toBe("checkpoint");
    expect(result.source_path).toBe("/Projects/A/notes.md");
    expect(result.path).toBe(
      "/Projects/A/.lanyard/checkpoints/notes.md/run-rpc.md",
    );
    expect(backend.getFileRevision("/Projects/A/notes.md")?.token).toBe(
      before.token,
    );

    // Production adapter path also works with domain params.
    const viaAdapter = await service.writeVault!(ctx, {
      path: "/Projects/A/.lanyard/checkpoints/notes.md/run-rpc-2.md",
      mode: "write_checkpoint",
      sourcePath: "/Projects/A/notes.md",
      encoding: "utf-8",
      content: "rpc checkpoint 2",
      sizeBytes: 16,
      idempotencyKey: "rpc-checkpoint-2",
      mimeType: "text/markdown",
    });
    expect(viaAdapter.write_kind).toBe("checkpoint");
    expect(backend.getFileRevision("/Projects/A/notes.md")?.token).toBe(
      before.token,
    );
  });

  it("dirty-human policy → write_checkpoint on fake without touching canonical", async () => {
    const service = new FakeBackendRuntimeService({
      files: [
        ...SAMPLE_FILES,
        {
          path: "/Projects/A/proposal.docx",
          content: "human draft v1",
          mime_type:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      ],
      supportWriteVault: true,
    });
    const ctx = testContext();
    const ownership: ActivePathOwnership = {
      path: "/Projects/A/proposal.docx",
      tenant_id: "tenant_demo",
      dirty: true,
      mode: "edit",
      session_id: "oo_sess_test",
    };
    const decision = resolveAgentWritePolicy(ownership, {
      intended_path: "/Projects/A/proposal.docx",
      path_exists: true,
      run_id: "run-dirty-1",
    });
    expect(decision.action).toBe("write_checkpoint");
    if (decision.action !== "write_checkpoint") {
      throw new Error("expected write_checkpoint decision");
    }

    const sourceBefore = service.getFileRevision("/Projects/A/proposal.docx")!;
    const body = {
      path: decision.path,
      mode: decision.mode,
      source_path: decision.source_path,
      encoding: "utf-8" as const,
      content: "agent rewrite while human dirty",
      size_bytes: 31,
      idempotency_key: "dirty-policy-checkpoint-1",
      mime_type:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      create_parents: true,
    };
    const params = parseAgentVaultWriteBody(body);
    const written = await writeVaultContent(service, ctx, params, {
      origin: "agent",
    });

    expect(written.path).toBe(decision.path);
    expect(written.write_kind).toBe("checkpoint");
    expect(written.source_path).toBe("/Projects/A/proposal.docx");
    expect(service.getFileRevision("/Projects/A/proposal.docx")?.token).toBe(
      sourceBefore.token,
    );
    const sourceRead = await readVaultContent(
      service,
      ctx,
      "/Projects/A/proposal.docx",
    );
    expect(sourceRead.content).toBe("human draft v1");
    expect(written.commit?.kind).toBe("file_checkpoint");
  });
});

// ---------------------------------------------------------------------------
// vault.write → signed-operation ledger commit (lp-ye4.8)
// ---------------------------------------------------------------------------

describe("vault.write ledger commit integration (lp-ye4.8)", () => {
  it("maps create_new / replace_if_absent / replace_if_match to ledger kinds", async () => {
    const service = new FakeBackendRuntimeService({
      files: SAMPLE_FILES,
      supportWriteVault: true,
    });
    const ctx = testContext();

    const create = await writeVaultFromBrowser(service, ctx, {
      path: "/Projects/A/created.md",
      mode: "create_new",
      encoding: "utf-8",
      content: "create",
      size_bytes: 6,
      idempotency_key: "ledger-create-1",
      mime_type: "text/markdown",
    });
    expect(create.commit?.kind).toBe("file_create");
    expect(service.getArtifactHead("/Projects/A/created.md")?.revision.token).toBe(
      create.revision.token,
    );

    const absent = await writeVaultFromBrowser(service, ctx, {
      path: "/Projects/A/absent.md",
      mode: "replace_if_absent",
      encoding: "utf-8",
      content: "absent",
      size_bytes: 6,
      idempotency_key: "ledger-absent-1",
      mime_type: "text/markdown",
    });
    expect(absent.created).toBe(true);
    expect(absent.commit?.kind).toBe("file_create");

    const current = service.getFileRevision("/Projects/A/notes.md")!;
    const replace = await writeVaultFromBrowser(service, ctx, {
      path: "/Projects/A/notes.md",
      mode: "replace_if_match",
      if_match: current.token,
      encoding: "utf-8",
      content: "replaced",
      size_bytes: 8,
      idempotency_key: "ledger-replace-1",
      mime_type: "text/markdown",
    });
    expect(replace.commit?.kind).toBe("file_replace");
    expect(replace.commit?.tree_root_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(service.getWorkspaceHead()?.operation_id).toBe(
      replace.commit?.operation_id,
    );

    // History of path includes committed replace (and any prior events for path)
    const pathEvents = service
      .listLedgerEvents()
      .filter((e) => e.target.path === "/Projects/A/notes.md");
    expect(pathEvents.some((e) => e.operation_id === replace.commit?.operation_id)).toBe(
      true,
    );
  });

  it("path_exists conflict does not advance heads and exposes safe reason", async () => {
    const service = new FakeBackendRuntimeService({
      files: SAMPLE_FILES,
      supportWriteVault: true,
    });
    const ctx = testContext();
    const wsBefore = service.getWorkspaceHead();
    const headsBefore = service.listArtifactHeads();

    await expect(
      writeVaultFromBrowser(service, ctx, {
        path: "/Projects/A/notes.md",
        mode: "create_new",
        encoding: "utf-8",
        content: "dup",
        size_bytes: 3,
        idempotency_key: "ledger-exists-1",
        mime_type: "text/markdown",
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      details: {
        reason: "path_exists",
        path: "/Projects/A/notes.md",
      },
    });

    const last = service.listLedgerEvents().at(-1)!;
    expect(last.kind).toBe("operation_rejected");
    expect(last.result.reason).toBe("path_exists");
    expect(last.vault_write_mode).toBe("create_new");
    expect(last.advances_artifact_head).toBe(false);
    expect(last.advances_workspace_head).toBe(false);
    expect(service.listArtifactHeads()).toEqual(headsBefore);
    expect(service.getWorkspaceHead()?.operation_id).toBe(
      wsBefore?.operation_id,
    );
  });
});
