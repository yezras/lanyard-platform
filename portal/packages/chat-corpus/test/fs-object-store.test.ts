/**
 * lp-gkh.9 — FsCorpusObjectStore durable put/get/list (survives new instance).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildChatCorpusObjectKeyFromRecord,
  contentSha256,
  FsCorpusObjectStore,
  S3CorpusWriter,
  type ChatTurnRecord,
} from "../src/index.js";

const BUCKET = "lanyard-chat-corpus-lab";

function baseRecord(overrides: Partial<ChatTurnRecord> = {}): ChatTurnRecord {
  const inputContent = "user live proof";
  const outputContent = "assistant live proof";
  return {
    schema_version: 1,
    record_type: "chat_turn",
    tenant_id: "mocklab-tenant",
    user_id: "user-1",
    instance_id: "instance-1",
    thread_id: "thread-1",
    turn_id: "turn-live-1",
    created_at: "2026-08-13T12:00:00.000Z",
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

describe("FsCorpusObjectStore", () => {
  let root: string;

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("put/get/list and survives a new store instance (restart)", async () => {
    root = await mkdtemp(path.join(tmpdir(), "corpus-fs-"));
    const storeA = new FsCorpusObjectStore({ rootDir: root });
    const writer = new S3CorpusWriter({ bucket: BUCKET, store: storeA });
    const record = baseRecord();
    const result = await writer.writeTurn(record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const key = result.key;
    expect(key).toContain("tenants/mocklab-tenant/chat-corpus/v1/");
    expect(key).toContain("turn=turn-live-1.json");

    // New process simulation: brand-new store, same root.
    const storeB = new FsCorpusObjectStore({ rootDir: root });
    const body = await storeB.getObject({ bucket: BUCKET, key });
    expect(body).toBeTruthy();
    const parsed = JSON.parse(body!) as ChatTurnRecord;
    expect(parsed.input.content).toBe("user live proof");
    expect(parsed.output.content).toBe("assistant live proof");

    const listed = await storeB.listObjects!({
      bucket: BUCKET,
      prefix: "tenants/mocklab-tenant/chat-corpus/",
    });
    expect(listed.objects.map((o) => o.key)).toContain(key);
  });

  it("rejects path-escape keys", async () => {
    root = await mkdtemp(path.join(tmpdir(), "corpus-fs-"));
    const store = new FsCorpusObjectStore({ rootDir: root });
    await expect(
      store.putObject({
        bucket: BUCKET,
        key: "../escape.json",
        body: "{}",
      }),
    ).rejects.toThrow(/not allowed/);
  });

  it("buildChatCorpusObjectKey matches written key", async () => {
    root = await mkdtemp(path.join(tmpdir(), "corpus-fs-"));
    const store = new FsCorpusObjectStore({ rootDir: root });
    const writer = new S3CorpusWriter({ bucket: BUCKET, store });
    const record = baseRecord();
    const expected = buildChatCorpusObjectKeyFromRecord(record);
    const result = await writer.writeTurn(record);
    expect(result.ok && result.key).toBe(expected);
  });
});
