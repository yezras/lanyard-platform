import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as shared from "../index.js";
import * as browser from "../browser.js";
import {
  MAILBOX_ERROR_CODES,
  type MailboxErrorCode,
} from "./errors.js";
import {
  CONNECTOR_MARKS,
  isConnectorMark,
  isMailboxForbiddenTo,
  MAILBOX_SCHEMA_VERSION,
  MAILBOX_SEND_INPUT_FIELDS,
  MAILBOX_SEND_STAMP_FIELDS,
  MAILBOX_SEND_TOOL_NAME,
  mailboxDedupeKey,
  mailboxExternalMessageId,
  parseMailboxAppendRequest,
  parseMailboxAppendResult,
  parseMailboxHaltInput,
  parseMailboxSendInput,
  parseMailboxTo,
  personaId,
  proseMailboxNonce,
  threadId,
} from "./send.js";

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "contracts/mailbox-v1/mailbox.schema.json"))) {
      return dir;
    }
    dir = dirname(dir);
  }
  throw new Error("contracts/mailbox-v1/mailbox.schema.json not found");
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

type JsonSchema = {
  $defs?: Record<
    string,
    {
      required?: string[];
      properties?: Record<string, unknown>;
      enum?: string[];
      const?: unknown;
      description?: string;
    }
  >;
};

function loadMailboxSchema(): JsonSchema {
  return JSON.parse(
    readFileSync(
      join(repoRoot, "contracts/mailbox-v1/mailbox.schema.json"),
      "utf8",
    ),
  ) as JsonSchema;
}

describe("branded ids", () => {
  it("accepts a single PersonaId / ThreadId with no colon or whitespace", () => {
    expect(personaId("fizz")).toBe("fizz");
    expect(threadId("thr_workshop")).toBe("thr_workshop");
  });

  it("rejects colon, whitespace, empty, and overlong ids", () => {
    expect(() => personaId("")).toThrow(/invalid PersonaId/);
    expect(() => personaId("a:b")).toThrow(/invalid PersonaId/);
    expect(() => personaId("a b")).toThrow(/invalid PersonaId/);
    expect(() => personaId("fizz\n")).toThrow(/invalid PersonaId/);
    expect(() => personaId("x".repeat(129))).toThrow(/invalid PersonaId/);
    expect(() => threadId("")).toThrow(/invalid ThreadId/);
    expect(() => threadId("room:1")).toThrow(/invalid ThreadId/);
    expect(() => threadId("room 1")).toThrow(/invalid ThreadId/);
    expect(() => threadId("x".repeat(129))).toThrow(/invalid ThreadId/);
  });
});

describe("mailbox.send one-to", () => {
  it("parses exactly one branded to", () => {
    const input = parseMailboxSendInput({
      to: "fizz",
      room: "thr_1",
      text: "hello",
      nonce: "11111111-1111-1111-1111-111111111111",
    });
    expect(input.to).toBe("fizz");
    expect(input.room).toBe("thr_1");
    expect(input.text).toBe("hello");
    expect(Array.isArray(input.to)).toBe(false);
  });

  it("rejects a list of tos", () => {
    expect(() =>
      parseMailboxSendInput({
        to: ["fizz", "bill"],
        room: "thr_1",
        text: "hello",
        nonce: "n1",
      }),
    ).toThrow(/invalid MailboxSendInput/);
  });

  it("rejects Jack and connector ids as to (bad_to)", () => {
    const base = { room: "thr_1", text: "hi", nonce: "n1" };
    expect(() => parseMailboxTo("Jack")).toThrow(/bad_to/);
    expect(() => parseMailboxTo("jack")).toThrow(/bad_to/);
    expect(() => parseMailboxSendInput({ ...base, to: "Jack" })).toThrow(
      /bad_to/,
    );
    for (const mark of CONNECTOR_MARKS) {
      expect(isConnectorMark(mark)).toBe(true);
      expect(isMailboxForbiddenTo(mark)).toBe(true);
      expect(() => parseMailboxTo(mark)).toThrow(/bad_to/);
    }
  });

  it("rejects from on the model-visible tool input", () => {
    expect(() =>
      parseMailboxSendInput({
        to: "fizz",
        room: "thr_1",
        text: "hi",
        nonce: "n1",
        from: "bill",
      }),
    ).toThrow(/invalid MailboxSendInput/);
    expect(MAILBOX_SEND_INPUT_FIELDS).toEqual(["to", "room", "text", "nonce"]);
    expect(MAILBOX_SEND_STAMP_FIELDS).toEqual(["from", "tenant_id"]);
    expect(MAILBOX_SEND_INPUT_FIELDS).not.toContain("from");
    expect(MAILBOX_SEND_INPUT_FIELDS).not.toContain("tenant_id");
  });
});

describe("nonce identity", () => {
  it("nonce IS externalMessageId and the only dedupe key", () => {
    const nonce = "prose:turn-1:fizz:thr_1";
    const a = parseMailboxSendInput({
      to: "fizz",
      room: "thr_1",
      text: "one",
      nonce,
    });
    const b = parseMailboxSendInput({
      to: "fizz",
      room: "thr_1",
      text: "different body",
      nonce,
    });
    expect(mailboxExternalMessageId(a.nonce)).toBe(nonce);
    expect(mailboxDedupeKey(a.nonce)).toBe(a.nonce);
    expect(mailboxDedupeKey(a.nonce)).toBe(mailboxDedupeKey(b.nonce));
    expect(a.text).not.toBe(b.text);
  });

  it("different nonces are different dedupe keys even when text matches", () => {
    const a = parseMailboxSendInput({
      to: "fizz",
      room: "thr_1",
      text: "same",
      nonce: "n-a",
    });
    const b = parseMailboxSendInput({
      to: "fizz",
      room: "thr_1",
      text: "same",
      nonce: "n-b",
    });
    expect(mailboxDedupeKey(a.nonce)).not.toBe(mailboxDedupeKey(b.nonce));
  });

  it("builds the prose @ nonce shape", () => {
    const to = personaId("fizz");
    const room = threadId("thr_1");
    expect(proseMailboxNonce("turn-9", to, room)).toBe(
      "prose:turn-9:fizz:thr_1",
    );
  });

  it("rejects empty nonce", () => {
    expect(() =>
      parseMailboxSendInput({
        to: "fizz",
        room: "thr_1",
        text: "hi",
        nonce: "",
      }),
    ).toThrow(/invalid MailboxSendInput/);
  });
});

describe("mailbox_halt", () => {
  it("parses room only", () => {
    expect(parseMailboxHaltInput({ room: "thr_1" })).toEqual({
      room: "thr_1",
    });
  });

  it("rejects from on halt input", () => {
    expect(() =>
      parseMailboxHaltInput({ room: "thr_1", from: "bill" }),
    ).toThrow(/invalid MailboxHaltInput/);
  });
});

describe("mailbox append request/result (types only)", () => {
  it("stamps from + tenant_id onto send input", () => {
    const req = parseMailboxAppendRequest({
      to: "fizz",
      room: "thr_1",
      text: "hi",
      nonce: "n1",
      from: "bill",
      tenant_id: "ten_1",
    });
    expect(req.from).toBe("bill");
    expect(req.tenant_id).toBe("ten_1");
    expect(req.to).toBe("fizz");
  });

  it("parses ok + message_id or a locked error code", () => {
    expect(parseMailboxAppendResult({ ok: true, message_id: "msg_1" })).toEqual(
      {
        ok: true,
        message_id: "msg_1",
      },
    );
    expect(
      parseMailboxAppendResult({ ok: false, error: "frozen" }),
    ).toEqual({ ok: false, error: "frozen" });
    expect(() =>
      parseMailboxAppendResult({ ok: false, error: "unauthorized" }),
    ).toThrow(/invalid MailboxAppendResult/);
  });
});

describe("contracts/mailbox-v1 schema matches TS fields", () => {
  it("schema version is 1", () => {
    expect(MAILBOX_SCHEMA_VERSION).toBe(1);
    const schema = loadMailboxSchema();
    expect(schema.$defs?.schemaVersion?.const).toBe(1);
  });

  it("mailboxSendInput has to/room/text/nonce and no from", () => {
    const schema = loadMailboxSchema();
    const send = schema.$defs?.mailboxSendInput;
    expect(send?.required).toEqual(["to", "room", "text", "nonce"]);
    expect(Object.keys(send?.properties ?? {})).toEqual([
      "to",
      "room",
      "text",
      "nonce",
    ]);
    expect(send?.properties).not.toHaveProperty("from");
    expect(send?.properties).not.toHaveProperty("tenant_id");
    expect(send?.description).toMatch(/externalMessageId/);
  });

  it("stamps from and tenant_id live only on append", () => {
    const schema = loadMailboxSchema();
    const stamps = schema.$defs?.mailboxSendStamps;
    expect(stamps?.required).toEqual(["from", "tenant_id"]);
    const append = schema.$defs?.mailboxAppendRequest;
    expect(append?.required).toEqual([
      "to",
      "room",
      "text",
      "nonce",
      "from",
      "tenant_id",
    ]);
    expect(append?.properties).toHaveProperty("from");
  });

  it("error union matches MailboxErrorCode", () => {
    const schema = loadMailboxSchema();
    expect(schema.$defs?.mailboxErrorCode?.enum).toEqual([
      ...MAILBOX_ERROR_CODES,
    ]);
    const _codes: MailboxErrorCode[] = [
      "not_found",
      "forbidden",
      "frozen",
      "fuse_tripped",
      "bad_to",
      "dead_room",
    ];
    expect(_codes).toEqual([...MAILBOX_ERROR_CODES]);
  });

  it("nonce description names externalMessageId", () => {
    const schema = loadMailboxSchema();
    expect(schema.$defs?.nonce?.description).toMatch(/externalMessageId/);
  });

  it("halt input is room only", () => {
    const schema = loadMailboxSchema();
    const halt = schema.$defs?.mailboxHaltInput;
    expect(halt?.required).toEqual(["room"]);
    expect(Object.keys(halt?.properties ?? {})).toEqual(["room"]);
    expect(halt?.properties).not.toHaveProperty("from");
  });

  it("connectorMark enum is google|hubspot|whatsapp|github", () => {
    const schema = loadMailboxSchema();
    expect(schema.$defs?.connectorMark?.enum).toEqual([...CONNECTOR_MARKS]);
  });

  it("examples parse as the matching TS types", () => {
    const examples = join(repoRoot, "contracts/mailbox-v1/examples");
    const read = (name: string) =>
      JSON.parse(readFileSync(join(examples, name), "utf8")) as unknown;
    expect(parseMailboxSendInput(read("send.input.json")).to).toBe("fizz");
    expect(parseMailboxHaltInput(read("halt.input.json")).room).toBe(
      "thr_workshop",
    );
    expect(parseMailboxAppendRequest(read("append.request.json")).from).toBe(
      "bill",
    );
    expect(parseMailboxAppendResult(read("append.ok.json"))).toEqual({
      ok: true,
      message_id: "msg_01EXAMPLE",
    });
    expect(parseMailboxAppendResult(read("append.error.json"))).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

describe("@lanyard/shared export", () => {
  it("exports mailbox.send / mailbox_halt types from the package barrels", () => {
    expect(shared.MAILBOX_ERROR_CODES).toEqual([...MAILBOX_ERROR_CODES]);
    expect(shared.MAILBOX_SEND_TOOL_NAME).toBe("mailbox.send");
    expect(MAILBOX_SEND_TOOL_NAME).toBe("mailbox.send");
    expect(shared.parseMailboxSendInput).toBeTypeOf("function");
    expect(shared.parseMailboxHaltInput).toBeTypeOf("function");
    expect(browser.MAILBOX_ERROR_CODES).toEqual([...MAILBOX_ERROR_CODES]);
    expect(browser.parseMailboxSendInput).toBeTypeOf("function");
    expect(browser.MAILBOX_SEND_INPUT_FIELDS).not.toContain("from");
  });
});
