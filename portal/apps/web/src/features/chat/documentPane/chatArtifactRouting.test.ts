/**
 * Citation / artifact.open / tool_target routing (lp-5q6.14) +
 * soft mode A office path reference open (lp-dpr.2).
 */
import { describe, expect, it } from "vitest";

import {
  detectChatOpenDocumentIntent,
  extractOfficeBasenameFromText,
  extractOfficePathOrBasenameFromText,
  extractOfficeVaultPathFromText,
  isOfficeBasenameToken,
  openDocumentIntentFromUserMessage,
  openDocumentPathAction,
  openToolTargetAction,
  panelActionsFromChatEvent,
} from "./chatArtifactRouting.js";
import {
  artifactPanelReducer,
  createInitialArtifactPanelState,
} from "./artifactPanelReducer.js";

describe("openDocumentPathAction (citation)", () => {
  it("opens absolute citation paths with source citation", () => {
    const action = openDocumentPathAction("/Projects/A/README.md", {
      source: "citation",
    });
    expect(action).toEqual({
      type: "PANEL_OPEN",
      ref: {
        path: "/Projects/A/README.md",
        title: "README.md",
        source: "citation",
      },
      mode: "preview",
    });
  });

  it("resolves relative citations against projectVaultPath", () => {
    const action = openDocumentPathAction("notes/a.md", {
      projectVaultPath: "/home/u/Core",
      source: "citation",
    });
    expect(action).toMatchObject({
      type: "PANEL_OPEN",
      ref: {
        path: "/home/u/Core/notes/a.md",
        source: "citation",
      },
    });
  });

  it("returns null for empty / traversal paths", () => {
    expect(openDocumentPathAction("")).toBeNull();
    expect(openDocumentPathAction("../etc/passwd")).toBeNull();
  });

  it("lp-rt5.7: Office citations open inline document pane in preview mode", () => {
    for (const path of [
      "/Projects/A/Proposal.docx",
      "/Projects/A/Budget.xlsx",
      "/Projects/A/Deck.pptx",
    ]) {
      const action = openDocumentPathAction(path, { source: "citation" });
      expect(action).toMatchObject({
        type: "PANEL_OPEN",
        ref: { path, source: "citation" },
        mode: "preview",
      });
    }
  });
});

describe("openToolTargetAction", () => {
  it("opens absolute tool targets with source tool_target", () => {
    const action = openToolTargetAction("/Projects/Legal/memo.md");
    expect(action).toMatchObject({
      type: "PANEL_OPEN",
      ref: {
        path: "/Projects/Legal/memo.md",
        source: "tool_target",
      },
    });
  });

  it("resolves relative tool targets against projectVaultPath", () => {
    const action = openToolTargetAction("src/foo.ts", {
      projectVaultPath: "/home/u/Core",
    });
    expect(action).toMatchObject({
      type: "PANEL_OPEN",
      ref: {
        path: "/home/u/Core/src/foo.ts",
        source: "tool_target",
      },
    });
  });
});

describe("panelActionsFromChatEvent — explicit artifact.open", () => {
  it("maps explicit artifact.open metadata to PANEL_EVENT open", () => {
    const actions = panelActionsFromChatEvent(
      {
        type: "message_send",
        chat_id: "thread-1",
        metadata: {
          portal_event: "artifact.open",
          thread_id: "thread-1",
          artifact_id: "op:1",
          vault_path: "/Projects/A/memo.md",
          title: "memo.md",
          file_type: "md",
          producer: "agent",
          status: "open",
          timestamp: "2026-07-24T12:00:00.000Z",
        },
      },
      { thread_id: "thread-1" },
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "PANEL_EVENT",
      event: {
        type: "open",
        ref: {
          path: "/Projects/A/memo.md",
          title: "memo.md",
          source: "artifact_event",
        },
      },
    });
  });

  it("applies explicit open through the pane reducer", () => {
    const actions = panelActionsFromChatEvent(
      {
        type: "message_send",
        chat_id: "t1",
        metadata: {
          portal_event: "artifact.open",
          thread_id: "t1",
          artifact_id: "a1",
          vault_path: "/Projects/A/README.md",
          title: "README.md",
          file_type: "md",
          producer: "agent",
          status: "open",
          timestamp: "2026-07-24T12:00:00.000Z",
        },
      },
      { thread_id: "t1" },
    );
    let state = createInitialArtifactPanelState();
    for (const action of actions) {
      state = artifactPanelReducer(state, action);
    }
    expect(state.status).toBe("opening");
    expect(state.ref?.path).toBe("/Projects/A/README.md");
  });
});

describe("panelActionsFromChatEvent — tool_target fallback", () => {
  it("promotes structured file tool_progress to open/progress events", () => {
    const actions = panelActionsFromChatEvent(
      {
        type: "tool_progress",
        chat_id: "thread-1",
        tool_name: "write_file",
        tool_status: "complete",
        tool_target: "/Projects/Legal/memo.md",
        tool_call_id: "tc-1",
      },
      { thread_id: "thread-1" },
    );

    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect(actions[0]).toMatchObject({
      type: "PANEL_EVENT",
      event: {
        type: "open",
        ref: {
          path: "/Projects/Legal/memo.md",
          source: "tool_target",
        },
      },
    });
  });

  it("resolves relative tool_target against project_vault_path", () => {
    const actions = panelActionsFromChatEvent(
      {
        type: "tool_progress",
        chat_id: "thread-1",
        tool_name: "read_file",
        tool_status: "running",
        tool_target: "notes/a.md",
        tool_call_id: "tc-2",
      },
      {
        thread_id: "thread-1",
        project_vault_path: "/home/u/Core",
      },
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "PANEL_EVENT",
      event: {
        type: "progress",
        ref: {
          path: "/home/u/Core/notes/a.md",
          source: "tool_target",
        },
      },
    });
  });

  it("does not promote bash / non-file tools", () => {
    const actions = panelActionsFromChatEvent(
      {
        type: "tool_progress",
        chat_id: "thread-1",
        tool_name: "bash",
        tool_status: "running",
        tool_target: "yarn test",
      },
      { thread_id: "thread-1" },
    );
    expect(actions).toEqual([]);
  });

  it("lp-oop.38.9: harness read completed opens the pane on the vault path", () => {
    const actions = panelActionsFromChatEvent(
      {
        type: "tool_progress",
        chat_id: "thr_1",
        tool_name: "read",
        tool_status: "completed",
        tool_target: "/Notes/memo.md",
        tool_call_id: "call_read",
      },
      { thread_id: "thr_1" },
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "PANEL_EVENT",
      event: {
        type: "open",
        ref: { path: "/Notes/memo.md", source: "tool_target" },
      },
    });
  });

  it("lp-oop.38.9: harness office read opens the pane on the docx path", () => {
    const actions = panelActionsFromChatEvent(
      {
        type: "tool_progress",
        chat_id: "thr_1",
        tool_name: "read",
        tool_status: "completed",
        tool_target: "/Projects/Workspace/office/brief.docx",
        tool_call_id: "call_office",
      },
      { thread_id: "thr_1" },
    );
    expect(actions[0]).toMatchObject({
      type: "PANEL_EVENT",
      event: {
        type: "open",
        ref: {
          path: "/Projects/Workspace/office/brief.docx",
          source: "tool_target",
        },
      },
    });
  });
});

describe("panelActionsFromChatEvent — citation auto-open policy", () => {
  it("skips citation promotions by default (click path owns them)", () => {
    const actions = panelActionsFromChatEvent(
      {
        type: "message_send",
        chat_id: "thread-1",
        content: "See sources",
        citations: [{ path: "/Projects/A/README.md", title: "README.md" }],
      },
      { thread_id: "thread-1" },
    );
    expect(actions).toEqual([]);
  });

  it("can include citation promotions when skipCitationAutoOpen is false", () => {
    const actions = panelActionsFromChatEvent(
      {
        type: "message_send",
        chat_id: "thread-1",
        citations: [{ path: "/Projects/A/README.md", title: "README.md" }],
      },
      { thread_id: "thread-1", skipCitationAutoOpen: false },
    );
    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect(actions[0]).toMatchObject({
      type: "PANEL_EVENT",
      event: { type: "open", ref: { path: "/Projects/A/README.md" } },
    });
  });

  it("lp-oop.38.9: citation click opens the pane (harness 38.7 shape)", () => {
    const action = openDocumentPathAction("/Notes/memo.md", {
      source: "citation",
      title: "memo.md",
    });
    expect(action).toMatchObject({
      type: "PANEL_OPEN",
      ref: { path: "/Notes/memo.md", source: "citation", title: "memo.md" },
      mode: "preview",
    });
  });

  it("lp-oop.38.9: office citation click opens the pane on the docx", () => {
    const action = openDocumentPathAction(
      "/Projects/Workspace/office/brief.docx",
      { source: "citation", title: "brief.docx" },
    );
    expect(action).toMatchObject({
      type: "PANEL_OPEN",
      ref: {
        path: "/Projects/Workspace/office/brief.docx",
        source: "citation",
        title: "brief.docx",
      },
    });
  });
});


describe("panelActionsFromChatEvent — defensive assistant soft mode A (lp-dpr.2)", () => {
  it("opens when assistant free-text names a multi-segment office path", () => {
    const actions = panelActionsFromChatEvent(
      {
        type: "message_send",
        chat_id: "thread-1",
        content: "I summarized /Projects/A/Proposal.docx into three bullets",
      },
      { thread_id: "thread-1" },
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "PANEL_OPEN",
      ref: { path: "/Projects/A/Proposal.docx", source: "artifact_event" },
    });
  });

  it("opens path-only assistant office vault path", () => {
    const actions = panelActionsFromChatEvent(
      {
        type: "message_send",
        chat_id: "thread-1",
        content: "/Projects/A/Budget.xlsx",
      },
      { thread_id: "thread-1" },
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "PANEL_OPEN",
      ref: { path: "/Projects/A/Budget.xlsx" },
    });
  });

  it("does not open assistant free-text bare basename without vault resolve", () => {
    const actions = panelActionsFromChatEvent(
      {
        type: "message_send",
        chat_id: "thread-1",
        content: "Here is Note.docx for your review",
      },
      { thread_id: "thread-1" },
    );
    expect(actions).toEqual([]);
  });

  it("does not double-open when artifact.open already present", () => {
    const actions = panelActionsFromChatEvent(
      {
        type: "message_send",
        chat_id: "thread-1",
        content: "Opened /Projects/A/Proposal.docx",
        metadata: {
          portal_event: "artifact.open",
          thread_id: "thread-1",
          artifact_id: "a1",
          vault_path: "/Projects/A/Proposal.docx",
          title: "Proposal.docx",
          file_type: "docx",
          producer: "agent",
          status: "open",
          timestamp: "2026-07-24T12:00:00.000Z",
        },
      },
      { thread_id: "thread-1" },
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]?.type).toBe("PANEL_EVENT");
  });

  it("still skips pure citation lists under skipCitationAutoOpen default", () => {
    const actions = panelActionsFromChatEvent(
      {
        type: "message_send",
        chat_id: "thread-1",
        content: "See sources",
        citations: [
          { path: "/Projects/A/a.docx", title: "a.docx" },
          { path: "/Projects/A/b.docx", title: "b.docx" },
        ],
      },
      { thread_id: "thread-1" },
    );
    expect(actions).toEqual([]);
  });
});

describe("detectChatOpenDocumentIntent soft mode A (lp-dpr.2)", () => {
  const AUDIT_DOCX =
    "/Business/Legal/contracts/Lanyard_MSA_7.17.26_revised.docx";

  it("extracts absolute office vault paths from free text", () => {
    expect(extractOfficeVaultPathFromText(`Please open ${AUDIT_DOCX}`)).toBe(
      AUDIT_DOCX,
    );
    expect(
      extractOfficeVaultPathFromText("see `/Projects/A/Budget.xlsx` thanks"),
    ).toBe("/Projects/A/Budget.xlsx");
    expect(extractOfficeVaultPathFromText("notes/deck.pptx")).toBe(
      "notes/deck.pptx",
    );
  });

  it("does not extract multi-segment from bare basenames or non-office files", () => {
    expect(extractOfficeVaultPathFromText("open README.md")).toBeNull();
    expect(extractOfficeVaultPathFromText("open Note.docx")).toBeNull();
    expect(extractOfficeVaultPathFromText("just chatting")).toBeNull();
  });

  it("extracts bare office basenames", () => {
    expect(extractOfficeBasenameFromText("What does Note.docx say?")).toBe(
      "Note.docx",
    );
    expect(extractOfficeBasenameFromText("Budget.xlsx")).toBe("Budget.xlsx");
    expect(extractOfficeBasenameFromText(`open ${AUDIT_DOCX}`)).toBeNull();
    expect(isOfficeBasenameToken("Note.docx")).toBe(true);
    expect(isOfficeBasenameToken("notes/a.docx")).toBe(false);
  });

  it("extractOfficePathOrBasenameFromText prefers multi-segment then basename", () => {
    expect(extractOfficePathOrBasenameFromText(`Summarize ${AUDIT_DOCX}`)).toEqual({
      path: AUDIT_DOCX,
      isBasename: false,
    });
    expect(extractOfficePathOrBasenameFromText("What does Note.docx say?")).toEqual({
      path: "Note.docx",
      isBasename: true,
    });
  });

  it("soft mode A: office path mention without open-verb is path_reference", () => {
    expect(
      detectChatOpenDocumentIntent(
        `Please summarize ${AUDIT_DOCX}`,
      ),
    ).toEqual({
      path: AUDIT_DOCX,
      kind: "path_reference",
      isBasename: false,
    });
    expect(
      detectChatOpenDocumentIntent(
        "The file /Projects/A/Proposal.docx has three sections",
      ),
    ).toEqual({
      path: "/Projects/A/Proposal.docx",
      kind: "path_reference",
      isBasename: false,
    });
    expect(
      detectChatOpenDocumentIntent("Give me an overview of /Projects/A/Deck.pptx"),
    ).toEqual({
      path: "/Projects/A/Deck.pptx",
      kind: "path_reference",
      isBasename: false,
    });
  });

  it("soft mode A: unique basename mention without open-verb is path_reference", () => {
    expect(detectChatOpenDocumentIntent("What does Note.docx say?")).toEqual({
      path: "Note.docx",
      kind: "path_reference",
      isBasename: true,
    });
    expect(detectChatOpenDocumentIntent("What is in Note.docx?")).toEqual({
      path: "Note.docx",
      kind: "path_reference",
      isBasename: true,
    });
  });

  it("still classifies open/work verbs as open_request", () => {
    expect(
      detectChatOpenDocumentIntent(`Please open ${AUDIT_DOCX}`),
    ).toEqual({ path: AUDIT_DOCX, kind: "open_request", isBasename: false });
    expect(detectChatOpenDocumentIntent("Work on Note.docx")).toEqual({
      path: "Note.docx",
      kind: "open_request",
      isBasename: true,
    });
  });

  it("detects path-only paste-and-send as path_only", () => {
    expect(detectChatOpenDocumentIntent(AUDIT_DOCX)).toEqual({
      path: AUDIT_DOCX,
      kind: "path_only",
      isBasename: false,
    });
    expect(detectChatOpenDocumentIntent("Note.docx")).toEqual({
      path: "Note.docx",
      kind: "path_only",
      isBasename: true,
    });
  });

  it("does not fire without an office path/basename token", () => {
    expect(detectChatOpenDocumentIntent("update me later")).toBeNull();
    expect(detectChatOpenDocumentIntent("please edit this draft")).toBeNull();
    expect(detectChatOpenDocumentIntent("Hello brain")).toBeNull();
  });

  it("prefers first extractable office path (one primary path per message)", () => {
    expect(
      detectChatOpenDocumentIntent(
        "Compare /Projects/A/a.docx with /Projects/B/b.docx",
      ),
    ).toEqual({
      path: "/Projects/A/a.docx",
      kind: "path_reference",
      isBasename: false,
    });
  });

  it("openDocumentIntentFromUserMessage opens on summarize without open-verb", () => {
    const action = openDocumentIntentFromUserMessage(
      `Summarize ${AUDIT_DOCX}`,
    );
    expect(action).toMatchObject({
      type: "PANEL_OPEN",
      ref: { path: AUDIT_DOCX, source: "deep_link" },
    });

    let state = createInitialArtifactPanelState();
    state = artifactPanelReducer(state, action!);
    expect(state.status).toBe("opening");
    expect(state.ref?.path).toBe(AUDIT_DOCX);
  });

  it("basename opens only when uniquely resolved", () => {
    const resolveBasename = (name: string) =>
      name === "Note.docx" ? "/Projects/A/Note.docx" : null;

    expect(
      openDocumentIntentFromUserMessage("What does Note.docx say?", {
        resolveBasename,
      }),
    ).toMatchObject({
      type: "PANEL_OPEN",
      ref: { path: "/Projects/A/Note.docx", source: "deep_link" },
    });

    expect(
      openDocumentIntentFromUserMessage("What does Note.docx say?"),
    ).toBeNull();
    expect(
      openDocumentIntentFromUserMessage("What does Note.docx say?", {
        resolveBasename: () => null,
      }),
    ).toBeNull();
  });
});
