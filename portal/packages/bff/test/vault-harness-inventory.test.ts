/**
 * lp-oop.38.18 — Tools snapshot inventory is the live vault document.
 * Harness BACKEND_HOME may be empty; vault skills/workflows still project.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { UserRbac } from "../src/control-plane-client.js";
import { createFixtureVaultIndexProvider } from "../src/vault/fixture-index.js";
import { createFsVaultContentProvider } from "../src/vault/fs-provider.js";
import { VaultService } from "../src/vault/service.js";
import {
  collectVaultHarnessInventory,
  overlayVaultInventoryOnSnapshot,
  projectVaultInventoryOntoSnapshot,
} from "../src/vault-harness-inventory.js";

const rbac: UserRbac = {
  user_id: "user-vault-inventory",
  tenant_id: "mocklab",
  hermes_profile: "admin",
  allowed_path_prefixes: ["/"],
  role_names: ["admin"],
};

function seedVaultHome(): string {
  const root = mkdtempSync(join(tmpdir(), "vault-harness-inventory-"));
  mkdirSync(join(root, "skills", "mocklab-research"), { recursive: true });
  writeFileSync(
    join(root, "skills", "mocklab-research", "SKILL.md"),
    ["---", "name: mocklab-research", "---", "", "# MockLab research", ""].join(
      "\n",
    ),
  );
  mkdirSync(join(root, "workflows"), { recursive: true });
  writeFileSync(
    join(root, "workflows", "README.md"),
    "# workflows/\n",
  );
  writeFileSync(
    join(root, "workflows", "research-lite.yaml"),
    "name: MockLab research lite\n",
  );
  return root;
}

describe("overlayVaultInventoryOnSnapshot", () => {
  it("fills empty harness skills/workflows from the vault document", () => {
    const next = overlayVaultInventoryOnSnapshot(
      {
        exported_at: "2026-08-20T00:00:00.000Z",
        source: "harness",
        backend_home: null,
        skills: [],
        workflows: [],
        models: [{ provider: "poolside", model: "laguna-s-2.1" }],
        mcp_servers: [],
      },
      {
        skills: [
          {
            id: "mocklab-research",
            name: "mocklab-research",
            enabled: true,
            path: "skills/mocklab-research",
            source: "harness",
          },
        ],
        workflows: [
          {
            id: "research-lite",
            name: "research-lite",
            path: "workflows/research-lite.yaml",
            enabled: true,
          },
        ],
      },
    );
    expect(next.source).toBe("harness");
    expect(next.backend_home).toBeNull();
    expect(next.skills).toEqual([
      expect.objectContaining({ id: "mocklab-research" }),
    ]);
    expect(next.workflows).toEqual([
      expect.objectContaining({ id: "research-lite" }),
    ]);
    expect(next.models).toEqual([
      { provider: "poolside", model: "laguna-s-2.1" },
    ]);
  });

  it("keeps harness rows on id collision and unions missing vault ids", () => {
    const next = overlayVaultInventoryOnSnapshot(
      {
        skills: [{ id: "mocklab-research", enabled: false, name: "from-home" }],
        workflows: [],
      },
      {
        skills: [
          {
            id: "mocklab-research",
            name: "mocklab-research",
            enabled: true,
            path: "skills/mocklab-research",
            source: "harness",
          },
          {
            id: "extra-vault",
            name: "extra-vault",
            enabled: true,
            path: "skills/extra-vault",
            source: "harness",
          },
        ],
        workflows: [],
      },
    );
    const skills = next.skills as Array<{ id: string; enabled?: boolean; name?: string }>;
    expect(skills.map((s) => s.id).sort()).toEqual([
      "extra-vault",
      "mocklab-research",
    ]);
    expect(skills.find((s) => s.id === "mocklab-research")).toMatchObject({
      enabled: false,
      name: "from-home",
    });
  });
});

describe("collectVaultHarnessInventory", () => {
  it("walks SKILL.md packages and skips workflow README", async () => {
    const root = seedVaultHome();
    const vault = new VaultService(
      createFsVaultContentProvider(root),
      createFixtureVaultIndexProvider(),
    );
    const inventory = await collectVaultHarnessInventory(vault, rbac);
    expect(inventory.skills.map((s) => s.id)).toEqual(["mocklab-research"]);
    expect(inventory.skills[0]?.path).toBe("skills/mocklab-research");
    expect(inventory.workflows.map((w) => w.id)).toEqual(["research-lite"]);
    expect(inventory.workflows[0]?.path).toBe("workflows/research-lite.yaml");
  });
});

describe("projectVaultInventoryOntoSnapshot", () => {
  it("projects a live vault skill onto an empty harness snapshot", async () => {
    const root = seedVaultHome();
    const vault = new VaultService(
      createFsVaultContentProvider(root),
      createFixtureVaultIndexProvider(),
    );
    const next = await projectVaultInventoryOntoSnapshot(
      {
        exported_at: "2026-08-20T00:00:00.000Z",
        source: "harness",
        backend_home: null,
        skills: [],
        workflows: [],
        mcp_servers: [],
        models: [{ provider: "litellm", model: "x" }],
      },
      vault,
      rbac,
    );
    expect(next.source).toBe("harness");
    expect((next.skills as Array<{ id: string }>).map((s) => s.id)).toEqual([
      "mocklab-research",
    ]);
    expect((next.workflows as Array<{ id: string }>).map((w) => w.id)).toEqual([
      "research-lite",
    ]);
  });

  it("leaves the harness snapshot unchanged when rbac is missing", async () => {
    const root = seedVaultHome();
    const vault = new VaultService(
      createFsVaultContentProvider(root),
      createFixtureVaultIndexProvider(),
    );
    const snapshot = { source: "harness", skills: [], workflows: [] };
    const next = await projectVaultInventoryOntoSnapshot(snapshot, vault, null);
    expect(next).toEqual(snapshot);
  });
});
