import { describe, expect, it } from "vitest";

import type { Project } from "../../api/types.js";
import {
  DEFAULT_PROJECTS_ROOT,
  defaultFolderPath,
  normalizeVaultParentPath,
  projectSelectOptions,
} from "./projectOptions.js";

describe("defaultFolderPath", () => {
  it("defaults under agent/vault root (not /Projects or ~/…)", () => {
    // Vault root is `/` — no forced generic /Projects namespace.
    expect(DEFAULT_PROJECTS_ROOT).toBe("/");
    expect(defaultFolderPath("")).toBe("/Project");
    expect(defaultFolderPath("Beta")).toBe("/Beta");
    expect(defaultFolderPath("Acme")).toBe("/Acme");
    expect(defaultFolderPath("My App!")).toBe("/my-app");
    // Vault-root-relative (leading /), not home-relative.
    expect(defaultFolderPath("Beta")).toMatch(/^\//);
    expect(defaultFolderPath("Beta")).not.toMatch(/^~/);
    expect(defaultFolderPath("Beta")).not.toMatch(/^~\/[^/]+$/);
    // Must not force product namespace /Projects unless operator types it.
    expect(defaultFolderPath("Beta")).not.toMatch(/^\/Projects(\/|$)/);
    expect(defaultFolderPath("Beta")).not.toBe("/Projects/Beta");
  });

  it("nests under selected parent project vault_path/primary_path", () => {
    expect(
      defaultFolderPath("relationships", { parentPath: "/Business" }),
    ).toBe("/Business/relationships");
    expect(defaultFolderPath("Acme", { parentPath: "/clients" })).toBe(
      "/clients/Acme",
    );
    expect(
      defaultFolderPath("nested", { parentPath: "/Business/" }),
    ).toBe("/Business/nested");
    // Absolute host primary_path still nests as a subdirectory.
    expect(
      defaultFolderPath("child", {
        parentPath: "/home/agent/lanyard/Business",
      }),
    ).toBe("/home/agent/lanyard/Business/child");
  });

  it("treats empty or root parent as vault-root create", () => {
    expect(defaultFolderPath("Acme", { parentPath: null })).toBe("/Acme");
    expect(defaultFolderPath("Acme", { parentPath: undefined })).toBe("/Acme");
    expect(defaultFolderPath("Acme", { parentPath: "" })).toBe("/Acme");
    expect(defaultFolderPath("Acme", { parentPath: "/" })).toBe("/Acme");
  });
});

describe("normalizeVaultParentPath", () => {
  it("returns null for empty/root and normalizes trailing slashes", () => {
    expect(normalizeVaultParentPath(null)).toBeNull();
    expect(normalizeVaultParentPath(undefined)).toBeNull();
    expect(normalizeVaultParentPath("")).toBeNull();
    expect(normalizeVaultParentPath("/")).toBeNull();
    expect(normalizeVaultParentPath("/Business/")).toBe("/Business");
    expect(normalizeVaultParentPath("clients")).toBe("/clients");
  });
});

describe("projectSelectOptions", () => {
  it("includes a no-project option and shows name with absolute path", () => {
    const projects: Project[] = [
      {
        project_id: "p_demo",
        name: "Demo",
        vault_path: "/home/operator/Demo",
        parent_project_id: null,
      },
      {
        project_id: "p_child",
        name: "Nested",
        vault_path: "/home/operator/Nested",
        parent_project_id: "p_demo",
      },
    ];

    expect(projectSelectOptions(projects)).toEqual([
      { value: "", label: "No project" },
      { value: "p_demo", label: "Demo (/home/operator/Demo)" },
      { value: "p_child", label: "↳ Nested (/home/operator/Nested)" },
    ]);
  });

  it("omits empty path suffix", () => {
    const projects: Project[] = [
      {
        project_id: "p1",
        name: "EmptyPath",
        vault_path: "",
        parent_project_id: null,
      },
    ];
    expect(projectSelectOptions(projects)).toEqual([
      { value: "", label: "No project" },
      { value: "p1", label: "EmptyPath" },
    ]);
  });
});
