/**
 * lp-gkh.8 — Training export: list/read turns by tenant + time range.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildChatCorpusDayPrefix,
  buildChatCorpusDayPrefixesForRange,
  buildChatCorpusObjectKeyFromRecord,
  contentSha256,
  CorpusTrainingExporter,
  enumerateChatCorpusDayHives,
  FakeCorpusObjectStore,
  isChatCorpusTurnObjectKey,
  iterateCorpusTurns,
  listCorpusTurns,
  readCorpusTurn,
  S3CorpusWriter,
  utcDateString,
  type ChatTurnRecord,
} from "../src/index.js";

const BUCKET = "lanyard-chat-corpus-export-test";
const PKG_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function baseRecord(overrides: Partial<ChatTurnRecord> = {}): ChatTurnRecord {
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
    created_at: "2026-08-07T15:04:05.000Z",
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

async function seed(
  store: FakeCorpusObjectStore,
  records: ChatTurnRecord[],
): Promise<string[]> {
  const writer = new S3CorpusWriter({ bucket: BUCKET, store });
  const keys: string[] = [];
  for (const r of records) {
    const result = await writer.writeTurn(r);
    expect(result.ok).toBe(true);
    if (result.ok) keys.push(result.key);
  }
  return keys;
}

describe("date / day prefix helpers (lp-gkh.8)", () => {
  it("utcDateString accepts YYYY-MM-DD and RFC3339", () => {
    expect(utcDateString("2026-08-07")).toBe("2026-08-07");
    expect(utcDateString("2026-08-07T23:30:00+09:00")).toBe("2026-08-07");
    // +09:00 morning → previous UTC day
    expect(utcDateString("2026-08-07T01:00:00+09:00")).toBe("2026-08-06");
  });

  it("enumerates inclusive UTC day hives", () => {
    const hives = enumerateChatCorpusDayHives("2026-08-06", "2026-08-08");
    expect(hives).toEqual([
      { year: "2026", month: "08", day: "06" },
      { year: "2026", month: "08", day: "07" },
      { year: "2026", month: "08", day: "08" },
    ]);
  });

  it("buildChatCorpusDayPrefix has trailing slash and hive segments", () => {
    const p = buildChatCorpusDayPrefix("tenant-1", {
      year: "2026",
      month: "08",
      day: "07",
    });
    expect(p).toBe(
      "tenants/tenant-1/chat-corpus/v1/year=2026/month=08/day=07/",
    );
  });

  it("buildChatCorpusDayPrefixesForRange matches enumerate length", () => {
    const prefixes = buildChatCorpusDayPrefixesForRange(
      "tenant-1",
      "2026-08-06",
      "2026-08-07",
    );
    expect(prefixes).toHaveLength(2);
    expect(prefixes[0]).toContain("day=06/");
    expect(prefixes[1]).toContain("day=07/");
  });

  it("isChatCorpusTurnObjectKey accepts normative keys only", () => {
    const key = buildChatCorpusObjectKeyFromRecord(baseRecord());
    expect(isChatCorpusTurnObjectKey(key)).toBe(true);
    expect(
      isChatCorpusTurnObjectKey(
        "tenants/tenant-1/chat-corpus/v1/year=2026/month=08/day=07/",
      ),
    ).toBe(false);
  });
});

describe("listCorpusTurns against FakeCorpusObjectStore", () => {
  it("lists expected keys for tenant + date range (dry-run shape)", async () => {
    const store = new FakeCorpusObjectStore();
    const inRangeA = baseRecord({
      turn_id: "turn-a",
      thread_id: "thread-a",
      created_at: "2026-08-06T10:00:00.000Z",
    });
    const inRangeB = baseRecord({
      turn_id: "turn-b",
      thread_id: "thread-b",
      created_at: "2026-08-07T12:00:00.000Z",
    });
    const inRangeC = baseRecord({
      turn_id: "turn-c",
      thread_id: "thread-c",
      created_at: "2026-08-08T08:00:00.000Z",
    });
    const outOfRange = baseRecord({
      turn_id: "turn-old",
      thread_id: "thread-old",
      created_at: "2026-08-01T00:00:00.000Z",
    });
    const otherTenant = baseRecord({
      tenant_id: "other-tenant",
      turn_id: "turn-x",
      thread_id: "thread-x",
      created_at: "2026-08-07T00:00:00.000Z",
    });

    await seed(store, [
      inRangeA,
      inRangeB,
      inRangeC,
      outOfRange,
      otherTenant,
    ]);

    const listed = await listCorpusTurns({
      store,
      bucket: BUCKET,
      tenant_id: "tenant-1",
      from: "2026-08-06",
      to: "2026-08-08",
    });

    expect(listed.ok).toBe(true);
    if (!listed.ok) return;

    const keys = listed.keys.map((k) => k.key);
    expect(keys).toEqual([
      buildChatCorpusObjectKeyFromRecord(inRangeA),
      buildChatCorpusObjectKeyFromRecord(inRangeB),
      buildChatCorpusObjectKeyFromRecord(inRangeC),
    ]);
    expect(keys).not.toContain(buildChatCorpusObjectKeyFromRecord(outOfRange));
    expect(keys).not.toContain(
      buildChatCorpusObjectKeyFromRecord(otherTenant),
    );
    expect(listed.prefixes).toHaveLength(3);
    expect(store.getListCount()).toBeGreaterThanOrEqual(3);
  });

  it("returns empty keys when range has no objects", async () => {
    const store = new FakeCorpusObjectStore();
    await seed(store, [baseRecord()]);
    const listed = await listCorpusTurns({
      store,
      bucket: BUCKET,
      tenant_id: "tenant-1",
      from: "2025-01-01",
      to: "2025-01-02",
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.keys).toEqual([]);
  });

  it("fails closed when store lacks listObjects", async () => {
    const store = {
      async getObject() {
        return null;
      },
      async putObject() {},
    };
    const listed = await listCorpusTurns({
      store,
      bucket: BUCKET,
      tenant_id: "tenant-1",
      from: "2026-08-07",
      to: "2026-08-07",
    });
    expect(listed.ok).toBe(false);
    if (listed.ok) return;
    expect(listed.code).toBe("LIST_NOT_SUPPORTED");
  });

  it("rejects inverted date ranges without throwing", async () => {
    const store = new FakeCorpusObjectStore();
    const listed = await listCorpusTurns({
      store,
      bucket: BUCKET,
      tenant_id: "tenant-1",
      from: "2026-08-10",
      to: "2026-08-01",
    });
    expect(listed.ok).toBe(false);
    if (listed.ok) return;
    expect(listed.code).toBe("INVALID_DATE_RANGE");
  });
});

describe("readCorpusTurn + iterate", () => {
  it("reads a full ChatTurnRecord body for training pipeline", async () => {
    const store = new FakeCorpusObjectStore();
    const record = baseRecord({ turn_id: "turn-read" });
    const [key] = await seed(store, [record]);
    const read = await readCorpusTurn({ store, bucket: BUCKET, key });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.record.turn_id).toBe("turn-read");
    expect(read.record.input.content).toBe("hello");
    expect(read.record.output.content).toBe("world");
  });

  it("returns NOT_FOUND for missing keys", async () => {
    const store = new FakeCorpusObjectStore();
    const read = await readCorpusTurn({
      store,
      bucket: BUCKET,
      key: "tenants/tenant-1/chat-corpus/v1/year=2026/month=08/day=07/thread=t/turn=missing.json",
    });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.code).toBe("NOT_FOUND");
  });

  it("iterateCorpusTurns yields list then each record", async () => {
    const store = new FakeCorpusObjectStore();
    const a = baseRecord({
      turn_id: "t-iter-a",
      created_at: "2026-08-07T01:00:00.000Z",
    });
    const b = baseRecord({
      turn_id: "t-iter-b",
      created_at: "2026-08-07T02:00:00.000Z",
    });
    await seed(store, [a, b]);

    const rows: string[] = [];
    for await (const row of iterateCorpusTurns({
      store,
      bucket: BUCKET,
      tenant_id: "tenant-1",
      from: "2026-08-07",
      to: "2026-08-07",
    })) {
      expect(row.ok).toBe(true);
      if (row.ok) rows.push(row.record.turn_id);
    }
    expect(rows.sort()).toEqual(["t-iter-a", "t-iter-b"]);
  });

  it("CorpusTrainingExporter binds bucket + store", async () => {
    const store = new FakeCorpusObjectStore();
    await seed(store, [
      baseRecord({ turn_id: "t-exp", created_at: "2026-08-07T00:00:00.000Z" }),
    ]);
    const exporter = new CorpusTrainingExporter({ bucket: BUCKET, store });
    const listed = await exporter.listTurns({
      tenant_id: "tenant-1",
      from: "2026-08-07",
      to: "2026-08-07",
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.keys).toHaveLength(1);
    const read = await exporter.readTurn(listed.keys[0]!.key);
    expect(read.ok && read.record.turn_id === "t-exp").toBe(true);
  });
});

describe("CLI dry-run against fake S3 (lp-gkh.8 acceptance)", () => {
  it("lists expected keys on stdout without secrets", () => {
    const cli = path.join(PKG_ROOT, "src/cli/export-training.ts");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "--fake",
        "--tenant",
        "tenant-1",
        "--from",
        "2026-08-06",
        "--to",
        "2026-08-08",
        "--mode",
        "list",
      ],
      {
        cwd: PKG_ROOT,
        encoding: "utf8",
        env: { ...process.env },
      },
    );

    expect(result.status).toBe(0);
    const lines = result.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    expect(lines).toEqual([
      "tenants/tenant-1/chat-corpus/v1/year=2026/month=08/day=06/thread=thread-a/turn=turn-a1.json",
      "tenants/tenant-1/chat-corpus/v1/year=2026/month=08/day=07/thread=thread-a/turn=turn-a2.json",
      "tenants/tenant-1/chat-corpus/v1/year=2026/month=08/day=08/thread=thread-b/turn=turn-b1.json",
    ]);

    // No secrets / credential material in output
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toMatch(/AKIA[0-9A-Z]{16}/);
    expect(combined).not.toMatch(/aws_secret|AWS_SECRET|password\s*=/i);
    // Other-tenant and out-of-range keys must not appear
    expect(combined).not.toContain("other-tenant");
    expect(combined).not.toContain("turn-old");
  });

  it("jsonl mode streams parseable ChatTurnRecord lines", () => {
    const cli = path.join(PKG_ROOT, "src/cli/export-training.ts");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cli,
        "--fake",
        "--tenant",
        "tenant-1",
        "--from",
        "2026-08-07",
        "--to",
        "2026-08-07",
        "--mode",
        "jsonl",
      ],
      {
        cwd: PKG_ROOT,
        encoding: "utf8",
        env: { ...process.env },
      },
    );
    expect(result.status).toBe(0);
    const lines = result.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!) as ChatTurnRecord;
    expect(rec.record_type).toBe("chat_turn");
    expect(rec.turn_id).toBe("turn-a2");
    expect(rec.input.content.length).toBeGreaterThan(0);
    expect(rec.output.content.length).toBeGreaterThan(0);
  });
});
