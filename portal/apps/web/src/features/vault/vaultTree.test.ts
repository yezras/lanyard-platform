import type { MouseEvent, ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import type { VaultTreeNode } from "../../api/types.js";

import {
  findVaultTreeFilePath,
  vaultNodesToTreeItems,
  vaultPathAncestorIds,
  vaultTreeStateToTreeItems,
} from "./vaultTree.js";
import {
  createEmptyVaultTreeState,
  vaultTreeReducer,
} from "./vaultTreeState.js";

describe("vaultPathAncestorIds", () => {
  it("returns parent directory paths for a nested file", () => {
    expect(vaultPathAncestorIds("/Projects/A/Nested/deep.md")).toEqual([
      "/Projects",
      "/Projects/A",
      "/Projects/A/Nested",
    ]);
  });

  it("returns empty for root or non-absolute paths", () => {
    expect(vaultPathAncestorIds("/README.md")).toEqual([]);
    expect(vaultPathAncestorIds("src/foo.ts")).toEqual([]);
    expect(vaultPathAncestorIds("")).toEqual([]);
  });
});

describe("findVaultTreeFilePath", () => {
  const multiRoot: VaultTreeNode[] = [
    {
      name: "Core",
      path: "/home/u/Core",
      kind: "directory",
      children: [
        {
          name: "README.md",
          path: "/home/u/Core/README.md",
          kind: "file",
          mime_type: "text/markdown",
        },
        {
          name: "src",
          path: "/home/u/Core/src",
          kind: "directory",
          children: [
            {
              name: "foo.ts",
              path: "/home/u/Core/src/foo.ts",
              kind: "file",
              mime_type: "text/typescript",
            },
          ],
        },
      ],
    },
  ];

  it("returns exact multi-root path matches", () => {
    expect(findVaultTreeFilePath(multiRoot, "/home/u/Core/README.md")).toBe(
      "/home/u/Core/README.md",
    );
  });

  it("matches relative and suffix paths onto tree nodes", () => {
    expect(findVaultTreeFilePath(multiRoot, "README.md")).toBe(
      "/home/u/Core/README.md",
    );
    expect(findVaultTreeFilePath(multiRoot, "src/foo.ts")).toBe(
      "/home/u/Core/src/foo.ts",
    );
  });

  it("returns null when basename is ambiguous", () => {
    const roots: VaultTreeNode[] = [
      {
        name: "A",
        path: "/A",
        kind: "directory",
        children: [
          {
            name: "notes.md",
            path: "/A/notes.md",
            kind: "file",
            mime_type: "text/markdown",
          },
        ],
      },
      {
        name: "B",
        path: "/B",
        kind: "directory",
        children: [
          {
            name: "notes.md",
            path: "/B/notes.md",
            kind: "file",
            mime_type: "text/markdown",
          },
        ],
      },
    ];
    expect(findVaultTreeFilePath(roots, "notes.md")).toBeNull();
  });
});

describe("vaultNodesToTreeItems", () => {
  const roots: VaultTreeNode[] = [
    {
      name: "Projects",
      path: "/Projects",
      kind: "directory",
      children: [
        {
          name: "A",
          path: "/Projects/A",
          kind: "directory",
          children: [
            {
              name: "Nested",
              path: "/Projects/A/Nested",
              kind: "directory",
              children: [
                {
                  name: "deep.md",
                  path: "/Projects/A/Nested/deep.md",
                  kind: "file",
                  mime_type: "text/markdown",
                },
              ],
            },
            {
              name: "README.md",
              path: "/Projects/A/README.md",
              kind: "file",
              mime_type: "text/markdown",
            },
          ],
        },
        {
          name: "notes.md",
          path: "/Projects/B/notes.md",
          kind: "file",
          mime_type: "text/markdown",
        },
      ],
    },
  ];

  it("keeps all directories collapsed by default and attaches icons", () => {
    const onOpenFile = vi.fn();
    const items = vaultNodesToTreeItems(roots, onOpenFile);

    expect(items).toHaveLength(1);
    const projects = items[0]!;
    expect(projects.id).toBe("/Projects");
    expect(projects.isExpanded).toBe(false);
    expect(projects.startContent).toBeTruthy();
    expect(projects.onClick).toBeUndefined();

    const teamA = projects.children?.[0];
    expect(teamA?.id).toBe("/Projects/A");
    expect(teamA?.isExpanded).toBe(false);
    expect(teamA?.startContent).toBeTruthy();
    expect(teamA?.onClick).toBeUndefined();

    const nested = teamA?.children?.find((c) => c.id === "/Projects/A/Nested");
    expect(nested?.isExpanded).toBe(false);
    expect(nested?.startContent).toBeTruthy();
  });

  it("opens files only via onClick; directories have no onOpenFile", () => {
    const onOpenFile = vi.fn();
    const items = vaultNodesToTreeItems(roots, onOpenFile);

    const projects = items[0]!;
    const teamA = projects.children?.[0];
    const readme = teamA?.children?.find((c) => c.id === "/Projects/A/README.md");

    expect(readme?.onClick).toBeTypeOf("function");
    expect(readme?.startContent).toBeTruthy();
    readme?.onClick?.({} as MouseEvent);
    expect(onOpenFile).toHaveBeenCalledWith("/Projects/A/README.md");
    expect(onOpenFile).toHaveBeenCalledTimes(1);

    // Directory nodes must not open as files
    projects.onClick?.({} as MouseEvent);
    teamA?.onClick?.({} as MouseEvent);
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  it("uses Text maxLines labels for tree nodes", () => {
    const items = vaultNodesToTreeItems(roots, vi.fn());
    const projects = items[0]!;
    // Label is a React element (Text maxLines={1}), not a raw string
    expect(typeof projects.label).not.toBe("string");
    const label = projects.label as ReactElement<{ maxLines?: number }>;
    expect(label.props.maxLines).toBe(1);
  });

  it("passes absolute path description through for Hermes project roots", () => {
    const hermesRoots: VaultTreeNode[] = [
      {
        name: "Core",
        path: "/home/operator/Core",
        kind: "directory",
        description: "/home/operator/Core",
        children: [
          {
            name: "README.md",
            path: "/home/operator/Core/README.md",
            kind: "file",
            mime_type: "text/markdown",
          },
        ],
      },
    ];

    const items = vaultNodesToTreeItems(hermesRoots, vi.fn());
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("/home/operator/Core");
    expect(items[0]!.description).toBe("/home/operator/Core");
    // Nested files without description stay clean
    expect(items[0]!.children?.[0]?.description).toBeUndefined();
  });

  it("expands ancestors and selects the deep-linked file path", () => {
    const onOpenFile = vi.fn();
    const target = "/Projects/A/Nested/deep.md";
    const items = vaultNodesToTreeItems(roots, {
      onOpenFile,
      expandedPaths: vaultPathAncestorIds(target),
      selectedPath: target,
    });

    const projects = items[0]!;
    expect(projects.isExpanded).toBe(true);
    expect(projects.isSelected).toBe(false);

    const teamA = projects.children?.[0];
    expect(teamA?.isExpanded).toBe(true);

    const nested = teamA?.children?.find((c) => c.id === "/Projects/A/Nested");
    expect(nested?.isExpanded).toBe(true);

    const deep = nested?.children?.find((c) => c.id === target);
    expect(deep?.isSelected).toBe(true);

    // Sibling file not selected
    const readme = teamA?.children?.find(
      (c) => c.id === "/Projects/A/README.md",
    );
    expect(readme?.isSelected).toBe(false);
  });
});

describe("vaultTreeStateToTreeItems", () => {
  it("adds a disabled synthetic child so unloaded directories can expand", () => {
    const state = vaultTreeReducer(createEmptyVaultTreeState(), {
      type: "snapshot.loaded",
      roots: [
        {
          name: "Projects",
          path: "/Projects",
          kind: "directory",
          children: [
            {
              name: "Archive",
              path: "/Projects/Archive",
              kind: "directory",
            },
          ],
        },
      ],
    });

    const items = vaultTreeStateToTreeItems(state, {
      onOpenFile: vi.fn(),
      expandedPaths: ["/Projects", "/Projects/Archive"],
    });

    const archive = items[0]?.children?.find(
      (item) => item.id === "/Projects/Archive",
    );
    expect(archive?.children?.[0]?.id).toBe(
      "__vault_unloaded:/Projects/Archive",
    );
    expect(archive?.children?.[0]?.isDisabled).toBe(true);
  });

  it("renders retry and load-more synthetic rows with callbacks", () => {
    const retry = vi.fn();
    const loadMore = vi.fn();
    const snapshot = vaultTreeReducer(createEmptyVaultTreeState(), {
      type: "snapshot.loaded",
      roots: [
        {
          name: "Projects",
          path: "/Projects",
          kind: "directory",
          children: [
            {
              name: "Archive",
              path: "/Projects/Archive",
              kind: "directory",
            },
            {
              name: "More",
              path: "/Projects/More",
              kind: "directory",
            },
          ],
        },
      ],
    });
    const loading = vaultTreeReducer(snapshot, {
      type: "directory.loadStarted",
      path: "/Projects/Archive",
      requestId: "retry",
    });
    const failed = vaultTreeReducer(loading, {
      type: "directory.loadFailed",
      path: "/Projects/Archive",
      requestId: "retry",
      error: "Host unavailable",
    });
    const moreLoading = vaultTreeReducer(failed, {
      type: "directory.loadStarted",
      path: "/Projects/More",
      requestId: "more-1",
    });
    const moreLoaded = vaultTreeReducer(moreLoading, {
      type: "directory.loadSucceeded",
      path: "/Projects/More",
      requestId: "more-1",
      entries: [
        {
          name: "one.md",
          path: "/Projects/More/one.md",
          kind: "file",
        },
      ],
      truncated: true,
      nextCursor: "page-2",
    });

    const items = vaultTreeStateToTreeItems(moreLoaded, {
      onOpenFile: vi.fn(),
      expandedPaths: ["/Projects", "/Projects/Archive", "/Projects/More"],
      onRetryDirectory: retry,
      onLoadMoreDirectory: loadMore,
    });
    const projects = items[0]!;
    const archive = projects.children?.find(
      (item) => item.id === "/Projects/Archive",
    );
    const more = projects.children?.find((item) => item.id === "/Projects/More");

    archive?.children?.find((item) => item.id.startsWith("__vault_error:"))
      ?.onClick?.({} as MouseEvent);
    more?.children?.find((item) => item.id.startsWith("__vault_load-more:"))
      ?.onClick?.({} as MouseEvent);

    expect(retry).toHaveBeenCalledWith("/Projects/Archive");
    expect(loadMore).toHaveBeenCalledWith("/Projects/More");
  });
});
