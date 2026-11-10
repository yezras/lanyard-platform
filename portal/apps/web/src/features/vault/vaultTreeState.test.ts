import { describe, expect, it } from "vitest";

import type { VaultTreeNode } from "../../api/types.js";

import {
  createEmptyVaultTreeState,
  vaultTreeReducer,
  vaultTreeStateToRoots,
} from "./vaultTreeState.js";

const SNAPSHOT: VaultTreeNode[] = [
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
            name: "README.md",
            path: "/Projects/A/README.md",
            kind: "file",
            mime_type: "text/markdown",
          },
        ],
      },
      {
        name: "Archive",
        path: "/Projects/Archive",
        kind: "directory",
      },
    ],
  },
];

describe("vaultTreeState", () => {
  it("ingests recursive snapshots into normalized roots, nodes, and directories", () => {
    const state = vaultTreeReducer(createEmptyVaultTreeState(), {
      type: "snapshot.loaded",
      roots: SNAPSHOT,
      meta: {
        source: "brain_rpc",
        truncated: true,
        truncatedReason: "max_nodes",
      },
    });

    expect(state.rootIds).toEqual(["/Projects"]);
    expect(state.nodesByPath["/Projects/A/README.md"]?.kind).toBe("file");
    expect(state.directoriesByPath["/Projects"]?.status).toBe("loaded");
    expect(state.directoriesByPath["/Projects/A"]?.status).toBe("loaded");
    expect(state.directoriesByPath["/Projects/Archive"]?.status).toBe(
      "unloaded",
    );
    expect(state.treeMeta).toMatchObject({
      ready: true,
      truncated: true,
      source: "brain_rpc",
      truncatedReason: "max_nodes",
    });
    expect(vaultTreeStateToRoots(state)).toEqual(SNAPSHOT);
  });

  it("tracks expansion loads and merges loaded children with pagination metadata", () => {
    const initial = vaultTreeReducer(createEmptyVaultTreeState(), {
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
    const loading = vaultTreeReducer(initial, {
      type: "directory.loadStarted",
      path: "/Projects/Archive",
      requestId: "req-1",
    });

    expect(loading.directoriesByPath["/Projects/Archive"]?.status).toBe(
      "loading",
    );

    const loaded = vaultTreeReducer(loading, {
      type: "directory.loadSucceeded",
      path: "/Projects/Archive",
      requestId: "req-1",
      entries: [
        {
          name: "old.md",
          path: "/Projects/Archive/old.md",
          kind: "file",
          mime_type: "text/markdown",
        },
        {
          name: "Nested",
          path: "/Projects/Archive/Nested",
          kind: "directory",
        },
      ],
      truncated: true,
      nextCursor: "page-2",
    });

    const directory = loaded.directoriesByPath["/Projects/Archive"];
    expect(directory).toMatchObject({
      status: "loaded",
      nextCursor: "page-2",
      truncated: true,
      source: "entries",
    });
    expect(directory?.status === "loaded" ? directory.childIds : []).toEqual([
      "/Projects/Archive/old.md",
      "/Projects/Archive/Nested",
    ]);
    expect(loaded.directoriesByPath["/Projects/Archive/Nested"]?.status).toBe(
      "unloaded",
    );
    expect(vaultTreeStateToRoots(loaded)[0]?.children?.[0]?.children).toEqual([
      {
        name: "old.md",
        path: "/Projects/Archive/old.md",
        kind: "file",
        mime_type: "text/markdown",
      },
      {
        name: "Nested",
        path: "/Projects/Archive/Nested",
        kind: "directory",
      },
    ]);
  });

  it("ignores stale directory load responses by request id", () => {
    const initial = vaultTreeReducer(createEmptyVaultTreeState(), {
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
    const first = vaultTreeReducer(initial, {
      type: "directory.loadStarted",
      path: "/Projects/Archive",
      requestId: "old",
    });
    const second = vaultTreeReducer(first, {
      type: "directory.loadStarted",
      path: "/Projects/Archive",
      requestId: "new",
    });
    const stale = vaultTreeReducer(second, {
      type: "directory.loadSucceeded",
      path: "/Projects/Archive",
      requestId: "old",
      entries: [
        {
          name: "stale.md",
          path: "/Projects/Archive/stale.md",
          kind: "file",
        },
      ],
    });

    expect(stale).toBe(second);
    expect(stale.nodesByPath["/Projects/Archive/stale.md"]).toBeUndefined();
    expect(stale.directoriesByPath["/Projects/Archive"]).toMatchObject({
      status: "loading",
      requestId: "new",
    });
  });

  it("preserves selected deep-linked files and expands ancestors", () => {
    const state = vaultTreeReducer(createEmptyVaultTreeState(), {
      type: "path.focus",
      path: "/Projects/A/Nested/deep.md",
    });

    expect(state.selectedPath).toBe("/Projects/A/Nested/deep.md");
    expect([...state.expandedPaths]).toEqual([
      "/Projects",
      "/Projects/A",
      "/Projects/A/Nested",
    ]);
    expect(state.focusKey).toBe(1);
  });

  it("reconciles poll snapshots without dropping entries-loaded folder state", () => {
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
          ],
        },
      ],
    });
    const loading = vaultTreeReducer(snapshot, {
      type: "directory.loadStarted",
      path: "/Projects/Archive",
      requestId: "req-1",
    });
    const loaded = vaultTreeReducer(loading, {
      type: "directory.loadSucceeded",
      path: "/Projects/Archive",
      requestId: "req-1",
      entries: [
        {
          name: "old.md",
          path: "/Projects/Archive/old.md",
          kind: "file",
          mime_type: "text/markdown",
        },
      ],
    });

    const reconciled = vaultTreeReducer(loaded, {
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

    const archive = reconciled.directoriesByPath["/Projects/Archive"];
    expect(archive).toMatchObject({
      status: "loaded",
      source: "entries",
    });
    expect(archive?.status === "loaded" ? archive.childIds : []).toEqual([
      "/Projects/Archive/old.md",
    ]);
    expect(JSON.stringify(vaultTreeStateToRoots(reconciled))).toContain(
      "/Projects/Archive/old.md",
    );
  });

  it("appends additional pages when loading more children", () => {
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
          ],
        },
      ],
    });
    const firstLoading = vaultTreeReducer(snapshot, {
      type: "directory.loadStarted",
      path: "/Projects/Archive",
      requestId: "first",
    });
    const firstPage = vaultTreeReducer(firstLoading, {
      type: "directory.loadSucceeded",
      path: "/Projects/Archive",
      requestId: "first",
      entries: [
        {
          name: "one.md",
          path: "/Projects/Archive/one.md",
          kind: "file",
        },
      ],
      truncated: true,
      nextCursor: "page-2",
    });
    const moreLoading = vaultTreeReducer(firstPage, {
      type: "directory.loadStarted",
      path: "/Projects/Archive",
      requestId: "second",
      mode: "more",
    });
    const secondPage = vaultTreeReducer(moreLoading, {
      type: "directory.loadSucceeded",
      path: "/Projects/Archive",
      requestId: "second",
      entries: [
        {
          name: "two.md",
          path: "/Projects/Archive/two.md",
          kind: "file",
        },
      ],
      truncated: false,
      nextCursor: null,
    });

    const archive = secondPage.directoriesByPath["/Projects/Archive"];
    expect(archive?.status === "loaded" ? archive.childIds : []).toEqual([
      "/Projects/Archive/one.md",
      "/Projects/Archive/two.md",
    ]);
    expect(archive).toMatchObject({
      status: "loaded",
      truncated: false,
      nextCursor: null,
    });
  });
});
