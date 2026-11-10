import { describe, expect, it } from "vitest";

import {
  DEFAULT_GUEST_VAULT_ROOT,
  inferVaultRootFromProjectPath,
  looksLikeHostFilesystemPath,
  projectToVaultRelativePath,
} from "./path-project.js";

describe("looksLikeHostFilesystemPath", () => {
  it("detects common host roots", () => {
    expect(looksLikeHostFilesystemPath("/home/u/Lanyard/AGENTS.md")).toBe(true);
    expect(looksLikeHostFilesystemPath("/opt/company-brain/Clients/x")).toBe(
      true,
    );
    expect(looksLikeHostFilesystemPath("/Users/me/vault/Note.docx")).toBe(
      true,
    );
  });

  it("rejects vault-root-relative API paths", () => {
    expect(looksLikeHostFilesystemPath("/Clients/Active/Acme/AGENTS.md")).toBe(
      false,
    );
    expect(looksLikeHostFilesystemPath("/Projects/Legal/memo.md")).toBe(false);
    expect(looksLikeHostFilesystemPath("/AGENTS.md")).toBe(false);
    expect(looksLikeHostFilesystemPath("/Note.docx")).toBe(false);
    expect(looksLikeHostFilesystemPath("/workflows/runs/wf_abc/state.json")).toBe(
      false,
    );
  });

  it("detects the short-stack guest mount as a host path", () => {
    expect(looksLikeHostFilesystemPath("/mnt/vault")).toBe(true);
    expect(
      looksLikeHostFilesystemPath(
        "/mnt/vault/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
      ),
    ).toBe(true);
  });
});

describe("inferVaultRootFromProjectPath", () => {
  it("strips host prefix before Clients/Projects top-level", () => {
    expect(
      inferVaultRootFromProjectPath("/home/operator/Lanyard/Clients"),
    ).toBe("/home/operator/Lanyard");
    expect(
      inferVaultRootFromProjectPath(
        "/opt/company-brain/Clients/Active/Acme_Demo",
      ),
    ).toBe("/opt/company-brain");
    expect(
      inferVaultRootFromProjectPath("/home/u/Lanyard/Projects/Legal"),
    ).toBe("/home/u/Lanyard");
  });

  it("returns null for multi-root project folders without vault top-level", () => {
    expect(inferVaultRootFromProjectPath("/home/u/Core")).toBeNull();
    expect(inferVaultRootFromProjectPath("/home/u/Demo")).toBeNull();
    expect(inferVaultRootFromProjectPath("/Clients/Active/Acme")).toBeNull();
    expect(inferVaultRootFromProjectPath(null)).toBeNull();
  });
});

describe("projectToVaultRelativePath", () => {
  const clientsProject = "/home/operator/Lanyard/Clients";

  it("projects host absolute under Clients project to vault-relative", () => {
    expect(
      projectToVaultRelativePath(
        "/home/operator/Lanyard/Clients/Active/Acme/AGENTS.md",
        { projectVaultPath: clientsProject },
      ),
    ).toBe("/Clients/Active/Acme/AGENTS.md");
    expect(
      projectToVaultRelativePath("/home/operator/Lanyard/AGENTS.md", {
        projectVaultPath: clientsProject,
      }),
    ).toBe("/AGENTS.md");
    expect(
      projectToVaultRelativePath("/home/operator/Lanyard/Note.docx", {
        projectVaultPath: clientsProject,
      }),
    ).toBe("/Note.docx");
  });

  it("projects joined relative results under Clients project", () => {
    // resolveVaultCitationPath joins first; projection runs on the absolute.
    expect(
      projectToVaultRelativePath(
        "/home/operator/Lanyard/Clients/Active/X/Note.docx",
        { projectVaultPath: clientsProject },
      ),
    ).toBe("/Clients/Active/X/Note.docx");
  });

  it("keeps already vault-relative paths", () => {
    expect(
      projectToVaultRelativePath("/Clients/Active/Acme/AGENTS.md", {
        projectVaultPath: clientsProject,
      }),
    ).toBe("/Clients/Active/Acme/AGENTS.md");
    expect(projectToVaultRelativePath("/AGENTS.md")).toBe("/AGENTS.md");
  });

  it("strips explicit vaultRoot including root files", () => {
    expect(
      projectToVaultRelativePath("/home/operator/Lanyard/AGENTS.md", {
        vaultRoot: "/home/operator/Lanyard",
      }),
    ).toBe("/AGENTS.md");
    expect(
      projectToVaultRelativePath(
        "/home/operator/Lanyard/Clients/Active/x.md",
        { vaultRoot: "/home/operator/Lanyard" },
      ),
    ).toBe("/Clients/Active/x.md");
  });

  it("strips through vault top-level without project context", () => {
    expect(
      projectToVaultRelativePath(
        "/opt/company-brain/Clients/Active/Acme/Note.docx",
      ),
    ).toBe("/Clients/Active/Acme/Note.docx");
    expect(
      projectToVaultRelativePath(
        "/home/u/Lanyard/Projects/Legal/memo.md",
      ),
    ).toBe("/Projects/Legal/memo.md");
  });

  it("preserves multi-root host absolute identity without vault top-level", () => {
    expect(
      projectToVaultRelativePath("/home/u/Core/README.md", {
        projectVaultPath: "/home/u/Core",
      }),
    ).toBe("/home/u/Core/README.md");
    expect(
      projectToVaultRelativePath("/home/u/Demo/notes.md"),
    ).toBe("/home/u/Demo/notes.md");
  });

  it("strips the guest vault root from workflow run citations (lp-oop.38.22)", () => {
    expect(DEFAULT_GUEST_VAULT_ROOT).toBe("/mnt/vault");
    expect(
      projectToVaultRelativePath(
        "/mnt/vault/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
      ),
    ).toBe("/workflows/runs/wf_03e3fb5b2224a1d2/state.json");
    expect(projectToVaultRelativePath("/mnt/vault/AGENTS.md")).toBe(
      "/AGENTS.md",
    );
    expect(projectToVaultRelativePath("/mnt/vault")).toBe("/");
    expect(
      projectToVaultRelativePath(
        "/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
      ),
    ).toBe("/workflows/runs/wf_03e3fb5b2224a1d2/state.json");
  });
});
