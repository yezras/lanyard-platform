import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mintOfficeSession,
  OfficeApiError,
  toOfficeEditorSessionConfig,
} from "./office.js";

const mintBody = {
  session_id: "s1",
  document_key: "dk1",
  base_revision: { token: "t1", kind: "etag" },
  mode: "view" as const,
  file_type: "docx",
  path: "/Projects/A/Proposal.docx",
  expires_at: "2099-01-01T00:00:00.000Z",
  editor_config: {
    documentType: "word" as const,
    document: {
      fileType: "docx",
      key: "dk1",
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
      mode: "view" as const,
      callbackUrl: "https://bff/callback",
      user: { id: "u1", name: "Ada" },
      lang: "en",
    },
    token: "jwt",
  },
  idempotent_replay: false,
};

vi.mock("./client.js", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "./client.js";

const mockedFetch = vi.mocked(apiFetch);

afterEach(() => {
  vi.clearAllMocks();
});

describe("mintOfficeSession", () => {
  it("posts path/mode and returns editor_config", async () => {
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify(mintBody), { status: 201 }),
    );

    const result = await mintOfficeSession({
      path: "/Projects/A/Proposal.docx",
      mode: "view",
    });

    expect(mockedFetch).toHaveBeenCalledWith(
      "/api/office/sessions",
      expect.objectContaining({ method: "POST" }),
    );
    const init = mockedFetch.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      path: "/Projects/A/Proposal.docx",
      mode: "view",
    });
    expect(result.session_id).toBe("s1");
    expect(result.editor_config.token).toBe("jwt");
  });

  it("throws OfficeApiError on failure", async () => {
    mockedFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "Unsupported file type",
          reason: "unsupported_file_type",
        }),
        { status: 400 },
      ),
    );

    await expect(
      mintOfficeSession({ path: "/a.md", mode: "view" }),
    ).rejects.toBeInstanceOf(OfficeApiError);
  });
});

describe("toOfficeEditorSessionConfig", () => {
  it("maps mint response and document server url", () => {
    const cfg = toOfficeEditorSessionConfig(mintBody, "http://127.0.0.1:8080/");
    expect(cfg.sessionId).toBe("s1");
    expect(cfg.documentServerUrl).toBe("http://127.0.0.1:8080");
    expect(cfg.editorConfig.documentType).toBe("word");
  });
});
