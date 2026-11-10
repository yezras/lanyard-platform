/**
 * lp-oop.10 — BFF CpS3 vault provider vs fake CP.
 * Maps tree/entries/content. Not wired as default. No Daytona wake.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { FakeS3ObjectStore } from "../../control-plane/src/fake-s3-object-store.js";
import type { ControlPlaneStore } from "../../control-plane/src/store.js";
import {
  VAULT_HTTP_API_PATHS,
} from "../../control-plane/src/vault-http.js";
import { buildS3VaultPrefix } from "../../control-plane/src/vault-prefix.js";
import { loadConfig } from "../src/config.js";
import {
  CONTROL_PLANE_SERVICE_TOKEN_HEADER,
  ControlPlaneRequestError,
  type UserRbac,
} from "../src/control-plane-client.js";
import {
  createCpS3VaultContentProvider,
  VAULT_CP_HTTP_PATHS,
} from "../src/vault/cp-s3-provider.js";
import { createFixtureVaultIndexProvider } from "../src/vault/fixture-index.js";
import { VaultService } from "../src/vault/service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const providerSrc = readFileSync(
  join(__dirname, "../src/vault/cp-s3-provider.ts"),
  "utf8",
);
const indexSrc = readFileSync(join(__dirname, "../src/index.ts"), "utf8");
const configSrc = readFileSync(join(__dirname, "../src/config.ts"), "utf8");
const testSrc = readFileSync(fileURLToPath(import.meta.url), "utf8");
const bffPkg = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf8"),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

const TENANT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OTHER_TENANT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const BUCKET = "lanyard-mocklab-vault-test";
const PREFIX = buildS3VaultPrefix(TENANT);
const OTHER_PREFIX = buildS3VaultPrefix(OTHER_TENANT);
const FIXED_NOW = () => new Date("2026-08-14T00:00:00.000Z");
const CP_BASE = "http://control-plane.test";
const SERVICE_TOKEN = "test-cp-service-token";

type RecordedCall = {
  url: string;
  path: string;
  search: string;
  method: string;
  tenantHeader: string | null;
  serviceToken: string | null;
};

function pathnameOf(input: string): { path: string; search: string } {
  const url = new URL(input, "http://unused.test");
  return { path: url.pathname, search: url.search };
}

function headerGet(
  headers: HeadersInit | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  return new Headers(headers).get(name);
}

function seedTenantVault(store: FakeS3ObjectStore): void {
  store.seed(BUCKET, `${PREFIX}AGENTS.md`, "# tenant A\n", "text/markdown");
  store.seed(
    BUCKET,
    `${PREFIX}Projects/Alpha/readme.md`,
    "hello alpha\n",
    "text/markdown",
  );
  store.seed(
    BUCKET,
    `${PREFIX}Projects/Beta/note.md`,
    "café 🎉\n",
    "text/plain",
  );
  store.seed(
    BUCKET,
    `${PREFIX}Projects/A/logo.png`,
    "PNGDATA",
    "image/png",
  );
  store.seed(
    BUCKET,
    `${OTHER_PREFIX}secret.md`,
    "tenant B only\n",
    "text/plain",
  );
}

function mockStore(): ControlPlaneStore {
  return {} as unknown as ControlPlaneStore;
}

function wiredCp(store: FakeS3ObjectStore) {
  const ensureOnline = vi.fn(async () => {
    throw new Error("Daytona wake must not run on CpS3 vault (lp-oop.10)");
  });
  const app = createControlPlaneApp(mockStore(), {
    devOpen: true,
    vaultObjectStore: store,
    vaultBucket: BUCKET,
    instanceOrchestrator: {
      ensureOnline,
      stop: vi.fn(),
    },
  });
  const calls: RecordedCall[] = [];
  const requestFn = (input: string, init?: RequestInit) => {
    const parsed = pathnameOf(String(input));
    calls.push({
      url: String(input),
      path: parsed.path,
      search: parsed.search,
      method: init?.method ?? "GET",
      tenantHeader: headerGet(init?.headers, "x-lanyard-tenant-id"),
      serviceToken: headerGet(
        init?.headers,
        CONTROL_PLANE_SERVICE_TOKEN_HEADER,
      ),
    });
    return app.request(parsed.path + parsed.search, init);
  };
  return { app, ensureOnline, calls, requestFn };
}

function providerFor(
  store: FakeS3ObjectStore,
  extras: { listPageSize?: number; maxReadBytes?: number } = {},
) {
  const wired = wiredCp(store);
  return {
    ...wired,
    provider: createCpS3VaultContentProvider({
      tenantId: TENANT,
      baseUrl: CP_BASE,
      requestFn: wired.requestFn,
      serviceToken: SERVICE_TOKEN,
      ...extras,
    }),
  };
}

const rbacAll: UserRbac = {
  user_id: "user-a",
  tenant_id: TENANT,
  hermes_profile: "profile-a",
  allowed_path_prefixes: ["/"],
  role_names: ["admin"],
};

describe("CpS3 vault provider catalog (lp-oop.10)", () => {
  it("matches CP vault HTTP paths and is not the default plane", () => {
    expect(VAULT_CP_HTTP_PATHS.list(TENANT)).toBe(VAULT_HTTP_API_PATHS.list(TENANT));
    expect(VAULT_CP_HTTP_PATHS.stat(TENANT)).toBe(VAULT_HTTP_API_PATHS.stat(TENANT));
    expect(VAULT_CP_HTTP_PATHS.get(TENANT)).toBe(VAULT_HTTP_API_PATHS.get(TENANT));
    expect(indexSrc).toMatch(/createCpS3VaultContentProvider/);
    expect(configSrc).toMatch(/VAULT_PLANE/);
    expect(loadConfig({ CONTROL_PLANE_URL: "http://cp.test" }).vaultPlane).toBe(
      "fs",
    );
    expect(loadConfig({ CONTROL_PLANE_URL: "http://cp.test" }).vaultRoot).toBeUndefined();
    expect(providerSrc).toMatch(/Selected only when `VaultPlane=cp_s3`/);
    expect(providerSrc).toMatch(/Does not call ensureOnline/);
  });

  it("does not add an S3 AWS SDK to BFF", () => {
    const deps = { ...bffPkg.dependencies, ...bffPkg.devDependencies };
    expect(deps["@aws-sdk/client-s3"]).toBeUndefined();
    expect(providerSrc).not.toMatch(/from ["']@aws-sdk/);
    expect(testSrc).not.toMatch(/from ["']@aws-sdk/);
  });
});

describe("CpS3 vault provider vs fake CP (lp-oop.10)", () => {
  it("lists entries in existing tree/entries shapes", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { provider, ensureOnline, calls } = providerFor(store);

    const root = await provider.listEntries("/");
    expect(root.map((e) => e.path)).toEqual(["/Projects", "/AGENTS.md"]);
    expect(root[0]).toEqual({
      name: "Projects",
      path: "/Projects",
      kind: "directory",
    });
    expect(root[1]).toEqual({
      name: "AGENTS.md",
      path: "/AGENTS.md",
      kind: "file",
      mime_type: "text/markdown",
    });

    const projects = await provider.listEntries("/Projects");
    expect(projects.map((e) => e.path)).toEqual([
      "/Projects/A",
      "/Projects/Alpha",
      "/Projects/Beta",
    ]);
    expect(projects.every((e) => e.kind === "directory")).toBe(true);
    expect(JSON.stringify(projects)).not.toContain("secret.md");
    expect(JSON.stringify(projects)).not.toContain(OTHER_TENANT);
    expect(ensureOnline).not.toHaveBeenCalled();
    expect(calls.every((c) => !c.path.includes("ensure-online"))).toBe(true);
    expect(calls[0]?.tenantHeader).toBe(TENANT);
    expect(calls[0]?.serviceToken).toBe(SERVICE_TOKEN);
  });

  it("builds getTree from recursive CP list", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { provider, ensureOnline } = providerFor(store);

    const tree = await provider.getTree();
    expect(tree.map((n) => n.path)).toEqual(["/Projects", "/AGENTS.md"]);
    const projects = tree.find((n) => n.path === "/Projects");
    expect(projects?.kind).toBe("directory");
    const alpha = projects?.children?.find((n) => n.path === "/Projects/Alpha");
    expect(alpha?.kind).toBe("directory");
    expect(alpha?.children).toEqual([
      {
        name: "readme.md",
        path: "/Projects/Alpha/readme.md",
        kind: "file",
        mime_type: "text/markdown",
      },
    ]);
    expect(JSON.stringify(tree)).not.toContain("secret.md");
    expect(ensureOnline).not.toHaveBeenCalled();
  });

  it("reads file content as existing VaultFileContent", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { provider, ensureOnline } = providerFor(store);

    const md = await provider.readFile("/AGENTS.md");
    expect(md).toEqual({
      path: "/AGENTS.md",
      kind: "file",
      mime_type: "text/markdown",
      encoding: "utf-8",
      content: "# tenant A\n",
      size_bytes: Buffer.byteLength("# tenant A\n", "utf-8"),
    });

    const note = await provider.readFile("/Projects/Beta/note.md");
    expect(note?.encoding).toBe("utf-8");
    expect(note?.content).toBe("café 🎉\n");

    const png = await provider.readFile("/Projects/A/logo.png");
    expect(png).toMatchObject({
      path: "/Projects/A/logo.png",
      kind: "file",
      mime_type: "image/png",
      encoding: "base64",
    });
    expect(png && Buffer.from(png.content, "base64").toString("utf-8")).toBe(
      "PNGDATA",
    );
    expect(ensureOnline).not.toHaveBeenCalled();
  });

  it("returns null / empty for missing paths and directories", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { provider } = providerFor(store);

    expect(await provider.readFile("/missing.md")).toBeNull();
    expect(await provider.readFile("/Projects")).toBeNull();
    expect(await provider.listEntries("/no-such-dir")).toEqual([]);
    expect(await provider.listEntries("/AGENTS.md")).toEqual([]);
  });

  it("follows list cursors when the fake CP page is truncated", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { provider, calls } = providerFor(store, { listPageSize: 1 });

    const projects = await provider.listEntries("/Projects");
    expect(projects.map((e) => e.path)).toEqual([
      "/Projects/A",
      "/Projects/Alpha",
      "/Projects/Beta",
    ]);
    const listCalls = calls.filter((c) => c.path.endsWith("/vault/list"));
    expect(listCalls.length).toBeGreaterThan(1);
    expect(listCalls.some((c) => c.search.includes("cursor="))).toBe(true);
  });

  it("maps through VaultService tree/entries/content", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { provider, ensureOnline } = providerFor(store);
    const service = new VaultService(
      provider,
      createFixtureVaultIndexProvider(),
    );

    const tree = await service.getTree(rbacAll);
    expect(tree.roots.some((n) => n.path === "/Projects")).toBe(true);

    const entries = await service.listEntries(rbacAll, "/Projects/Alpha");
    expect(entries).toEqual({
      path: "/Projects/Alpha",
      entries: [
        {
          name: "readme.md",
          path: "/Projects/Alpha/readme.md",
          kind: "file",
          mime_type: "text/markdown",
        },
      ],
    });

    const content = await service.readContent(
      rbacAll,
      "/Projects/Alpha/readme.md",
    );
    expect(content.content).toBe("hello alpha\n");
    expect(content.encoding).toBe("utf-8");
    expect(ensureOnline).not.toHaveBeenCalled();
  });

  it("does not fetch another tenant's object", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { provider } = providerFor(store);

    expect(await provider.readFile("/secret.md")).toBeNull();
    expect(store.getGetCount()).toBeGreaterThan(0);
  });

  it("propagates CP cross-tenant prefix denial", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    seedTenantVault(store);
    const { requestFn } = wiredCp(store);
    const provider = createCpS3VaultContentProvider({
      tenantId: TENANT,
      baseUrl: CP_BASE,
      requestFn: async (input, init) => {
        const parsed = pathnameOf(String(input));
        const url = new URL(parsed.path + parsed.search, CP_BASE);
        url.searchParams.set("prefix", OTHER_PREFIX);
        return requestFn(url.toString(), init);
      },
      serviceToken: SERVICE_TOKEN,
    });

    await expect(provider.listEntries("/")).rejects.toBeInstanceOf(
      ControlPlaneRequestError,
    );
    await expect(provider.listEntries("/")).rejects.toMatchObject({
      status: 403,
      code: "VAULT_CROSS_TENANT",
    });
  });

  it("refuses reads larger than the documented max byte cap", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    store.seed(BUCKET, `${PREFIX}big.txt`, "x".repeat(65), "text/plain");
    store.seed(BUCKET, `${PREFIX}ok.txt`, "y".repeat(64), "text/plain");
    const { provider } = providerFor(store, { maxReadBytes: 64 });

    expect(await provider.readFile("/big.txt")).toBeNull();
    expect((await provider.readFile("/ok.txt"))?.content).toBe("y".repeat(64));
  });
});
