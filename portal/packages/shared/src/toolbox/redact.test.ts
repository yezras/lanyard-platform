/**
 * lp-oop.24 — Toolbox argv / command-line redaction (offline).
 * Throwaway tokens only; no prod / SM secrets.
 */
import { describe, expect, it } from "vitest";

import { REDACTED } from "../logging/redact.js";

import type { ToolboxExec } from "./exec.js";
import {
  TOOLBOX_ARGV_REDACTED,
  isToolboxCommandLineKey,
  redactToolboxArgv,
  redactToolboxExecForLog,
  redactToolboxExecResultForLog,
  redactToolboxLogFields,
} from "./redact.js";

const THROW_AWAY_SECRET = "test-throwaway-relay-secret-not-for-prod";
const THROW_AWAY_TOKEN = "sk-test-throwaway-openai-not-real";

const DIRTY_EXEC: ToolboxExec = {
  sandbox_id: "sb-redact-1",
  argv: ["bash", "-lc", `export GATEWAY_RELAY_SECRET=${THROW_AWAY_SECRET}`],
  cwd: "/mnt/vault",
  timeout_ms: 15_000,
};

describe("redactToolboxArgv / redactToolboxExecForLog (lp-oop.24)", () => {
  it("replaces every argv token with the redaction marker", () => {
    const redacted = redactToolboxArgv(DIRTY_EXEC.argv);
    expect(redacted).toEqual([REDACTED, REDACTED, REDACTED]);
    expect(TOOLBOX_ARGV_REDACTED).toBe(REDACTED);
    expect(JSON.stringify(redacted)).not.toContain(THROW_AWAY_SECRET);
    expect(DIRTY_EXEC.argv[2]).toContain(THROW_AWAY_SECRET);
  });

  it("log summary never contains raw argv or secret material", () => {
    const summary = redactToolboxExecForLog(DIRTY_EXEC);
    expect(summary).toEqual({
      sandbox_id: "sb-redact-1",
      argv_count: 3,
      argv: REDACTED,
      cwd: "/mnt/vault",
      timeout_ms: 15_000,
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(THROW_AWAY_SECRET);
    expect(serialized).not.toContain("GATEWAY_RELAY_SECRET");
    expect(serialized).not.toContain("bash");
    expect(serialized).not.toContain("-lc");
  });
});

describe("redactToolboxExecResultForLog", () => {
  it("keeps exit_code and byte lengths, drops bodies", () => {
    const summary = redactToolboxExecResultForLog({
      stdout: `token=${THROW_AWAY_TOKEN}\n`,
      stderr: "warn\n",
      exit_code: 2,
    });
    expect(summary.exit_code).toBe(2);
    expect(summary.stdout_bytes).toBeGreaterThan(0);
    expect(summary.stderr_bytes).toBeGreaterThan(0);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(THROW_AWAY_TOKEN);
    expect(serialized).not.toContain("warn");
  });
});

describe("redactToolboxLogFields", () => {
  it("flags command-line keys", () => {
    expect(isToolboxCommandLineKey("argv")).toBe(true);
    expect(isToolboxCommandLineKey("command")).toBe(true);
    expect(isToolboxCommandLineKey("cmd")).toBe(true);
    expect(isToolboxCommandLineKey("command_line")).toBe(true);
    expect(isToolboxCommandLineKey("sandbox_id")).toBe(false);
    expect(isToolboxCommandLineKey("cwd")).toBe(false);
  });

  it("strips Daytona request command and domain argv from dump-safe clones", () => {
    const dumped = redactToolboxLogFields({
      op: "execute",
      sandbox_id: "sb-1",
      argv: DIRTY_EXEC.argv,
      body: {
        command: `echo ${THROW_AWAY_SECRET}`,
        cwd: "/mnt/vault",
        timeout: 15,
      },
    }) as Record<string, unknown>;

    expect(dumped.argv).toBe(REDACTED);
    expect(dumped.argv_count).toBe(3);
    expect(dumped.sandbox_id).toBe("sb-1");
    const body = dumped.body as Record<string, unknown>;
    expect(body.command).toBe(REDACTED);
    expect(body.cwd).toBe("/mnt/vault");
    expect(body.timeout).toBe(15);

    const serialized = JSON.stringify(dumped);
    expect(serialized).not.toContain(THROW_AWAY_SECRET);
    expect(serialized).not.toMatch(/echo /);
  });

  it("does not wipe argv_count when argv is already the marker", () => {
    const again = redactToolboxLogFields({
      argv: REDACTED,
      argv_count: 3,
      sandbox_id: "sb-1",
    }) as Record<string, unknown>;
    expect(again.argv).toBe(REDACTED);
    expect(again.argv_count).toBe(3);
  });
});
