import { describe, expect, it } from "vitest";

import {
  createEnvOperatorDirectory,
  MemoryOperatorDirectory,
  parsePlatformOperatorEmails,
} from "../src/operator-directory.js";

describe("parsePlatformOperatorEmails", () => {
  it("is empty when unset", () => {
    expect(parsePlatformOperatorEmails(undefined)).toEqual([]);
    expect(parsePlatformOperatorEmails("")).toEqual([]);
    expect(parsePlatformOperatorEmails("  , , ")).toEqual([]);
  });

  it("normalizes and de-duplicates", () => {
    expect(
      parsePlatformOperatorEmails("Ops@Lanyard.example, other@x.com, OPS@lanyard.example"),
    ).toEqual([
      { operatorId: "ops@lanyard.example", email: "ops@lanyard.example" },
      { operatorId: "other@x.com", email: "other@x.com" },
    ]);
  });
});

describe("MemoryOperatorDirectory", () => {
  it("looks up by email case-insensitively", async () => {
    const directory = new MemoryOperatorDirectory([
      { operatorId: "op-1", email: "Ops@Lanyard.example" },
    ]);
    expect(await directory.lookupByEmail("ops@lanyard.example")).toEqual({
      operatorId: "op-1",
      email: "ops@lanyard.example",
    });
    expect(await directory.lookupByEmail("stranger@example.com")).toBeNull();
  });

  it("env directory is fail-closed when PLATFORM_OPERATOR_EMAILS is unset", async () => {
    const directory = createEnvOperatorDirectory({});
    expect(await directory.lookupByEmail("ops@lanyard.example")).toBeNull();
    expect(await directory.lookupByEmail("ops@lanyard.local")).toBeNull();
  });

  it("defaults local lab emails when DEV_TENANT_SLUG is set and env is unset", async () => {
    const directory = createEnvOperatorDirectory({
      DEV_TENANT_SLUG: "demo",
    });
    expect(await directory.lookupByEmail("ops@lanyard.local")).toEqual({
      operatorId: "ops@lanyard.local",
      email: "ops@lanyard.local",
    });
    expect(await directory.lookupByEmail("dev@demo.local")).not.toBeNull();
    expect(
      await directory.lookupByEmail("agent-dev@mocklab.example.com"),
    ).not.toBeNull();
  });

  it("PLATFORM_OPERATOR_EMAILS still wins over local defaults", async () => {
    const directory = createEnvOperatorDirectory({
      DEV_TENANT_SLUG: "demo",
      PLATFORM_OPERATOR_EMAILS: "only@example.com",
    });
    expect(await directory.lookupByEmail("only@example.com")).not.toBeNull();
    expect(await directory.lookupByEmail("ops@lanyard.local")).toBeNull();
  });
});
