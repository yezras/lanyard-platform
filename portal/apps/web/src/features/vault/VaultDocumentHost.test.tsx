/**
 * Vault Office open (lp-5q6.29 / lp-xcu.2 / lp-swt.2).
 * Covers flag matrix, auto-open OnlyOffice, unsupported file, view-only user,
 * no dual-mode Edit/Back/"Editing in Office" chrome.
 */
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MintOfficeSessionSuccess } from "../../api/office.js";
import { OfficeApiError } from "../../api/office.js";
import type { VaultFileContent } from "../../api/types.js";
import { Providers } from "../../app/providers.js";
import type { DocsApiGlobal } from "../chat/documentPane/onlyOfficeTypes.js";

import { VaultDocumentHost } from "./VaultDocumentHost.js";

const DOCX_CONTENT: VaultFileContent = {
  path: "/Projects/A/Proposal.docx",
  mime_type:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  encoding: "base64",
  content: btoa("fake-docx"),
};

const XLSX_CONTENT: VaultFileContent = {
  path: "/Projects/A/Budget.xlsx",
  mime_type:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  encoding: "base64",
  content: btoa("fake-xlsx"),
};

const PPTX_CONTENT: VaultFileContent = {
  path: "/Projects/A/Deck.pptx",
  mime_type:
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  encoding: "base64",
  content: btoa("fake-pptx"),
};

const MD_CONTENT: VaultFileContent = {
  path: "/Projects/A/README.md",
  mime_type: "text/markdown",
  encoding: "utf-8",
  content: "# Hello",
};

const MINT_EDIT: MintOfficeSessionSuccess = {
  session_id: "sess-edit",
  document_key: "dk-edit",
  base_revision: { token: "r1", kind: "etag" },
  mode: "edit",
  file_type: "docx",
  path: "/Projects/A/Proposal.docx",
  expires_at: "2099-01-01T00:00:00.000Z",
  editor_config: {
    documentType: "word",
    document: {
      fileType: "docx",
      key: "dk-edit",
      title: "Proposal.docx",
      url: "https://bff/content",
      permissions: {
        edit: true,
        review: false,
        comment: false,
        download: true,
        print: true,
        fillForms: false,
        modifyFilter: false,
        modifyContentControl: false,
        copy: true,
        chat: false,
      },
    },
    editorConfig: {
      mode: "edit",
      callbackUrl: "https://bff/callback",
      user: { id: "u1", name: "Ada" },
      lang: "en",
    },
    token: "jwt",
  },
  idempotent_replay: false,
};

function mockDocsApi(
  onConstruct?: (cfg: Record<string, unknown>) => void,
): DocsApiGlobal {
  return {
    DocEditor: class {
      constructor(_id: string, config: Record<string, unknown>) {
        onConstruct?.(config);
        const events = config.events as
          | {
              onAppReady?: () => void;
              onDocumentReady?: () => void;
              onDocumentStateChange?: (e: { data?: boolean }) => void;
            }
          | undefined;
        queueMicrotask(() => {
          events?.onAppReady?.();
          events?.onDocumentReady?.();
        });
      }
      destroyEditor(): void {}
    },
  };
}

function renderHost(
  props: Partial<ComponentProps<typeof VaultDocumentHost>> & {
    content?: VaultFileContent | null;
  } = {},
) {
  const mint = props.mint ?? vi.fn().mockResolvedValue(MINT_EDIT);
  const loadDocsApi =
    props.loadDocsApi ?? (async () => mockDocsApi());
  return {
    mint: mint as ReturnType<typeof vi.fn>,
    ...render(
      <Providers>
        <VaultDocumentHost
          content={props.content === undefined ? DOCX_CONTENT : props.content}
          isLoading={props.isLoading ?? false}
          error={props.error ?? null}
          canVaultEdit={
            props.canVaultEdit === undefined ? true : props.canVaultEdit
          }
          editorEnabled={
            props.editorEnabled === undefined ? true : props.editorEnabled
          }
          documentServerUrl="https://ds.test"
          mint={mint as typeof import("../../api/office.js").mintOfficeSession}
          loadDocsApi={loadDocsApi}
        />
      </Providers>,
    ),
  };
}

afterEach(() => {
  cleanup();
});

describe("VaultDocumentHost office-only open (lp-swt.2)", () => {
  it("auto-mounts OnlyOffice for docx when flag + vault_edit + type pass", async () => {
    const { mint } = renderHost({ canVaultEdit: true, editorEnabled: true });

    await waitFor(() => {
      expect(
        screen.getByTestId("vault-document-host").getAttribute("data-open-mode"),
      ).toBe("edit");
    });
    expect(
      screen.getByTestId("vault-document-host").getAttribute("data-editing"),
    ).toBe("true");
    // No dual-mode chrome.
    expect(screen.queryByTestId("vault-edit-button")).toBeNull();
    expect(screen.queryByTestId("vault-exit-edit")).toBeNull();
    expect(screen.queryByTestId("vault-document-toolbar")).toBeNull();
    expect(screen.queryByTestId("vault-edit-mode-label")).toBeNull();
    expect(screen.queryByText(/Editing in Office/i)).toBeNull();

    await waitFor(() => {
      expect(screen.getByTestId("onlyoffice-editor-host")).toBeTruthy();
    });
    expect(mint).toHaveBeenCalled();
    const mintArg = mint.mock.calls[0]?.[0] as { mode?: string; path?: string };
    expect(mintArg?.mode).toBe("edit");
    expect(mintArg?.path).toBe("/Projects/A/Proposal.docx");
  });

  it("auto-mounts OnlyOffice for xlsx and pptx without Edit chrome", async () => {
    for (const content of [XLSX_CONTENT, PPTX_CONTENT]) {
      cleanup();
      const mint = vi.fn().mockResolvedValue({
        ...MINT_EDIT,
        path: content.path,
        file_type: content.path.endsWith(".xlsx") ? "xlsx" : "pptx",
      });
      renderHost({ content, mint });

      await waitFor(() => {
        expect(
          screen
            .getByTestId("vault-document-host")
            .getAttribute("data-open-mode"),
        ).toBe("edit");
      });
      await waitFor(() => {
        expect(screen.getByTestId("onlyoffice-editor-host")).toBeTruthy();
      });
      expect(screen.queryByTestId("vault-edit-button")).toBeNull();
      expect(screen.queryByTestId("vault-exit-edit")).toBeNull();
      expect(mint).toHaveBeenCalled();
    }
  });

  it("stays on client preview when feature flag is off (no dead Edit)", () => {
    renderHost({ canVaultEdit: true, editorEnabled: false });
    expect(
      screen.getByTestId("vault-document-host").getAttribute("data-open-mode"),
    ).toBe("preview");
    expect(screen.queryByTestId("onlyoffice-editor-host")).toBeNull();
    expect(screen.queryByTestId("vault-edit-button")).toBeNull();
    expect(screen.queryByTestId("vault-document-toolbar")).toBeNull();
    expect(screen.getByText("Proposal.docx")).toBeTruthy();
  });

  it("stays on client preview for view-only user (canVaultEdit=false)", () => {
    renderHost({ canVaultEdit: false, editorEnabled: true });
    expect(
      screen.getByTestId("vault-document-host").getAttribute("data-open-mode"),
    ).toBe("preview");
    expect(screen.queryByTestId("vault-edit-button")).toBeNull();
    expect(screen.getByText("Proposal.docx")).toBeTruthy();
  });

  it("stays on client preview while capability unknown (null)", () => {
    renderHost({ canVaultEdit: null, editorEnabled: true });
    expect(
      screen.getByTestId("vault-document-host").getAttribute("data-open-mode"),
    ).toBe("preview");
    expect(screen.queryByTestId("vault-edit-button")).toBeNull();
  });

  it("stays on client preview for non-office files", () => {
    renderHost({
      content: MD_CONTENT,
      canVaultEdit: true,
      editorEnabled: true,
    });
    expect(
      screen.getByTestId("vault-document-host").getAttribute("data-open-mode"),
    ).toBe("preview");
    expect(screen.queryByTestId("vault-edit-button")).toBeNull();
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("does not auto-enter while loading or on error", () => {
    const { unmount } = renderHost({ isLoading: true });
    expect(
      screen.getByTestId("vault-document-host").getAttribute("data-open-mode"),
    ).toBe("preview");
    expect(screen.queryByTestId("vault-edit-button")).toBeNull();
    unmount();
    renderHost({ error: "Failed to open", content: null });
    expect(
      screen.getByTestId("vault-document-host").getAttribute("data-open-mode"),
    ).toBe("preview");
    expect(screen.queryByTestId("vault-edit-button")).toBeNull();
  });

  it("auto-mounts OnlyOffice when opening a different office file", async () => {
    const mint = vi.fn().mockImplementation(async (args: { path: string }) => ({
      ...MINT_EDIT,
      path: args.path,
    }));
    const { rerender } = render(
      <Providers>
        <VaultDocumentHost
          content={DOCX_CONTENT}
          isLoading={false}
          error={null}
          canVaultEdit={true}
          editorEnabled={true}
          documentServerUrl="https://ds.test"
          mint={mint as typeof import("../../api/office.js").mintOfficeSession}
          loadDocsApi={async () => mockDocsApi()}
        />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("onlyoffice-editor-host")).toBeTruthy();
    });

    rerender(
      <Providers>
        <VaultDocumentHost
          content={XLSX_CONTENT}
          isLoading={false}
          error={null}
          canVaultEdit={true}
          editorEnabled={true}
          documentServerUrl="https://ds.test"
          mint={mint as typeof import("../../api/office.js").mintOfficeSession}
          loadDocsApi={async () => mockDocsApi()}
        />
      </Providers>,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("vault-document-host").getAttribute("data-open-mode"),
      ).toBe("edit");
    });
    await waitFor(() => {
      expect(screen.getByTestId("onlyoffice-editor-host")).toBeTruthy();
    });
    const paths = mint.mock.calls.map(
      (c) => (c[0] as { path?: string }).path,
    );
    expect(paths).toContain("/Projects/A/Budget.xlsx");
    expect(screen.queryByTestId("vault-edit-button")).toBeNull();
    expect(screen.queryByTestId("vault-exit-edit")).toBeNull();
  });
});

describe("VaultDocumentHost OnlyOffice host chrome (no mode marketing)", () => {
  it("mints edit session without Edit/Back/mode-label chrome", async () => {
    const constructed: Record<string, unknown>[] = [];
    const { mint } = renderHost({
      loadDocsApi: async () =>
        mockDocsApi((cfg) => {
          constructed.push(cfg);
        }),
    });

    await waitFor(() => {
      expect(screen.getByTestId("onlyoffice-editor-host")).toBeTruthy();
    });

    expect(mint).toHaveBeenCalled();
    const mintArg = mint.mock.calls[0]?.[0] as { mode?: string; path?: string };
    expect(mintArg?.mode).toBe("edit");
    expect(mintArg?.path).toBe("/Projects/A/Proposal.docx");
    expect(screen.queryByTestId("vault-exit-edit")).toBeNull();
    expect(screen.queryByTestId("vault-edit-mode-label")).toBeNull();
    expect(screen.queryByText(/Editing in Office/i)).toBeNull();
    expect(
      screen.getByTestId("vault-document-host").getAttribute("data-editing"),
    ).toBe("true");
    expect(
      screen.getByTestId("vault-document-host").getAttribute("data-show-edit"),
    ).toBe("false");
  });

  it("shows dirty banner without claiming vault persistence", async () => {
    let stateChange:
      | ((e: { data?: boolean }) => void)
      | undefined;
    renderHost({
      loadDocsApi: async () => ({
        DocEditor: class {
          constructor(_id: string, config: Record<string, unknown>) {
            const events = config.events as {
              onAppReady?: () => void;
              onDocumentReady?: () => void;
              onDocumentStateChange?: (e: { data?: boolean }) => void;
            };
            stateChange = events.onDocumentStateChange;
            queueMicrotask(() => {
              events.onAppReady?.();
              events.onDocumentReady?.();
            });
          }
          destroyEditor(): void {}
        },
      }),
    });

    await waitFor(() => {
      expect(screen.getByTestId("onlyoffice-editor-host")).toBeTruthy();
    });

    expect(stateChange).toBeTypeOf("function");
    stateChange?.({ data: true });

    await waitFor(() => {
      expect(screen.getByTestId("vault-editor-dirty-banner")).toBeTruthy();
    });
    const dirty = screen.getByTestId("vault-editor-dirty-banner");
    expect(dirty.textContent).toMatch(/Unsaved local changes/i);
    expect(dirty.textContent).toMatch(/not yet a confirmed vault write/i);
    // Must not claim "Saved" while dirty.
    expect(dirty.textContent).not.toMatch(/Saved to vault/i);
    // Dirty banner is functional — still no mode marketing chrome.
    expect(screen.queryByText(/Editing in Office/i)).toBeNull();
  });

  it("surfaces editor load failure without Back to preview", async () => {
    renderHost({
      mint: vi
        .fn()
        .mockRejectedValue(
          new OfficeApiError("mint failed", 500, "upstream"),
        ),
    });

    await waitFor(() => {
      expect(screen.getByTestId("onlyoffice-editor-error")).toBeTruthy();
    });
    expect(
      screen
        .getByTestId("onlyoffice-editor-error")
        .getAttribute("data-error-code"),
    ).toMatch(/config_mint_failed|load_failure/);
    expect(
      screen.getByTestId("vault-document-host").getAttribute("data-open-mode"),
    ).toBe("edit");
    expect(screen.queryByRole("button", { name: "Back to preview" })).toBeNull();
    expect(screen.queryByTestId("vault-exit-edit")).toBeNull();
  });

  it("surfaces DocsAPI load failure", async () => {
    renderHost({
      loadDocsApi: async () => {
        throw new Error("api.js failed");
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("onlyoffice-editor-error")).toBeTruthy();
    });
    expect(
      screen
        .getByTestId("onlyoffice-editor-error")
        .getAttribute("data-error-code"),
    ).toBe("load_failure");
  });

  it("shows save-issue banner from host callback", async () => {
    let onWarning:
      | ((e: { data?: { warningCode?: number } }) => void)
      | undefined;
    renderHost({
      loadDocsApi: async () => ({
        DocEditor: class {
          constructor(_id: string, config: Record<string, unknown>) {
            const events = config.events as {
              onAppReady?: () => void;
              onDocumentReady?: () => void;
              onWarning?: (e: { data?: { warningCode?: number } }) => void;
            };
            onWarning = events.onWarning;
            queueMicrotask(() => {
              events.onAppReady?.();
              events.onDocumentReady?.();
            });
          }
          destroyEditor(): void {}
        },
      }),
    });

    await waitFor(() => {
      expect(screen.getByTestId("onlyoffice-editor-host")).toBeTruthy();
    });
    onWarning?.({ data: { warningCode: 1 } });
    await waitFor(() => {
      expect(screen.getByTestId("vault-editor-save-issue")).toBeTruthy();
    });
  });
});

describe("VaultDocumentHost zero content margin (lp-75r.2)", () => {
  it("OnlyOffice body is padding 0 and flush markers match chat editor intent", async () => {
    renderHost({ canVaultEdit: true, editorEnabled: true });

    await waitFor(() => {
      expect(screen.getByTestId("onlyoffice-editor-host")).toBeTruthy();
    });

    const body = screen.getByTestId("vault-document-body");
    expect(body.getAttribute("data-body-pad")).toBe("0");
    expect(body.style.padding).toMatch(/^0(px)?$/);
    expect(body.style.overflow).toBe("hidden");

    // Host is nested under the zero-pad body (no LayoutContent inset between).
    expect(body.contains(screen.getByTestId("onlyoffice-editor-host"))).toBe(
      true,
    );
  });

  it("markdown/preview body keeps internal padding", () => {
    renderHost({
      content: MD_CONTENT,
      canVaultEdit: true,
      editorEnabled: true,
    });

    const body = screen.getByTestId("vault-document-body");
    expect(body.getAttribute("data-body-pad")).toBe("preview");
    expect(body.style.padding).toContain("spacing-6");
    expect(screen.queryByTestId("onlyoffice-editor-host")).toBeNull();
  });

  it("save/dirty banners stay outside the editor body (strip above, not frame margin)", async () => {
    let onStateChange: ((e: { data?: boolean }) => void) | undefined;
    renderHost({
      loadDocsApi: async () => ({
        DocEditor: class {
          constructor(_id: string, config: Record<string, unknown>) {
            const events = config.events as {
              onAppReady?: () => void;
              onDocumentReady?: () => void;
              onDocumentStateChange?: (e: { data?: boolean }) => void;
            };
            onStateChange = events.onDocumentStateChange;
            queueMicrotask(() => {
              events.onAppReady?.();
              events.onDocumentReady?.();
            });
          }
          destroyEditor(): void {}
        },
      }),
    });

    await waitFor(() => {
      expect(screen.getByTestId("onlyoffice-editor-host")).toBeTruthy();
    });
    onStateChange?.({ data: true });

    await waitFor(() => {
      expect(screen.getByTestId("vault-editor-dirty-banner")).toBeTruthy();
    });

    const host = screen.getByTestId("vault-document-host");
    const body = screen.getByTestId("vault-document-body");
    const banner = screen.getByTestId("vault-editor-dirty-banner");
    // Banner is a sibling strip above the OO body, not inside the editor frame.
    expect(host.contains(banner)).toBe(true);
    expect(body.contains(banner)).toBe(false);
    expect(body.contains(screen.getByTestId("onlyoffice-editor-host"))).toBe(
      true,
    );
  });
});
