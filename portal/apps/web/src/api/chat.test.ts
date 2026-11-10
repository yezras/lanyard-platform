import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assignChatThreadName,
  assignChatThreadSystemPrompt,
  cancelChatRequest,
  haltMailboxRoom,
  chatSendErrorFromResponse,
  ChatSendError,
  createChatThread,
  deleteChatThread,
  fetchThreadHistory,
  kickSpeculativeEnsureOnline,
  sendChatMessage,
  updateChatThreadSystemPrompt,
  updateChatThreadTitle,
} from "./chat.js";
import { avatarSeedFromThreadId } from "./threadMeta.js";
import type { Project } from "./types.js";

vi.mock("./client.js", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "./client.js";

const projects: Project[] = [
  {
    project_id: "p1",
    name: "Alpha",
    vault_path: "/Projects/A",
    parent_project_id: null,
  },
];

describe("createChatThread", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("creates a thread with project metadata", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        thread_id: "thread-1",
        title: "Alpha",
        project_id: "p1",
        project_vault_path: "/Projects/A",
        created_at: "2026-07-01T12:00:00.000Z",
        avatar_seed: "aabbccdd11223344",
        title_source: "default",
      }),
    } as Response);

    await expect(
      createChatThread({ projectId: "p1", projects }),
    ).resolves.toEqual({
      thread_id: "thread-1",
      title: "Alpha",
      project_id: "p1",
      project_vault_path: "/Projects/A",
      created_at: "2026-07-01T12:00:00.000Z",
      avatar_seed: "aabbccdd11223344",
      title_source: "default",
      kind: "chat",
      scheduled_job_id: null,
      system_prompt: "",
      system_prompt_source: "default",
    });

    expect(apiFetch).toHaveBeenCalledWith("/api/chat/threads", {
      method: "POST",
      body: JSON.stringify({
        title: "Alpha",
        project_id: "p1",
      }),
    });
  });

  it("creates a default thread when no project is selected", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        thread_id: "thread-2",
        title: "New chat",
        project_id: null,
        created_at: "2026-07-01T12:00:00.000Z",
        avatar_seed: "seed-2",
        title_source: "default",
      }),
    } as Response);

    await createChatThread({ projectId: null, projects });

    expect(apiFetch).toHaveBeenCalledWith("/api/chat/threads", {
      method: "POST",
      body: JSON.stringify({ title: "New chat" }),
    });
  });

  it("backfills avatar_seed from thread_id when BFF omits it", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        thread_id: "legacy-thread",
        title: "New chat",
        project_id: null,
        created_at: "2026-07-01T12:00:00.000Z",
      }),
    } as Response);

    const result = await createChatThread({ projectId: null, projects });
    expect(result.avatar_seed).toBe(avatarSeedFromThreadId("legacy-thread"));
    expect(result.title_source).toBe("default");
  });
});

describe("updateChatThreadTitle", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("PATCHes title and optional title_source=user", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        thread_id: "thread-1",
        title: "My agent",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-01T12:00:00.000Z",
        avatar_seed: "seed-1",
        title_source: "user",
      }),
    } as Response);

    const result = await updateChatThreadTitle({
      threadId: "thread-1",
      title: "My agent",
      titleSource: "user",
    });

    expect(apiFetch).toHaveBeenCalledWith("/api/chat/threads/thread-1", {
      method: "PATCH",
      body: JSON.stringify({
        title: "My agent",
        title_source: "user",
      }),
    });
    expect(result.title_source).toBe("user");
    expect(result.avatar_seed).toBe("seed-1");
  });
});

describe("assignChatThreadName", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("POSTs assign-name with first message context", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        thread_id: "thread-1",
        title: "Quarterly pipeline",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-01T12:00:00.000Z",
        avatar_seed: "seed-1",
        title_source: "llm",
        applied: true,
        name_source: "fixture",
        skipped_reason: null,
      }),
    } as Response);

    const result = await assignChatThreadName({
      threadId: "thread-1",
      message: "summarize the quarterly pipeline",
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/chat/threads/thread-1/assign-name",
      {
        method: "POST",
        body: JSON.stringify({
          message: "summarize the quarterly pipeline",
        }),
      },
    );
    expect(result.applied).toBe(true);
    expect(result.title_source).toBe("llm");
    expect(result.title).toBe("Quarterly pipeline");
    expect(result.name_source).toBe("fixture");
  });
});

describe("updateChatThreadSystemPrompt", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("PATCHes system_prompt with source=user", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        thread_id: "thread-1",
        title: "Agent",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-01T12:00:00.000Z",
        avatar_seed: "seed-1",
        title_source: "user",
        system_prompt: "User purpose",
        system_prompt_source: "user",
      }),
    } as Response);

    const result = await updateChatThreadSystemPrompt({
      threadId: "thread-1",
      systemPrompt: "User purpose",
      systemPromptSource: "user",
    });

    expect(apiFetch).toHaveBeenCalledWith("/api/chat/threads/thread-1", {
      method: "PATCH",
      body: JSON.stringify({
        system_prompt: "User purpose",
        system_prompt_source: "user",
      }),
    });
    expect(result.system_prompt).toBe("User purpose");
    expect(result.system_prompt_source).toBe("user");
  });
});

describe("assignChatThreadSystemPrompt", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("POSTs assign-system-prompt with messages", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        thread_id: "thread-1",
        title: "Agent",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-01T12:00:00.000Z",
        avatar_seed: "seed-1",
        title_source: "llm",
        system_prompt: "Help with pipeline",
        system_prompt_source: "llm",
        applied: true,
        prompt_source: "fixture",
        skipped_reason: null,
      }),
    } as Response);

    const result = await assignChatThreadSystemPrompt({
      threadId: "thread-1",
      message: "summarize pipeline",
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/chat/threads/thread-1/assign-system-prompt",
      {
        method: "POST",
        body: JSON.stringify({
          message: "summarize pipeline",
        }),
      },
    );
    expect(result.applied).toBe(true);
    expect(result.system_prompt_source).toBe("llm");
    expect(result.prompt_source).toBe("fixture");
  });
});

describe("kickSpeculativeEnsureOnline (lp-vqr0.9 T7)", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("POSTs /api/chat/ensure-online", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ ok: true, action: "waking", path: "relay" }),
    } as Response);

    await kickSpeculativeEnsureOnline();

    expect(apiFetch).toHaveBeenCalledWith("/api/chat/ensure-online", {
      method: "POST",
      body: JSON.stringify({}),
    });
  });

  it("throws when the BFF rejects the kick", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Not authenticated" }),
    } as Response);

    await expect(kickSpeculativeEnsureOnline()).rejects.toThrow(
      /Speculative ensure_online failed \(401\)/,
    );
  });
});

describe("cancelChatRequest", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("POSTs cancel for the thread", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await cancelChatRequest("thread-1");

    expect(apiFetch).toHaveBeenCalledWith("/api/chat/threads/thread-1/cancel", {
      method: "POST",
      body: JSON.stringify({}),
    });
  });
});

describe("haltMailboxRoom", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("POSTs mailbox/halt for the thread, not cancel", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await haltMailboxRoom("thread-1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/chat/threads/thread-1/mailbox/halt",
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    expect(apiFetch).not.toHaveBeenCalledWith(
      "/api/chat/threads/thread-1/cancel",
      expect.anything(),
    );
  });
});

describe("sendChatMessage wake failures (lp-6ty / lp-mrh)", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("throws ChatSendError with message + retry_guidance on wake_timeout", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 504,
      json: async () => ({
        error: "wake_timeout",
        code: "wake_timeout",
        message:
          "The agent is taking longer than expected to start. Your message was not delivered.",
        retryable: true,
        retry_guidance:
          "Wait a few seconds and send your message again. Cold start can take up to a minute.",
        phase: "ensure_online",
        cp_code: "ENSURE_ONLINE_TIMEOUT",
      }),
    } as Response);

    let caught: unknown;
    try {
      await sendChatMessage({ threadId: "thread-1", text: "hello" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ChatSendError);
    const err = caught as ChatSendError;
    expect(err.isWakeFailure).toBe(true);
    expect(err.code).toBe("wake_timeout");
    expect(err.status).toBe(504);
    expect(err.message).toContain("taking longer");
    expect(err.message).toContain("Wait a few seconds");
  });

  it("chatSendErrorFromResponse maps generic relay errors", () => {
    const err = chatSendErrorFromResponse(502, { error: "Relay down" });
    expect(err.isWakeFailure).toBe(false);
    expect(err.message).toBe("Relay down");
  });

  it("202 agent_starting is ok and returns starting so the chip can show", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        ok: true,
        status: "agent_starting",
        thread_id: "thread-1",
        instance_id: "inst-1",
        presence: "offline",
        message: "Agent starting…",
      }),
    } as Response);

    await expect(
      sendChatMessage({ threadId: "thread-1", text: "ping" }),
    ).resolves.toEqual({
      agentStarting: true,
      message: "Agent starting…",
    });
  });
});

describe("deleteChatThread", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("DELETEs the thread by id", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await expect(deleteChatThread("thread-1")).resolves.toBeUndefined();

    expect(apiFetch).toHaveBeenCalledWith("/api/chat/threads/thread-1", {
      method: "DELETE",
    });
  });

  it("throws when the API returns an error", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Chat thread not found" }),
    } as Response);

    await expect(deleteChatThread("missing")).rejects.toThrow(
      "Chat thread not found",
    );
  });
});

describe("fetchThreadHistory", () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("GETs durable events for a thread", async () => {
    const events = [
      {
        type: "user_message",
        message_id: "u1",
        content: "Hi",
        created_at: "2026-01-01T00:00:00.000Z",
        chat_id: "thread-1",
      },
      {
        type: "message_send",
        chat_id: "thread-1",
        message_id: "a1",
        content: "Hello",
      },
    ];
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ thread_id: "thread-1", events }),
    } as Response);

    await expect(fetchThreadHistory("thread-1")).resolves.toEqual(events);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/chat/threads/thread-1/history",
    );
  });

  it("throws when the API returns an error", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Chat thread not found" }),
    } as Response);

    await expect(fetchThreadHistory("missing")).rejects.toThrow(
      "Chat thread not found",
    );
  });
});