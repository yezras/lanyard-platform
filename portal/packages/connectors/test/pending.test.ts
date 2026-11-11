import { describe, expect, it } from "vitest";

import {
  GMAIL_DRAFTS_CREATE_ARGV,
  PENDING_CONNECTOR_USE_TTL_MS,
  buildNeedsAuthWizard,
  buildPendingConnectorUse,
  connectorIdForActionClass,
  connectorIdForArgv,
  decideConnectorChatUse,
  decideConnectorResume,
  isHealthyConnectorStatus,
  isPendingExpired,
  pendingArgv,
  preferPendingGmailDraft,
} from "../src/pending.js";

describe("preferPendingGmailDraft", () => {
  it("rewrites gmail.send to drafts.create and keeps flags", () => {
    expect(
      preferPendingGmailDraft([
        "gws",
        "gmail",
        "users",
        "messages",
        "send",
        "--to",
        "ada@example.com",
        "--subject",
        "Hi",
      ]),
    ).toEqual([
      ...GMAIL_DRAFTS_CREATE_ARGV,
      "--to",
      "ada@example.com",
      "--subject",
      "Hi",
    ]);
  });

  it("leaves drafts.create unchanged", () => {
    const argv = [...GMAIL_DRAFTS_CREATE_ARGV, "--to", "ada@example.com"];
    expect(preferPendingGmailDraft(argv)).toEqual(argv);
  });

  it("does not rewrite gmail.read", () => {
    const argv = ["gws", "gmail", "users", "messages", "list"];
    expect(preferPendingGmailDraft(argv)).toEqual(argv);
  });
});

describe("decideConnectorChatUse", () => {
  it("returns needs_auth instead of treating not_connected as ready", () => {
    const decision = decideConnectorChatUse({
      tenant_id: "t1",
      user_id: "u1",
      thread_id: "th-1",
      connector_id: "google",
      argv: ["gws", "gmail", "users", "drafts", "create", "--to", "ada@example.com"],
      connection_status: "not_connected",
      now: 1_000,
    });
    expect(decision.kind).toBe("needs_auth");
    if (decision.kind !== "needs_auth") return;
    expect(decision.pending.tool).toBe("gws");
    expect(decision.pending.args).toEqual([
      "gmail",
      "users",
      "drafts",
      "create",
      "--to",
      "ada@example.com",
    ]);
    expect(decision.pending.action_class).toBe("gmail.draft");
    expect(decision.pending.expires_at).toBe(1_000 + PENDING_CONNECTOR_USE_TTL_MS);
  });

  it("stores one gmail.draft tool when the turn asked to send", () => {
    const decision = decideConnectorChatUse({
      tenant_id: "t1",
      user_id: "u1",
      thread_id: "th-1",
      connector_id: "google",
      argv: ["gws", "gmail", "+send", "--to", "ada@example.com"],
      connection_status: "needs_reauth",
      now: 50,
    });
    expect(decision.kind).toBe("needs_auth");
    if (decision.kind !== "needs_auth") return;
    expect(pendingArgv(decision.pending)).toEqual([
      ...GMAIL_DRAFTS_CREATE_ARGV,
      "--to",
      "ada@example.com",
    ]);
    expect(decision.pending.action_class).toBe("gmail.draft");
  });

  it("proceeds when already connected", () => {
    expect(
      decideConnectorChatUse({
        tenant_id: "t1",
        user_id: "u1",
        thread_id: "th-1",
        connector_id: "google",
        argv: [...GMAIL_DRAFTS_CREATE_ARGV],
        connection_status: "connected",
      }),
    ).toEqual({ kind: "ready" });
  });
});

describe("decideConnectorResume", () => {
  const pending = buildPendingConnectorUse({
    tenant_id: "t1",
    user_id: "u1",
    thread_id: "th-1",
    connector_id: "google",
    argv: [...GMAIL_DRAFTS_CREATE_ARGV, "--subject", "Draft only"],
    now: 10,
    ttl_ms: 100,
  });

  it("resumes only the stored tool args", () => {
    expect(
      decideConnectorResume({
        pending,
        connector_id: "google",
        now: 50,
      }),
    ).toEqual({
      kind: "resume",
      connector_id: "google",
      tool: "gws",
      args: ["gmail", "users", "drafts", "create", "--subject", "Draft only"],
      thread_id: "th-1",
    });
  });

  it("cancel and TTL do not auto-send", () => {
    expect(
      decideConnectorResume({
        pending,
        connector_id: "google",
        cancelled: true,
        now: 50,
      }),
    ).toMatchObject({
      kind: "connected_no_resume",
      reason: "cancelled",
      message: "Google connected. The pending tool was not sent.",
    });
    expect(
      decideConnectorResume({
        pending,
        connector_id: "google",
        now: 110,
      }),
    ).toMatchObject({
      kind: "connected_no_resume",
      reason: "expired",
      message: "Google connected. The pending tool was not sent.",
    });
  });

  it("page Connect has no pending tool to resume", () => {
    expect(
      decideConnectorResume({
        pending,
        connector_id: "google",
        source: "page",
        now: 50,
      }),
    ).toMatchObject({
      kind: "connected_no_resume",
      reason: "page_connect",
    });
  });
});

describe("needs_auth wizard", () => {
  it("is a connect/cancel bubble bound to the thread", () => {
    const wizard = buildNeedsAuthWizard({
      connector_id: "google",
      thread_id: "th-1",
    });
    expect(wizard.portal_event).toBe("needs_auth");
    expect(wizard.mcq_id).toBe("cc-needs_auth-google-th-1");
    expect(wizard.choices.map((c) => c.id)).toEqual(["connect", "cancel"]);
    expect(wizard.content).toMatch(/new tab/i);
  });
});

describe("helpers", () => {
  it("maps action classes onto closed connector ids", () => {
    expect(connectorIdForActionClass("gmail.draft")).toBe("google");
    expect(connectorIdForActionClass("hubspot.write")).toBe("hubspot");
    expect(connectorIdForArgv(["gws", "gmail", "users", "drafts", "create"])).toBe(
      "google",
    );
    expect(isHealthyConnectorStatus("not_connected")).toBe(false);
    expect(isHealthyConnectorStatus("connected")).toBe(true);
    expect(
      isPendingExpired({
        ...buildPendingConnectorUse({
          tenant_id: "t1",
          user_id: "u1",
          thread_id: "th-1",
          connector_id: "google",
          argv: [...GMAIL_DRAFTS_CREATE_ARGV],
          now: 0,
          ttl_ms: 10,
        }),
      }, 10),
    ).toBe(true);
  });
});
