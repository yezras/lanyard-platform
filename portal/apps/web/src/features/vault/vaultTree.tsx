import type { TreeListItemData } from "@astryxdesign/core/TreeList";
import { Icon } from "@astryxdesign/core/Icon";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Text } from "@astryxdesign/core/Text";
import { ArrowDownTrayIcon, FolderIcon } from "@heroicons/react/24/outline";

import type { VaultTreeNode } from "../../api/types.js";

import { fileTypeIcon } from "./fileTypeIcon.js";
import type { VaultDirectoryStatus, VaultTreeState } from "./vaultTreeState.js";

/**
 * Expand directories with depth <= this value by default.
 * -1 keeps the vault file tree fully collapsed until the user expands it.
 */
const DEFAULT_EXPAND_MAX_DEPTH = -1;

export type VaultTreeHandlers = {
  onOpenFile: (path: string) => void;
  onDownloadFile?: (path: string) => void;
  /**
   * Directory paths that should be expanded (e.g. ancestors of a deep-linked file).
   * Unioned with the default depth-based expansion.
   */
  expandedPaths?: ReadonlySet<string> | readonly string[];
  /** File (or directory) path currently selected in the tree. */
  selectedPath?: string | null;
};

export type VaultLazyTreeHandlers = VaultTreeHandlers & {
  onRetryDirectory?: (path: string) => void;
  onLoadMoreDirectory?: (path: string) => void;
};

/**
 * Ancestor directory vault paths for a file/dir path (POSIX absolute).
 * `/Projects/A/Nested/deep.md` → `["/Projects", "/Projects/A", "/Projects/A/Nested"]`.
 * Does not include the leaf segment itself.
 */
export function vaultPathAncestorIds(path: string): string[] {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) {
    return [];
  }
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return [];
  }
  const ancestors: string[] = [];
  let acc = "";
  for (let i = 0; i < parts.length - 1; i += 1) {
    acc += `/${parts[i]}`;
    ancestors.push(acc);
  }
  return ancestors;
}

/**
 * Resolve a citation / deep-link path to a file node path in the vault tree.
 *
 * Matching order:
 * 1. Exact path equality
 * 2. Unique tree path ending with the target (relative or absolute suffix)
 * 3. Unique basename among files (ambiguous names return null)
 */
export function findVaultTreeFilePath(
  roots: readonly VaultTreeNode[],
  target: string,
): string | null {
  const trimmed = target.trim();
  if (!trimmed) {
    return null;
  }

  const relative = trimmed.replace(/^\/+/, "");
  let exact: string | null = null;
  const suffixMatches: string[] = [];
  const byBasename = new Map<string, string[]>();

  const walk = (nodes: readonly VaultTreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "file") {
        if (node.path === trimmed) {
          exact = node.path;
        } else if (relative && node.path.endsWith(`/${relative}`)) {
          suffixMatches.push(node.path);
        }
        const list = byBasename.get(node.name) ?? [];
        list.push(node.path);
        byBasename.set(node.name, list);
      }
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };
  walk(roots);

  if (exact) {
    return exact;
  }
  if (suffixMatches.length === 1) {
    return suffixMatches[0] ?? null;
  }

  const basename = relative.split("/").filter(Boolean).pop();
  if (!basename) {
    return null;
  }
  const matches = byBasename.get(basename);
  if (matches?.length === 1) {
    return matches[0] ?? null;
  }
  return null;
}

function toPathSet(
  paths: ReadonlySet<string> | readonly string[] | undefined,
): ReadonlySet<string> {
  if (!paths) {
    return new Set();
  }
  return paths instanceof Set ? paths : new Set(paths);
}

export function vaultNodesToTreeItems(
  nodes: VaultTreeNode[],
  onOpenFileOrHandlers: ((path: string) => void) | VaultTreeHandlers,
): TreeListItemData[] {
  const handlers: VaultTreeHandlers =
    typeof onOpenFileOrHandlers === "function"
      ? { onOpenFile: onOpenFileOrHandlers }
      : onOpenFileOrHandlers;
  const expandedPaths = toPathSet(handlers.expandedPaths);
  const selectedPath = handlers.selectedPath?.trim() || null;
  return nodes.map((node) =>
    vaultNodeToTreeItem(node, handlers, 0, expandedPaths, selectedPath),
  );
}

export function vaultTreeStateToTreeItems(
  state: VaultTreeState,
  handlers: VaultLazyTreeHandlers,
): TreeListItemData[] {
  const expandedPaths = toPathSet(handlers.expandedPaths);
  const selectedPath = handlers.selectedPath?.trim() || null;
  return state.rootIds.flatMap((path) => {
    const item = vaultStateNodeToTreeItem(
      state,
      path,
      handlers,
      0,
      expandedPaths,
      selectedPath,
      new Set(),
    );
    return item ? [item] : [];
  });
}

function vaultNodeToTreeItem(
  node: VaultTreeNode,
  handlers: VaultTreeHandlers,
  depth: number,
  expandedPaths: ReadonlySet<string>,
  selectedPath: string | null,
): TreeListItemData {
  const label = <Text maxLines={1}>{node.name}</Text>;
  // Hermes project roots expose absolute path as supporting description.
  const description = node.description?.trim() || undefined;
  const isSelected = selectedPath != null && selectedPath === node.path;

  if (node.kind === "directory") {
    return {
      id: node.path,
      label,
      description,
      startContent: <Icon icon={FolderIcon} size="xsm" />,
      isExpanded:
        depth <= DEFAULT_EXPAND_MAX_DEPTH || expandedPaths.has(node.path),
      isSelected,
      children: node.children?.map((child) =>
        vaultNodeToTreeItem(
          child,
          handlers,
          depth + 1,
          expandedPaths,
          selectedPath,
        ),
      ),
    };
  }

  const typeIcon = fileTypeIcon(node.name, node.mime_type);
  const endContent = handlers.onDownloadFile ? (
    <span
      onClick={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
    >
      <MoreMenu
        size="sm"
        label={`File actions for ${node.name}`}
        items={[
          {
            label: "Download",
            icon: ArrowDownTrayIcon,
            onClick: () => handlers.onDownloadFile?.(node.path),
          },
        ]}
      />
    </span>
  ) : undefined;

  return {
    id: node.path,
    label,
    description,
    startContent: <Icon icon={typeIcon} size="xsm" />,
    endContent,
    isSelected,
    onClick: () => handlers.onOpenFile(node.path),
  };
}

function vaultStateNodeToTreeItem(
  state: VaultTreeState,
  path: string,
  handlers: VaultLazyTreeHandlers,
  depth: number,
  expandedPaths: ReadonlySet<string>,
  selectedPath: string | null,
  seen: ReadonlySet<string>,
): TreeListItemData | null {
  if (seen.has(path)) {
    return null;
  }
  const node = state.nodesByPath[path];
  if (!node) {
    return null;
  }
  const label = <Text maxLines={1}>{node.name}</Text>;
  const description = node.description?.trim() || undefined;
  const isSelected = selectedPath != null && selectedPath === node.path;

  if (node.kind === "directory") {
    const nextSeen = new Set(seen);
    nextSeen.add(path);
    const directory = state.directoriesByPath[path] ?? { status: "unloaded" };
    const children = directoryTreeItems(
      state,
      node.path,
      directory,
      handlers,
      depth,
      expandedPaths,
      selectedPath,
      nextSeen,
    );
    return {
      id: node.path,
      label,
      description,
      startContent: <Icon icon={FolderIcon} size="xsm" />,
      isExpanded:
        depth <= DEFAULT_EXPAND_MAX_DEPTH || expandedPaths.has(node.path),
      isSelected,
      children,
    };
  }

  return fileNodeToTreeItem(node, handlers, label, description, isSelected);
}

function directoryTreeItems(
  state: VaultTreeState,
  path: string,
  directory: VaultDirectoryStatus,
  handlers: VaultLazyTreeHandlers,
  depth: number,
  expandedPaths: ReadonlySet<string>,
  selectedPath: string | null,
  seen: ReadonlySet<string>,
): TreeListItemData[] {
  const childIds = directoryChildIds(directory);
  const children = childIds.flatMap((childPath) => {
    const child = vaultStateNodeToTreeItem(
      state,
      childPath,
      handlers,
      depth + 1,
      expandedPaths,
      selectedPath,
      seen,
    );
    return child ? [child] : [];
  });

  if (directory.status === "unloaded") {
    children.push({
      id: syntheticTreeId(path, "unloaded"),
      label: <Text maxLines={1}>Load folder</Text>,
      isDisabled: true,
    });
  }
  if (directory.status === "loading" || directory.status === "refreshing") {
    children.push({
      id: syntheticTreeId(path, "loading"),
      label: <Text maxLines={1}>Loading...</Text>,
      isDisabled: true,
    });
  }
  if (directory.status === "error") {
    children.push({
      id: syntheticTreeId(path, "error"),
      label: <Text maxLines={1}>Retry</Text>,
      description: directory.error,
      onClick: () => handlers.onRetryDirectory?.(path),
    });
  }
  if (
    (directory.status === "loaded" || directory.status === "loadingMore") &&
    directory.truncated &&
    directory.nextCursor
  ) {
    children.push({
      id: syntheticTreeId(path, "load-more"),
      label: (
        <Text maxLines={1}>
          {directory.status === "loadingMore" ? "Loading more..." : "Load more"}
        </Text>
      ),
      isDisabled: directory.status === "loadingMore",
      onClick:
        directory.status === "loadingMore"
          ? undefined
          : () => handlers.onLoadMoreDirectory?.(path),
    });
  }
  return children;
}

function fileNodeToTreeItem(
  node: VaultTreeNode,
  handlers: VaultTreeHandlers,
  label: TreeListItemData["label"],
  description: string | undefined,
  isSelected: boolean,
): TreeListItemData {
  const typeIcon = fileTypeIcon(node.name, node.mime_type);
  const endContent = handlers.onDownloadFile ? (
    <span
      onClick={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
    >
      <MoreMenu
        size="sm"
        label={`File actions for ${node.name}`}
        items={[
          {
            label: "Download",
            icon: ArrowDownTrayIcon,
            onClick: () => handlers.onDownloadFile?.(node.path),
          },
        ]}
      />
    </span>
  ) : undefined;

  return {
    id: node.path,
    label,
    description,
    startContent: <Icon icon={typeIcon} size="xsm" />,
    endContent,
    isSelected,
    onClick: () => handlers.onOpenFile(node.path),
  };
}

function directoryChildIds(directory: VaultDirectoryStatus): string[] {
  return directory.status === "unloaded" ? [] : directory.childIds;
}

function syntheticTreeId(path: string, kind: string): string {
  return `__vault_${kind}:${path}`;
}
