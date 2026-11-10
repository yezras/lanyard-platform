import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutPanel } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { SideNav, useSideNavCollapse } from "@astryxdesign/core/SideNav";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TreeList } from "@astryxdesign/core/TreeList";
import { VStack } from "@astryxdesign/core/VStack";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";

import { fetchPortalContext } from "../../api/context.js";
import {
  downloadVaultFile,
  fetchVaultEntries,
  fetchVaultContent,
  fetchVaultTree,
  searchVaultIndex,
} from "../../api/vault.js";
import type {
  VaultFileContent,
  VaultSearchHit,
} from "../../api/types.js";
import {
  HonestyBanner,
  resolveHonestyNotice,
  useOptionalPortalHonesty,
} from "../honesty/index.js";
import { VaultDocumentHost } from "./VaultDocumentHost.js";
import { canVaultEditFromPortalContext } from "./vaultEditGating.js";
import {
  VAULT_LAYOUT_CONTENT_PADDING,
  vaultRootStyle,
} from "./vaultLayout.js";
import { VAULT_TREE_INVALIDATE_EVENT } from "./vaultTreeEvents.js";
import { vaultPathFromHref } from "./vaultPaths.js";
import {
  findVaultTreeFilePath,
  vaultPathAncestorIds,
  vaultTreeStateToTreeItems,
} from "./vaultTree.js";
import {
  createEmptyVaultTreeState,
  vaultTreeReducer,
  vaultTreeStateToRoots,
} from "./vaultTreeState.js";

const SIDE_NAV_RESIZE = {
  defaultWidth: 240,
  minWidth: 180,
  maxWidth: 400,
} as const;

/** Default poll interval for live tree mirror (~5–10s per HQ7 Slice C). */
export const VAULT_TREE_POLL_MS = 8_000;

const EMPTY_TREE_TITLE = "No files";

type VaultSearchTopContentProps = {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  isSearching: boolean;
  onClearResults: () => void;
  onSearch: () => void;
};

/** Hide full search field when collapsed; icon expands the rail. */
function VaultSearchTopContent({
  searchQuery,
  setSearchQuery,
  isSearching,
  onClearResults,
  onSearch,
}: VaultSearchTopContentProps) {
  const { isCollapsed, toggle } = useSideNavCollapse();

  if (isCollapsed) {
    return (
      <Button
        label="Search vault"
        variant="ghost"
        size="sm"
        isIconOnly
        tooltip="Search"
        icon={<Icon icon={MagnifyingGlassIcon} size="sm" />}
        onClick={() => toggle()}
      />
    );
  }

  return (
    <TextInput
      label="Search"
      isLabelHidden
      value={searchQuery}
      onChange={(value) => {
        setSearchQuery(value);
        if (!value.trim()) {
          onClearResults();
        }
      }}
      placeholder="Search…"
      startIcon={MagnifyingGlassIcon}
      isLoading={isSearching}
      hasClear
      onEnter={() => void onSearch()}
    />
  );
}

export type VaultViewProps = {
  /**
   * Deep-link vault path (e.g. from chat citations). When set, opens the file
   * reader for that path.
   */
  deepLinkPath?: string | null;
  /**
   * Bumps when the shell opens a path (including the same path again) so the
   * deep-link effect re-runs after a prior consume.
   */
  deepLinkKey?: number;
  /** Called after a deep-link open is attempted so the shell can clear state. */
  onDeepLinkConsumed?: () => void;
  /** Override tree poll interval (ms). Defaults to {@link VAULT_TREE_POLL_MS}. */
  treePollIntervalMs?: number;
  /**
   * Override ui.can.vault_edit (tests). When omitted, read from GET /api/context.
   * Fail-closed while loading / unknown.
   */
  canVaultEdit?: boolean | null;
  /** Override ONLYOFFICE feature flag (tests). */
  onlyOfficeEditorEnabled?: boolean;
};

export function VaultView({
  deepLinkPath = null,
  deepLinkKey = 0,
  onDeepLinkConsumed,
  treePollIntervalMs = VAULT_TREE_POLL_MS,
  canVaultEdit: canVaultEditProp,
  onlyOfficeEditorEnabled,
}: VaultViewProps = {}) {
  const [treeState, dispatchTree] = useReducer(
    vaultTreeReducer,
    createEmptyVaultTreeState(),
  );
  const treeRoots = useMemo(() => vaultTreeStateToRoots(treeState), [treeState]);
  /** From GET /api/vault/tree `truncated` (node budget honesty, lp-8ty). */
  const treeTruncated = treeState.treeMeta.truncated;
  const treeReady = treeState.treeMeta.ready;
  const selectedTreePath = treeState.selectedPath;
  const expandedTreePaths = treeState.expandedPaths;
  const treeFocusKey = treeState.focusKey;
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<VaultSearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchEmpty, setSearchEmpty] = useState(false);

  const [readerContent, setReaderContent] = useState<VaultFileContent | null>(
    null,
  );
  const [readerError, setReaderError] = useState<string | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  /** From GET /api/context when prop not injected. null = unknown (fail closed). */
  const [contextVaultEdit, setContextVaultEdit] = useState<boolean | null>(
    canVaultEditProp === undefined ? null : canVaultEditProp,
  );
  /** Monotonic id so stale openFile responses (deep-link races) are ignored. */
  const openRequestIdRef = useRef(0);
  /** Monotonic id so stale directory page responses are ignored. */
  const directoryRequestIdRef = useRef(0);
  const inFlightDirectoryPathsRef = useRef<Set<string>>(new Set());

  // ui.can.vault_edit from session bootstrap (lp-5q6.29). Prop override wins.
  useEffect(() => {
    if (canVaultEditProp !== undefined) {
      setContextVaultEdit(canVaultEditProp);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const ctx = await fetchPortalContext();
        if (!cancelled) {
          setContextVaultEdit(canVaultEditFromPortalContext(ctx));
        }
      } catch {
        if (!cancelled) {
          setContextVaultEdit(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canVaultEditProp]);

  const canVaultEdit =
    canVaultEditProp !== undefined ? canVaultEditProp : contextVaultEdit;

  const focusTreePath = useCallback((path: string) => {
    dispatchTree({ type: "path.focus", path });
  }, []);

  const loadDirectoryPage = useCallback(
    async (
      path: string,
      cursor: string | null = null,
      mode: "replace" | "more" = "replace",
    ) => {
      if (inFlightDirectoryPathsRef.current.has(path)) {
        return;
      }
      inFlightDirectoryPathsRef.current.add(path);
      const requestId = `vault-dir-${++directoryRequestIdRef.current}`;
      dispatchTree({
        type: "directory.loadStarted",
        path,
        requestId,
        mode,
      });
      try {
        const body = await fetchVaultEntries(path, cursor);
        dispatchTree({
          type: "directory.loadSucceeded",
          path,
          requestId,
          entries: body.entries,
          nextCursor: body.next_cursor ?? null,
          truncated: body.truncated === true,
        });
      } catch (err) {
        dispatchTree({
          type: "directory.loadFailed",
          path,
          requestId,
          error:
            err instanceof Error ? err.message : "Failed to load folder",
        });
      } finally {
        inFlightDirectoryPathsRef.current.delete(path);
      }
    },
    [],
  );

  const loadDirectoryIfNeeded = useCallback(
    (path: string) => {
      if (treeState.nodesByPath[path]?.kind === "file") {
        return;
      }
      const directory = treeState.directoriesByPath[path];
      if (!directory || directory.status === "unloaded") {
        void loadDirectoryPage(path, null, "replace");
      }
    },
    [loadDirectoryPage, treeState.directoriesByPath, treeState.nodesByPath],
  );

  const handleRetryDirectory = useCallback(
    (path: string) => {
      void loadDirectoryPage(path, null, "replace");
    },
    [loadDirectoryPage],
  );

  const handleLoadMoreDirectory = useCallback(
    (path: string) => {
      const directory = treeState.directoriesByPath[path];
      if (
        directory?.status !== "loaded" ||
        !directory.truncated ||
        !directory.nextCursor
      ) {
        return;
      }
      void loadDirectoryPage(path, directory.nextCursor, "more");
    },
    [loadDirectoryPage, treeState.directoriesByPath],
  );

  const loadDirectoryFromTreeEventTarget = useCallback(
    (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const treeItem = target.closest<HTMLElement>(
        '[role="treeitem"][data-tree-id]',
      );
      const path = treeItem?.dataset.treeId;
      if (!path || path.startsWith("__vault_")) {
        return;
      }
      loadDirectoryIfNeeded(path);
    },
    [loadDirectoryIfNeeded],
  );

  const handleTreeClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      loadDirectoryFromTreeEventTarget(event.target);
    },
    [loadDirectoryFromTreeEventTarget],
  );

  const handleTreeKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (
        event.key !== "Enter" &&
        event.key !== " " &&
        event.key !== "ArrowRight"
      ) {
        return;
      }
      loadDirectoryFromTreeEventTarget(event.target);
    },
    [loadDirectoryFromTreeEventTarget],
  );

  const loadMissingAncestorsForPath = useCallback(
    (path: string) => {
      for (const ancestor of vaultPathAncestorIds(path)) {
        loadDirectoryIfNeeded(ancestor);
      }
    },
    [loadDirectoryIfNeeded],
  );

  const openFile = useCallback(
    async (path: string) => {
      // Prefer raw absolute multi-root paths (e.g. /home/u/Core/README.md).
      // vaultPathFromHref is only for same-origin URLs / relative hrefs.
      const trimmed = path.trim();
      const fromHref = vaultPathFromHref(trimmed);
      const normalized =
        trimmed.startsWith("/") || /^file:\/\//i.test(trimmed)
          ? fromHref ?? trimmed.replace(/^file:\/\//i, "")
          : fromHref ?? trimmed;
      if (!normalized) {
        setReaderError("Missing vault path");
        setReaderContent(null);
        setIsLoadingFile(false);
        return;
      }

      // Align citation / partial paths with multi-root tree node ids when possible.
      const treePath =
        treeRoots.length > 0
          ? findVaultTreeFilePath(treeRoots, normalized)
          : null;
      const pathToOpen = treePath ?? normalized;

      // Expand ancestors + select node so collapsed trees reveal the citation.
      focusTreePath(pathToOpen);
      loadMissingAncestorsForPath(pathToOpen);

      const requestId = ++openRequestIdRef.current;
      setIsLoadingFile(true);
      setReaderError(null);
      setReaderContent(null);

      try {
        const content = await fetchVaultContent(pathToOpen);
        if (requestId !== openRequestIdRef.current) {
          return;
        }
        setReaderContent(content);
      } catch (err) {
        if (requestId !== openRequestIdRef.current) {
          return;
        }
        // Fallback: tree match may have been wrong or tree empty at first try.
        const fallbackPath =
          treeRoots.length > 0
            ? findVaultTreeFilePath(treeRoots, normalized)
            : null;
        if (fallbackPath && fallbackPath !== pathToOpen) {
          try {
            const content = await fetchVaultContent(fallbackPath);
            if (requestId !== openRequestIdRef.current) {
              return;
            }
            focusTreePath(fallbackPath);
            setReaderContent(content);
            setReaderError(null);
            return;
          } catch {
            // fall through to original error
          }
        }
        const message =
          err instanceof Error ? err.message : "Failed to open file";
        // Surface path so a failed citation deep-link is not a blank "Select a file".
        setReaderError(
          message.includes(pathToOpen) ? message : `${message}: ${pathToOpen}`,
        );
        setReaderContent(null);
      } finally {
        if (requestId === openRequestIdRef.current) {
          setIsLoadingFile(false);
        }
      }
    },
    [focusTreePath, loadMissingAncestorsForPath, treeRoots],
  );

  const refreshTree = useCallback(async () => {
    try {
      const body = await fetchVaultTree();
      dispatchTree({
        type: "snapshot.loaded",
        roots: body.roots ?? [],
        meta: {
          truncated: body.truncated === true,
          source: body.source,
          unavailable: body.unavailable,
          truncatedReason: body.truncated_reason,
        },
      });
    } catch {
      dispatchTree({ type: "snapshot.failed" });
    }
  }, []);

  const runSearch = useCallback(async () => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchEmpty(false);
      return;
    }

    setIsSearching(true);
    setSearchEmpty(false);
    try {
      const body = await searchVaultIndex(trimmed);
      setSearchResults(body.results);
      setSearchEmpty(body.results.length === 0);
    } catch {
      setSearchResults([]);
      setSearchEmpty(false);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  const clearSearchResults = useCallback(() => {
    setSearchResults([]);
    setSearchEmpty(false);
  }, []);

  // Initial load + live poll for new artifacts under VAULT_ROOT.
  useEffect(() => {
    void refreshTree();

    if (treePollIntervalMs <= 0) {
      return;
    }

    const id = window.setInterval(() => {
      void refreshTree();
    }, treePollIntervalMs);

    return () => {
      window.clearInterval(id);
    };
  }, [refreshTree, treePollIntervalMs]);

  // Refresh tree when the window regains focus (e.g. after editing files).
  useEffect(() => {
    const onFocus = () => {
      void refreshTree();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshTree]);

  // Immediate refresh after host FS mutations (project create/delete).
  useEffect(() => {
    const onInvalidate = () => {
      void refreshTree();
    };
    window.addEventListener(VAULT_TREE_INVALIDATE_EVENT, onInvalidate);
    return () => {
      window.removeEventListener(VAULT_TREE_INVALIDATE_EVENT, onInvalidate);
    };
  }, [refreshTree]);

  // Keep a stable openFile ref so tree poll (new openFile identity) does not
  // cancel an in-flight citation deep-link and leave the reader blank.
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;

  // Citation / shell deep-link → open reader when path is set.
  // Wait for the first tree load so multi-root path matching can expand/select
  // the correct node. deepLinkKey forces re-open when the same path is clicked
  // again after consume.
  useEffect(() => {
    if (!deepLinkPath) {
      return;
    }
    if (!treeReady) {
      return;
    }
    // Prefer raw deep-link path (already project-resolved by chat). Only use
    // vaultPathFromHref for true URLs / relative hrefs — never strip multi-root
    // absolute paths.
    const trimmed = deepLinkPath.trim();
    const normalized =
      trimmed.startsWith("/") || /^file:\/\//i.test(trimmed)
        ? vaultPathFromHref(trimmed) ?? trimmed.replace(/^file:\/\//i, "")
        : vaultPathFromHref(trimmed) ?? trimmed;
    if (!normalized) {
      onDeepLinkConsumed?.();
      return;
    }
    let cancelled = false;
    void openFileRef.current(normalized).finally(() => {
      if (!cancelled) {
        onDeepLinkConsumed?.();
      }
    });
    return () => {
      cancelled = true;
    };
    // Intentionally omit openFile — use openFileRef to avoid poll-driven cancels.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openFile via ref
  }, [deepLinkPath, deepLinkKey, treeReady, onDeepLinkConsumed]);

  const handleDownload = useCallback((path: string) => {
    void downloadVaultFile(path).catch((err) => {
      const message =
        err instanceof Error ? err.message : "Failed to download file";
      setReaderError(message);
    });
  }, []);

  const treeItems = useMemo(
    () =>
      vaultTreeStateToTreeItems(treeState, {
        onOpenFile: (path) => void openFile(path),
        onDownloadFile: handleDownload,
        expandedPaths: expandedTreePaths,
        selectedPath: selectedTreePath,
        onRetryDirectory: handleRetryDirectory,
        onLoadMoreDirectory: handleLoadMoreDirectory,
      }),
    [
      treeState,
      openFile,
      handleDownload,
      expandedTreePaths,
      selectedTreePath,
      handleRetryDirectory,
      handleLoadMoreDirectory,
    ],
  );

  const showEmptyTree = treeReady && treeRoots.length === 0;
  const treeUnavailable = treeReady && treeState.treeMeta.unavailable === true;
  const { brainRpcEnabled, chatDelivery, vaultPlane } =
    useOptionalPortalHonesty();
  const honestyNotice = useMemo(
    () =>
      resolveHonestyNotice({
        surface: "vault",
        brainRpcEnabled,
        chatDelivery,
        vaultPlane,
        vaultEmpty: showEmptyTree,
        vaultUnavailable: treeUnavailable,
        // Soft tree budget hits are navigable via entries expand (lp-ypx);
        // do not yellow-banner normal company vaults (lp-vnz.10).
        vaultTruncated: treeReady && treeTruncated,
        vaultLazyEntriesAvailable: true,
      }),
    [
      brainRpcEnabled,
      chatDelivery,
      vaultPlane,
      showEmptyTree,
      treeUnavailable,
      treeReady,
      treeTruncated,
    ],
  );

  return (
    <div style={vaultRootStyle}>
      <Layout
        height="fill"
        start={
          <LayoutPanel padding={0} hasDivider role="navigation">
            <SideNav
              collapsible
              resizable={SIDE_NAV_RESIZE}
              topContent={
                <VaultSearchTopContent
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  isSearching={isSearching}
                  onClearResults={clearSearchResults}
                  onSearch={() => void runSearch()}
                />
              }
            >
              <VStack gap={3}>
                {honestyNotice?.id === "vault-brain-rpc-off" ? null : (
                  <div data-testid="vault-agent-files-label">
                    <Text type="body" weight="semibold">
                      Agent files
                    </Text>
                  </div>
                )}
                <HonestyBanner notice={honestyNotice} />
                {showEmptyTree ? (
                  <EmptyState title={EMPTY_TREE_TITLE} isCompact />
                ) : (
                  <div
                    onClickCapture={handleTreeClickCapture}
                    onKeyDownCapture={handleTreeKeyDownCapture}
                  >
                    <TreeList
                      key={treeFocusKey}
                      density="compact"
                      items={treeItems}
                    />
                  </div>
                )}

                {searchResults.length > 0 ? (
                  <List aria-label="Vault search results">
                    {searchResults.map((hit) => (
                      <ListItem
                        key={hit.path}
                        label={hit.title}
                        description={
                          <VStack gap={1}>
                            <Text type="body" color="secondary" size="sm">
                              {hit.path}
                            </Text>
                            <Text type="body" color="secondary" size="sm">
                              {hit.snippet}
                            </Text>
                          </VStack>
                        }
                        onClick={() => void openFile(hit.path)}
                      />
                    ))}
                  </List>
                ) : searchEmpty ? (
                  <EmptyState title="No matches" isCompact />
                ) : null}
              </VStack>
            </SideNav>
          </LayoutPanel>
        }
        content={
          <LayoutContent
            // lp-75r.2: zero pad so OnlyOffice is edge-to-edge (match chat pane).
            // VaultDocumentHost pads markdown/preview only; OO body stays flush.
            padding={VAULT_LAYOUT_CONTENT_PADDING}
            role="main"
            aria-live="polite"
            data-testid="vault-layout-content"
            data-content-padding={String(VAULT_LAYOUT_CONTENT_PADDING)}
            // Let previews (PDF) stretch to the pane; scroll inside iframe/content.
            isScrollable={false}
            style={{
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              height: "100%",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minHeight: 0,
                height: "100%",
              }}
            >
              <VaultDocumentHost
                content={readerContent}
                isLoading={isLoadingFile}
                error={readerError}
                canVaultEdit={canVaultEdit}
                editorEnabled={onlyOfficeEditorEnabled}
              />
            </div>
          </LayoutContent>
        }
      />
    </div>
  );
}
