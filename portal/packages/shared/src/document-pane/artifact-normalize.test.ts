import { describe, expect, it } from "vitest";

import {
  chatEventMayCarryArtifactMetadata,
  collectArtifactEventsFromHistory,
  normalizeArtifactEventsFromChatEvent,
  resolveArtifactVaultPath,
  type ChatEventLike,
} from "./artifact-normalize.js";
import { parseArtifactEventMetadata } from "./artifact-events.js";

const TS = "2026-07-24T12:00:00.000Z";
const PROJECT = "/Projects/Legal";

describe("resolveArtifactVaultPath", () => {
  it("joins relative paths with project vault root", () => {
    expect(resolveArtifactVaultPath("notes/memo.md", PROJECT)).toBe(
      "/Projects/Legal/notes/memo.md",
    );
    expect(resolveArtifactVaultPath("./draft.md", PROJECT)).toBe(
      "/Projects/Legal/draft.md",
    );
  });

  it("keeps absolute paths under project root", () => {
    expect(
      resolveArtifactVaultPath("/Projects/Legal/memo.md", PROJECT),
    ).toBe("/Projects/Legal/memo.md");
  });

  it("remaps /Projects/<seg>/rest into project root", () => {
    expect(
      resolveArtifactVaultPath("/Projects/Other/exhibits/a.md", PROJECT),
    ).toBe("/Projects/Legal/exhibits/a.md");
  });

  it("joins single-segment absolute under project", () => {
    expect(resolveArtifactVaultPath("/README.md", PROJECT)).toBe(
      "/Projects/Legal/README.md",
    );
  });

  it("normalizes without project root", () => {
    expect(resolveArtifactVaultPath("notes.md", null)).toBe("/notes.md");
    expect(resolveArtifactVaultPath("/Projects/A/a.md")).toBe(
      "/Projects/A/a.md",
    );
  });

  it("rejects traversal and empty", () => {
    expect(resolveArtifactVaultPath("../secret", PROJECT)).toBeNull();
    expect(resolveArtifactVaultPath("/Projects/../etc/passwd")).toBeNull();
    expect(resolveArtifactVaultPath("", PROJECT)).toBeNull();
    expect(resolveArtifactVaultPath("   ")).toBeNull();
  });

  // lp-vnz.3 — host absolute → vault-relative under Clients
  it("projects host absolute Clients paths to vault-relative", () => {
    const clients = "/home/operator/Lanyard/Clients";
    expect(
      resolveArtifactVaultPath(
        "/home/operator/Lanyard/Clients/Active/Acme/AGENTS.md",
        clients,
      ),
    ).toBe("/Clients/Active/Acme/AGENTS.md");
    expect(
      resolveArtifactVaultPath("/home/operator/Lanyard/AGENTS.md", clients),
    ).toBe("/AGENTS.md");
    expect(
      resolveArtifactVaultPath("Active/X/Note.docx", clients),
    ).toBe("/Clients/Active/X/Note.docx");
    expect(
      resolveArtifactVaultPath(
        "/opt/company-brain/Projects/Legal/memo.md",
        null,
      ),
    ).toBe("/Projects/Legal/memo.md");
  });

  it("preserves multi-root host paths without vault top-level", () => {
    expect(
      resolveArtifactVaultPath("/home/u/Core/README.md", "/home/u/Core"),
    ).toBe("/home/u/Core/README.md");
  });
});

describe("normalizeArtifactEventsFromChatEvent — explicit", () => {
  it("parses explicit artifact.open from message_send metadata", () => {
    const event: ChatEventLike = {
      type: "message_send",
      chat_id: "thread-1",
      content: "",
      created_at: TS,
      metadata: {
        portal_event: "artifact.open",
        thread_id: "thread-1",
        artifact_id: "art-1",
        vault_path: "/Projects/Legal/memo.md",
        title: "memo.md",
        mime_type: "text/markdown",
        file_type: "md",
        producer: "agent",
        status: "open",
        timestamp: TS,
        preferred_mode: "preview",
      },
    };

    const result = normalizeArtifactEventsFromChatEvent(event);
    expect(result.sources).toEqual(["explicit"]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      portal_event: "artifact.open",
      vault_path: "/Projects/Legal/memo.md",
      artifact_id: "art-1",
      status: "open",
    });
  });

  it("resolves relative vault_path on explicit events with project root", () => {
    const event: ChatEventLike = {
      type: "message_send",
      chat_id: "thread-1",
      metadata: {
        portal_event: "artifact.progress",
        artifact_id: "op-1",
        vault_path: "notes/draft.md",
        title: "draft.md",
        file_type: "md",
        producer: "agent",
        status: "running",
        timestamp: TS,
        percent: 30,
      },
    };

    const result = normalizeArtifactEventsFromChatEvent(event, {
      project_vault_path: PROJECT,
    });
    expect(result.sources).toEqual(["explicit"]);
    expect(result.events[0]?.vault_path).toBe(
      "/Projects/Legal/notes/draft.md",
    );
  });

  it("returns empty for malformed explicit artifact.* (no fallback promote)", () => {
    const event: ChatEventLike = {
      type: "message_send",
      chat_id: "thread-1",
      metadata: {
        portal_event: "artifact.open",
        // missing required fields
        vault_path: "/Projects/a.md",
      },
      citations: [{ path: "/Projects/a.md", title: "a" }],
    };
    const result = normalizeArtifactEventsFromChatEvent(event);
    expect(result.events).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  it("parses all five explicit variants", () => {
    const kinds = [
      ["artifact.open", "open"],
      ["artifact.progress", "running"],
      ["artifact.updated", "ready"],
      ["artifact.error", "error"],
      ["artifact.close", "closed"],
    ] as const;

    for (const [kind, status] of kinds) {
      const metadata: Record<string, unknown> = {
        portal_event: kind,
        thread_id: "t",
        artifact_id: "a",
        vault_path: "/Projects/x.md",
        title: "x.md",
        file_type: "md",
        producer: "agent",
        status,
        timestamp: TS,
      };
      if (kind === "artifact.updated") {
        metadata.revision = { token: "r1", kind: "etag" };
      }
      if (kind === "artifact.error") {
        metadata.error_code = "unknown";
        metadata.error_message = "fail";
      }
      const result = normalizeArtifactEventsFromChatEvent({
        type: "message_send",
        chat_id: "t",
        metadata,
      });
      expect(result.events[0]?.portal_event, kind).toBe(kind);
    }
  });
});

describe("normalizeArtifactEventsFromChatEvent — citation fallback", () => {
  it("promotes metadata.citations to artifact.open", () => {
    const event: ChatEventLike = {
      type: "message_send",
      chat_id: "thread-1",
      content: "See [1]",
      created_at: TS,
      metadata: {
        citations: [
          { path: "/Projects/Legal/memo.md", title: "Legal memo" },
          { path: "exhibits/checklist.md", title: "Checklist" },
        ],
      },
    };

    const result = normalizeArtifactEventsFromChatEvent(event, {
      project_vault_path: PROJECT,
    });
    expect(result.sources).toEqual(["citation", "citation"]);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      portal_event: "artifact.open",
      vault_path: "/Projects/Legal/memo.md",
      title: "Legal memo",
      preferred_mode: "preview",
    });
    expect(result.events[1]?.vault_path).toBe(
      "/Projects/Legal/exhibits/checklist.md",
    );
  });

  it("promotes top-level event.citations", () => {
    const event: ChatEventLike = {
      type: "message_send",
      chat_id: "thread-1",
      citations: [{ path: "/Projects/A/README.md", title: "Readme" }],
      created_at: TS,
    };
    const result = normalizeArtifactEventsFromChatEvent(event);
    expect(result.sources).toEqual(["citation"]);
    expect(result.events[0]?.artifact_id).toBe(
      "citation:/Projects/A/README.md",
    );
  });

  it("promotes portal_event citation", () => {
    const event: ChatEventLike = {
      type: "message_send",
      chat_id: "thread-1",
      metadata: {
        portal_event: "citation",
        path: "memo.md",
        title: "Memo",
      },
      created_at: TS,
    };
    const result = normalizeArtifactEventsFromChatEvent(event, {
      project_vault_path: PROJECT,
    });
    expect(result.events[0]).toMatchObject({
      portal_event: "artifact.open",
      vault_path: "/Projects/Legal/memo.md",
      title: "Memo",
    });
  });
});

describe("normalizeArtifactEventsFromChatEvent — tool_target fallback", () => {
  it("promotes structured tool_progress file tool to artifact.progress", () => {
    const event: ChatEventLike = {
      type: "tool_progress",
      chat_id: "thread-1",
      tool_name: "write_file",
      tool_status: "running",
      tool_target: "/Projects/Legal/memo.md",
      tool_call_id: "tc-1",
      created_at: TS,
      metadata: { portal_event: "tool_progress" },
    };

    const result = normalizeArtifactEventsFromChatEvent(event);
    expect(result.sources).toEqual(["tool_progress"]);
    expect(result.events[0]).toMatchObject({
      portal_event: "artifact.progress",
      status: "running",
      vault_path: "/Projects/Legal/memo.md",
      artifact_id: "tool:tc-1",
      tool_call_id: "tc-1",
    });
  });

  it("resolves relative tool_target against project root", () => {
    const event: ChatEventLike = {
      type: "tool_progress",
      chat_id: "thread-1",
      tool_name: "edit",
      tool_status: "complete",
      tool_target: "notes/a.md",
      tool_call_id: "tc-e",
      additions: 3,
      deletions: 1,
      created_at: TS,
    };

    const result = normalizeArtifactEventsFromChatEvent(event, {
      project_vault_path: PROJECT,
    });
    // complete without revision → artifact.open (legacy bridge)
    expect(result.events[0]).toMatchObject({
      portal_event: "artifact.open",
      vault_path: "/Projects/Legal/notes/a.md",
      additions: 3,
      deletions: 1,
    });
  });

  it("promotes tool_target from metadata when top-level fields missing", () => {
    const event: ChatEventLike = {
      type: "tool_progress",
      chat_id: "thread-1",
      created_at: TS,
      metadata: {
        portal_event: "tool_progress",
        tool_name: "read_file",
        tool_status: "running",
        tool_target: "src/foo.ts",
        tool_call_id: "tc-r",
      },
    };

    const result = normalizeArtifactEventsFromChatEvent(event, {
      project_vault_path: "/home/u/Core",
    });
    expect(result.events[0]?.vault_path).toBe("/home/u/Core/src/foo.ts");
    expect(result.events[0]?.portal_event).toBe("artifact.progress");
  });

  it("does not promote bash / non-file tools", () => {
    const event: ChatEventLike = {
      type: "tool_progress",
      chat_id: "thread-1",
      tool_name: "bash",
      tool_status: "running",
      tool_target: "yarn test",
      created_at: TS,
    };
    expect(normalizeArtifactEventsFromChatEvent(event).events).toEqual([]);
  });

  it("does not promote MCQ or plain message without citations/tools", () => {
    expect(
      normalizeArtifactEventsFromChatEvent({
        type: "mcq",
        chat_id: "thread-1",
        metadata: { portal_event: "mcq", mcq_id: "q1" },
      }).events,
    ).toEqual([]);
    expect(
      normalizeArtifactEventsFromChatEvent({
        type: "message_send",
        chat_id: "thread-1",
        content: "hello",
      }).events,
    ).toEqual([]);
  });
});

describe("normalizeArtifactEventsFromChatEvent — invalid input", () => {
  it("returns empty for nullish / non-objects / typing / user_message", () => {
    expect(
      normalizeArtifactEventsFromChatEvent(null as unknown as ChatEventLike)
        .events,
    ).toEqual([]);
    expect(
      normalizeArtifactEventsFromChatEvent({
        type: "typing",
        chat_id: "t",
      }).events,
    ).toEqual([]);
    expect(
      normalizeArtifactEventsFromChatEvent({
        type: "user_message",
        chat_id: "t",
      }).events,
    ).toEqual([]);
  });

  it("returns empty when thread_id cannot be resolved for promotions", () => {
    const event: ChatEventLike = {
      type: "tool_progress",
      tool_name: "write_file",
      tool_target: "/Projects/a.md",
      tool_status: "running",
    };
    expect(normalizeArtifactEventsFromChatEvent(event).events).toEqual([]);
  });

  it("returns empty for citation path traversal", () => {
    const event: ChatEventLike = {
      type: "message_send",
      chat_id: "thread-1",
      citations: [{ path: "/Projects/../etc/passwd", title: "x" }],
    };
    expect(normalizeArtifactEventsFromChatEvent(event).events).toEqual([]);
  });
});

describe("collectArtifactEventsFromHistory — durable hydrate", () => {
  it("re-parses explicit artifact metadata after history reload", () => {
    // Shape matches durableOutboundFromRelayEvent output (metadata retained).
    const history: ChatEventLike[] = [
      {
        type: "user_message",
        chat_id: "thread-1",
      },
      {
        type: "tool_progress",
        chat_id: "thread-1",
        tool_name: "write_file",
        tool_status: "running",
        tool_target: "memo.md",
        tool_call_id: "tc-1",
        created_at: "2026-07-24T12:00:00.000Z",
        metadata: {
          portal_event: "tool_progress",
          tool_name: "write_file",
          tool_status: "running",
          tool_target: "memo.md",
          tool_call_id: "tc-1",
        },
      },
      {
        type: "message_send",
        chat_id: "thread-1",
        content: "Done",
        created_at: "2026-07-24T12:00:05.000Z",
        metadata: {
          portal_event: "artifact.updated",
          thread_id: "thread-1",
          artifact_id: "op-1",
          vault_path: "/Projects/Legal/memo.md",
          title: "memo.md",
          file_type: "md",
          producer: "agent",
          status: "ready",
          timestamp: "2026-07-24T12:00:05.000Z",
          revision: { token: "etag-1", kind: "etag", size_bytes: 100 },
          tool_call_id: "tc-1",
        },
      },
      {
        type: "message_send",
        chat_id: "thread-1",
        content: "See file",
        created_at: "2026-07-24T12:00:06.000Z",
        metadata: {
          citations: [{ path: "memo.md", title: "Memo" }],
        },
      },
    ];

    const events = collectArtifactEventsFromHistory(history, {
      project_vault_path: PROJECT,
    });

    expect(events.map((e) => e.portal_event)).toEqual([
      "artifact.progress",
      "artifact.updated",
      "artifact.open",
    ]);
    expect(events[0]?.vault_path).toBe("/Projects/Legal/memo.md");
    expect(events[1]?.revision).toEqual({
      token: "etag-1",
      kind: "etag",
      size_bytes: 100,
    });
    // Re-parse wire still valid
    expect(parseArtifactEventMetadata(events[1]!)).toEqual(events[1]);
  });

  it("dedupes identical artifact rows", () => {
    const row: ChatEventLike = {
      type: "message_send",
      chat_id: "thread-1",
      created_at: TS,
      metadata: {
        portal_event: "artifact.open",
        thread_id: "thread-1",
        artifact_id: "a1",
        vault_path: "/Projects/a.md",
        title: "a.md",
        file_type: "md",
        producer: "agent",
        status: "open",
        timestamp: TS,
      },
    };
    const events = collectArtifactEventsFromHistory([row, row]);
    expect(events).toHaveLength(1);
  });
});

describe("chatEventMayCarryArtifactMetadata", () => {
  it("detects artifact-bearing rows for durable retention", () => {
    expect(
      chatEventMayCarryArtifactMetadata({
        type: "message_send",
        metadata: { portal_event: "artifact.open" },
      }),
    ).toBe(true);
    expect(
      chatEventMayCarryArtifactMetadata({
        type: "message_send",
        metadata: { citations: [{ path: "/a.md" }] },
      }),
    ).toBe(true);
    expect(
      chatEventMayCarryArtifactMetadata({
        type: "tool_progress",
        tool_target: "/a.md",
      }),
    ).toBe(true);
    expect(
      chatEventMayCarryArtifactMetadata({
        type: "typing",
        chat_id: "t",
      }),
    ).toBe(false);
    expect(
      chatEventMayCarryArtifactMetadata({
        type: "message_send",
        content: "hi",
      }),
    ).toBe(false);
  });
});
