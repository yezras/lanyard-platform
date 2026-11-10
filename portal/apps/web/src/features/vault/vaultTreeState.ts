import type { VaultEntry, VaultTreeNode } from "../../api/types.js";
import { vaultPathAncestorIds } from "./vaultTree.js";

export type VaultDirectoryStatus =
  | { status: "unloaded" }
  | {
      status: "loading";
      requestId: string;
      childIds: string[];
      nextCursor: string | null;
      truncated: boolean;
    }
  | {
      status: "loaded";
      childIds: string[];
      nextCursor: string | null;
      truncated: boolean;
      source: "snapshot" | "entries";
    }
  | {
      status: "refreshing";
      requestId: string;
      childIds: string[];
      nextCursor: string | null;
      truncated: boolean;
      source: "snapshot" | "entries";
    }
  | {
      status: "loadingMore";
      requestId: string;
      childIds: string[];
      nextCursor: string | null;
      truncated: boolean;
      source: "snapshot" | "entries";
    }
  | {
      status: "error";
      error: string;
      stale: boolean;
      childIds: string[];
      nextCursor: string | null;
      truncated: boolean;
      source?: "snapshot" | "entries";
    };

export type VaultTreeRecord = Omit<VaultTreeNode, "children">;

export type VaultTreeState = {
  nodesByPath: Record<string, VaultTreeRecord>;
  rootIds: string[];
  directoriesByPath: Record<string, VaultDirectoryStatus>;
  expandedPaths: ReadonlySet<string>;
  selectedPath: string | null;
  focusKey: number;
  treeMeta: {
    ready: boolean;
    truncated: boolean;
    source?: string;
    unavailable?: boolean;
    truncatedReason?: string;
  };
};

export type VaultTreeSnapshotMeta = {
  truncated?: boolean;
  source?: string;
  unavailable?: boolean;
  truncatedReason?: string;
};

export type VaultTreeAction =
  | {
      type: "snapshot.loaded";
      roots: VaultTreeNode[];
      meta?: VaultTreeSnapshotMeta;
    }
  | { type: "snapshot.failed" }
  | { type: "path.focus"; path: string }
  | {
      type: "directory.loadStarted";
      path: string;
      requestId: string;
      mode?: "replace" | "refresh" | "more";
    }
  | {
      type: "directory.loadSucceeded";
      path: string;
      requestId: string;
      entries: VaultEntry[];
      nextCursor?: string | null;
      truncated?: boolean;
    }
  | {
      type: "directory.loadFailed";
      path: string;
      requestId: string;
      error: string;
    };

type NormalizedSnapshot = {
  nodesByPath: Record<string, VaultTreeRecord>;
  rootIds: string[];
  directoriesByPath: Record<string, VaultDirectoryStatus>;
};

export function createEmptyVaultTreeState(): VaultTreeState {
  return {
    nodesByPath: {},
    rootIds: [],
    directoriesByPath: {},
    expandedPaths: new Set(),
    selectedPath: null,
    focusKey: 0,
    treeMeta: {
      ready: false,
      truncated: false,
    },
  };
}

export function vaultTreeReducer(
  state: VaultTreeState,
  action: VaultTreeAction,
): VaultTreeState {
  switch (action.type) {
    case "snapshot.loaded":
      return ingestVaultTreeSnapshot(state, action.roots, action.meta);
    case "snapshot.failed":
      return {
        ...createEmptyVaultTreeState(),
        treeMeta: { ready: true, truncated: false, unavailable: true },
      };
    case "path.focus":
      return focusVaultTreePath(state, action.path);
    case "directory.loadStarted":
      return beginVaultDirectoryLoad(
        state,
        action.path,
        action.requestId,
        action.mode ?? "replace",
      );
    case "directory.loadSucceeded":
      return completeVaultDirectoryLoad(
        state,
        action.path,
        action.requestId,
        action.entries,
        {
          nextCursor: action.nextCursor ?? null,
          truncated: action.truncated === true,
        },
      );
    case "directory.loadFailed":
      return failVaultDirectoryLoad(
        state,
        action.path,
        action.requestId,
        action.error,
      );
  }
}

export function ingestVaultTreeSnapshot(
  previous: VaultTreeState,
  roots: VaultTreeNode[],
  meta: VaultTreeSnapshotMeta = {},
): VaultTreeState {
  const normalized = normalizeSnapshot(roots);
  const nodesByPath = { ...normalized.nodesByPath };
  const directoriesByPath = { ...normalized.directoriesByPath };

  for (const [path, previousDirectory] of Object.entries(
    previous.directoriesByPath,
  )) {
    if (
      previousDirectory.status !== "loaded" ||
      previousDirectory.source !== "entries" ||
      directoriesByPath[path] === undefined
    ) {
      continue;
    }

    const snapshotDirectory = directoriesByPath[path];
    const snapshotChildIds =
      snapshotDirectory.status === "loaded" ? snapshotDirectory.childIds : [];
    const childIds = mergeIds(previousDirectory.childIds, snapshotChildIds);
    directoriesByPath[path] = { ...previousDirectory, childIds };
    copyPreservedSubtree(previous, nodesByPath, directoriesByPath, childIds);
  }

  return {
    ...previous,
    nodesByPath,
    rootIds: normalized.rootIds,
    directoriesByPath,
    treeMeta: {
      ready: true,
      truncated: meta.truncated === true,
      source: meta.source,
      unavailable: meta.unavailable,
      truncatedReason: meta.truncatedReason,
    },
  };
}

export function focusVaultTreePath(
  state: VaultTreeState,
  path: string,
): VaultTreeState {
  const trimmed = path.trim();
  if (!trimmed) {
    return state;
  }
  const expandedPaths = new Set(state.expandedPaths);
  for (const ancestor of vaultPathAncestorIds(trimmed)) {
    expandedPaths.add(ancestor);
  }
  return {
    ...state,
    selectedPath: trimmed,
    expandedPaths,
    focusKey: state.focusKey + 1,
  };
}

export function beginVaultDirectoryLoad(
  state: VaultTreeState,
  path: string,
  requestId: string,
  mode: "replace" | "refresh" | "more" = "replace",
): VaultTreeState {
  const current = state.directoriesByPath[path] ?? { status: "unloaded" };
  const preserved = directorySnapshot(current);
  const status =
    mode === "more"
      ? "loadingMore"
      : preserved.childIds.length > 0 || mode === "refresh"
        ? "refreshing"
        : "loading";
  return {
    ...state,
    directoriesByPath: {
      ...state.directoriesByPath,
      [path]:
        status === "loading"
          ? {
              status,
              requestId,
              childIds: preserved.childIds,
              nextCursor: preserved.nextCursor,
              truncated: preserved.truncated,
            }
          : {
              status,
              requestId,
              childIds: preserved.childIds,
              nextCursor: preserved.nextCursor,
              truncated: preserved.truncated,
              source: preserved.source ?? "entries",
            },
    },
  };
}

export function completeVaultDirectoryLoad(
  state: VaultTreeState,
  path: string,
  requestId: string,
  entries: VaultEntry[],
  page: { nextCursor?: string | null; truncated?: boolean } = {},
): VaultTreeState {
  const current = state.directoriesByPath[path];
  if (
    current?.status !== "loading" &&
    current?.status !== "refreshing" &&
    current?.status !== "loadingMore"
  ) {
    return state;
  }
  if (current.requestId !== requestId) {
    return state;
  }

  const nodesByPath = { ...state.nodesByPath };
  const directoriesByPath = { ...state.directoriesByPath };
  const incomingIds: string[] = [];
  for (const entry of entries) {
    nodesByPath[entry.path] = entry;
    incomingIds.push(entry.path);
    if (entry.kind === "directory" && directoriesByPath[entry.path] === undefined) {
      directoriesByPath[entry.path] = { status: "unloaded" };
    }
  }

  const childIds =
    current.status === "loadingMore"
      ? mergeIds(current.childIds, incomingIds)
      : incomingIds;

  directoriesByPath[path] = {
    status: "loaded",
    childIds,
    nextCursor: page.nextCursor ?? null,
    truncated: page.truncated === true,
    source: "entries",
  };

  return {
    ...state,
    nodesByPath,
    directoriesByPath,
  };
}

export function failVaultDirectoryLoad(
  state: VaultTreeState,
  path: string,
  requestId: string,
  error: string,
): VaultTreeState {
  const current = state.directoriesByPath[path];
  if (
    current?.status !== "loading" &&
    current?.status !== "refreshing" &&
    current?.status !== "loadingMore"
  ) {
    return state;
  }
  if (current.requestId !== requestId) {
    return state;
  }
  const preserved = directorySnapshot(current);
  return {
    ...state,
    directoriesByPath: {
      ...state.directoriesByPath,
      [path]: {
        status: "error",
        error,
        stale: preserved.childIds.length > 0,
        childIds: preserved.childIds,
        nextCursor: preserved.nextCursor,
        truncated: preserved.truncated,
        source: preserved.source,
      },
    },
  };
}

export function vaultTreeStateToRoots(state: VaultTreeState): VaultTreeNode[] {
  return state.rootIds.flatMap((id) => {
    const node = recordToTreeNode(state, id, new Set());
    return node ? [node] : [];
  });
}

function normalizeSnapshot(roots: VaultTreeNode[]): NormalizedSnapshot {
  const out: NormalizedSnapshot = {
    nodesByPath: {},
    rootIds: [],
    directoriesByPath: {},
  };
  for (const root of roots) {
    out.rootIds.push(root.path);
    normalizeSnapshotNode(root, out);
  }
  return out;
}

function normalizeSnapshotNode(
  node: VaultTreeNode,
  out: NormalizedSnapshot,
): void {
  const { children, ...record } = node;
  out.nodesByPath[node.path] = record;
  if (node.kind !== "directory") {
    return;
  }
  if (Array.isArray(children)) {
    const childIds = children.map((child) => child.path);
    out.directoriesByPath[node.path] = {
      status: "loaded",
      childIds,
      nextCursor: null,
      truncated: false,
      source: "snapshot",
    };
    for (const child of children) {
      normalizeSnapshotNode(child, out);
    }
  } else {
    out.directoriesByPath[node.path] = { status: "unloaded" };
  }
}

function copyPreservedSubtree(
  previous: VaultTreeState,
  nodesByPath: Record<string, VaultTreeRecord>,
  directoriesByPath: Record<string, VaultDirectoryStatus>,
  ids: readonly string[],
): void {
  for (const id of ids) {
    const previousNode = previous.nodesByPath[id];
    if (previousNode && nodesByPath[id] === undefined) {
      nodesByPath[id] = previousNode;
    }
    const previousDirectory = previous.directoriesByPath[id];
    if (previousDirectory) {
      directoriesByPath[id] = previousDirectory;
      copyPreservedSubtree(
        previous,
        nodesByPath,
        directoriesByPath,
        directorySnapshot(previousDirectory).childIds,
      );
    }
  }
}

function directorySnapshot(status: VaultDirectoryStatus): {
  childIds: string[];
  nextCursor: string | null;
  truncated: boolean;
  source?: "snapshot" | "entries";
} {
  if (status.status === "unloaded") {
    return { childIds: [], nextCursor: null, truncated: false };
  }
  return {
    childIds: status.childIds,
    nextCursor: status.nextCursor,
    truncated: status.truncated,
    source: "source" in status ? status.source : undefined,
  };
}

function mergeIds(first: readonly string[], second: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...first, ...second]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function recordToTreeNode(
  state: VaultTreeState,
  path: string,
  seen: Set<string>,
): VaultTreeNode | null {
  if (seen.has(path)) {
    return null;
  }
  const record = state.nodesByPath[path];
  if (!record) {
    return null;
  }
  if (record.kind !== "directory") {
    return { ...record };
  }
  const nextSeen = new Set(seen);
  nextSeen.add(path);
  const directory = state.directoriesByPath[path];
  const childIds = directorySnapshot(directory ?? { status: "unloaded" }).childIds;
  const children = childIds.flatMap((childId) => {
    const child = recordToTreeNode(state, childId, nextSeen);
    return child ? [child] : [];
  });
  return children.length > 0 ? { ...record, children } : { ...record };
}
