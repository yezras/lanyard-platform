/**
 * Unit tests for ONLYOFFICE editor host (lp-5q6.27).
 * Mocks DocsAPI.DocEditor — no live Document Server or BFF.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../../app/providers.js";

import { OnlyOfficeEditorHost } from "./OnlyOfficeEditorHost.js";
import { officeEditorError } from "./onlyOfficeEditorErrors.js";
import { officeEditorMetrics } from "./onlyOfficeEditorMetrics.js";
import type {
  DocsApiGlobal,
  OfficeEditorSessionConfig,
} from "./onlyOfficeTypes.js";

const FIXTURE_SESSION: OfficeEditorSessionConfig = {
  sessionId: "sess-1",
  documentKey: "dk-1",
  mode: "view",
  fileType: "docx",
  path: "/Projects/A/Proposal.docx",
  expiresAt: "2099-01-01T00:00:00.000Z",
  baseRevision: { token: "r1", kind: "etag" },
  documentServerUrl: "https://ds.test",
  editorConfig: {
    documentType: "word",
    document: {
      fileType: "docx",
      key: "dk-1",
      title: "Proposal.docx",
      url: "https://bff/content",
      permissions: {
        edit: false,
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
      mode: "view",
      callbackUrl: "https://bff/callback",
      user: { id: "u1", name: "Ada" },
      lang: "en",
    },
    token: "jwt.token.here",
  },
};

function mockDocsApi(onConstruct?: (id: string, cfg: Record<string, unknown>) => void): DocsApiGlobal {
  return {
    DocEditor: class {
      constructor(placeholderId: string, config: Record<string, unknown>) {
        onConstruct?.(placeholderId, config);
        const el = document.getElementById(placeholderId);
        if (el) {
          const surface = document.createElement("div");
          surface.setAttribute("data-testid", "mock-docs-surface");
          surface.textContent = "Mock DocsAPI surface";
          el.appendChild(surface);
        }
        const events = config.events as
          | { onAppReady?: () => void; onDocumentReady?: () => void }
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

afterEach(() => {
  cleanup();
  officeEditorMetrics.reset();
});

beforeEach(() => {
  officeEditorMetrics.reset();
});

describe("OnlyOfficeEditorHost", () => {
  it("mounts DocsAPI with typed session config and lifecycle callbacks", async () => {
    const constructed: Array<{ id: string; cfg: Record<string, unknown> }> = [];
    const onReady = vi.fn();
    const onDocumentReady = vi.fn();
    const api = mockDocsApi((id, cfg) => constructed.push({ id, cfg }));

    render(
      <Providers>
        <OnlyOfficeEditorHost
          session={FIXTURE_SESSION}
          loadDocsApi={async () => api}
          onReady={onReady}
          onDocumentReady={onDocumentReady}
        />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("onlyoffice-editor-host")).toBeTruthy();
      expect(screen.getByTestId("mock-docs-surface")).toBeTruthy();
    });

    expect(constructed).toHaveLength(1);
    expect(constructed[0]!.cfg.documentType).toBe("word");
    expect(constructed[0]!.cfg.token).toBe("jwt.token.here");
    expect(
      (constructed[0]!.cfg.document as { key: string }).key,
    ).toBe("dk-1");

    await waitFor(() => {
      expect(onReady).toHaveBeenCalled();
      expect(onDocumentReady).toHaveBeenCalled();
    });

    expect(officeEditorMetrics.snapshot().editor_load_total).toBe(1);
    expect(officeEditorMetrics.snapshot().editor_load_by_outcome.success).toBe(
      1,
    );
  });

  it("shows load_failure when DocsAPI loader rejects", async () => {
    const onError = vi.fn();
    render(
      <Providers>
        <OnlyOfficeEditorHost
          session={FIXTURE_SESSION}
          loadDocsApi={async () => {
            throw new Error("network down");
          }}
          onError={onError}
        />
      </Providers>,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("onlyoffice-editor-error").getAttribute(
          "data-error-code",
        ),
      ).toBe("load_failure");
    });
    expect(onError).toHaveBeenCalled();
    expect(
      screen.getByText(/Could not load the Office editor/i),
    ).toBeTruthy();
  });

  it("shows unsupported_file error state", () => {
    render(
      <Providers>
        <OnlyOfficeEditorHost
          session={null}
          error={officeEditorError("unsupported_file")}
        />
      </Providers>,
    );
    expect(
      screen.getByTestId("onlyoffice-editor-error").getAttribute(
        "data-error-code",
      ),
    ).toBe("unsupported_file");
    expect(screen.getByText(/not supported/i)).toBeTruthy();
  });

  it("shows no_edit_permission when mode is edit but permissions.edit is false", async () => {
    const session: OfficeEditorSessionConfig = {
      ...FIXTURE_SESSION,
      mode: "edit",
      editorConfig: {
        ...FIXTURE_SESSION.editorConfig,
        document: {
          ...FIXTURE_SESSION.editorConfig.document,
          permissions: {
            ...FIXTURE_SESSION.editorConfig.document.permissions,
            edit: false,
          },
        },
        editorConfig: {
          ...FIXTURE_SESSION.editorConfig.editorConfig,
          mode: "view",
        },
      },
    };

    render(
      <Providers>
        <OnlyOfficeEditorHost
          session={session}
          loadDocsApi={async () => mockDocsApi()}
        />
      </Providers>,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("onlyoffice-editor-error").getAttribute(
          "data-error-code",
        ),
      ).toBe("no_edit_permission");
    });
  });

  it("reports callback_save_issue via onSaveIssue on DocsAPI warning", async () => {
    const onSaveIssue = vi.fn();
    const api: DocsApiGlobal = {
      DocEditor: class {
        constructor(
          _id: string,
          config: Record<string, unknown>,
        ) {
          const events = config.events as {
            onWarning?: (e: { data?: { warningCode?: number } }) => void;
          };
          queueMicrotask(() => {
            events.onWarning?.({ data: { warningCode: 1 } });
          });
        }
        destroyEditor(): void {}
      },
    };

    render(
      <Providers>
        <OnlyOfficeEditorHost
          session={FIXTURE_SESSION}
          loadDocsApi={async () => api}
          onSaveIssue={onSaveIssue}
        />
      </Providers>,
    );

    await waitFor(() => {
      expect(onSaveIssue).toHaveBeenCalled();
    });
    expect(onSaveIssue.mock.calls[0]![0].code).toBe("callback_save_issue");
  });

  it("shows config_missing when session is null and not loading", async () => {
    render(
      <Providers>
        <OnlyOfficeEditorHost session={null} isLoading={false} />
      </Providers>,
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("onlyoffice-editor-error").getAttribute(
          "data-error-code",
        ),
      ).toBe("config_missing");
    });
  });
});
