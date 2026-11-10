/**
 * Harness turn HTTP contract fixture (lp-oop.26).
 * Mirrors lanyard-agent packages/adapters-portal/fixtures/harness-turn-contract.v1.json.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  HARNESS_SERVICE_TOKEN_HEADER,
  HARNESS_TURNS_PATH,
  harnessTurnEventsPath,
  harnessTurnInterruptPath,
} from "./http.js";
import { isTurnEvent, isTurnRequest, RELAY_CHAT_EVENT_TYPES } from "./turn.js";

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/harness-turn-contract.v1.json",
);

describe("harness-turn-contract.v1 fixture", () => {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    schema: string;
    fixture_id: string;
    fixture_version: number;
    http: {
      service_token_header: string;
      turns_path: string;
      events_path_template: string;
      interrupt_path_template: string;
    };
    request: unknown;
    start_response: { turn_id: string };
    events: unknown[];
    interrupt_response: unknown;
    errors: { unauthorized: { status: number; body: { error: string } } };
    event_types: string[];
  };

  it("locks paths and header to @lanyard/shared harness helpers", () => {
    expect(fixture.schema).toBe("lanyard.harness.turn_contract_fixture");
    expect(fixture.fixture_id).toBe("harness-turn-contract.v1");
    expect(fixture.fixture_version).toBe(1);
    expect(fixture.http.service_token_header).toBe(HARNESS_SERVICE_TOKEN_HEADER);
    expect(fixture.http.turns_path).toBe(HARNESS_TURNS_PATH);
    expect(
      fixture.http.events_path_template.replace(
        "{turn_id}",
        fixture.start_response.turn_id,
      ),
    ).toBe(harnessTurnEventsPath(fixture.start_response.turn_id));
    expect(
      fixture.http.interrupt_path_template.replace(
        "{turn_id}",
        fixture.start_response.turn_id,
      ),
    ).toBe(harnessTurnInterruptPath(fixture.start_response.turn_id));
  });

  it("covers TurnRequest + Relay message_send + interrupt", () => {
    expect(isTurnRequest(fixture.request)).toBe(true);
    expect(fixture.events).toHaveLength(1);
    expect(isTurnEvent(fixture.events[0])).toBe(true);
    expect(fixture.interrupt_response).toEqual({
      ok: true,
      interrupted: true,
    });
    expect(fixture.event_types).toEqual([...RELAY_CHAT_EVENT_TYPES]);
    expect(fixture.errors.unauthorized.status).toBe(401);
  });
});
