import { describe, expect, it } from "vitest";

import {
  parseConnectorCliEvent,
  parseConnectorOAuthEvent,
} from "./connectorStreamCards.js";

describe("connector stream cards (lp-xhf4.17)", () => {
  it("parses connector.oauth connect", () => {
    const parsed = parseConnectorOAuthEvent({
      type: "connector.oauth",
      connector_id: "google",
      phase: "connect",
      ts: 1,
      metadata: { portal_event: "connector.oauth" },
    });
    expect(parsed).toMatchObject({
      connector_id: "google",
      phase: "connect",
    });
  });

  it("parses connector.oauth connected via metadata", () => {
    const parsed = parseConnectorOAuthEvent({
      type: "connector.oauth",
      metadata: {
        portal_event: "connector.oauth",
        connector_id: "google",
        phase: "connected",
        account_label: "operator@example.com",
        ts: 2,
      },
    });
    expect(parsed).toMatchObject({
      connector_id: "google",
      phase: "connected",
      account_label: "operator@example.com",
    });
  });

  it("parses connector.cli waiting", () => {
    const parsed = parseConnectorCliEvent({
      type: "connector.cli",
      device_code: "XXXX-1234",
      command: "gh auth login --hostname github.com",
      status: "waiting",
      ts: 3,
      metadata: { portal_event: "connector.cli" },
    });
    expect(parsed).toMatchObject({
      connector_id: "github",
      device_code: "XXXX-1234",
      command: "gh auth login --hostname github.com",
      status: "waiting",
    });
  });

  it("defaults CLI to github + waiting when connector_id omitted", () => {
    const parsed = parseConnectorCliEvent({
      type: "connector.cli",
      metadata: {
        portal_event: "connector.cli",
        device_code: "ABCD-1234",
      },
    });
    expect(parsed?.connector_id).toBe("github");
    expect(parsed?.status).toBe("waiting");
  });

  it("returns null for unrelated portal_event", () => {
    expect(parseConnectorOAuthEvent({ type: "tool_progress", metadata: {} })).toBeNull();
    expect(parseConnectorCliEvent({ type: "tool_progress", metadata: {} })).toBeNull();
  });
});
