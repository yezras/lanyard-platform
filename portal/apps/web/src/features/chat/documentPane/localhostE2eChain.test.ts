/**
 * lp-5q6.38 — Offline localhost-proof substitute: chat artifact → pane open →
 * agent revision advance refreshes the pane (openGeneration bump).
 *
 * Live lab DocsAPI + DS: deploy/scripts/prove-localhost-office-e2e.sh
 * Scope: localhost mocklab + lab Document Server only.
 */
import { describe, expect, it } from "vitest";
import {
  parseArtifactEventMetadata,
  planAgentFileWorkEmit,
  type ArtifactEventWire,
} from "@lanyard/shared";

import {
  artifactPanelReducer,
  createInitialArtifactPanelState,
} from "./artifactPanelReducer.js";
import { mapArtifactWireToPanelEvent } from "./mapArtifactWire.js";

const THREAD = "thread-localhost-e2e-1";
const PATH = "/Projects/Lab/e2e-proof.docx";
const TOOL_CALL = "tc-localhost-e2e-1";
const OP = "localhost-e2e-write-1";

function emitPlanPhase(
  phase: "started" | "progress" | "succeeded",
  extras: {
    percent?: number;
    progress_label?: string;
    revision?: {
      token: string;
      kind: "content_hash" | "etag" | "host_revision" | "mtime_size_fallback";
      size_bytes?: number;
    };
  } = {},
) {
  const plan = planAgentFileWorkEmit({
    thread_id: THREAD,
    phase,
    tool_name: "write_file",
    vault_path: PATH,
    tool_call_id: TOOL_CALL,
    operation_id: OP,
    timestamp: "2026-07-26T18:00:00.000Z",
    ...extras,
  });
  if (!plan) throw new Error(`plan null for phase ${phase}`);
  return plan;
}

function applyWire(
  state: ReturnType<typeof createInitialArtifactPanelState>,
  wire: ArtifactEventWire,
) {
  // Re-parse at the boundary (same as chat SSE path) for realism.
  const parsed = parseArtifactEventMetadata(
    wire as unknown as Record<string, unknown>,
  );
  if (!parsed) return state;
  const panelEvent = mapArtifactWireToPanelEvent(parsed, "tool_progress");
  if (!panelEvent) return state;
  return artifactPanelReducer(state, {
    type: "PANEL_EVENT",
    event: panelEvent,
  });
}

describe("lp-5q6.38 localhost e2e chain (web pane)", () => {
  it("agent open → progress → updated opens pane and refreshes on new revision", () => {
    let state = createInitialArtifactPanelState();
    expect(state.status).toBe("closed");

    // Local user is in a chat thread; pane starts closed beside chat.
    // Agent starts writing DOCX → open + progress frames.
    const started = emitPlanPhase("started");
    for (const ev of started.artifact_events) {
      state = applyWire(state, ev);
    }
    expect(["opening", "progress", "previewing"]).toContain(state.status);
    expect(state.ref?.path).toBe(PATH);
    const genAfterOpen = state.openGeneration;
    expect(genAfterOpen).toBeGreaterThan(0);

    const progress = emitPlanPhase("progress", {
      percent: 55,
      progress_label: "Writing executive summary",
    });
    for (const ev of progress.artifact_events) {
      state = applyWire(state, ev);
    }
    expect(state.status).toBe("progress");
    expect(state.progress?.percent).toBe(55);
    expect(state.progress?.message).toMatch(/executive summary|Writing/i);

    // Agent finishes → artifact.updated with revision → pane refreshes.
    const rev1 = {
      token: "sha256:agent-rev-1",
      kind: "content_hash" as const,
      size_bytes: 2048,
    };
    const succeeded = emitPlanPhase("succeeded", { revision: rev1 });
    for (const ev of succeeded.artifact_events) {
      state = applyWire(state, ev);
    }
    expect(state.status).toBe("previewing");
    expect(state.knownRevision?.token).toBe("sha256:agent-rev-1");
    expect(state.progress).toBeNull();
    // Idle revision advance must bump openGeneration so preview reloads.
    expect(state.openGeneration).toBeGreaterThan(genAfterOpen);
    const genAfterAgent = state.openGeneration;

    // Second agent revision advance refreshes again.
    const rev2 = {
      token: "sha256:agent-rev-2",
      kind: "content_hash" as const,
      size_bytes: 4096,
    };
    const again = emitPlanPhase("succeeded", { revision: rev2 });
    for (const ev of again.artifact_events) {
      state = applyWire(state, ev);
    }
    expect(state.knownRevision?.token).toBe("sha256:agent-rev-2");
    expect(state.openGeneration).toBeGreaterThan(genAfterAgent);
  });

  it("does not leak file bodies into artifact error path", () => {
    let state = createInitialArtifactPanelState();
    const plan = planAgentFileWorkEmit({
      thread_id: THREAD,
      phase: "failed",
      tool_name: "write_file",
      vault_path: PATH,
      tool_call_id: TOOL_CALL,
      operation_id: OP,
      error_code: "upstream",
      error_message:
        "write failed:\n```docx\nSECRET_BODY_MUST_NOT_APPEAR\n```",
      timestamp: "2026-07-26T18:01:00.000Z",
    });
    if (!plan) throw new Error("failed plan null");
    for (const ev of plan.artifact_events) {
      state = applyWire(state, ev);
    }
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("SECRET_BODY_MUST_NOT_APPEAR");
    if (state.error) {
      expect(state.error.message).not.toContain("SECRET_BODY_MUST_NOT_APPEAR");
    }
  });
});
