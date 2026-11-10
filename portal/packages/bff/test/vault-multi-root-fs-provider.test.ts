import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMultiRootFsVaultContentProvider } from "../src/vault/multi-root-fs-provider.js";
import { VaultService } from "../src/vault/service.js";
import { createFixtureVaultIndexProvider } from "../src/vault/fixture-index.js";
import { DEFAULT_VAULT_READ_MAX_BYTES } from "../src/vault/path-security.js";

describe("createMultiRootFsVaultContentProvider", () => {
  let rootA: string;
  let rootB: string;
  let outside: string | undefined;

  afterEach(async () => {
    if (rootA) {
      await rm(rootA, { recursive: true, force: true });
    }
    if (rootB) {
      await rm(rootB, { recursive: true, force: true });
    }
    if (outside) {
      await rm(outside, { recursive: true, force: true });
      outside = undefined;
    }
  });

  it("lists each root with basename name and absolute path", async () => {
    rootA = await mkdtemp(path.join(tmpdir(), "vault-mra-"));
    rootB = await mkdtemp(path.join(tmpdir(), "vault-mrb-"));
    await writeFile(path.join(rootA, "a.md"), "# A\n", "utf-8");
    await mkdir(path.join(rootB, "nested"), { recursive: true });
    await writeFile(path.join(rootB, "nested", "b.md"), "# B\n", "utf-8");

    const provider = createMultiRootFsVaultContentProvider({
      getRoots: () => [
        {
          absolutePath: rootA,
          name: path.basename(rootA),
          description: rootA,
        },
        {
          absolutePath: rootB,
          name: path.basename(rootB),
          description: rootB,
        },
      ],
    });

    const tree = await provider.getTree();
    expect(tree).toHaveLength(2);
    expect(tree[0]?.name).toBe(path.basename(rootA));
    expect(tree[0]?.path).toBe(rootA);
    expect(tree[0]?.description).toBe(rootA);
    expect(
      tree[0]?.children?.some((c) => c.path === path.join(rootA, "a.md")),
    ).toBe(true);

    expect(tree[1]?.path).toBe(rootB);
    const nested = tree[1]?.children?.find((c) => c.name === "nested");
    expect(nested?.kind).toBe("directory");
    expect(
      nested?.children?.some(
        (c) => c.path === path.join(rootB, "nested", "b.md"),
      ),
    ).toBe(true);

    const file = await provider.readFile(path.join(rootA, "a.md"));
    expect(file?.content).toContain("# A");
    expect(file?.path).toBe(path.join(rootA, "a.md"));

    const denied = await provider.readFile("/tmp/outside.md");
    expect(denied).toBeNull();
  });

  it("ACL with / prefix returns multi-root project folders", async () => {
    rootA = await mkdtemp(path.join(tmpdir(), "vault-acl-"));
    await writeFile(path.join(rootA, "note.md"), "hi\n", "utf-8");

    const provider = createMultiRootFsVaultContentProvider({
      getRoots: () => [
        {
          absolutePath: rootA,
          name: path.basename(rootA),
          description: rootA,
        },
      ],
    });

    const service = new VaultService(
      provider,
      createFixtureVaultIndexProvider(),
    );
    const rbac = {
      user_id: "u1",
      tenant_id: "t1",
      hermes_profile: "default",
      allowed_path_prefixes: ["/"],
      role_names: ["member"],
    };

    const { roots } = await service.getTree(rbac);

    expect(roots).toHaveLength(1);
    expect(roots[0]?.path).toBe(rootA);
    expect(roots[0]?.description).toBe(rootA);
    expect(roots[0]?.children?.some((c) => c.name === "note.md")).toBe(true);

    const content = await service.readContent(
      rbac,
      path.join(rootA, "note.md"),
    );
    expect(content.content).toContain("hi");
  });

  it("refuses outside-root symlink breakout via canonical containment", async () => {
    rootA = await mkdtemp(path.join(tmpdir(), "vault-mr-sym-a-"));
    rootB = await mkdtemp(path.join(tmpdir(), "vault-mr-sym-b-"));
    outside = await mkdtemp(path.join(tmpdir(), "vault-mr-sym-out-"));

    await writeFile(path.join(rootA, "a.md"), "# A\n", "utf-8");
    await writeFile(path.join(rootB, "b.md"), "# B\n", "utf-8");
    const secretPath = path.join(outside, "secret.txt");
    await writeFile(secretPath, "HOST_SECRET\n", "utf-8");

    await symlink(secretPath, path.join(rootA, "escape.txt"));
    await symlink(outside, path.join(rootA, "escape-dir"));

    const provider = createMultiRootFsVaultContentProvider({
      getRoots: () => [
        {
          absolutePath: rootA,
          name: path.basename(rootA),
          description: rootA,
        },
        {
          absolutePath: rootB,
          name: path.basename(rootB),
          description: rootB,
        },
      ],
    });

    // Lexical path is under rootA, but realpath points outside every root.
    expect(await provider.readFile(path.join(rootA, "escape.txt"))).toBeNull();
    expect(
      await provider.readFile(path.join(rootA, "escape-dir", "secret.txt")),
    ).toBeNull();
    expect(await provider.readFile(secretPath)).toBeNull();

    const entries = await provider.listEntries(rootA);
    const names = entries.map((e) => e.name);
    expect(names).toContain("a.md");
    expect(names).not.toContain("escape.txt");
    expect(names).not.toContain("escape-dir");

    // Symlink into another configured root is allowed (canonical containment).
    await symlink(path.join(rootB, "b.md"), path.join(rootA, "to-b.md"));
    const cross = await provider.readFile(path.join(rootA, "to-b.md"));
    expect(cross?.content).toContain("# B");

    // Size cap: refuse oversized allowed files.
    const cap = 32;
    await writeFile(path.join(rootA, "big.md"), "z".repeat(cap + 1), "utf-8");
    const capped = createMultiRootFsVaultContentProvider({
      maxReadBytes: cap,
      getRoots: () => [
        {
          absolutePath: rootA,
          name: path.basename(rootA),
          description: rootA,
        },
      ],
    });
    expect(await capped.readFile(path.join(rootA, "big.md"))).toBeNull();
    expect(DEFAULT_VAULT_READ_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});
