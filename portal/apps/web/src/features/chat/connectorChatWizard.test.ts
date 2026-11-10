import { describe, expect, it, vi } from "vitest";

import {
  applyConnectorOAuthSuccess,
  applyConnectorWizardChoice,
  connectorWizardMcqId,
  createConnectorChatWizardSession,
  formatConnectorResumePrompt,
  googleToolArgvFromChatEvent,
  isConnectorChatWizardMcqId,
  openConnectorOAuthTab,
} from "./connectorChatWizard.js";

function session(overrides: Partial<ReturnType<typeof createConnectorChatWizardSession>> = {}) {
  return {
    ...createConnectorChatWizardSession({
      connectorId: "google",
      threadId: "th-1",
      tool: "gws",
      args: ["gmail", "users", "drafts", "create", "--to", "ada@example.com"],
      expiresAt: 1_000,
    }),
    ...overrides,
  };
}

describe("connector chat wizard", () => {
  it("connects in a new tab and resumes only stored args", () => {
    const created = session();
    expect(isConnectorChatWizardMcqId(created.sessionId)).toBe(true);
    expect(created.sessionId).toBe(connectorWizardMcqId("google", "th-1"));

    const connect = applyConnectorWizardChoice(
      created,
      { mcq_id: created.sessionId, choice_id: "connect" },
      50,
    );
    expect(connect.ok).toBe(true);
    if (!connect.ok) return;
    expect(connect.shouldOpenOAuth).toBe(true);
    expect(connect.session.step).toBe("waiting_oauth");

    const success = applyConnectorOAuthSuccess(connect.session, 50);
    expect(success.ok).toBe(true);
    if (!success.ok) return;
    expect(success.shouldResume).toBe(true);
    expect(success.assistantMessage).toMatch(/stored tool only/i);
    expect(
      formatConnectorResumePrompt(success.session.tool, success.session.args),
    ).toBe(
      "Resume only this Google tool (do not replay the previous turn): gws gmail users drafts create --to ada@example.com",
    );
  });

  it("cancel and TTL never auto-send", () => {
    const created = session();
    const cancel = applyConnectorWizardChoice(
      created,
      { mcq_id: created.sessionId, choice_id: "cancel" },
      50,
    );
    expect(cancel.ok).toBe(true);
    if (!cancel.ok) return;
    expect(cancel.shouldResume).toBe(false);
    expect(cancel.shouldCancelPending).toBe(true);

    const afterCancel = applyConnectorOAuthSuccess(cancel.session, 50);
    expect(afterCancel.ok).toBe(true);
    if (!afterCancel.ok) return;
    expect(afterCancel.shouldResume).toBe(false);
    expect(afterCancel.assistantMessage).toMatch(/was not sent/i);

    const expired = applyConnectorOAuthSuccess(session({ step: "waiting_oauth" }), 2_000);
    expect(expired.ok).toBe(true);
    if (!expired.ok) return;
    expect(expired.shouldResume).toBe(false);
    expect(expired.session.step).toBe("expired");
  });

  it("opens OAuth with _blank and no noopener", () => {
    const open = vi.fn().mockReturnValue({ closed: false });
    vi.stubGlobal("open", open);
    expect(openConnectorOAuthTab("https://accounts.google.com/o/oauth2/v2/auth")).toEqual({
      opened: true,
    });
    expect(open).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth",
      "_blank",
    );
    vi.unstubAllGlobals();
  });

  it("maps a Gmail tool event onto argv", () => {
    expect(
      googleToolArgvFromChatEvent({
        tool_name: "bash",
        tool_target: "gws gmail users messages send --to ada@example.com",
      }),
    ).toEqual([
      "gws",
      "gmail",
      "users",
      "messages",
      "send",
      "--to",
      "ada@example.com",
    ]);
    expect(
      googleToolArgvFromChatEvent({
        tool_name: "gws-gmail-send",
        error_message: "403 unauthorized",
      }),
    ).toEqual(["gws", "gmail", "users", "drafts", "create"]);
    expect(googleToolArgvFromChatEvent({ tool_name: "web_search" })).toBeNull();
  });
});
