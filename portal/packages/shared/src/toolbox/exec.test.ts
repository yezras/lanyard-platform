/**
 * lp-oop.24 — ToolboxExec types (offline).
 */
import { describe, expect, it } from "vitest";

import {
  isToolboxClient,
  isToolboxExec,
  isToolboxExecResult,
  parseToolboxExec,
  type ToolboxClient,
  type ToolboxExec,
  type ToolboxExecResult,
} from "./exec.js";

const VALID_EXEC: ToolboxExec = {
  sandbox_id: "sb-1",
  argv: ["ls", "-la", "/mnt/vault"],
  cwd: "/mnt/vault",
  timeout_ms: 10_000,
};

describe("ToolboxExec types (lp-oop.24)", () => {
  it("parses sandbox_id, argv, cwd, timeout_ms", () => {
    expect(parseToolboxExec(VALID_EXEC)).toEqual(VALID_EXEC);
    expect(isToolboxExec(VALID_EXEC)).toBe(true);
  });

  it("trims sandbox_id and cwd", () => {
    expect(
      parseToolboxExec({
        sandbox_id: " sb-1 ",
        argv: ["echo", "ok"],
        cwd: " /tmp ",
        timeout_ms: 1_000,
      }),
    ).toEqual({
      sandbox_id: "sb-1",
      argv: ["echo", "ok"],
      cwd: "/tmp",
      timeout_ms: 1_000,
    });
  });

  it("rejects missing or invalid fields", () => {
    expect(isToolboxExec(null)).toBe(false);
    expect(isToolboxExec("exec")).toBe(false);
    expect(() => parseToolboxExec({ ...VALID_EXEC, sandbox_id: "" })).toThrow(
      /sandbox_id/,
    );
    expect(() => parseToolboxExec({ ...VALID_EXEC, cwd: "   " })).toThrow(
      /cwd/,
    );
    expect(() => parseToolboxExec({ ...VALID_EXEC, argv: [] })).toThrow(/argv/);
    expect(() =>
      parseToolboxExec({ ...VALID_EXEC, argv: ["ok", 1] }),
    ).toThrow(/argv\[1]/);
    expect(() => parseToolboxExec({ ...VALID_EXEC, timeout_ms: 0 })).toThrow(
      /timeout_ms/,
    );
    expect(() => parseToolboxExec({ ...VALID_EXEC, timeout_ms: -5 })).toThrow(
      /timeout_ms/,
    );
    const { argv: _omit, ...rest } = VALID_EXEC;
    expect(isToolboxExec(rest)).toBe(false);
  });

  it("result type is stdout / stderr / exit_code", () => {
    const result: ToolboxExecResult = {
      stdout: "ok\n",
      stderr: "",
      exit_code: 0,
    };
    expect(isToolboxExecResult(result)).toBe(true);
    expect(isToolboxExecResult({ stdout: "x", stderr: "y" })).toBe(false);
    expect(isToolboxExecResult({ exit_code: 0 })).toBe(false);
  });

  it("ToolboxClient is an execute port", () => {
    const client: ToolboxClient = {
      execute: async () => ({ stdout: "", stderr: "", exit_code: 0 }),
    };
    expect(isToolboxClient(client)).toBe(true);
    expect(isToolboxClient({})).toBe(false);
    expect(isToolboxClient(null)).toBe(false);
  });
});
