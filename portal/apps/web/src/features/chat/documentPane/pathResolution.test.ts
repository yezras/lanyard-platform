import { describe, expect, it } from "vitest";

import {
  normalizePaneVaultPath,
  resolvePaneArtifactRef,
  sameDocumentRevision,
  samePaneArtifactPath,
} from "./pathResolution.js";

describe("normalizePaneVaultPath", () => {
  it("adds leading slash and collapses duplicate slashes", () => {
    expect(normalizePaneVaultPath("Projects/a.md")).toBe("/Projects/a.md");
    expect(normalizePaneVaultPath("//Projects//a.md")).toBe("/Projects/a.md");
  });

  it("strips trailing slash except root", () => {
    expect(normalizePaneVaultPath("/Projects/a.md/")).toBe("/Projects/a.md");
  });

  it("rejects empty, root-only, and traversal segments", () => {
    expect(normalizePaneVaultPath("")).toBeNull();
    expect(normalizePaneVaultPath("   ")).toBeNull();
    expect(normalizePaneVaultPath("/")).toBeNull();
    expect(normalizePaneVaultPath("/Projects/../secret")).toBeNull();
    expect(normalizePaneVaultPath("/Projects/./a.md")).toBeNull();
  });
});

describe("resolvePaneArtifactRef", () => {
  const projectRoot = "/home/u/Core";

  it("joins relative citation paths to project root", () => {
    const result = resolvePaneArtifactRef("README.md", {
      projectVaultPath: projectRoot,
      source: "citation",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ref.path).toBe("/home/u/Core/README.md");
    expect(result.ref.title).toBe("README.md");
    expect(result.ref.source).toBe("citation");
  });

  it("joins multi-segment relatives without force-prefixing early", () => {
    const result = resolvePaneArtifactRef("src/foo.ts", {
      projectVaultPath: projectRoot,
      source: "tool_target",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ref.path).toBe("/home/u/Core/src/foo.ts");
  });

  it("keeps absolute paths under the project root", () => {
    const result = resolvePaneArtifactRef("/home/u/Core/notes.md", {
      projectVaultPath: projectRoot,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ref.path).toBe("/home/u/Core/notes.md");
  });

  it("remaps /Projects/<seg>/… fixture paths into the project root", () => {
    const result = resolvePaneArtifactRef("/Projects/A/README.md", {
      projectVaultPath: projectRoot,
      source: "citation",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ref.path).toBe("/home/u/Core/README.md");
  });

  it("keeps vault-root absolute like /README.md (no project re-scope)", () => {
    // Intentional (lp-95v.3): vault-root office/doc paths must not be re-scoped
    // under the active project or OnlyOffice open breaks.
    const result = resolvePaneArtifactRef("/README.md", {
      projectVaultPath: projectRoot,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ref.path).toBe("/README.md");
  });

  it("handles file:// URLs", () => {
    const result = resolvePaneArtifactRef(
      "file:///home/u/Core/notes.md",
      { projectVaultPath: projectRoot },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ref.path).toBe("/home/u/Core/notes.md");
  });

  it("normalizes without project context to leading slash", () => {
    const result = resolvePaneArtifactRef("Projects/Legal/memo.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ref.path).toBe("/Projects/Legal/memo.md");
    expect(result.ref.title).toBe("memo.md");
  });

  it("projects guest /mnt/vault workflow citations to vault-relative (lp-oop.38.22)", () => {
    const result = resolvePaneArtifactRef(
      "/mnt/vault/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
      { source: "citation" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ref.path).toBe(
      "/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
    );
    expect(result.ref.title).toBe("state.json");
  });

  it("fails closed on empty path", () => {
    const result = resolvePaneArtifactRef("  ", {
      projectVaultPath: projectRoot,
    });
    expect(result).toMatchObject({
      ok: false,
      code: "empty",
    });
  });

  it("fails closed on traversal segments", () => {
    const result = resolvePaneArtifactRef("../secret.md", {
      projectVaultPath: projectRoot,
    });
    expect(result).toMatchObject({
      ok: false,
      code: "invalid_path",
    });
  });

  it("uses provided title when present", () => {
    const result = resolvePaneArtifactRef("/Projects/Legal/memo.md", {
      title: "Legal memo",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ref.title).toBe("Legal memo");
  });

  // lp-vnz.3 — Clients host absolute → vault-root-relative for vault.read
  describe("host absolute under Clients project (lp-vnz.3)", () => {
    const clientsProject = "/home/operator/Lanyard/Clients";

    it("projects host absolute vault-root files to /Name", () => {
      const agents = resolvePaneArtifactRef(
        "/home/operator/Lanyard/AGENTS.md",
        { projectVaultPath: clientsProject, source: "citation" },
      );
      expect(agents.ok).toBe(true);
      if (!agents.ok) return;
      expect(agents.ref.path).toBe("/AGENTS.md");
      expect(agents.ref.title).toBe("AGENTS.md");

      const note = resolvePaneArtifactRef(
        "/home/operator/Lanyard/Note.docx",
        { projectVaultPath: clientsProject, source: "deep_link" },
      );
      expect(note.ok).toBe(true);
      if (!note.ok) return;
      expect(note.ref.path).toBe("/Note.docx");
    });

    it("projects host absolute under Clients/… to vault-relative", () => {
      const result = resolvePaneArtifactRef(
        "/home/operator/Lanyard/Clients/Active/Acme_Demo/AGENTS.md",
        { projectVaultPath: clientsProject },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.ref.path).toBe(
        "/Clients/Active/Acme_Demo/AGENTS.md",
      );
    });

    it("joins relative names then projects under Clients project", () => {
      const result = resolvePaneArtifactRef("Active/Acme_Demo/Note.docx", {
        projectVaultPath: clientsProject,
        source: "tool_target",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.ref.path).toBe(
        "/Clients/Active/Acme_Demo/Note.docx",
      );
    });

    it("keeps already vault-relative Clients paths", () => {
      const result = resolvePaneArtifactRef(
        "/Clients/Active/Acme_Demo/AGENTS.md",
        { projectVaultPath: clientsProject },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.ref.path).toBe(
        "/Clients/Active/Acme_Demo/AGENTS.md",
      );
    });

    it("projects /opt/company-brain host roots without project context", () => {
      const result = resolvePaneArtifactRef(
        "/opt/company-brain/Clients/Active/Acme/Note.docx",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.ref.path).toBe(
        "/Clients/Active/Acme/Note.docx",
      );
    });
  });
});

describe("samePaneArtifactPath / sameDocumentRevision", () => {
  it("compares normalized paths only", () => {
    expect(
      samePaneArtifactPath(
        { path: "/Projects/a.md", title: "A" },
        { path: "Projects/a.md", title: "B" },
      ),
    ).toBe(true);
    expect(
      samePaneArtifactPath(
        { path: "/Projects/a.md" },
        { path: "/Projects/b.md" },
      ),
    ).toBe(false);
    expect(samePaneArtifactPath(null, { path: "/a.md" })).toBe(false);
  });

  it("compares revision tokens", () => {
    expect(
      sameDocumentRevision(
        { token: "etag-1" },
        { token: "etag-1" },
      ),
    ).toBe(true);
    expect(
      sameDocumentRevision(
        { token: "etag-1" },
        { token: "etag-2" },
      ),
    ).toBe(false);
    expect(sameDocumentRevision(null, { token: "x" })).toBe(false);
  });
});
