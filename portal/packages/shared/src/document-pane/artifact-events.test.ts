import { describe, expect, it } from "vitest";

import {
  looksLikeVaultPath,
  normalizeArtifactVaultPath,
  parseArtifactEventMetadata,
  promoteCitationToArtifactOpen,
  promoteToolProgressToArtifactEvent,
  type ArtifactEventWire,
} from "./artifact-events.js";

const BASE = {
  thread_id: "thread-1",
  artifact_id: "art-1",
  vault_path: "/Projects/Legal/memo.md",
  title: "memo.md",
  mime_type: "text/markdown",
  file_type: "md",
  producer: "agent" as const,
  timestamp: "2026-07-24T12:00:00.000Z",
};

describe("normalizeArtifactVaultPath", () => {
  it("normalizes leading slash and duplicate slashes", () => {
    expect(normalizeArtifactVaultPath("Projects/a.md")).toBe("/Projects/a.md");
    expect(normalizeArtifactVaultPath("//Projects//a.md")).toBe(
      "/Projects/a.md",
    );
  });

  it("rejects parent segments", () => {
    expect(normalizeArtifactVaultPath("/Projects/../secret")).toBeNull();
    expect(normalizeArtifactVaultPath("/Projects/./x")).toBeNull();
  });
});

describe("parseArtifactEventMetadata", () => {
  it("parses artifact.open", () => {
    const event = parseArtifactEventMetadata({
      portal_event: "artifact.open",
      ...BASE,
      status: "open",
      preview_mode: "markdown",
      preferred_mode: "preview",
    });
    expect(event).toMatchObject({
      portal_event: "artifact.open",
      vault_path: "/Projects/Legal/memo.md",
      status: "open",
      preview_mode: "markdown",
    });
  });

  it("parses artifact.progress with optional progress fields", () => {
    const event = parseArtifactEventMetadata({
      portal_event: "artifact.progress",
      ...BASE,
      status: "running",
      progress_label: "Writing draft",
      percent: 40,
      operation: "writing",
      tool_call_id: "tc-1",
      operation_id: "op-9",
    });
    expect(event).toEqual({
      portal_event: "artifact.progress",
      thread_id: "thread-1",
      artifact_id: "art-1",
      vault_path: "/Projects/Legal/memo.md",
      title: "memo.md",
      mime_type: "text/markdown",
      file_type: "md",
      producer: "agent",
      status: "running",
      timestamp: "2026-07-24T12:00:00.000Z",
      progress_label: "Writing draft",
      percent: 40,
      operation: "writing",
      tool_call_id: "tc-1",
      operation_id: "op-9",
    });
  });

  it("parses artifact.updated with required revision and diff stats", () => {
    const event = parseArtifactEventMetadata({
      portal_event: "artifact.updated",
      ...BASE,
      status: "ready",
      revision: {
        token: "etag-abc",
        kind: "etag",
        size_bytes: 2048,
      },
      write_kind: "checkpoint",
      source_path: "/Projects/Legal/memo.md",
      additions: 12,
      deletions: 3,
    });
    expect(event?.portal_event).toBe("artifact.updated");
    expect(event).toMatchObject({
      revision: { token: "etag-abc", kind: "etag", size_bytes: 2048 },
      write_kind: "checkpoint",
      additions: 12,
      deletions: 3,
    });
  });

  it("parses artifact.error", () => {
    const event = parseArtifactEventMetadata({
      portal_event: "artifact.error",
      ...BASE,
      status: "error",
      error_code: "human_edit_active",
      error_message: "Human edit session owns this path",
    });
    expect(event).toMatchObject({
      portal_event: "artifact.error",
      error_code: "human_edit_active",
    });
  });

  it("parses artifact.close", () => {
    const event = parseArtifactEventMetadata({
      portal_event: "artifact.close",
      ...BASE,
      status: "closed",
      close_reason: "user",
    });
    expect(event).toMatchObject({
      portal_event: "artifact.close",
      status: "closed",
      close_reason: "user",
    });
  });

  it("accepts file_type without mime_type", () => {
    const { mime_type: _omit, ...rest } = BASE;
    const event = parseArtifactEventMetadata({
      portal_event: "artifact.open",
      ...rest,
      status: "open",
    });
    expect(event?.file_type).toBe("md");
    expect(event?.mime_type).toBeUndefined();
  });

  it("accepts mime_type without file_type", () => {
    const { file_type: _omit, ...rest } = BASE;
    const event = parseArtifactEventMetadata({
      portal_event: "artifact.open",
      ...rest,
      status: "open",
    });
    expect(event?.mime_type).toBe("text/markdown");
  });

  it("reads thread_id from outer chat_id envelope", () => {
    const event = parseArtifactEventMetadata({
      chat_id: "thread-from-frame",
      metadata: {
        portal_event: "artifact.open",
        artifact_id: "art-1",
        vault_path: "/Projects/a.pdf",
        title: "a.pdf",
        mime_type: "application/pdf",
        producer: "gateway",
        status: "open",
        timestamp: "2026-07-24T12:00:00.000Z",
      },
    });
    expect(event?.thread_id).toBe("thread-from-frame");
    expect(event?.vault_path).toBe("/Projects/a.pdf");
  });

  it("uses options.thread_id fallback", () => {
    const event = parseArtifactEventMetadata(
      {
        portal_event: "artifact.open",
        artifact_id: "art-1",
        vault_path: "/Projects/a.md",
        title: "a.md",
        file_type: "md",
        producer: "user",
        status: "open",
        timestamp: "2026-07-24T12:00:00.000Z",
      },
      { thread_id: "opt-thread" },
    );
    expect(event?.thread_id).toBe("opt-thread");
  });

  it("covers all five variants as a closed union", () => {
    const kinds = [
      "artifact.open",
      "artifact.progress",
      "artifact.updated",
      "artifact.error",
      "artifact.close",
    ] as const;
    const statusByKind = {
      "artifact.open": "open",
      "artifact.progress": "running",
      "artifact.updated": "ready",
      "artifact.error": "error",
      "artifact.close": "closed",
    } as const;

    for (const kind of kinds) {
      const meta: Record<string, unknown> = {
        portal_event: kind,
        ...BASE,
        status: statusByKind[kind],
      };
      if (kind === "artifact.updated") {
        meta.revision = { token: "r1", kind: "content_hash" };
      }
      if (kind === "artifact.error") {
        meta.error_code = "unknown";
        meta.error_message = "x";
      }
      const event = parseArtifactEventMetadata(meta);
      expect(event, kind).not.toBeNull();
      expect((event as ArtifactEventWire).portal_event).toBe(kind);
    }
  });

  // --- rejections ---

  it("returns null for non-artifact portal_event", () => {
    expect(
      parseArtifactEventMetadata({
        portal_event: "tool_progress",
        ...BASE,
        status: "open",
      }),
    ).toBeNull();
    expect(parseArtifactEventMetadata({ portal_event: "mcq" })).toBeNull();
    expect(parseArtifactEventMetadata(null)).toBeNull();
    expect(parseArtifactEventMetadata("artifact.open")).toBeNull();
  });

  it("rejects missing required fields", () => {
    expect(
      parseArtifactEventMetadata({
        portal_event: "artifact.open",
        // no thread_id
        artifact_id: "a",
        vault_path: "/x.md",
        title: "x",
        file_type: "md",
        producer: "agent",
        status: "open",
        timestamp: "2026-07-24T12:00:00.000Z",
      }),
    ).toBeNull();

    expect(
      parseArtifactEventMetadata({
        portal_event: "artifact.open",
        thread_id: "t",
        artifact_id: "a",
        vault_path: "/x.md",
        title: "x",
        // no mime or file type
        producer: "agent",
        status: "open",
        timestamp: "2026-07-24T12:00:00.000Z",
      }),
    ).toBeNull();

    expect(
      parseArtifactEventMetadata({
        portal_event: "artifact.open",
        thread_id: "t",
        artifact_id: "a",
        vault_path: "/x.md",
        title: "x",
        file_type: "md",
        producer: "agent",
        status: "open",
        // no timestamp
      }),
    ).toBeNull();
  });

  it("rejects artifact.updated without revision", () => {
    expect(
      parseArtifactEventMetadata({
        portal_event: "artifact.updated",
        ...BASE,
        status: "ready",
      }),
    ).toBeNull();
  });

  it("rejects malformed revision", () => {
    expect(
      parseArtifactEventMetadata({
        portal_event: "artifact.updated",
        ...BASE,
        status: "ready",
        revision: { token: "x", kind: "not-a-kind" },
      }),
    ).toBeNull();
    expect(
      parseArtifactEventMetadata({
        portal_event: "artifact.updated",
        ...BASE,
        status: "ready",
        revision: { kind: "etag" },
      }),
    ).toBeNull();
  });

  it("rejects status that does not match the variant", () => {
    expect(
      parseArtifactEventMetadata({
        portal_event: "artifact.open",
        ...BASE,
        status: "closed",
      }),
    ).toBeNull();
    expect(
      parseArtifactEventMetadata({
        portal_event: "artifact.error",
        ...BASE,
        status: "ready",
        error_code: "unknown",
        error_message: "x",
      }),
    ).toBeNull();
  });

  it("rejects path traversal vault_path", () => {
    expect(
      parseArtifactEventMetadata({
        portal_event: "artifact.open",
        ...BASE,
        vault_path: "/Projects/../../etc/passwd",
        status: "open",
      }),
    ).toBeNull();
  });

  it("rejects out-of-range percent and negative diffs", () => {
    expect(
      parseArtifactEventMetadata({
        portal_event: "artifact.progress",
        ...BASE,
        status: "running",
        percent: 150,
      }),
    ).toBeNull();
    expect(
      parseArtifactEventMetadata({
        portal_event: "artifact.progress",
        ...BASE,
        status: "running",
        additions: -1,
      }),
    ).toBeNull();
  });

  it("rejects unknown producer, preview_mode, error_code", () => {
    expect(
      parseArtifactEventMetadata({
        portal_event: "artifact.open",
        ...BASE,
        status: "open",
        producer: "hacker",
      }),
    ).toBeNull();
    expect(
      parseArtifactEventMetadata({
        portal_event: "artifact.open",
        ...BASE,
        status: "open",
        preview_mode: "flash",
      }),
    ).toBeNull();
    expect(
      parseArtifactEventMetadata({
        portal_event: "artifact.error",
        ...BASE,
        status: "error",
        error_code: "boom",
        error_message: "x",
      }),
    ).toBeNull();
  });

  it("rejects artifact.error without error_code/message", () => {
    expect(
      parseArtifactEventMetadata({
        portal_event: "artifact.error",
        ...BASE,
        status: "error",
        error_code: "unknown",
      }),
    ).toBeNull();
  });
});

describe("looksLikeVaultPath", () => {
  it("accepts vault-looking paths", () => {
    expect(looksLikeVaultPath("/Projects/Legal/memo.md")).toBe(true);
    expect(looksLikeVaultPath("notes.md")).toBe(true);
    expect(looksLikeVaultPath("/.lanyard/checkpoints/x.docx")).toBe(true);
  });

  it("rejects shell commands and traversal", () => {
    expect(looksLikeVaultPath("yarn test")).toBe(false);
    expect(looksLikeVaultPath("ls | grep foo")).toBe(false);
    expect(looksLikeVaultPath("/Projects/../etc/passwd")).toBe(false);
  });
});

describe("promoteToolProgressToArtifactEvent", () => {
  it("promotes running file tool to artifact.progress", () => {
    const event = promoteToolProgressToArtifactEvent({
      thread_id: "thread-1",
      tool_name: "write_file",
      tool_status: "running",
      tool_target: "/Projects/notes.md",
      tool_call_id: "tc-w1",
      timestamp: "2026-07-24T12:00:00.000Z",
    });
    expect(event).toMatchObject({
      portal_event: "artifact.progress",
      status: "running",
      vault_path: "/Projects/notes.md",
      artifact_id: "tool:tc-w1",
      tool_call_id: "tc-w1",
      file_type: "md",
      producer: "agent",
    });
  });

  it("promotes complete file tool to artifact.open without claiming revision", () => {
    const event = promoteToolProgressToArtifactEvent({
      thread_id: "thread-1",
      tool_name: "edit",
      tool_status: "complete",
      tool_target: "/Projects/a.md",
      tool_call_id: "tc-e1",
      additions: 5,
      deletions: 2,
      timestamp: "2026-07-24T12:00:00.000Z",
    });
    expect(event?.portal_event).toBe("artifact.open");
    expect(event && "revision" in event ? event.revision : undefined).toBe(
      undefined,
    );
    expect(event).toMatchObject({ additions: 5, deletions: 2 });
  });

  it("promotes tool error to artifact.error", () => {
    const event = promoteToolProgressToArtifactEvent({
      thread_id: "thread-1",
      tool_name: "read_file",
      tool_status: "error",
      tool_target: "/Projects/missing.md",
      error_message: "not found",
      timestamp: "2026-07-24T12:00:00.000Z",
    });
    expect(event).toMatchObject({
      portal_event: "artifact.error",
      error_code: "upstream",
      error_message: "not found",
    });
  });

  it("does not promote non-file tools or shell targets", () => {
    expect(
      promoteToolProgressToArtifactEvent({
        thread_id: "thread-1",
        tool_name: "bash",
        tool_status: "running",
        tool_target: "yarn test",
      }),
    ).toBeNull();
    expect(
      promoteToolProgressToArtifactEvent({
        thread_id: "thread-1",
        tool_name: "web_search",
        tool_status: "running",
        tool_target: "/Projects/a.md",
      }),
    ).toBeNull();
  });

  it("lp-oop.38.9: harness read + completed promotes to artifact.open", () => {
    const event = promoteToolProgressToArtifactEvent({
      thread_id: "thr_1",
      tool_name: "read",
      tool_status: "completed",
      tool_target: "/Notes/memo.md",
      tool_call_id: "call_read",
      timestamp: "2026-08-20T00:00:00.000Z",
    });
    expect(event).toMatchObject({
      portal_event: "artifact.open",
      status: "open",
      vault_path: "/Notes/memo.md",
      title: "memo.md",
      file_type: "md",
      mime_type: "text/markdown",
      artifact_id: "tool:call_read",
    });
  });

  it("lp-oop.38.9: harness read of office path is file_type docx", () => {
    const event = promoteToolProgressToArtifactEvent({
      thread_id: "thr_1",
      tool_name: "read",
      tool_status: "completed",
      tool_target: "/Projects/Workspace/office/brief.docx",
      tool_call_id: "call_office",
      timestamp: "2026-08-20T00:00:00.000Z",
    });
    expect(event).toMatchObject({
      portal_event: "artifact.open",
      vault_path: "/Projects/Workspace/office/brief.docx",
      file_type: "docx",
      mime_type:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  });
});

describe("promoteCitationToArtifactOpen", () => {
  it("promotes citation path to artifact.open", () => {
    const event = promoteCitationToArtifactOpen({
      thread_id: "thread-1",
      path: "/Projects/Legal/memo.md",
      title: "Legal memo",
      timestamp: "2026-07-24T12:00:00.000Z",
    });
    expect(event).toMatchObject({
      portal_event: "artifact.open",
      status: "open",
      title: "Legal memo",
      vault_path: "/Projects/Legal/memo.md",
      artifact_id: "citation:/Projects/Legal/memo.md",
      preferred_mode: "preview",
      mime_type: "text/markdown",
    });
  });

  it("lp-oop.38.9: harness citation of an office file is preview-first docx", () => {
    const event = promoteCitationToArtifactOpen({
      thread_id: "thr_1",
      path: "/Projects/Workspace/office/brief.docx",
      title: "brief.docx",
      timestamp: "2026-08-20T00:00:00.000Z",
    });
    expect(event).toMatchObject({
      portal_event: "artifact.open",
      preferred_mode: "preview",
      vault_path: "/Projects/Workspace/office/brief.docx",
      file_type: "docx",
      mime_type:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  });

  it("rejects empty or traversal paths", () => {
    expect(
      promoteCitationToArtifactOpen({
        thread_id: "thread-1",
        path: "",
      }),
    ).toBeNull();
    expect(
      promoteCitationToArtifactOpen({
        thread_id: "thread-1",
        path: "/Projects/../x.md",
      }),
    ).toBeNull();
  });

  it("promoted events re-parse as valid wire events", () => {
    const promoted = promoteCitationToArtifactOpen({
      thread_id: "thread-1",
      path: "/Projects/deck.pptx",
      timestamp: "2026-07-24T12:00:00.000Z",
    });
    expect(promoted).not.toBeNull();
    const reparsed = parseArtifactEventMetadata(promoted);
    expect(reparsed).toEqual(promoted);
  });
});
