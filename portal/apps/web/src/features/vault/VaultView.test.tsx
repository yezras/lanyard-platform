import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import { PortalHonestyProvider } from "../honesty/index.js";

import { VaultView, VAULT_TREE_POLL_MS } from "./VaultView.js";

const DEFAULT_VAULT_TREE = {
  roots: [
    {
      name: "Projects",
      path: "/Projects",
      kind: "directory" as const,
      children: [
        {
          name: "A",
          path: "/Projects/A",
          kind: "directory" as const,
          children: [
            {
              name: "README.md",
              path: "/Projects/A/README.md",
              kind: "file" as const,
              mime_type: "text/markdown",
            },
          ],
        },
        {
          name: "README.md",
          path: "/Projects/README.md",
          kind: "file" as const,
          mime_type: "text/markdown",
        },
      ],
    },
  ],
};

vi.mock("../../api/vault.js", () => ({
  fetchVaultTree: vi.fn(),
  fetchVaultEntries: vi.fn(),
  fetchVaultContent: vi.fn(),
  searchVaultIndex: vi.fn(),
  downloadVaultFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../api/context.js", () => ({
  fetchPortalContext: vi.fn().mockResolvedValue({
    brain_rpc_enabled: true,
    ui: { can: { vault_edit: false } },
  }),
}));

function renderVault(
  props?: {
    deepLinkPath?: string | null;
    onDeepLinkConsumed?: () => void;
    treePollIntervalMs?: number;
    canVaultEdit?: boolean | null;
    onlyOfficeEditorEnabled?: boolean;
  },
  honesty?: {
    brainRpcEnabled: boolean | null;
    chatDelivery?: "relay" | "harness" | null;
    vaultPlane?: "fs" | "brain_rpc" | "cp_s3" | null;
  },
) {
  return render(
    <Providers>
      <PortalHonestyProvider
        value={
          honesty
            ? {
                brainRpcEnabled: honesty.brainRpcEnabled,
                chatDelivery: honesty.chatDelivery,
                vaultPlane: honesty.vaultPlane,
                isReady: true,
              }
            : undefined
        }
      >
        <VaultView {...props} />
      </PortalHonestyProvider>
    </Providers>,
  );
}

describe("VaultView", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { fetchVaultEntries, fetchVaultTree, searchVaultIndex } =
      await import("../../api/vault.js");
    vi.mocked(fetchVaultTree).mockResolvedValue(DEFAULT_VAULT_TREE as never);
    vi.mocked(fetchVaultEntries).mockResolvedValue({
      path: "/",
      entries: [],
      truncated: false,
      next_cursor: null,
    } as never);
    vi.mocked(searchVaultIndex).mockResolvedValue({
      query: "",
      results: [],
      last_indexed_at: "2026-01-01T00:00:00.000Z",
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not render noisy Live tree / search corpus labels", async () => {
    renderVault();

    await waitFor(() => {
      expect(screen.getByText("Projects")).toBeTruthy();
    });

    expect(screen.queryByText("Live tree")).toBeNull();
    expect(screen.queryByText("Search indexed vault corpus…")).toBeNull();
    expect(screen.queryByText("Search index")).toBeNull();
    expect(screen.queryByText(/Index last updated/i)).toBeNull();
    expect(screen.queryByText(/Loading vault tree/i)).toBeNull();
  });

  it("exposes collapsible SideNav chrome (collapse sidebar control)", async () => {
    renderVault();

    await waitFor(() => {
      expect(screen.getByText("Projects")).toBeTruthy();
    });

    expect(
      screen.getByRole("button", { name: /Collapse sidebar|Expand sidebar/i }),
    ).toBeTruthy();
  });

  it("shows empty state for missing projects when tree is empty", async () => {
    const { fetchVaultTree } = await import("../../api/vault.js");
    vi.mocked(fetchVaultTree).mockResolvedValueOnce({ roots: [] });

    renderVault();

    await waitFor(() => {
      expect(screen.getByText("No files")).toBeTruthy();
    });

    expect(screen.getByTestId("vault-agent-files-label")).toBeTruthy();
    expect(screen.queryByText(/create one from Directory/i)).toBeNull();
    expect(screen.queryByText(/Brain/i)).toBeNull();
    expect(screen.queryByText(/fixture/i)).toBeNull();
    expect(screen.queryByText(/Hermes/i)).toBeNull();
    expect(screen.queryByText("Live tree")).toBeNull();
  });

  it("shows vault honesty banner when brain_rpc_enabled is false", async () => {
    renderVault(undefined, { brainRpcEnabled: false });

    await waitFor(() => {
      expect(screen.getByText("Projects")).toBeTruthy();
    });

    expect(screen.getByTestId("honesty-banner-vault-brain-rpc-off")).toBeTruthy();
    expect(screen.getByText("Agent files")).toBeTruthy();
    expect(screen.getByText(/The vault is the agent's files/i)).toBeTruthy();
    expect(screen.queryByText(/Brain/i)).toBeNull();
    expect(screen.queryByText(/fixture/i)).toBeNull();
    expect(screen.queryByText(/host protocol/i)).toBeNull();
  });

  it("hides vault honesty banner when brain_rpc is on and tree has roots", async () => {
    renderVault(undefined, { brainRpcEnabled: true });

    await waitFor(() => {
      expect(screen.getByText("Projects")).toBeTruthy();
    });

    expect(
      screen.queryByTestId("honesty-banner-vault-brain-rpc-off"),
    ).toBeNull();
    expect(screen.getByTestId("vault-agent-files-label")).toBeTruthy();
    expect(screen.getByText("Agent files")).toBeTruthy();
    expect(screen.queryByText(/Brain/i)).toBeNull();
    expect(screen.queryByText(/fixture/i)).toBeNull();
  });

  it("does not show truncated-tree banner when tree is soft-truncated (lp-vnz.10)", async () => {
    const { fetchVaultTree } = await import("../../api/vault.js");
    vi.mocked(fetchVaultTree).mockResolvedValue({
      roots: [
        {
          name: "Projects",
          path: "/Projects",
          kind: "directory",
          children: [],
        },
      ],
      source: "brain_rpc",
      truncated: true,
      truncated_reason: "max_nodes",
    } as never);

    renderVault({ treePollIntervalMs: 0 }, { brainRpcEnabled: true });

    await waitFor(() => {
      expect(screen.getByText("Projects")).toBeTruthy();
    });

    expect(screen.queryByTestId("honesty-banner-vault-tree-truncated")).toBeNull();
    expect(screen.queryByText("Vault tree is truncated")).toBeNull();
    expect(
      screen.queryByText(/initial vault tree hit a size limit/i),
    ).toBeNull();
  });

  it("uses honesty empty copy when brain_rpc off and tree empty", async () => {
    const { fetchVaultTree } = await import("../../api/vault.js");
    vi.mocked(fetchVaultTree).mockResolvedValueOnce({ roots: [] });

    renderVault(undefined, { brainRpcEnabled: false });

    await waitFor(() => {
      expect(screen.getByText("No files")).toBeTruthy();
    });
    expect(screen.getByText(/The vault is the agent's files/i)).toBeTruthy();
    expect(screen.getByTestId("honesty-banner-vault-brain-rpc-off")).toBeTruthy();
    expect(screen.queryByText(/Brain/i)).toBeNull();
    expect(screen.queryByText(/fixture/i)).toBeNull();
    expect(screen.queryByText(/Hermes/i)).toBeNull();
  });

  it("does not claim local/fixture or Relay when Vault is on cp_s3 + harness", async () => {
    const { fetchVaultTree } = await import("../../api/vault.js");
    vi.mocked(fetchVaultTree).mockResolvedValueOnce({ roots: [] });

    renderVault(undefined, {
      brainRpcEnabled: false,
      chatDelivery: "harness",
      vaultPlane: "cp_s3",
    });

    await waitFor(() => {
      expect(screen.getByText("No files")).toBeTruthy();
    });

    const banner = screen.getByTestId("honesty-banner-vault-empty-host");
    expect(banner.textContent).toMatch(/agent's files/i);
    expect(screen.getByTestId("vault-agent-files-label")).toBeTruthy();
    expect(screen.queryByTestId("honesty-banner-vault-brain-rpc-off")).toBeNull();
    expect(screen.queryByText(/fixture/i)).toBeNull();
    expect(screen.queryByText(/relay path/i)).toBeNull();
    expect(screen.queryByText(/Brain/i)).toBeNull();
    expect(screen.queryByText(/host protocol/i)).toBeNull();
  });

  it("polls fetchVaultTree on the live-refresh interval", async () => {
    vi.useFakeTimers();
    const { fetchVaultTree } = await import("../../api/vault.js");
    vi.mocked(fetchVaultTree).mockResolvedValue({ roots: [] });

    renderVault({ treePollIntervalMs: VAULT_TREE_POLL_MS });

    // Initial load
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchVaultTree).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VAULT_TREE_POLL_MS);
    });
    expect(fetchVaultTree).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VAULT_TREE_POLL_MS);
    });
    expect(fetchVaultTree).toHaveBeenCalledTimes(3);
  });

  it("refreshes tree when the window gains focus", async () => {
    const { fetchVaultTree } = await import("../../api/vault.js");
    vi.mocked(fetchVaultTree).mockResolvedValue({
      roots: [
        {
          name: "Projects",
          path: "/Projects",
          kind: "directory",
          children: [],
        },
      ],
    });

    // Disable interval so focus is the only extra call.
    renderVault({ treePollIntervalMs: 0 });

    await waitFor(() => {
      expect(fetchVaultTree).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchVaultTree).toHaveBeenCalledTimes(2);
    });
  });

  it("loads unloaded folder children on expansion without full tree reload", async () => {
    const { fetchVaultEntries, fetchVaultTree } = await import("../../api/vault.js");
    vi.mocked(fetchVaultTree).mockResolvedValue({
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
    } as never);
    vi.mocked(fetchVaultEntries).mockResolvedValue({
      path: "/Projects/Archive",
      entries: [
        {
          name: "old.md",
          path: "/Projects/Archive/old.md",
          kind: "file",
          mime_type: "text/markdown",
        },
      ],
      truncated: false,
      next_cursor: null,
    } as never);

    renderVault({ treePollIntervalMs: 0 });

    await waitFor(() => {
      expect(screen.getByText("Projects")).toBeTruthy();
    });
    const projectsItem = screen.getByText("Projects").closest('[role="treeitem"]');
    fireEvent.click(
      projectsItem!.querySelector('button[aria-label="Toggle children"]')!,
    );

    await waitFor(() => {
      expect(screen.getByText("Archive")).toBeTruthy();
    });
    const archiveItem = screen.getByText("Archive").closest('[role="treeitem"]');
    const archiveToggle = archiveItem!.querySelector(
      'button[aria-label="Toggle children"]',
    )!;
    fireEvent.click(archiveToggle);

    await waitFor(() => {
      expect(fetchVaultEntries).toHaveBeenCalledWith(
        "/Projects/Archive",
        null,
      );
      expect(screen.getByText("old.md")).toBeTruthy();
    });
    expect(fetchVaultTree).toHaveBeenCalledTimes(1);

    fireEvent.click(archiveToggle);
    fireEvent.click(archiveToggle);
    expect(fetchVaultEntries).toHaveBeenCalledTimes(1);
  });

  it("shows folder load errors and retries in place", async () => {
    const { fetchVaultEntries, fetchVaultTree } = await import("../../api/vault.js");
    vi.mocked(fetchVaultTree).mockResolvedValue({
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
    } as never);
    vi.mocked(fetchVaultEntries)
      .mockRejectedValueOnce(new Error("Host unavailable"))
      .mockResolvedValueOnce({
        path: "/Projects/Archive",
        entries: [
          {
            name: "retry.md",
            path: "/Projects/Archive/retry.md",
            kind: "file",
            mime_type: "text/markdown",
          },
        ],
        truncated: false,
        next_cursor: null,
      } as never);

    renderVault({ treePollIntervalMs: 0 });

    await waitFor(() => {
      expect(screen.getByText("Projects")).toBeTruthy();
    });
    const projectsItem = screen.getByText("Projects").closest('[role="treeitem"]');
    fireEvent.click(
      projectsItem!.querySelector('button[aria-label="Toggle children"]')!,
    );
    await waitFor(() => {
      expect(screen.getByText("Archive")).toBeTruthy();
    });
    const archiveItem = screen.getByText("Archive").closest('[role="treeitem"]');
    fireEvent.click(
      archiveItem!.querySelector('button[aria-label="Toggle children"]')!,
    );

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeTruthy();
      expect(screen.getByText("Host unavailable")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(fetchVaultEntries).toHaveBeenCalledTimes(2);
      expect(screen.getByText("retry.md")).toBeTruthy();
    });
  });

  it("loads additional folder pages from next_cursor", async () => {
    const { fetchVaultEntries, fetchVaultTree } = await import("../../api/vault.js");
    vi.mocked(fetchVaultTree).mockResolvedValue({
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
    } as never);
    vi.mocked(fetchVaultEntries)
      .mockResolvedValueOnce({
        path: "/Projects/Archive",
        entries: [
          {
            name: "one.md",
            path: "/Projects/Archive/one.md",
            kind: "file",
            mime_type: "text/markdown",
          },
        ],
        truncated: true,
        next_cursor: "page-2",
      } as never)
      .mockResolvedValueOnce({
        path: "/Projects/Archive",
        entries: [
          {
            name: "two.md",
            path: "/Projects/Archive/two.md",
            kind: "file",
            mime_type: "text/markdown",
          },
        ],
        truncated: false,
        next_cursor: null,
      } as never);

    renderVault({ treePollIntervalMs: 0 });

    await waitFor(() => {
      expect(screen.getByText("Projects")).toBeTruthy();
    });
    const projectsItem = screen.getByText("Projects").closest('[role="treeitem"]');
    fireEvent.click(
      projectsItem!.querySelector('button[aria-label="Toggle children"]')!,
    );
    await waitFor(() => {
      expect(screen.getByText("Archive")).toBeTruthy();
    });
    const archiveItem = screen.getByText("Archive").closest('[role="treeitem"]');
    fireEvent.click(
      archiveItem!.querySelector('button[aria-label="Toggle children"]')!,
    );

    await waitFor(() => {
      expect(screen.getByText("one.md")).toBeTruthy();
      expect(screen.getByText("Load more")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Load more"));

    await waitFor(() => {
      expect(fetchVaultEntries).toHaveBeenNthCalledWith(
        2,
        "/Projects/Archive",
        "page-2",
      );
      expect(screen.getByText("two.md")).toBeTruthy();
    });
    expect(screen.queryByText("Load more")).toBeNull();
  });

  it("does not request directory entries when a loaded file row is opened", async () => {
    const { fetchVaultContent, fetchVaultEntries, fetchVaultTree } =
      await import("../../api/vault.js");
    vi.mocked(fetchVaultTree).mockResolvedValue({
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
    } as never);
    vi.mocked(fetchVaultEntries).mockResolvedValue({
      path: "/Projects/Archive",
      entries: [
        {
          name: "loaded.md",
          path: "/Projects/Archive/loaded.md",
          kind: "file",
          mime_type: "text/markdown",
        },
      ],
      truncated: false,
      next_cursor: null,
    } as never);
    vi.mocked(fetchVaultContent).mockResolvedValue({
      path: "/Projects/Archive/loaded.md",
      mime_type: "text/markdown",
      encoding: "utf-8",
      content: "# Loaded file\n",
    });

    renderVault({ treePollIntervalMs: 0 });

    await waitFor(() => {
      expect(screen.getByText("Projects")).toBeTruthy();
    });
    const projectsItem = screen.getByText("Projects").closest('[role="treeitem"]');
    fireEvent.click(
      projectsItem!.querySelector('button[aria-label="Toggle children"]')!,
    );
    await waitFor(() => {
      expect(screen.getByText("Archive")).toBeTruthy();
    });
    const archiveItem = screen.getByText("Archive").closest('[role="treeitem"]');
    fireEvent.click(
      archiveItem!.querySelector('button[aria-label="Toggle children"]')!,
    );

    await waitFor(() => {
      expect(screen.getByText("loaded.md")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("loaded.md"));

    await waitFor(() => {
      expect(screen.getByText("Loaded file")).toBeTruthy();
    });
    expect(fetchVaultEntries).toHaveBeenCalledTimes(1);
    expect(fetchVaultContent).toHaveBeenCalledWith("/Projects/Archive/loaded.md");
  });

  it("opens reader when deepLinkPath is set", async () => {
    const { fetchVaultContent } = await import("../../api/vault.js");
    vi.mocked(fetchVaultContent).mockResolvedValue({
      path: "/Projects/A/README.md",
      mime_type: "text/markdown",
      encoding: "utf-8",
      content: "# Hello from deep link\n",
    });

    renderVault({ deepLinkPath: "/Projects/A/README.md" });

    await waitFor(() => {
      expect(fetchVaultContent).toHaveBeenCalledWith("/Projects/A/README.md");
    });

    await waitFor(() => {
      // Expanded tree may show multiple README.md labels; content is the signal.
      expect(screen.getByText("Hello from deep link")).toBeTruthy();
    });
  });

  it("expands tree ancestors and selects file on deepLinkPath", async () => {
    const { fetchVaultContent, fetchVaultTree } = await import(
      "../../api/vault.js"
    );
    // Prior tests may override the tree mock — re-seed nested structure here.
    vi.mocked(fetchVaultTree).mockResolvedValue({
      roots: [
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
          ],
        },
      ],
    });
    vi.mocked(fetchVaultContent).mockResolvedValue({
      path: "/Projects/A/README.md",
      mime_type: "text/markdown",
      encoding: "utf-8",
      content: "# Focus tree\n",
    });

    renderVault({
      deepLinkPath: "/Projects/A/README.md",
      treePollIntervalMs: 0,
    });

    await waitFor(() => {
      expect(fetchVaultContent).toHaveBeenCalledWith("/Projects/A/README.md");
    });

    await waitFor(() => {
      // Nested file label appears in the tree once ancestors expand.
      const tree = screen.getByRole("tree");
      expect(tree).toBeTruthy();
      // Selected treeitem for the deep-linked file.
      const selected = tree.querySelector('[aria-selected="true"]');
      expect(selected).toBeTruthy();
      expect(selected?.textContent).toMatch(/README\.md/);
      // Projects and A folders are expanded.
      const toggles = tree.querySelectorAll(
        'button[aria-label="Toggle children"][aria-expanded="true"]',
      );
      expect(toggles.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("loads missing deep-link ancestors while opening the file", async () => {
    const { fetchVaultContent, fetchVaultEntries, fetchVaultTree } =
      await import("../../api/vault.js");
    vi.mocked(fetchVaultTree).mockResolvedValue({
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
    } as never);
    vi.mocked(fetchVaultEntries).mockResolvedValue({
      path: "/Projects/Archive",
      entries: [
        {
          name: "old.md",
          path: "/Projects/Archive/old.md",
          kind: "file",
          mime_type: "text/markdown",
        },
      ],
      truncated: false,
      next_cursor: null,
    } as never);
    vi.mocked(fetchVaultContent).mockResolvedValue({
      path: "/Projects/Archive/old.md",
      mime_type: "text/markdown",
      encoding: "utf-8",
      content: "# Old file\n",
    });

    renderVault({
      deepLinkPath: "/Projects/Archive/old.md",
      treePollIntervalMs: 0,
    });

    await waitFor(() => {
      expect(fetchVaultContent).toHaveBeenCalledWith(
        "/Projects/Archive/old.md",
      );
      expect(fetchVaultEntries).toHaveBeenCalledWith(
        "/Projects/Archive",
        null,
      );
    });
    await waitFor(() => {
      expect(screen.getAllByText("old.md").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Old file")).toBeTruthy();
    });
  });

  it("calls onDeepLinkConsumed after opening deepLinkPath", async () => {
    const { fetchVaultContent } = await import("../../api/vault.js");
    vi.mocked(fetchVaultContent).mockResolvedValue({
      path: "/Projects/A/README.md",
      mime_type: "text/markdown",
      encoding: "utf-8",
      content: "# Hello vault",
    });
    const onDeepLinkConsumed = vi.fn();

    renderVault({
      deepLinkPath: "/Projects/A/README.md",
      onDeepLinkConsumed,
    });

    await waitFor(() => {
      expect(fetchVaultContent).toHaveBeenCalledWith("/Projects/A/README.md");
    });
    await waitFor(() => {
      expect(onDeepLinkConsumed).toHaveBeenCalled();
    });
  });

  it("waits for tree before resolving multi-root citation deep-links", async () => {
    const { fetchVaultContent, fetchVaultTree } = await import("../../api/vault.js");
    let resolveTree!: (value: typeof DEFAULT_VAULT_TREE) => void;
    const treePromise = new Promise<typeof DEFAULT_VAULT_TREE>((resolve) => {
      resolveTree = resolve;
    });
    vi.mocked(fetchVaultTree).mockReturnValue(treePromise as never);
    vi.mocked(fetchVaultContent).mockResolvedValue({
      path: "/home/u/Core/README.md",
      mime_type: "text/markdown",
      encoding: "utf-8",
      content: "# Multi-root citation\n",
    });

    renderVault({ deepLinkPath: "README.md" });

    // Tree still loading — do not fetch content yet (path match needs roots).
    await Promise.resolve();
    expect(fetchVaultContent).not.toHaveBeenCalled();

    await act(async () => {
      resolveTree({
        roots: [
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
            ],
          },
        ],
      } as typeof DEFAULT_VAULT_TREE);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchVaultContent).toHaveBeenCalledWith("/home/u/Core/README.md");
    });
    await waitFor(() => {
      expect(screen.getByText("Multi-root citation")).toBeTruthy();
    });
  });

  it("opens reader when deepLinkPath is set after mount (keep-alive citation)", async () => {
    const { fetchVaultContent } = await import("../../api/vault.js");
    vi.mocked(fetchVaultContent).mockResolvedValue({
      path: "/Projects/A/notes.md",
      mime_type: "text/markdown",
      encoding: "utf-8",
      content: "## Notes from citation\n",
    });
    const onDeepLinkConsumed = vi.fn();

    const { rerender } = render(
      <Providers>
        <VaultView deepLinkPath={null} onDeepLinkConsumed={onDeepLinkConsumed} />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByText("Projects")).toBeTruthy();
    });
    expect(fetchVaultContent).not.toHaveBeenCalled();

    rerender(
      <Providers>
        <VaultView
          deepLinkPath="/Projects/A/notes.md"
          onDeepLinkConsumed={onDeepLinkConsumed}
        />
      </Providers>,
    );

    await waitFor(() => {
      expect(fetchVaultContent).toHaveBeenCalledWith("/Projects/A/notes.md");
    });
    await waitFor(() => {
      expect(screen.getByText("Notes from citation")).toBeTruthy();
      expect(onDeepLinkConsumed).toHaveBeenCalled();
    });
  });

  it("shows a clear error (not blank reader) when deep-link path is missing", async () => {
    const { fetchVaultContent } = await import("../../api/vault.js");
    vi.mocked(fetchVaultContent).mockRejectedValue(
      new Error("Vault file not found"),
    );

    renderVault({ deepLinkPath: "/Projects/missing.md" });

    await waitFor(() => {
      expect(fetchVaultContent).toHaveBeenCalledWith("/Projects/missing.md");
    });
    await waitFor(() => {
      expect(screen.getByText(/Vault file not found/i)).toBeTruthy();
      expect(screen.getByText(/\/Projects\/missing\.md/)).toBeTruthy();
    });
    expect(screen.queryByText("Select a file")).toBeNull();
  });

  /**
   * lp-upc / lp-xcu.2: vault open for Office never download-as-open.
   * When flag/capability off → client preview. When gates pass → OnlyOffice
   * open mode (covered in VaultDocumentHost tests with mint mocks).
   */
  it("opens docx via fetchVaultContent into preview host when gates off (never download)", async () => {
    const vaultApi = await import("../../api/vault.js");
    vi.mocked(vaultApi.fetchVaultContent).mockResolvedValue({
      path: "/Business/Legal/contracts/MSA.docx",
      mime_type:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      encoding: "base64",
      content: btoa("PK-fake-docx"),
    });
    vi.mocked(vaultApi.fetchVaultTree).mockResolvedValue({
      roots: [
        {
          name: "Business",
          path: "/Business",
          kind: "directory",
          children: [
            {
              name: "MSA.docx",
              path: "/Business/Legal/contracts/MSA.docx",
              kind: "file",
              mime_type:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            },
          ],
        },
      ],
    } as never);

    renderVault({
      deepLinkPath: "/Business/Legal/contracts/MSA.docx",
      treePollIntervalMs: 0,
      canVaultEdit: false,
      onlyOfficeEditorEnabled: false,
    });

    await waitFor(() => {
      expect(vaultApi.fetchVaultContent).toHaveBeenCalledWith(
        "/Business/Legal/contracts/MSA.docx",
      );
    });

    await waitFor(() => {
      const host = screen.getByTestId("vault-document-host");
      expect(host.getAttribute("data-open-mode")).toBe("preview");
      expect(host.getAttribute("data-editing")).toBe("false");
    });
    // Tree label + reader header both show the basename.
    expect(screen.getAllByText("MSA.docx").length).toBeGreaterThanOrEqual(1);
    expect(vaultApi.downloadVaultFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId("onlyoffice-editor-host")).toBeNull();
  });

  it("deep-links xlsx/pptx into edit open-mode when OnlyOffice gates pass (never download)", async () => {
    const vaultApi = await import("../../api/vault.js");
    for (const file of [
      {
        path: "/Projects/A/Budget.xlsx",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        name: "Budget.xlsx",
      },
      {
        path: "/Projects/A/Deck.pptx",
        mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        name: "Deck.pptx",
      },
    ] as const) {
      vi.clearAllMocks();
      vi.mocked(vaultApi.fetchVaultTree).mockResolvedValue(DEFAULT_VAULT_TREE as never);
      vi.mocked(vaultApi.fetchVaultContent).mockResolvedValue({
        path: file.path,
        mime_type: file.mime,
        encoding: "base64",
        content: btoa("PK"),
      });

      const { unmount } = renderVault({
        deepLinkPath: file.path,
        treePollIntervalMs: 0,
        canVaultEdit: true,
        onlyOfficeEditorEnabled: true,
      });

      await waitFor(() => {
        expect(vaultApi.fetchVaultContent).toHaveBeenCalledWith(file.path);
      });
      // lp-xcu.2: gates pass → host open-mode is edit (OnlyOffice mount path).
      // Mint/DS may fail in unit tests without office mocks; mode still flips.
      await waitFor(() => {
        expect(
          screen.getByTestId("vault-document-host").getAttribute("data-open-mode"),
        ).toBe("edit");
      });
      expect(vaultApi.downloadVaultFile).not.toHaveBeenCalled();
      unmount();
    }
  });

  /**
   * lp-75r.2: Vault LayoutContent is padding 0 so OnlyOffice can sit flush to
   * vault main (chat document pane parity). Preview pad lives on the host body.
   */
  it("vault main LayoutContent is zero content padding (OnlyOffice flush path)", async () => {
    renderVault({ treePollIntervalMs: 0 });

    await waitFor(() => {
      expect(screen.getByTestId("vault-layout-content")).toBeTruthy();
    });
    const main = screen.getByTestId("vault-layout-content");
    expect(main.getAttribute("data-content-padding")).toBe("0");
    expect(main.getAttribute("role")).toBe("main");
    // Document host fills main; OO body pad is controlled by VaultDocumentHost.
    expect(screen.getByTestId("vault-document-host")).toBeTruthy();
    expect(screen.getByTestId("vault-document-body").getAttribute("data-body-pad")).toBe(
      "preview",
    );
  });

  it("office edit open keeps vault main at padding 0 with OO zero body pad", async () => {
    const vaultApi = await import("../../api/vault.js");
    vi.mocked(vaultApi.fetchVaultContent).mockResolvedValue({
      path: "/Projects/A/Proposal.docx",
      mime_type:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      encoding: "base64",
      content: btoa("PK-fake-docx"),
    });

    renderVault({
      deepLinkPath: "/Projects/A/Proposal.docx",
      treePollIntervalMs: 0,
      canVaultEdit: true,
      onlyOfficeEditorEnabled: true,
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("vault-document-host").getAttribute("data-open-mode"),
      ).toBe("edit");
    });

    expect(
      screen.getByTestId("vault-layout-content").getAttribute("data-content-padding"),
    ).toBe("0");
    expect(
      screen.getByTestId("vault-document-body").getAttribute("data-body-pad"),
    ).toBe("0");
  });
});
