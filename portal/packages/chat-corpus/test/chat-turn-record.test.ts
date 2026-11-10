import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CHAT_TURN_SCHEMA_VERSION,
  contentSha256,
  parseChatTurnRecord,
  safeParseChatTurnRecord,
  verifyContentHashes,
  withContentHashes,
  type ChatTurnRecord,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(
  HERE,
  "../../../../contracts/chat-corpus-v1/examples",
);

function loadExample(name: string): unknown {
  return JSON.parse(readFileSync(join(EXAMPLES, name), "utf8"));
}

function baseRecord(
  overrides: Partial<ChatTurnRecord> = {},
): ChatTurnRecord {
  const inputContent = "hello";
  const outputContent = "world";
  return {
    schema_version: 1,
    record_type: "chat_turn",
    tenant_id: "tenant-1",
    user_id: "user-1",
    instance_id: "instance-1",
    thread_id: "thread-1",
    turn_id: "turn-1",
    created_at: "2026-08-07T12:00:00.000Z",
    model: { provider: "poolside", name: "laguna-s-2.1" },
    input: {
      role: "user",
      content: inputContent,
      content_sha256: contentSha256(inputContent),
    },
    output: {
      role: "assistant",
      content: outputContent,
      content_sha256: contentSha256(outputContent),
      finish_reason: "stop",
    },
    tool_events: [],
    meta: { client: "portal_web" },
    ...overrides,
  };
}

describe("ChatTurnRecord v1 — good records", () => {
  it("exposes schema_version const 1", () => {
    expect(CHAT_TURN_SCHEMA_VERSION).toBe(1);
  });

  it("accepts a minimal valid record", () => {
    const record = parseChatTurnRecord(baseRecord());
    expect(record.schema_version).toBe(1);
    expect(record.record_type).toBe("chat_turn");
    expect(record.tool_events).toEqual([]);
  });

  it("accepts contract example: chat-turn.minimal.json", () => {
    const raw = loadExample("chat-turn.minimal.json");
    const record = parseChatTurnRecord(raw);
    expect(record.turn_id).toBe("55555555-5555-4555-8555-555555555555");
    expect(verifyContentHashes(record)).toBeNull();
  });

  it("accepts contract example: chat-turn.with-tools.json", () => {
    const raw = loadExample("chat-turn.with-tools.json");
    const record = parseChatTurnRecord(raw);
    expect(record.tool_events).toHaveLength(2);
    expect(record.tool_events[0]?.status).toBe("complete");
    expect(record.tool_events[1]?.status).toBe("error");
    expect(record.session_key).toMatch(/^agent:/);
    expect(verifyContentHashes(record)).toBeNull();
  });

  it("withContentHashes fills digests and validates", () => {
    const record = withContentHashes({
      schema_version: 1,
      record_type: "chat_turn",
      tenant_id: "t",
      user_id: "u",
      instance_id: "i",
      thread_id: "th",
      turn_id: "tu",
      created_at: "2026-08-07T00:00:00Z",
      model: { provider: "p", name: "m" },
      input: { role: "user", content: "ping" },
      output: { role: "assistant", content: "pong", finish_reason: "stop" },
      tool_events: [
        {
          tool_call_id: "c1",
          tool_name: "bash",
          status: "complete",
          duration_ms: 10,
        },
      ],
      meta: { duration_ms: 100, request_id: "r1" },
    });
    expect(record.input.content_sha256).toBe(contentSha256("ping"));
    expect(record.output.content_sha256).toBe(contentSha256("pong"));
  });
});

describe("ChatTurnRecord v1 — bad records", () => {
  it("rejects missing schema_version", () => {
    const raw = baseRecord() as Record<string, unknown>;
    delete raw.schema_version;
    const result = safeParseChatTurnRecord(raw);
    expect(result.success).toBe(false);
  });

  it("rejects wrong schema_version", () => {
    const bad = { ...baseRecord(), schema_version: 2 };
    const result = safeParseChatTurnRecord(bad);
    expect(result.success).toBe(false);
    // Valid v1 still accepted
    expect(safeParseChatTurnRecord(baseRecord()).success).toBe(true);
  });

  it("rejects missing version field (version required)", () => {
    const { schema_version: _drop, ...rest } = baseRecord();
    void _drop;
    const result = safeParseChatTurnRecord(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p === "schema_version")).toBe(true);
    }
  });

  it("rejects wrong record_type", () => {
    const bad = { ...baseRecord(), record_type: "message" };
    expect(safeParseChatTurnRecord(bad).success).toBe(false);
  });

  it("rejects missing tenant_id / turn_id", () => {
    const noTenant = { ...baseRecord() } as Record<string, unknown>;
    delete noTenant.tenant_id;
    expect(safeParseChatTurnRecord(noTenant).success).toBe(false);

    const noTurn = { ...baseRecord() } as Record<string, unknown>;
    delete noTurn.turn_id;
    expect(safeParseChatTurnRecord(noTurn).success).toBe(false);
  });

  it("rejects empty identity fields", () => {
    expect(
      safeParseChatTurnRecord(baseRecord({ tenant_id: "" })).success,
    ).toBe(false);
    expect(
      safeParseChatTurnRecord(baseRecord({ user_id: "" })).success,
    ).toBe(false);
  });

  it("rejects content_sha256 mismatch on input", () => {
    const record = baseRecord();
    record.input = {
      ...record.input,
      content_sha256: "0".repeat(64),
    };
    const result = safeParseChatTurnRecord(record);
    expect(result.success).toBe(false);
  });

  it("rejects content_sha256 mismatch on output", () => {
    const record = baseRecord();
    record.output = {
      ...record.output,
      content_sha256: "a".repeat(64),
    };
    expect(safeParseChatTurnRecord(record).success).toBe(false);
  });

  it("rejects invalid content_sha256 format", () => {
    const record = baseRecord();
    record.input = {
      ...record.input,
      content_sha256: "not-a-hash",
    };
    expect(safeParseChatTurnRecord(record).success).toBe(false);
  });

  it("rejects uppercase content_sha256", () => {
    const record = baseRecord();
    record.input = {
      ...record.input,
      content_sha256: contentSha256(record.input.content).toUpperCase(),
    };
    expect(safeParseChatTurnRecord(record).success).toBe(false);
  });

  it("rejects non-assistant output role", () => {
    const bad = {
      ...baseRecord(),
      output: {
        role: "user",
        content: "x",
        content_sha256: contentSha256("x"),
      },
    };
    expect(safeParseChatTurnRecord(bad).success).toBe(false);
  });

  it("rejects invalid tool status", () => {
    const bad = baseRecord({
      tool_events: [
        {
          tool_call_id: "c1",
          tool_name: "bash",
          status: "done" as "complete",
        },
      ],
    });
    // force invalid via plain object
    const raw = {
      ...baseRecord(),
      tool_events: [{ tool_call_id: "c1", tool_name: "bash", status: "done" }],
    };
    expect(safeParseChatTurnRecord(raw).success).toBe(false);
    void bad;
  });

  it("rejects invalid created_at", () => {
    expect(
      safeParseChatTurnRecord(baseRecord({ created_at: "not-a-date" })).success,
    ).toBe(false);
  });

  it("rejects unknown top-level properties (strict)", () => {
    const bad = { ...baseRecord(), extra_field: true };
    expect(safeParseChatTurnRecord(bad).success).toBe(false);
  });

  it("verifyContentHashes reports mismatches without full parse", () => {
    expect(
      verifyContentHashes({
        input: { content: "a", content_sha256: contentSha256("a") },
        output: { content: "b", content_sha256: contentSha256("b") },
      }),
    ).toBeNull();
    expect(
      verifyContentHashes({
        input: { content: "a", content_sha256: "0".repeat(64) },
        output: { content: "b", content_sha256: contentSha256("b") },
      }),
    ).toMatch(/input\.content_sha256/);
  });
});
