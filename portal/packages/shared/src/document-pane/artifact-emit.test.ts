import { describe, expect, it } from "vitest";

import {
  buildFailedWriteTurnFixture,
  buildSuccessfulWriteTurnFixture,
  successfulWriteMetadataSequence,
} from "../fixtures/artifact-agent-file-work.js";
import { parseArtifactEventMetadata } from "./artifact-events.js";
import {
  ARTIFACT_ERROR_MESSAGE_MAX_CHARS,
  emitMetadataForAgentFileWork,
  flattenEmitPlanMetadata,
  planAgentFileWorkEmit,
  sanitizeArtifactErrorMessage,
} from "./artifact-emit.js";

const BASE_INPUT = {
  thread_id: "thread-1",
  tool_name: "write_file",
  vault_path: "/Projects/Legal/memo.md",
  tool_call_id: "tc-1",
  timestamp: "2026-07-24T12:00:00.000Z",
} as const;

describe("sanitizeArtifactErrorMessage", () => {
  it("keeps short safe messages", () => {
    expect(sanitizeArtifactErrorMessage("Permission denied")).toBe(
      "Permission denied",
    );
  });

  it("redacts fenced bodies and collapses to first line", () => {
    const raw =
      "write failed\n```markdown\n# SECRET\nbody lines\n```\nmore";
    const safe = sanitizeArtifactErrorMessage(raw);
    expect(safe).not.toContain("SECRET");
    expect(safe).not.toContain("```");
    expect(safe.length).toBeLessThanOrEqual(ARTIFACT_ERROR_MESSAGE_MAX_CHARS);
  });

  it("rejects data-url / base64-looking blobs", () => {
    expect(
      sanitizeArtifactErrorMessage(
        "data:text/plain;base64,SGVsbG8gV29ybGQgdGhpcyBpcyBhIHNlY3JldA==",
      ),
    ).toBe("Agent file work failed");
    expect(
      sanitizeArtifactErrorMessage(
        "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwYWJjZGVm",
      ),
    ).toBe("Agent file work failed");
  });
});

describe("planAgentFileWorkEmit", () => {
  it("returns null for non-file tools", () => {
    expect(
      planAgentFileWorkEmit({
        ...BASE_INPUT,
        phase: "started",
        tool_name: "web_search",
      }),
    ).toBeNull();
  });

  it("returns null for bad paths", () => {
    expect(
      planAgentFileWorkEmit({
        ...BASE_INPUT,
        phase: "started",
        vault_path: "ls -la && cat /etc/passwd",
      }),
    ).toBeNull();
  });

  it("write started emits artifact.open + artifact.progress and tool_progress", () => {
    const plan = planAgentFileWorkEmit({
      ...BASE_INPUT,
      phase: "started",
    });
    expect(plan).not.toBeNull();
    expect(plan!.artifact_events.map((e) => e.portal_event)).toEqual([
      "artifact.open",
      "artifact.progress",
    ]);
    expect(plan!.artifact_events[0]).toMatchObject({
      status: "opening",
      vault_path: "/Projects/Legal/memo.md",
      tool_call_id: "tc-1",
    });
    expect(plan!.artifact_events[1]).toMatchObject({
      portal_event: "artifact.progress",
      status: "writing",
      tool_call_id: "tc-1",
    });
    expect(plan!.tool_progress).toMatchObject({
      portal_event: "tool_progress",
      tool_name: "write_file",
      tool_status: "running",
      tool_target: "/Projects/Legal/memo.md",
      tool_call_id: "tc-1",
    });
  });

  it("read started emits open only (no writing progress)", () => {
    const plan = planAgentFileWorkEmit({
      ...BASE_INPUT,
      phase: "started",
      tool_name: "read_file",
    });
    expect(plan!.artifact_events.map((e) => e.portal_event)).toEqual([
      "artifact.open",
    ]);
    expect(plan!.artifact_events[0]).toMatchObject({ status: "open" });
  });

  it("succeeded with revision emits artifact.updated", () => {
    const plan = planAgentFileWorkEmit({
      ...BASE_INPUT,
      phase: "succeeded",
      revision: { token: "etag-1", kind: "etag", size_bytes: 100 },
      additions: 12,
      deletions: 3,
    });
    expect(plan!.artifact_events).toHaveLength(1);
    const ev = plan!.artifact_events[0];
    expect(ev.portal_event).toBe("artifact.updated");
    expect(ev).toMatchObject({
      vault_path: "/Projects/Legal/memo.md",
      tool_call_id: "tc-1",
      status: "ready",
      revision: { token: "etag-1", kind: "etag", size_bytes: 100 },
      additions: 12,
      deletions: 3,
    });
    expect(plan!.tool_progress?.tool_status).toBe("complete");
  });

  it("succeeded without revision does not claim artifact.updated", () => {
    const plan = planAgentFileWorkEmit({
      ...BASE_INPUT,
      phase: "succeeded",
    });
    expect(plan!.artifact_events[0].portal_event).toBe("artifact.open");
    expect(plan!.reason).toMatch(/without revision/);
  });

  it("failed emits artifact.error without leaking body", () => {
    const body = "```\n# confidential client file contents\nsecret-line\n```";
    const plan = planAgentFileWorkEmit({
      ...BASE_INPUT,
      phase: "failed",
      error_code: "human_edit_active",
      error_message: `conflict while writing\n${body}`,
    });
    const ev = plan!.artifact_events[0];
    expect(ev.portal_event).toBe("artifact.error");
    expect(ev).toMatchObject({
      status: "error",
      error_code: "human_edit_active",
      tool_call_id: "tc-1",
      vault_path: "/Projects/Legal/memo.md",
    });
    const msg = (ev as { error_message: string }).error_message;
    expect(msg).not.toContain("confidential");
    expect(msg).not.toContain("secret-line");
    expect(msg).not.toContain("```");
    expect(JSON.stringify(plan)).not.toContain("confidential client file");
  });

  it("produced events round-trip through parseArtifactEventMetadata", () => {
    const plan = planAgentFileWorkEmit({
      ...BASE_INPUT,
      phase: "succeeded",
      revision: { token: "h1", kind: "content_hash" },
    });
    for (const ev of plan!.artifact_events) {
      const parsed = parseArtifactEventMetadata(ev);
      expect(parsed).not.toBeNull();
      expect(parsed?.portal_event).toBe(ev.portal_event);
    }
  });
});

describe("flattenEmitPlanMetadata / dual emit", () => {
  it("emits tool_progress before artifact events", () => {
    const plan = planAgentFileWorkEmit({
      ...BASE_INPUT,
      phase: "started",
    })!;
    const flat = flattenEmitPlanMetadata(plan);
    expect(flat[0]?.portal_event).toBe("tool_progress");
    expect(flat.slice(1).map((m) => m.portal_event)).toEqual([
      "artifact.open",
      "artifact.progress",
    ]);
  });

  it("emitMetadataForAgentFileWork returns empty for bash", () => {
    expect(
      emitMetadataForAgentFileWork({
        ...BASE_INPUT,
        phase: "started",
        tool_name: "bash",
      }),
    ).toEqual([]);
  });
});

describe("replay fixtures: event ordering", () => {
  it("successful write turn: reasoning → tool_progress → artifacts → final", () => {
    const frames = buildSuccessfulWriteTurnFixture();
    const kinds = frames.map((f) => f.kind);
    expect(kinds[0]).toBe("reasoning");
    expect(kinds).toContain("tool_progress");
    expect(kinds).toContain("artifact");
    expect(kinds[kinds.length - 1]).toBe("final_answer");

    // First non-reasoning should be tool_progress (dual-emit ordering).
    const firstWork = frames.find((f) => f.kind !== "reasoning");
    expect(firstWork?.kind).toBe("tool_progress");
    expect(firstWork?.metadata.portal_event).toBe("tool_progress");

    const portalEvents = frames
      .map((f) => f.metadata.portal_event)
      .filter((v): v is string => typeof v === "string");

    // Ordered subsequence for artifact lifecycle.
    const artifactKinds = portalEvents.filter((e) =>
      e.startsWith("artifact."),
    );
    expect(artifactKinds).toEqual([
      "artifact.open",
      "artifact.progress",
      "artifact.progress",
      "artifact.updated",
    ]);

    const updated = frames.find(
      (f) => f.metadata.portal_event === "artifact.updated",
    );
    expect(updated?.metadata).toMatchObject({
      vault_path: "/Projects/Legal/memo.md",
      tool_call_id: "tc-write-fixture-1",
      revision: { token: "sha256:deadbeef", kind: "content_hash" },
    });

    // All artifact frames parse cleanly.
    for (const f of frames.filter((x) => x.kind === "artifact")) {
      expect(parseArtifactEventMetadata(f.metadata)).not.toBeNull();
    }

    // tool_progress rows still present with complete at end of write.
    const toolRows = frames.filter((f) => f.kind === "tool_progress");
    expect(toolRows.length).toBeGreaterThanOrEqual(2);
    expect(toolRows.some((r) => r.metadata.tool_status === "complete")).toBe(
      true,
    );
  });

  it("failed write turn never leaks file body on the wire", () => {
    const unsafe = "# SECRET_BODY_SHOULD_NOT_LEAK\nline2\nline3";
    const frames = buildFailedWriteTurnFixture({
      unsafe_body: `\`\`\`\n${unsafe}\n\`\`\``,
      raw_error: `Permission denied\n\`\`\`\n${unsafe}\n\`\`\``,
    });
    const serialized = JSON.stringify(frames);
    expect(serialized).not.toContain("SECRET_BODY_SHOULD_NOT_LEAK");
    const errorFrame = frames.find(
      (f) => f.metadata.portal_event === "artifact.error",
    );
    expect(errorFrame).toBeDefined();
    expect(errorFrame!.metadata.error_message).toBeDefined();
    expect(String(errorFrame!.metadata.error_message)).not.toContain(
      "SECRET_BODY",
    );
    expect(parseArtifactEventMetadata(errorFrame!.metadata)).not.toBeNull();
  });

  it("successfulWriteMetadataSequence is parseable end-to-end", () => {
    const seq = successfulWriteMetadataSequence();
    expect(seq.length).toBeGreaterThan(3);
    const artifactOnly = seq.filter(
      (m) =>
        typeof m.portal_event === "string" &&
        String(m.portal_event).startsWith("artifact."),
    );
    for (const m of artifactOnly) {
      expect(parseArtifactEventMetadata(m)).not.toBeNull();
    }
    const toolOnly = seq.filter((m) => m.portal_event === "tool_progress");
    expect(toolOnly.length).toBeGreaterThanOrEqual(2);
    expect(toolOnly.every((m) => m.tool_target === "/Projects/Legal/memo.md"))
      .toBe(true);
  });
});
