import { describe, expect, it } from "vitest";

import * as browser from "../browser.js";
import * as shared from "../index.js";
import {
  INBOUND_SANDBOX_NEEDS,
  INBOUND_WORK_SOURCES,
  isInboundWorkItem,
  parseInboundWorkItem,
  type InboundWorkItem,
} from "./inbound-work-item.js";
import { parseTurnRequest, type TurnRequest } from "./turn.js";

const TURN: TurnRequest = {
  tenant_id: "ten_1",
  user_id: "usr_1",
  instance_id: "inst_1",
  thread_id: "thr_1",
  message: "hello",
};

const WEB_NONE: InboundWorkItem = {
  ...TURN,
  source: "web",
  sandbox_need: "none",
  correlation_id: "corr_web_1",
  enqueue_at: 1_700_000_000_000,
};

const SLACK_TOOLBOX: InboundWorkItem = {
  ...TURN,
  source: "slack",
  sandbox_need: "toolbox",
  correlation_id: "corr_slack_1",
  enqueue_at: 1_700_000_000_001,
  sandbox_id: "sbx-1",
};

describe("InboundWorkItem unions", () => {
  it("locks source and sandbox_need to the plan 0019 §4.1 sets", () => {
    expect([...INBOUND_WORK_SOURCES]).toEqual([
      "web",
      "slack",
      "email",
      "whatsapp",
      "cron",
      "mailbox",
    ]);
    expect([...INBOUND_SANDBOX_NEEDS]).toEqual(["none", "toolbox"]);
  });
});

describe("parseInboundWorkItem", () => {
  it("round-trips web+none and slack+toolbox through JSON", () => {
    expect(parseInboundWorkItem(WEB_NONE)).toEqual(WEB_NONE);
    expect(
      parseInboundWorkItem(JSON.parse(JSON.stringify(WEB_NONE))),
    ).toEqual(WEB_NONE);
    expect(parseInboundWorkItem(SLACK_TOOLBOX)).toEqual(SLACK_TOOLBOX);
    expect(
      parseInboundWorkItem(JSON.parse(JSON.stringify(SLACK_TOOLBOX))),
    ).toEqual(SLACK_TOOLBOX);
    expect(isInboundWorkItem(WEB_NONE)).toBe(true);
    expect(isInboundWorkItem(SLACK_TOOLBOX)).toBe(true);
  });

  it("trims source, sandbox_need, correlation_id, and TurnRequest strings", () => {
    expect(
      parseInboundWorkItem({
        tenant_id: " ten_1 ",
        user_id: " usr_1 ",
        instance_id: " inst_1 ",
        thread_id: " thr_1 ",
        message: " hello ",
        source: " web ",
        sandbox_need: " none ",
        correlation_id: " corr_web_1 ",
        enqueue_at: WEB_NONE.enqueue_at,
      }),
    ).toEqual(WEB_NONE);
  });

  it("still requires TurnRequest fields", () => {
    expect(() =>
      parseInboundWorkItem({
        source: "web",
        sandbox_need: "none",
        correlation_id: "corr_1",
        enqueue_at: 1,
      }),
    ).toThrow(/tenant_id/);
    expect(() =>
      parseInboundWorkItem({ ...WEB_NONE, tenant_id: "" }),
    ).toThrow(/tenant_id/);
    expect(() =>
      parseInboundWorkItem({ ...WEB_NONE, user_id: "   " }),
    ).toThrow(/user_id/);
    expect(() =>
      parseInboundWorkItem({ ...WEB_NONE, instance_id: 1 }),
    ).toThrow(/instance_id/);
    expect(() =>
      parseInboundWorkItem({ ...WEB_NONE, thread_id: "" }),
    ).toThrow(/thread_id/);
    expect(() =>
      parseInboundWorkItem({ ...WEB_NONE, message: "   " }),
    ).toThrow(/message/);
    const { message: _omit, ...rest } = WEB_NONE;
    expect(isInboundWorkItem(rest)).toBe(false);
  });

  it("rejects unknown source and unknown sandbox_need (not fail-closed to none)", () => {
    expect(() =>
      parseInboundWorkItem({ ...WEB_NONE, source: "sms" }),
    ).toThrow(/source must be one of/);
    expect(() =>
      parseInboundWorkItem({ ...WEB_NONE, source: "WEB" }),
    ).toThrow(/source must be one of/);
    expect(() =>
      parseInboundWorkItem({ ...WEB_NONE, sandbox_need: "daytona" }),
    ).toThrow(/sandbox_need must be one of/);
    expect(() =>
      parseInboundWorkItem({ ...SLACK_TOOLBOX, sandbox_need: "nonee" }),
    ).toThrow(/sandbox_need must be one of/);
    expect(
      isInboundWorkItem({ ...WEB_NONE, sandbox_need: "nonee" }),
    ).toBe(false);
    expect(
      parseInboundWorkItem({ ...WEB_NONE, sandbox_need: "toolbox" }).sandbox_need,
    ).toBe("toolbox");
  });

  it("rejects missing or invalid envelope fields", () => {
    expect(isInboundWorkItem(null)).toBe(false);
    expect(isInboundWorkItem("web")).toBe(false);
    expect(() =>
      parseInboundWorkItem({ ...TURN, sandbox_need: "none", correlation_id: "c", enqueue_at: 1 }),
    ).toThrow(/source must be a string/);
    expect(() =>
      parseInboundWorkItem({ ...TURN, source: "web", correlation_id: "c", enqueue_at: 1 }),
    ).toThrow(/sandbox_need must be a string/);
    expect(() =>
      parseInboundWorkItem({ ...WEB_NONE, correlation_id: "" }),
    ).toThrow(/correlation_id/);
    expect(() =>
      parseInboundWorkItem({ ...WEB_NONE, enqueue_at: "1700000000000" }),
    ).toThrow(/enqueue_at/);
    expect(() =>
      parseInboundWorkItem({ ...WEB_NONE, enqueue_at: Number.NaN }),
    ).toThrow(/enqueue_at/);
    expect(() =>
      parseInboundWorkItem({ ...WEB_NONE, enqueue_at: Number.POSITIVE_INFINITY }),
    ).toThrow(/enqueue_at/);
  });

  it("does not change TurnRequest parse (extra spine fields are ignored)", () => {
    expect(parseTurnRequest(WEB_NONE)).toEqual(TURN);
    expect(parseTurnRequest(SLACK_TOOLBOX)).toEqual({
      ...TURN,
      sandbox_id: "sbx-1",
    });
  });
});

describe("@lanyard/shared export", () => {
  it("exports parseInboundWorkItem from the package barrels", () => {
    expect(typeof shared.parseInboundWorkItem).toBe("function");
    expect(typeof browser.parseInboundWorkItem).toBe("function");
    expect(shared.parseInboundWorkItem(WEB_NONE)).toEqual(WEB_NONE);
    expect(browser.parseInboundWorkItem(WEB_NONE)).toEqual(WEB_NONE);
    expect(shared.INBOUND_SANDBOX_NEEDS).toEqual(INBOUND_SANDBOX_NEEDS);
    expect(browser.INBOUND_WORK_SOURCES).toEqual(INBOUND_WORK_SOURCES);
  });
});
