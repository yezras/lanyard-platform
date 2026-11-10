/**
 * lp-oop.25 — in-memory FakeToolbox records execs and returns scripted results.
 * Offline only. No Daytona.
 */
import { describe, expect, it } from "vitest";

import { isToolboxClient, type ToolboxExec } from "./exec.js";
import {
  DEFAULT_FAKE_TOOLBOX_RESULT,
  FakeToolbox,
} from "./fake.js";

const LS: ToolboxExec = {
  sandbox_id: "sb-1",
  argv: ["ls", "-la", "/mnt/vault"],
  cwd: "/mnt/vault",
  timeout_ms: 10_000,
};

const ECHO: ToolboxExec = {
  sandbox_id: "sb-1",
  argv: ["echo", "hello"],
  cwd: "/tmp",
  timeout_ms: 5_000,
};

describe("FakeToolbox port", () => {
  it("implements ToolboxClient", () => {
    const fake = new FakeToolbox();
    expect(isToolboxClient(fake)).toBe(true);
  });
});

describe("FakeToolbox records execs", () => {
  it("records sandbox_id, argv, cwd, timeout_ms in call order", async () => {
    const fake = new FakeToolbox();
    await fake.execute(LS);
    await fake.execute(ECHO);

    expect(fake.execCount()).toBe(2);
    expect(fake.listExecs()).toEqual([LS, ECHO]);
    expect(fake.lastExec()).toEqual(ECHO);
  });

  it("rejects invalid ToolboxExec and does not record it", async () => {
    const fake = new FakeToolbox();
    await expect(
      fake.execute({ ...LS, argv: [] }),
    ).rejects.toThrow(/argv/);
    expect(fake.listExecs()).toEqual([]);
  });
});

describe("FakeToolbox scripted results", () => {
  it("returns the empty success default when nothing is scripted", async () => {
    const fake = new FakeToolbox();
    await expect(fake.execute(LS)).resolves.toEqual(DEFAULT_FAKE_TOOLBOX_RESULT);
  });

  it("returns FIFO enqueued results then the default", async () => {
    const fake = new FakeToolbox();
    fake
      .enqueue({ stdout: "a\n", stderr: "", exit_code: 0 })
      .enqueue({ stdout: "", stderr: "nope\n", exit_code: 2 });

    await expect(fake.execute(LS)).resolves.toEqual({
      stdout: "a\n",
      stderr: "",
      exit_code: 0,
    });
    await expect(fake.execute(ECHO)).resolves.toEqual({
      stdout: "",
      stderr: "nope\n",
      exit_code: 2,
    });
    await expect(fake.execute(LS)).resolves.toEqual(DEFAULT_FAKE_TOOLBOX_RESULT);

    expect(fake.listRecords().map((r) => r.result?.exit_code)).toEqual([
      0, 2, 0,
    ]);
  });

  it("uses the handler when the queue is empty", async () => {
    const fake = new FakeToolbox({
      handler: (req) => ({
        stdout: req.argv.join(" "),
        stderr: req.sandbox_id,
        exit_code: req.argv[0] === "ls" ? 0 : 1,
      }),
    });

    await expect(fake.execute(LS)).resolves.toEqual({
      stdout: "ls -la /mnt/vault",
      stderr: "sb-1",
      exit_code: 0,
    });
    await expect(fake.execute(ECHO)).resolves.toEqual({
      stdout: "echo hello",
      stderr: "sb-1",
      exit_code: 1,
    });
  });

  it("prefers the FIFO queue over the handler", async () => {
    const fake = new FakeToolbox({
      handler: () => ({ stdout: "handler", stderr: "", exit_code: 0 }),
    });
    fake.enqueue({ stdout: "queued", stderr: "", exit_code: 7 });

    await expect(fake.execute(LS)).resolves.toEqual({
      stdout: "queued",
      stderr: "",
      exit_code: 7,
    });
    await expect(fake.execute(LS)).resolves.toEqual({
      stdout: "handler",
      stderr: "",
      exit_code: 0,
    });
  });

  it("uses constructor defaultResult when nothing else applies", async () => {
    const fake = new FakeToolbox({
      defaultResult: { stdout: "def", stderr: "e", exit_code: 3 },
    });
    await expect(fake.execute(LS)).resolves.toEqual({
      stdout: "def",
      stderr: "e",
      exit_code: 3,
    });
  });
});

describe("FakeToolbox errors and reset", () => {
  it("records the exec then throws a configured error", async () => {
    const fake = new FakeToolbox({ error: "toolbox down" });
    await expect(fake.execute(LS)).rejects.toThrow("toolbox down");
    expect(fake.lastExec()).toEqual(LS);
    expect(fake.listRecords()[0]).toMatchObject({
      result: null,
      error: "toolbox down",
    });
  });

  it("clears a sticky error", async () => {
    const fake = new FakeToolbox();
    fake.setError(new Error("once"));
    await expect(fake.execute(LS)).rejects.toThrow("once");
    fake.clearError();
    await expect(fake.execute(ECHO)).resolves.toEqual(
      DEFAULT_FAKE_TOOLBOX_RESULT,
    );
    expect(fake.execCount()).toBe(2);
  });

  it("reset clears records and the scripted queue", async () => {
    const fake = new FakeToolbox();
    fake.enqueue({ stdout: "keep?", stderr: "", exit_code: 0 });
    await fake.execute(LS);
    fake.enqueue({ stdout: "later", stderr: "", exit_code: 1 });
    fake.reset();

    expect(fake.listExecs()).toEqual([]);
    await expect(fake.execute(ECHO)).resolves.toEqual(
      DEFAULT_FAKE_TOOLBOX_RESULT,
    );
    expect(fake.listExecs()).toEqual([ECHO]);
  });
});
