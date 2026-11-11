import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ACTION_CLASSES,
  ACTION_CLASS_GATES,
  ACTION_GATES,
  COMMAND_MAP,
  CONNECTOR_AUTH_KINDS,
  CONNECTOR_CATALOG,
  CONNECTOR_IDS,
  CONNECTOR_PRINCIPALS,
  CONNECTOR_RUNTIMES,
  CONNECTORS,
  InvalidConnectorEnumError,
  UNMAPPED_GATE,
  classifyCommand,
  commandTokens,
  gateForActionClass,
  isConnectorId,
  parseActionClass,
  parseConnectorId,
  type ActionClass,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG_JSON = join(
  HERE,
  "../../../../contracts/connectors-v1/catalog.json",
);

function loadCatalogJson(): unknown {
  return JSON.parse(readFileSync(CATALOG_JSON, "utf8"));
}

describe("catalog SoT", () => {
  it("matches contracts/connectors-v1/catalog.json", () => {
    expect(JSON.parse(JSON.stringify(CONNECTOR_CATALOG))).toEqual(
      loadCatalogJson(),
    );
  });

  it("schema_version is 1", () => {
    expect(CONNECTOR_CATALOG.schema_version).toBe(1);
  });
});

describe("closed enums", () => {
  it("catalog ConnectorId is first-class google|hubspot|whatsapp|github, not the live list", () => {
    expect([...CONNECTOR_IDS]).toEqual(["google", "hubspot", "whatsapp", "github"]);
    expect(CONNECTOR_IDS).not.toContain("slack");
  });

  it("rejects names that are not first-class catalog members", () => {
    for (const name of ["outlook", "slack", "google_workspace", ""]) {
      expect(isConnectorId(name)).toBe(false);
      expect(() => parseConnectorId(name)).toThrow(InvalidConnectorEnumError);
    }
  });

  it("ConnectorRuntime is api|cli|mcp|skill", () => {
    expect([...CONNECTOR_RUNTIMES]).toEqual(["api", "cli", "mcp", "skill"]);
  });

  it("ConnectorPrincipal is user|tenant", () => {
    expect([...CONNECTOR_PRINCIPALS]).toEqual(["user", "tenant"]);
  });

  it("ConnectorAuthKind is oauth|cli_qr|cli_token", () => {
    expect([...CONNECTOR_AUTH_KINDS]).toEqual(["oauth", "cli_qr", "cli_token"]);
  });

  it("ActionClass lists every v1 class", () => {
    expect([...ACTION_CLASSES]).toEqual([
      "gmail.read",
      "gmail.draft",
      "gmail.send",
      "calendar.read",
      "calendar.write",
      "drive.read",
      "drive.write",
      "hubspot.read",
      "hubspot.write",
      "whatsapp.read",
      "whatsapp.send",
      "github.read",
      "github.write",
    ]);
  });

  it("ActionGate is sticky|every_call", () => {
    expect([...ACTION_GATES]).toEqual(["sticky", "every_call"]);
  });

  it("every ActionClass has a gate", () => {
    for (const actionClass of ACTION_CLASSES) {
      expect(ACTION_CLASS_GATES[actionClass]).toBeDefined();
      expect(ACTION_GATES).toContain(gateForActionClass(actionClass));
    }
  });

  it("command_map covers every ActionClass", () => {
    const covered = new Set(COMMAND_MAP.map((entry) => entry.action_class));
    expect([...covered].sort()).toEqual([...ACTION_CLASSES].sort());
  });

  it("v1 connectors are user-principal with closed ids", () => {
    expect(CONNECTORS.map((row) => row.id)).toEqual([
      "google",
      "hubspot",
      "whatsapp",
      "github",
    ]);
    for (const row of CONNECTORS) {
      expect(row.principal).toBe("user");
      expect(CONNECTOR_IDS).toContain(row.id);
    }
  });
});

describe("classifyCommand", () => {
  it("accepts only argv; no model or prompt parameter", () => {
    expect(classifyCommand.length).toBe(1);
    const src = classifyCommand.toString();
    expect(src).not.toMatch(/\b(llm|openai|anthropic|completion|chat)\b/i);
    expect(src).not.toMatch(/\bprompt\b/i);
    expect(src).not.toMatch(/\bmodel\b/i);
  });

  it("maps architecture §11 examples", () => {
    expect(
      classifyCommand(["gws", "gmail", "users", "drafts", "create"]),
    ).toEqual({
      action_class: "gmail.draft",
      gate: "sticky",
      mapped: true,
    });
    expect(
      classifyCommand(["gws", "gmail", "users", "messages", "send"]),
    ).toEqual({
      action_class: "gmail.send",
      gate: "every_call",
      mapped: true,
    });
    expect(classifyCommand(["gws", "calendar", "+agenda"])).toEqual({
      action_class: "calendar.read",
      gate: "sticky",
      mapped: true,
    });
    expect(
      classifyCommand(["gws", "calendar", "events", "insert"]),
    ).toEqual({
      action_class: "calendar.write",
      gate: "every_call",
      mapped: true,
    });
    expect(classifyCommand(["gws", "drive", "files", "list"])).toEqual({
      action_class: "drive.read",
      gate: "sticky",
      mapped: true,
    });
    expect(classifyCommand(["wacli", "messages", "list"])).toEqual({
      action_class: "whatsapp.read",
      gate: "sticky",
      mapped: true,
    });
    expect(classifyCommand(["wacli", "send", "text"])).toEqual({
      action_class: "whatsapp.send",
      gate: "every_call",
      mapped: true,
    });
  });

  it("covers remaining action classes", () => {
    expect(classifyCommand(["gws", "gmail", "+read"])).toMatchObject({
      action_class: "gmail.read",
      gate: "sticky",
    });
    expect(classifyCommand(["gws", "drive", "+upload"])).toMatchObject({
      action_class: "drive.write",
      gate: "every_call",
    });
    expect(classifyCommand(["hs", "crm", "objects", "search"])).toMatchObject({
      action_class: "hubspot.read",
      gate: "sticky",
    });
    expect(
      classifyCommand(["hubspot", "crm", "contacts", "create"]),
    ).toMatchObject({
      action_class: "hubspot.write",
      gate: "every_call",
    });
  });

  it("classifies drafts send as gmail.send, not gmail.draft", () => {
    expect(
      classifyCommand(["gws", "gmail", "users", "drafts", "send"]),
    ).toEqual({
      action_class: "gmail.send",
      gate: "every_call",
      mapped: true,
    });
  });

  it("ignores flags after the subcommand", () => {
    expect(
      classifyCommand([
        "gws",
        "gmail",
        "+send",
        "--to",
        "alice@example.com",
        "--subject",
        "Hi",
      ]),
    ).toMatchObject({ action_class: "gmail.send", mapped: true });
  });

  it("uses the binary basename", () => {
    expect(
      classifyCommand(["/usr/local/bin/wacli", "messages", "list"]),
    ).toMatchObject({ action_class: "whatsapp.read", mapped: true });
  });

  it("classifies unknown commands as every_call", () => {
    const unmapped = [
      ["gws", "gmail", "users", "messages", "batchDelete"],
      ["gws", "chat", "spaces", "create"],
      ["wacli", "auth"],
      ["curl", "https://api.hubapi.com/crm/v3/objects/contacts"],
      ["rm", "-rf", "/"],
      [],
    ];
    for (const argv of unmapped) {
      expect(classifyCommand(argv), argv.join(" ")).toEqual({
        action_class: null,
        gate: "every_call",
        mapped: false,
      });
    }
  });

  it("unmapped_gate is every_call", () => {
    expect(UNMAPPED_GATE).toBe("every_call");
  });
});

describe("commandTokens", () => {
  it("stops at the first flag", () => {
    expect(
      commandTokens(["gws", "gmail", "+send", "--draft", "ignored"]),
    ).toEqual(["gws", "gmail", "+send"]);
  });
});

describe("parseActionClass", () => {
  it("accepts every catalog class", () => {
    for (const actionClass of ACTION_CLASSES) {
      expect(parseActionClass(actionClass)).toBe(actionClass);
    }
  });

  it("rejects free-text classes", () => {
    expect(() => parseActionClass("gmail.delete")).toThrow(
      InvalidConnectorEnumError,
    );
  });
});

describe("gate table", () => {
  it("high-gates write/send classes", () => {
    const everyCall: ActionClass[] = [
      "gmail.send",
      "calendar.write",
      "drive.write",
      "hubspot.write",
      "whatsapp.send",
    ];
    const sticky: ActionClass[] = [
      "gmail.read",
      "gmail.draft",
      "calendar.read",
      "drive.read",
      "hubspot.read",
      "whatsapp.read",
    ];
    for (const actionClass of everyCall) {
      expect(gateForActionClass(actionClass)).toBe("every_call");
    }
    for (const actionClass of sticky) {
      expect(gateForActionClass(actionClass)).toBe("sticky");
    }
  });
});
