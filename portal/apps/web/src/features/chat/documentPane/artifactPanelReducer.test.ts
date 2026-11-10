import { describe, expect, it } from "vitest";

import {
  artifactPanelReducer,
  createInitialArtifactPanelState,
} from "./artifactPanelReducer.js";
import { resolvePaneArtifactRef } from "./pathResolution.js";
import type {
  ArtifactPanelState,
  DocumentRevision,
  VaultArtifactRef,
} from "./types.js";

const REF: VaultArtifactRef = {
  path: "/Projects/Legal/memo.md",
  title: "memo.md",
  source: "citation",
};

const REF_B: VaultArtifactRef = {
  path: "/Projects/Legal/other.md",
  title: "other.md",
};

const REV_1: DocumentRevision = {
  token: "etag-1",
  kind: "etag",
};

const REV_2: DocumentRevision = {
  token: "etag-2",
  kind: "etag",
};

function openPreviewing(
  base: ArtifactPanelState = createInitialArtifactPanelState(),
  ref: VaultArtifactRef = REF,
): ArtifactPanelState {
  let s = artifactPanelReducer(base, {
    type: "PANEL_OPEN",
    ref,
    revision: REV_1,
  });
  s = artifactPanelReducer(s, {
    type: "PANEL_PREVIEW_READY",
    openGeneration: s.openGeneration,
    revision: REV_1,
  });
  return s;
}

describe("createInitialArtifactPanelState", () => {
  it("starts closed with null ref and generation 0", () => {
    const s = createInitialArtifactPanelState();
    expect(s.status).toBe("closed");
    expect(s.ref).toBeNull();
    expect(s.knownRevision).toBeNull();
    expect(s.mode).toBe("preview");
    expect(s.officeSessionId).toBeNull();
    expect(s.progress).toBeNull();
    expect(s.conflict).toBeNull();
    expect(s.checkpointOffer).toBeNull();
    expect(s.error).toBeNull();
    expect(s.localDirty).toBe(false);
    expect(s.openGeneration).toBe(0);
  });
});

describe("artifactPanelReducer — open / preview / error lifecycle", () => {
  it("closed → opening on PANEL_OPEN and bumps openGeneration", () => {
    const initial = createInitialArtifactPanelState();
    const s = artifactPanelReducer(initial, {
      type: "PANEL_OPEN",
      ref: REF,
    });
    expect(s.status).toBe("opening");
    expect(s.ref).toEqual(REF);
    expect(s.openGeneration).toBe(1);
    expect(s.error).toBeNull();
    expect(s.mode).toBe("preview");
  });

  it("re-opening the same path bumps openGeneration (re-run effects)", () => {
    let s = openPreviewing();
    const gen = s.openGeneration;
    s = artifactPanelReducer(s, { type: "PANEL_OPEN", ref: REF });
    expect(s.status).toBe("opening");
    expect(s.openGeneration).toBe(gen + 1);
  });

  it("opening → previewing on PANEL_PREVIEW_READY for matching generation", () => {
    let s = artifactPanelReducer(createInitialArtifactPanelState(), {
      type: "PANEL_OPEN",
      ref: REF,
    });
    s = artifactPanelReducer(s, {
      type: "PANEL_PREVIEW_READY",
      openGeneration: s.openGeneration,
      revision: REV_1,
    });
    expect(s.status).toBe("previewing");
    expect(s.knownRevision).toEqual(REV_1);
  });

  it("ignores stale PANEL_PREVIEW_READY from older openGeneration", () => {
    let s = artifactPanelReducer(createInitialArtifactPanelState(), {
      type: "PANEL_OPEN",
      ref: REF,
    });
    const staleGen = s.openGeneration;
    s = artifactPanelReducer(s, { type: "PANEL_OPEN", ref: REF_B });
    s = artifactPanelReducer(s, {
      type: "PANEL_PREVIEW_READY",
      openGeneration: staleGen,
      revision: REV_1,
    });
    expect(s.status).toBe("opening");
    expect(s.ref?.path).toBe(REF_B.path);
    expect(s.knownRevision).toBeNull();
  });

  it("opening → error on PANEL_PREVIEW_ERROR", () => {
    let s = artifactPanelReducer(createInitialArtifactPanelState(), {
      type: "PANEL_OPEN",
      ref: REF,
    });
    s = artifactPanelReducer(s, {
      type: "PANEL_PREVIEW_ERROR",
      openGeneration: s.openGeneration,
      error: {
        code: "not_found",
        message: "File not found",
        retryable: false,
      },
    });
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("not_found");
    expect(s.ref?.path).toBe(REF.path);
  });

  it("PANEL_OPEN with invalid path → error without crashing", () => {
    const s = artifactPanelReducer(createInitialArtifactPanelState(), {
      type: "PANEL_OPEN",
      ref: { path: "/Projects/../secret", title: "bad" },
    });
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("invalid_path");
  });

  it("PANEL_CLOSE returns closed and clears ref / session", () => {
    let s = openPreviewing();
    s = {
      ...s,
      officeSessionId: "sess-1",
      localDirty: true,
    };
    s = artifactPanelReducer(s, { type: "PANEL_CLOSE", reason: "user" });
    expect(s.status).toBe("closed");
    expect(s.ref).toBeNull();
    expect(s.officeSessionId).toBeNull();
    expect(s.localDirty).toBe(false);
    expect(s.openGeneration).toBeGreaterThan(0);
  });

  it("close then reopen restores opening lifecycle on the same path", () => {
    let s = openPreviewing();
    const path = s.ref!.path;
    s = artifactPanelReducer(s, { type: "PANEL_CLOSE", reason: "user" });
    expect(s.status).toBe("closed");
    s = artifactPanelReducer(s, { type: "PANEL_OPEN", ref: REF });
    expect(s.status).toBe("opening");
    expect(s.ref?.path).toBe(path);
    expect(s.openGeneration).toBeGreaterThan(1);
  });

  it("PANEL_RELOAD bumps generation and re-enters opening for current ref", () => {
    let s = openPreviewing();
    const gen = s.openGeneration;
    s = artifactPanelReducer(s, { type: "PANEL_RELOAD" });
    expect(s.status).toBe("opening");
    expect(s.ref?.path).toBe(REF.path);
    expect(s.openGeneration).toBe(gen + 1);
    expect(s.knownRevision).toEqual(REV_1);
  });

  it("PANEL_RELOAD from conflict clears dirty/session and returns to preview open", () => {
    let s = openPreviewing();
    s = artifactPanelReducer(s, { type: "PANEL_REQUEST_EDIT" });
    s = artifactPanelReducer(s, {
      type: "PANEL_SESSION_BOUND",
      sessionId: "sess-reload",
    });
    s = artifactPanelReducer(s, { type: "PANEL_SET_DIRTY", dirty: true });
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "updated",
        ref: REF,
        revision: REV_2,
        writeKind: "canonical",
      },
    });
    expect(s.status).toBe("conflict");
    s = artifactPanelReducer(s, {
      type: "PANEL_RELOAD",
      discardLocal: true,
      revision: REV_2,
    });
    expect(s.status).toBe("opening");
    expect(s.mode).toBe("preview");
    expect(s.localDirty).toBe(false);
    expect(s.officeSessionId).toBeNull();
    expect(s.conflict).toBeNull();
    expect(s.knownRevision).toEqual(REV_2);
  });

  it("PANEL_RELOAD is a no-op when closed", () => {
    const initial = createInitialArtifactPanelState();
    const s = artifactPanelReducer(initial, { type: "PANEL_RELOAD" });
    expect(s).toEqual(initial);
  });
});

describe("artifactPanelReducer — PANEL_EVENT artifact protocol", () => {
  it("artifact open drives closed → opening", () => {
    const s = artifactPanelReducer(createInitialArtifactPanelState(), {
      type: "PANEL_EVENT",
      event: { type: "open", ref: REF, revision: REV_1 },
    });
    expect(s.status).toBe("opening");
    expect(s.ref?.path).toBe(REF.path);
    expect(s.knownRevision).toEqual(REV_1);
  });

  it("progress while previewing → progress status + strip", () => {
    let s = openPreviewing();
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "progress",
        ref: REF,
        percent: 40,
        message: "Writing memo",
        phase: "writing",
        operationId: "op-1",
      },
    });
    expect(s.status).toBe("progress");
    expect(s.progress).toMatchObject({
      percent: 40,
      message: "Writing memo",
      phase: "writing",
      operationId: "op-1",
    });
    expect(s.ref?.path).toBe(REF.path);
  });

  it("updated on same path while idle → previewing + new revision + reload gen", () => {
    let s = openPreviewing();
    const gen = s.openGeneration;
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "updated",
        ref: REF,
        revision: REV_2,
        writeKind: "canonical",
      },
    });
    expect(s.status).toBe("previewing");
    expect(s.knownRevision).toEqual(REV_2);
    expect(s.progress).toBeNull();
    // lp-5q6.16: revision advance reloads preview bytes
    expect(s.openGeneration).toBe(gen + 1);
  });

  it("updated external revision while dirty editing → conflict (no auto key swap)", () => {
    let s = openPreviewing();
    s = artifactPanelReducer(s, { type: "PANEL_REQUEST_EDIT" });
    s = artifactPanelReducer(s, {
      type: "PANEL_SESSION_BOUND",
      sessionId: "sess-abc",
    });
    s = artifactPanelReducer(s, { type: "PANEL_SET_DIRTY", dirty: true });
    expect(s.status).toBe("editing");
    expect(s.officeSessionId).toBe("sess-abc");

    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "updated",
        ref: REF,
        revision: REV_2,
        writeKind: "canonical",
      },
    });
    expect(s.status).toBe("conflict");
    expect(s.conflict?.reason).toBe("superseded_base");
    expect(s.conflict?.actualRevision).toEqual(REV_2);
    expect(s.knownRevision).toEqual(REV_1);
    expect(s.officeSessionId).toBe("sess-abc");
    expect(s.localDirty).toBe(true);
  });

  it("checkpoint update while dirty → conflict with alternate_ref action", () => {
    let s = openPreviewing();
    s = artifactPanelReducer(s, { type: "PANEL_SET_DIRTY", dirty: true });
    const checkpoint: VaultArtifactRef = {
      path: "/.lanyard/checkpoints/memo.md",
      title: "memo.md (checkpoint)",
      source: "agent_checkpoint",
    };
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "updated",
        ref: checkpoint,
        revision: REV_2,
        writeKind: "checkpoint",
        sourcePath: REF.path,
      },
    });
    expect(s.status).toBe("conflict");
    expect(s.conflict?.reason).toBe("human_edit_active");
    expect(s.conflict?.alternateRef?.path).toBe(checkpoint.path);
    expect(s.conflict?.offeredActions).toContain("open_checkpoint");
  });

  it("error event → error status and keeps ref for retry", () => {
    let s = openPreviewing();
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "error",
        ref: REF,
        code: "forbidden",
        message: "ACL denied",
        retryable: false,
      },
    });
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("forbidden");
    expect(s.ref?.path).toBe(REF.path);
  });

  it("close event → closed", () => {
    let s = openPreviewing();
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: { type: "close", reason: "thread_change" },
    });
    expect(s.status).toBe("closed");
    expect(s.ref).toBeNull();
  });

  it("ignores progress/error/close for a different path", () => {
    let s = openPreviewing();
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "progress",
        ref: REF_B,
        percent: 10,
        message: "other",
      },
    });
    expect(s.status).toBe("previewing");
    expect(s.progress).toBeNull();

    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "error",
        ref: REF_B,
        code: "not_found",
        message: "missing",
      },
    });
    expect(s.status).toBe("previewing");
    expect(s.error).toBeNull();
  });

  it("event ordering: open → progress → updated settles to previewing", () => {
    let s = createInitialArtifactPanelState();
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: { type: "open", ref: REF, operationId: "op-seq" },
    });
    expect(s.status).toBe("opening");
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "progress",
        ref: REF,
        percent: 50,
        operationId: "op-seq",
        phase: "writing",
      },
    });
    expect(s.status).toBe("progress");
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "updated",
        ref: REF,
        revision: REV_2,
        writeKind: "canonical",
        operationId: "op-seq",
      },
    });
    expect(s.status).toBe("previewing");
    expect(s.knownRevision).toEqual(REV_2);
    expect(s.progress).toBeNull();
  });

  it("updated from closed opens into opening (not previewing) until READY (lp-dpr.1)", () => {
    let s = createInitialArtifactPanelState();
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "updated",
        ref: REF,
        revision: REV_1,
        writeKind: "canonical",
      },
    });
    expect(s.status).toBe("opening");
    expect(s.ref?.path).toBe(REF.path);
    expect(s.knownRevision).toEqual(REV_1);
    expect(s.openGeneration).toBe(1);

    s = artifactPanelReducer(s, {
      type: "PANEL_PREVIEW_READY",
      openGeneration: s.openGeneration,
    });
    expect(s.status).toBe("previewing");
  });

  it("duplicate same-path updated with identical revision is stable", () => {
    let s = openPreviewing();
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "updated",
        ref: REF,
        revision: REV_1,
        writeKind: "canonical",
        operationId: "op-dup",
      },
    });
    const afterFirst = s;
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "updated",
        ref: REF,
        revision: REV_1,
        writeKind: "canonical",
        operationId: "op-dup",
      },
    });
    expect(s.status).toBe("previewing");
    expect(s.knownRevision).toEqual(REV_1);
    expect(s.ref?.path).toBe(afterFirst.ref?.path);
    expect(s.openGeneration).toBe(afterFirst.openGeneration);
  });

  it("duplicate identical progress frames leave state reference-equal", () => {
    let s = openPreviewing();
    const event = {
      type: "progress" as const,
      ref: REF,
      percent: 40,
      message: "Writing memo",
      phase: "writing",
      operationId: "op-1",
    };
    s = artifactPanelReducer(s, { type: "PANEL_EVENT", event });
    const afterFirst = s;
    s = artifactPanelReducer(s, { type: "PANEL_EVENT", event });
    expect(s).toBe(afterFirst);
    expect(s.progress?.percent).toBe(40);
  });

  it("progress percent change updates strip without new openGeneration", () => {
    let s = openPreviewing();
    const gen = s.openGeneration;
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "progress",
        ref: REF,
        percent: 10,
        message: "Starting",
        operationId: "op-1",
      },
    });
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "progress",
        ref: REF,
        percent: 55,
        message: "Drafting section 2",
        operationId: "op-1",
      },
    });
    expect(s.status).toBe("progress");
    expect(s.progress?.percent).toBe(55);
    expect(s.progress?.message).toBe("Drafting section 2");
    expect(s.openGeneration).toBe(gen);
  });

  it("checkpoint update while idle → soft checkpointOffer, keeps current path", () => {
    let s = openPreviewing();
    const gen = s.openGeneration;
    const checkpoint: VaultArtifactRef = {
      path: "/.lanyard/checkpoints/memo.md",
      title: "memo.md (checkpoint)",
      source: "agent_checkpoint",
    };
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "updated",
        ref: checkpoint,
        revision: REV_2,
        writeKind: "checkpoint",
        sourcePath: REF.path,
      },
    });
    expect(s.status).toBe("previewing");
    expect(s.ref?.path).toBe(REF.path);
    expect(s.checkpointOffer?.ref.path).toBe(checkpoint.path);
    expect(s.checkpointOffer?.sourcePath).toBe(REF.path);
    expect(s.openGeneration).toBe(gen);
    expect(s.progress).toBeNull();
  });

  it("PANEL_OPEN_CHECKPOINT opens offer path and clears offer", () => {
    let s = openPreviewing();
    const checkpoint: VaultArtifactRef = {
      path: "/.lanyard/checkpoints/memo.md",
      title: "memo.md (checkpoint)",
      source: "agent_checkpoint",
    };
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "updated",
        ref: checkpoint,
        revision: REV_2,
        writeKind: "checkpoint",
        sourcePath: REF.path,
      },
    });
    s = artifactPanelReducer(s, { type: "PANEL_OPEN_CHECKPOINT" });
    expect(s.status).toBe("opening");
    expect(s.ref?.path).toBe(checkpoint.path);
    expect(s.ref?.source).toBe("agent_checkpoint");
    expect(s.knownRevision).toEqual(REV_2);
    expect(s.checkpointOffer).toBeNull();
    expect(s.conflict).toBeNull();
  });

  it("PANEL_DISMISS_CHECKPOINT clears soft offer without changing path", () => {
    let s = openPreviewing();
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "updated",
        ref: {
          path: "/.lanyard/checkpoints/memo.md",
          source: "agent_checkpoint",
        },
        revision: REV_2,
        writeKind: "checkpoint",
      },
    });
    expect(s.checkpointOffer).not.toBeNull();
    s = artifactPanelReducer(s, { type: "PANEL_DISMISS_CHECKPOINT" });
    expect(s.checkpointOffer).toBeNull();
    expect(s.ref?.path).toBe(REF.path);
    expect(s.status).toBe("previewing");
  });

  it("PANEL_PREVIEW_READY keeps progress strip when agent still working", () => {
    let s = artifactPanelReducer(createInitialArtifactPanelState(), {
      type: "PANEL_OPEN",
      ref: REF,
    });
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "progress",
        ref: REF,
        percent: 30,
        message: "Writing",
        operationId: "op-keep",
      },
    });
    expect(s.status).toBe("progress");
    s = artifactPanelReducer(s, {
      type: "PANEL_PREVIEW_READY",
      openGeneration: s.openGeneration,
      revision: REV_1,
    });
    expect(s.status).toBe("progress");
    expect(s.progress?.message).toBe("Writing");
    expect(s.knownRevision).toEqual(REV_1);
  });

  it("event ordering: open → progress → updated bumps gen and clears strip", () => {
    let s = createInitialArtifactPanelState();
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: { type: "open", ref: REF, operationId: "op-seq" },
    });
    const openGen = s.openGeneration;
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "progress",
        ref: REF,
        percent: 50,
        operationId: "op-seq",
        phase: "writing",
      },
    });
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "updated",
        ref: REF,
        revision: REV_2,
        writeKind: "canonical",
        operationId: "op-seq",
      },
    });
    expect(s.status).toBe("previewing");
    expect(s.knownRevision).toEqual(REV_2);
    expect(s.progress).toBeNull();
    expect(s.openGeneration).toBe(openGen + 1);
  });
});

describe("artifactPanelReducer — office-only open (lp-swt.2)", () => {
  const OFFICE_REF: VaultArtifactRef = {
    path: "/Projects/A/Proposal.docx",
    title: "Proposal.docx",
    source: "citation",
  };

  it("PANEL_OPEN for Office path enters edit mode without REQUEST_EDIT", () => {
    let s = createInitialArtifactPanelState();
    s = artifactPanelReducer(s, {
      type: "PANEL_OPEN",
      ref: OFFICE_REF,
      mode: "preview",
    });
    expect(s.status).toBe("opening");
    expect(s.mode).toBe("edit");
    expect(s.ref?.path).toBe(OFFICE_REF.path);
  });

  it("artifact open event for Office path enters edit (preferred preview ignored)", () => {
    let s = createInitialArtifactPanelState();
    s = artifactPanelReducer(s, {
      type: "PANEL_EVENT",
      event: {
        type: "open",
        ref: OFFICE_REF,
        preferredMode: "preview",
      },
    });
    expect(s.status).toBe("opening");
    expect(s.mode).toBe("edit");
  });

  it("PANEL_OPEN for non-office path stays preview", () => {
    let s = createInitialArtifactPanelState();
    s = artifactPanelReducer(s, {
      type: "PANEL_OPEN",
      ref: REF,
      mode: "preview",
    });
    expect(s.mode).toBe("preview");
  });

  it("EXIT_EDIT is a no-op for Office paths (no dual-mode)", () => {
    let s = createInitialArtifactPanelState();
    s = artifactPanelReducer(s, {
      type: "PANEL_OPEN",
      ref: OFFICE_REF,
    });
    s = artifactPanelReducer(s, {
      type: "PANEL_SESSION_BOUND",
      sessionId: "sess-office",
    });
    expect(s.mode).toBe("edit");
    expect(s.status).toBe("editing");
    const gen = s.openGeneration;
    s = artifactPanelReducer(s, { type: "PANEL_EXIT_EDIT" });
    expect(s.mode).toBe("edit");
    expect(s.status).toBe("editing");
    expect(s.officeSessionId).toBe("sess-office");
    expect(s.openGeneration).toBe(gen);
  });

  it("save success on Office path stays in edit", () => {
    let s = createInitialArtifactPanelState();
    s = artifactPanelReducer(s, {
      type: "PANEL_OPEN",
      ref: OFFICE_REF,
      revision: REV_1,
    });
    s = artifactPanelReducer(s, {
      type: "PANEL_SESSION_BOUND",
      sessionId: "sess-office",
    });
    s = artifactPanelReducer(s, { type: "PANEL_SET_DIRTY", dirty: true });
    s = artifactPanelReducer(s, {
      type: "PANEL_SAVE_SUCCESS",
      revision: REV_2,
    });
    expect(s.status).toBe("editing");
    expect(s.mode).toBe("edit");
    expect(s.localDirty).toBe(false);
    expect(s.knownRevision).toEqual(REV_2);
  });
});

describe("artifactPanelReducer — edit / save", () => {
  it("preview → request edit → session bound → editing", () => {
    let s = openPreviewing();
    s = artifactPanelReducer(s, { type: "PANEL_REQUEST_EDIT" });
    expect(s.status).toBe("opening");
    expect(s.mode).toBe("edit");
    s = artifactPanelReducer(s, {
      type: "PANEL_SESSION_BOUND",
      sessionId: "sess-1",
    });
    expect(s.status).toBe("editing");
    expect(s.officeSessionId).toBe("sess-1");
  });

  it("exit edit returns to view-only preview without closing (lp-5q6.30)", () => {
    let s = openPreviewing();
    s = artifactPanelReducer(s, { type: "PANEL_REQUEST_EDIT" });
    s = artifactPanelReducer(s, {
      type: "PANEL_SESSION_BOUND",
      sessionId: "sess-1",
    });
    s = artifactPanelReducer(s, { type: "PANEL_SET_DIRTY", dirty: true });
    const gen = s.openGeneration;
    s = artifactPanelReducer(s, { type: "PANEL_EXIT_EDIT" });
    expect(s.status).toBe("previewing");
    expect(s.mode).toBe("preview");
    expect(s.officeSessionId).toBeNull();
    expect(s.localDirty).toBe(false);
    expect(s.ref).toEqual(REF);
    // Keep openGeneration so preview bytes already loaded stay mounted.
    expect(s.openGeneration).toBe(gen);
  });

  it("save success without stayEditing → previewing and clears session", () => {
    let s = openPreviewing();
    s = artifactPanelReducer(s, { type: "PANEL_REQUEST_EDIT" });
    s = artifactPanelReducer(s, {
      type: "PANEL_SESSION_BOUND",
      sessionId: "sess-1",
    });
    s = artifactPanelReducer(s, { type: "PANEL_SET_DIRTY", dirty: true });
    s = artifactPanelReducer(s, {
      type: "PANEL_SAVE_SUCCESS",
      revision: REV_2,
    });
    expect(s.status).toBe("previewing");
    expect(s.mode).toBe("preview");
    expect(s.officeSessionId).toBeNull();
    expect(s.knownRevision).toEqual(REV_2);
    expect(s.localDirty).toBe(false);
  });

  it("PANEL_CONFLICT sets conflict status", () => {
    let s = openPreviewing();
    s = artifactPanelReducer(s, {
      type: "PANEL_CONFLICT",
      conflict: {
        reason: "revision_mismatch",
        path: REF.path,
        message: "CAS failed",
        offeredActions: ["reload", "retry_save"],
      },
    });
    expect(s.status).toBe("conflict");
    expect(s.conflict?.reason).toBe("revision_mismatch");
  });
});

describe("resolve + open integration", () => {
  it("resolves citation path then opens through reducer", () => {
    const resolved = resolvePaneArtifactRef("memo.md", {
      projectVaultPath: "/home/u/Core",
      source: "citation",
      title: "memo.md",
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    let s = createInitialArtifactPanelState();
    s = artifactPanelReducer(s, {
      type: "PANEL_OPEN",
      ref: resolved.ref,
    });
    expect(s.status).toBe("opening");
    expect(s.ref?.path).toBe("/home/u/Core/memo.md");
    expect(s.ref?.source).toBe("citation");

    s = artifactPanelReducer(s, {
      type: "PANEL_PREVIEW_READY",
      openGeneration: s.openGeneration,
    });
    expect(s.status).toBe("previewing");
  });
});
