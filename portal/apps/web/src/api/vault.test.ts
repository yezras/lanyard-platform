import { afterEach, describe, expect, it, vi } from "vitest";

import {
  downloadVaultFile,
  fetchArtifactHead,
  fetchVaultEntries,
  fetchVaultContent,
  fetchVaultHistory,
  fetchVaultTree,
  searchVaultIndex,
  VaultHistoryApiError,
} from "./vault.js";

describe("vault api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches the vault tree", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ roots: [{ name: "A", path: "/Projects/A", kind: "directory" }] }),
      }),
    );

    await expect(fetchVaultTree()).resolves.toEqual({
      roots: [{ name: "A", path: "/Projects/A", kind: "directory" }],
    });

    expect(fetch).toHaveBeenCalledWith("/api/vault/tree", {
      credentials: "include",
    });
  });

  it("fetches vault entries with cursor pagination metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          path: "/Projects/A",
          entries: [
            {
              name: "README.md",
              path: "/Projects/A/README.md",
              kind: "file",
              mime_type: "text/markdown",
            },
          ],
          source: "brain_rpc",
          truncated: true,
          next_cursor: "page:3",
        }),
      }),
    );

    await expect(fetchVaultEntries("/Projects/A", "page:2")).resolves.toEqual({
      path: "/Projects/A",
      entries: [
        {
          name: "README.md",
          path: "/Projects/A/README.md",
          kind: "file",
          mime_type: "text/markdown",
        },
      ],
      source: "brain_rpc",
      truncated: true,
      next_cursor: "page:3",
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/vault/entries?path=%2FProjects%2FA&cursor=page%3A2",
      { credentials: "include" },
    );
  });

  it("fetches vault file content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          path: "/Projects/A/README.md",
          mime_type: "text/markdown",
          encoding: "utf-8",
          content: "# Hello",
        }),
      }),
    );

    await expect(fetchVaultContent("/Projects/A/README.md")).resolves.toMatchObject({
      path: "/Projects/A/README.md",
      content: "# Hello",
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/vault/content?path=%2FProjects%2FA%2FREADME.md",
      { credentials: "include" },
    );
  });

  it("does not parse SPA HTML as vault JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null,
        },
        json: async () => {
          throw new SyntaxError("Unexpected token '<'");
        },
      }),
    );

    await expect(
      fetchVaultContent("/workflows/runs/wf_03e3fb5b2224a1d2/state.json"),
    ).rejects.toThrow(/HTML, not JSON/);
  });

  it("searches the vault index", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          query: "kickoff",
          last_indexed_at: "2026-01-01T00:00:00.000Z",
          results: [],
        }),
      }),
    );

    await expect(searchVaultIndex("kickoff")).resolves.toEqual({
      query: "kickoff",
      last_indexed_at: "2026-01-01T00:00:00.000Z",
      results: [],
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/vault/search?q=kickoff",
      { credentials: "include" },
    );
  });

  it("throws API errors with server message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: "Forbidden" }),
      }),
    );

    await expect(fetchVaultTree()).rejects.toThrow("Forbidden");
  });

  it("throws vault entries API errors with server message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "Host unavailable" }),
      }),
    );

    await expect(fetchVaultEntries("/Projects/A")).rejects.toThrow(
      "Host unavailable",
    );
  });

  /**
   * lp-upc: explicit Download only — Office blobs use octet-stream so the OS
   * does not auto-launch LibreOffice/X11; anchor always has download=filename.
   */
  it("downloadVaultFile forces Office MIME to octet-stream + download attr", async () => {
    const clicks: Array<{ download: string; href: string }> = [];
    const createObjectURL = vi.fn(() => "blob:mock-office");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === "a") {
        // Do not invoke real click (jsdom navigation); assert attrs only.
        el.click = () => {
          clicks.push({
            download: (el as HTMLAnchorElement).download,
            href: (el as HTMLAnchorElement).href,
          });
        };
      }
      return el;
    });

    let lastBlobType = "";
    const RealBlob = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class extends RealBlob {
        constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          lastBlobType = options?.type ?? "";
        }
      },
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          path: "/Business/Legal/contracts/MSA.docx",
          mime_type:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          encoding: "base64",
          content: btoa("PK-fake-docx"),
        }),
      }),
    );

    await downloadVaultFile("/Business/Legal/contracts/MSA.docx");

    expect(fetch).toHaveBeenCalledWith(
      "/api/vault/content?path=%2FBusiness%2FLegal%2Fcontracts%2FMSA.docx",
      { credentials: "include" },
    );
    expect(lastBlobType).toBe("application/octet-stream");
    expect(createObjectURL).toHaveBeenCalled();
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.download).toBe("MSA.docx");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-office");
  });

  it("downloadVaultFile keeps text mime for non-Office files", async () => {
    let lastBlobType = "";
    const RealBlob = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class extends RealBlob {
        constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          lastBlobType = options?.type ?? "";
        }
      },
    );
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock-md"),
      revokeObjectURL: vi.fn(),
    });
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === "a") {
        el.click = () => {};
      }
      return el;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          path: "/Projects/A/README.md",
          mime_type: "text/markdown",
          encoding: "utf-8",
          content: "# hi",
        }),
      }),
    );

    await downloadVaultFile("/Projects/A/README.md");
    expect(lastBlobType).toBe("text/markdown");
  });

  it("fetches vault history happy path (lp-ye4.11)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          path: "/Projects/Legal/memo.md",
          events: [
            {
              operation_id: "op_01",
              kind: "file_create",
              target: { path: "/Projects/Legal/memo.md" },
            },
          ],
          truncated: false,
          source: "brain_rpc",
        }),
      }),
    );

    await expect(
      fetchVaultHistory("/Projects/Legal/memo.md", { limit: 20 }),
    ).resolves.toMatchObject({
      path: "/Projects/Legal/memo.md",
      events: [{ operation_id: "op_01" }],
      source: "brain_rpc",
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/vault/history?path=%2FProjects%2FLegal%2Fmemo.md&limit=20",
      { credentials: "include" },
    );
  });

  it("history denied path surfaces VaultHistoryApiError forbidden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          error: "Vault path not permitted for user role: /Secrets/note.md",
          code: "forbidden",
          path: "/Secrets/note.md",
          method: "history.list",
        }),
      }),
    );

    await expect(fetchVaultHistory("/Secrets/note.md")).rejects.toMatchObject({
      name: "VaultHistoryApiError",
      code: "forbidden",
      status: 403,
    });
    await expect(fetchVaultHistory("/Secrets/note.md")).rejects.toBeInstanceOf(
      VaultHistoryApiError,
    );
  });

  it("fetches artifact head metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          record_type: "artifact_head",
          path: "/Projects/Legal/memo.md",
          operation_id: "op_head",
          revision: { token: "sha256:abc", kind: "content_hash" },
          head_kind: "canonical",
          source: "brain_rpc",
        }),
      }),
    );

    await expect(fetchArtifactHead("/Projects/Legal/memo.md")).resolves.toMatchObject({
      operation_id: "op_head",
      head_kind: "canonical",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/vault/heads/artifact?path=%2FProjects%2FLegal%2Fmemo.md",
      { credentials: "include" },
    );
  });
});
