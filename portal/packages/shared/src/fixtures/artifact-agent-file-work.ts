/**
 * Replay fixtures: agent file-work turn with dual tool_progress + artifact.*
 *
 * Used by host emit tests (lp-5q6.31) and UI/mock gateway before Hermes lands.
 * Ordering: reasoning → tool_progress → artifact open/progress → updated →
 * final answer; error path never carries file bodies.
 */

import type { ArtifactEventWire } from "../document-pane/artifact-events.js";
import {
  emitMetadataForAgentFileWork,
  planAgentFileWorkEmit,
  type ToolProgressEmitMetadata,
} from "../document-pane/artifact-emit.js";

/** One ordered outbound-like frame for mock gateway / SSE replay. */
export type ArtifactTurnFrame = {
  /** Logical frame kind for fixtures (not necessarily ChatEvent.type). */
  kind:
    | "reasoning"
    | "tool_progress"
    | "artifact"
    | "message_send"
    | "final_answer";
  /** Human-visible chrome when relevant. */
  content?: string;
  /** Outbound metadata (portal_event and fields). */
  metadata: Record<string, unknown>;
};

const THREAD = "thread-fixture-1";
const PATH = "/Projects/Legal/memo.md";
const TOOL_CALL = "tc-write-fixture-1";
const OP = "draft-memo-1";
const T0 = "2026-07-24T12:00:00.000Z";
const T1 = "2026-07-24T12:00:01.000Z";
const T2 = "2026-07-24T12:00:02.000Z";
const T3 = "2026-07-24T12:00:05.000Z";
const T4 = "2026-07-24T12:00:06.000Z";

function framesFromPlan(
  plan: NonNullable<ReturnType<typeof planAgentFileWorkEmit>>,
  content?: string,
): ArtifactTurnFrame[] {
  const frames: ArtifactTurnFrame[] = [];
  if (plan.tool_progress) {
    frames.push({
      kind: "tool_progress",
      content: content ?? plan.tool_progress.tool_label,
      metadata: { ...plan.tool_progress },
    });
  }
  for (const ev of plan.artifact_events) {
    frames.push({
      kind: "artifact",
      metadata: { ...(ev as ArtifactEventWire as unknown as Record<string, unknown>) },
    });
  }
  return frames;
}

/**
 * Happy path: reasoning → write started (open+progress) → progress →
 * updated with revision → final answer.
 */
export function buildSuccessfulWriteTurnFixture(): ArtifactTurnFrame[] {
  const frames: ArtifactTurnFrame[] = [];

  frames.push({
    kind: "reasoning",
    content: "Drafting the legal memo introduction.",
    metadata: {
      portal_event: "reasoning",
      reasoning: "Drafting the legal memo introduction.",
    },
  });

  const started = planAgentFileWorkEmit({
    thread_id: THREAD,
    phase: "started",
    tool_name: "write_file",
    vault_path: PATH,
    tool_call_id: TOOL_CALL,
    operation_id: OP,
    timestamp: T0,
  });
  if (!started) throw new Error("fixture: started plan null");
  frames.push(...framesFromPlan(started, "write_file: memo.md"));

  const progress = planAgentFileWorkEmit({
    thread_id: THREAD,
    phase: "progress",
    tool_name: "write_file",
    vault_path: PATH,
    tool_call_id: TOOL_CALL,
    operation_id: OP,
    progress_label: "Drafting section 2",
    percent: 45,
    timestamp: T1,
  });
  if (!progress) throw new Error("fixture: progress plan null");
  frames.push(...framesFromPlan(progress));

  const succeeded = planAgentFileWorkEmit({
    thread_id: THREAD,
    phase: "succeeded",
    tool_name: "write_file",
    vault_path: PATH,
    tool_call_id: TOOL_CALL,
    operation_id: OP,
    revision: {
      token: "sha256:deadbeef",
      kind: "content_hash",
      size_bytes: 4096,
    },
    write_kind: "canonical",
    additions: 40,
    deletions: 2,
    timestamp: T2,
  });
  if (!succeeded) throw new Error("fixture: succeeded plan null");
  frames.push(...framesFromPlan(succeeded));

  frames.push({
    kind: "final_answer",
    content: "Updated the legal memo with section 2.",
    metadata: {
      // Final assistant send — may include citations; not an artifact event.
      citations: [{ path: PATH, title: "memo.md" }],
    },
  });

  return frames;
}

/**
 * Error path: started → failed. Error metadata must not contain file body.
 */
export function buildFailedWriteTurnFixture(opts?: {
  /** Unsafe body the host might have received from the tool; must not appear. */
  unsafe_body?: string;
  raw_error?: string;
}): ArtifactTurnFrame[] {
  const unsafe =
    opts?.unsafe_body ??
    "```markdown\n# SECRET BODY\nconfidential client notes\n```";
  const rawError =
    opts?.raw_error ??
    `write_file failed: disk full\n${unsafe}`;

  const frames: ArtifactTurnFrame[] = [];

  frames.push({
    kind: "reasoning",
    content: "Attempting to write the memo.",
    metadata: {
      portal_event: "reasoning",
      reasoning: "Attempting to write the memo.",
    },
  });

  const started = planAgentFileWorkEmit({
    thread_id: THREAD,
    phase: "started",
    tool_name: "write_file",
    vault_path: PATH,
    tool_call_id: TOOL_CALL,
    operation_id: OP,
    timestamp: T3,
  });
  if (!started) throw new Error("fixture: started plan null");
  frames.push(...framesFromPlan(started));

  const failed = planAgentFileWorkEmit({
    thread_id: THREAD,
    phase: "failed",
    tool_name: "write_file",
    vault_path: PATH,
    tool_call_id: TOOL_CALL,
    operation_id: OP,
    error_code: "upstream",
    error_message: rawError,
    timestamp: T4,
  });
  if (!failed) throw new Error("fixture: failed plan null");
  frames.push(...framesFromPlan(failed));

  frames.push({
    kind: "final_answer",
    content: "I could not write the memo; please try again.",
    metadata: {},
  });

  return frames;
}

/** Flatten happy-path metadata sequence (tool_progress + artifact only). */
export function successfulWriteMetadataSequence(): Array<
  Record<string, unknown>
> {
  return [
    ...emitMetadataForAgentFileWork({
      thread_id: THREAD,
      phase: "started",
      tool_name: "write_file",
      vault_path: PATH,
      tool_call_id: TOOL_CALL,
      operation_id: OP,
      timestamp: T0,
    }),
    ...emitMetadataForAgentFileWork({
      thread_id: THREAD,
      phase: "progress",
      tool_name: "write_file",
      vault_path: PATH,
      tool_call_id: TOOL_CALL,
      operation_id: OP,
      progress_label: "Drafting section 2",
      percent: 45,
      timestamp: T1,
    }),
    ...emitMetadataForAgentFileWork({
      thread_id: THREAD,
      phase: "succeeded",
      tool_name: "write_file",
      vault_path: PATH,
      tool_call_id: TOOL_CALL,
      operation_id: OP,
      revision: {
        token: "sha256:deadbeef",
        kind: "content_hash",
        size_bytes: 4096,
      },
      write_kind: "canonical",
      additions: 40,
      deletions: 2,
      timestamp: T2,
    }),
  ];
}

export type { ToolProgressEmitMetadata };
