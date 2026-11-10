import { describe, expect, it } from "vitest";

import {
  appendComposerFragment,
  attachableSkillsFromSnapshot,
  findVaultTreeNode,
  oneLineDescription,
  skillInsertText,
  skillInsertToken,
  vaultBrowseLabel,
  vaultDeepLinkPath,
  vaultEntriesAtPath,
  vaultFilesForAttachMenu,
  vaultParentBrowsePath,
  vaultPathInsertText,
  vaultTreeHasContent,
  type AttachMenuVaultTreeNode,
} from "./composerAttachMenuModel.js";

const SAMPLE_TREE: AttachMenuVaultTreeNode[] = [
  {
    name: "Business",
    path: "/Business",
    kind: "directory",
    children: [
      {
        name: "Contracts",
        path: "/Business/Contracts",
        kind: "directory",
        children: [
          {
            name: "MSA.docx",
            path: "/Business/Contracts/MSA.docx",
            kind: "file",
          },
          {
            name: "NDA.pdf",
            path: "/Business/Contracts/NDA.pdf",
            kind: "file",
          },
        ],
      },
      {
        name: "notes.md",
        path: "/Business/notes.md",
        kind: "file",
      },
    ],
  },
  {
    name: "readme.md",
    path: "/readme.md",
    kind: "file",
  },
];

describe("composerAttachMenuModel", () => {
  it("maps enabled skills with optional description", () => {
    const skills = attachableSkillsFromSnapshot([
      {
        id: "summarize",
        name: "summarize",
        description: "Condense long text",
        enabled: true,
      },
      { id: "off", name: "disabled-skill", enabled: false },
      { id: "plain", name: "plain", enabled: true },
      {
        id: "multiline",
        name: "multiline",
        description: "  Line one\n\nLine two  ",
        enabled: true,
      },
      {
        id: "blank-desc",
        name: "blank-desc",
        description: "   ",
        enabled: true,
      },
    ]);
    expect(skills).toEqual([
      {
        id: "summarize",
        name: "summarize",
        description: "Condense long text",
        enabled: true,
      },
      { id: "plain", name: "plain", enabled: true },
      {
        id: "multiline",
        name: "multiline",
        description: "Line one Line two",
        enabled: true,
      },
      // Empty description omitted — name-only, no layout placeholder field.
      { id: "blank-desc", name: "blank-desc", enabled: true },
    ]);
  });

  it("oneLineDescription collapses whitespace and soft-caps length", () => {
    expect(oneLineDescription(undefined)).toBeUndefined();
    expect(oneLineDescription("")).toBeUndefined();
    expect(oneLineDescription("  ")).toBeUndefined();
    expect(oneLineDescription("  a\n\tb  ")).toBe("a b");
    const long = "word ".repeat(40).trim(); // 199 chars
    const capped = oneLineDescription(long, 40);
    expect(capped).toBeDefined();
    expect(capped!.endsWith("…")).toBe(true);
    expect(capped!.length).toBeLessThanOrEqual(40);
  });

  it("builds /skill insert token matching typeahead", () => {
    const token = skillInsertToken({
      id: "sum",
      name: "summarize",
      description: "x",
    });
    expect(token).toMatchObject({
      value: "/summarize",
      label: "/summarize",
      variant: "yellow",
    });
    expect(skillInsertText({ id: "sum", name: "summarize" })).toBe(
      "/summarize",
    );
  });

  it("inserts vault path reference with leading slash", () => {
    expect(
      vaultPathInsertText({
        path: "/Business/Contracts/MSA.docx",
        name: "MSA.docx",
      }),
    ).toBe("/Business/Contracts/MSA.docx");
    expect(
      vaultPathInsertText({ path: "relative/notes.md", name: "notes.md" }),
    ).toBe("/relative/notes.md");
  });

  it("appends composer fragments with spacing", () => {
    expect(appendComposerFragment("", "/summarize")).toBe("/summarize");
    expect(appendComposerFragment("hello", "/summarize")).toBe(
      "hello /summarize",
    );
    expect(appendComposerFragment("hello ", "/summarize")).toBe(
      "hello /summarize",
    );
  });

  it("flattens vault tree files for attach list", () => {
    const files = vaultFilesForAttachMenu(
      [
        {
          name: "Business",
          path: "/Business",
          kind: "directory",
          children: [
            {
              name: "MSA.docx",
              path: "/Business/MSA.docx",
              kind: "file",
            },
            {
              name: "notes.md",
              path: "/Business/notes.md",
              kind: "file",
            },
          ],
        },
      ],
      50,
    );
    expect(files).toEqual([
      { path: "/Business/MSA.docx", name: "MSA.docx" },
      { path: "/Business/notes.md", name: "notes.md" },
    ]);
  });

  it("lp-khq.7: lists folder children with directories first", () => {
    const roots = vaultEntriesAtPath(SAMPLE_TREE, "");
    expect(roots.map((n) => n.name)).toEqual(["Business", "readme.md"]);
    expect(roots[0]?.kind).toBe("directory");
    expect(roots[1]?.kind).toBe("file");

    const business = vaultEntriesAtPath(SAMPLE_TREE, "/Business");
    expect(business.map((n) => `${n.kind}:${n.name}`)).toEqual([
      "directory:Contracts",
      "file:notes.md",
    ]);

    const contracts = vaultEntriesAtPath(SAMPLE_TREE, "/Business/Contracts");
    expect(contracts.map((n) => n.name)).toEqual(["MSA.docx", "NDA.pdf"]);
  });

  it("lp-khq.7: parent browse path and deep-link path", () => {
    expect(vaultParentBrowsePath("")).toBeNull();
    expect(vaultParentBrowsePath("/")).toBeNull();
    expect(vaultParentBrowsePath("/Business")).toBe("");
    expect(vaultParentBrowsePath("/Business/Contracts")).toBe("/Business");

    expect(vaultDeepLinkPath("")).toBe("/");
    expect(vaultDeepLinkPath("/")).toBe("/");
    expect(vaultDeepLinkPath("/Business/Contracts")).toBe(
      "/Business/Contracts",
    );
    expect(vaultBrowseLabel("")).toBe("Vault root");
    expect(vaultBrowseLabel("/Business/Contracts")).toBe("Contracts");
  });

  it("lp-khq.7: findVaultTreeNode and vaultTreeHasContent", () => {
    expect(vaultTreeHasContent([])).toBe(false);
    expect(vaultTreeHasContent(SAMPLE_TREE)).toBe(true);
    expect(findVaultTreeNode(SAMPLE_TREE, "/Business/Contracts/MSA.docx")?.name)
      .toBe("MSA.docx");
    expect(findVaultTreeNode(SAMPLE_TREE, "/missing")).toBeNull();
  });
});
