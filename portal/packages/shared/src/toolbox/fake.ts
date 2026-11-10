/**
 * In-memory FakeToolbox (plan 0015 / lp-oop.25).
 *
 * Records every execute() and returns scripted results.
 * No network, no Daytona. Implements {@link ToolboxClient}.
 */

import {
  parseToolboxExec,
  type ToolboxClient,
  type ToolboxExec,
  type ToolboxExecResult,
} from "./exec.js";

export const DEFAULT_FAKE_TOOLBOX_RESULT: ToolboxExecResult = {
  stdout: "",
  stderr: "",
  exit_code: 0,
};

export type FakeToolboxExecRecord = {
  req: ToolboxExec;
  result: ToolboxExecResult | null;
  error: string | null;
};

export type FakeToolboxHandler = (
  req: ToolboxExec,
) => ToolboxExecResult | Promise<ToolboxExecResult>;

export type FakeToolboxOptions = {
  /** Default result when the FIFO queue is empty and no handler applies. */
  defaultResult?: ToolboxExecResult;
  /** Called when the FIFO queue is empty. */
  handler?: FakeToolboxHandler;
  /** Throw on every execute until {@link FakeToolbox.clearError}. */
  error?: string | Error | (() => string | Error);
};

function copyResult(result: ToolboxExecResult): ToolboxExecResult {
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  };
}

function resolveError(error: string | Error | (() => string | Error)): Error {
  const value = typeof error === "function" ? error() : error;
  return value instanceof Error ? value : new Error(value);
}

/**
 * Pure in-memory toolbox. Safe for single-process unit tests.
 * Callers inspect {@link FakeToolbox.listExecs} — argv is not redacted here.
 */
export class FakeToolbox implements ToolboxClient {
  private readonly records: FakeToolboxExecRecord[] = [];
  private readonly queue: ToolboxExecResult[] = [];
  private handler: FakeToolboxHandler | null;
  private defaultResult: ToolboxExecResult;
  private error: string | Error | (() => string | Error) | null;

  constructor(options: FakeToolboxOptions = {}) {
    this.defaultResult = copyResult(
      options.defaultResult ?? DEFAULT_FAKE_TOOLBOX_RESULT,
    );
    this.handler = options.handler ?? null;
    this.error = options.error ?? null;
  }

  /** Queue a scripted result for the next execute (FIFO, before handler). */
  enqueue(result: ToolboxExecResult): this {
    this.queue.push(copyResult(result));
    return this;
  }

  setHandler(handler: FakeToolboxHandler | null): this {
    this.handler = handler;
    return this;
  }

  setDefaultResult(result: ToolboxExecResult): this {
    this.defaultResult = copyResult(result);
    return this;
  }

  setError(error: string | Error | (() => string | Error)): this {
    this.error = error;
    return this;
  }

  clearError(): this {
    this.error = null;
    return this;
  }

  listExecs(): ToolboxExec[] {
    return this.records.map((record) => record.req);
  }

  listRecords(): FakeToolboxExecRecord[] {
    return this.records.map((record) => ({
      req: record.req,
      result: record.result ? copyResult(record.result) : null,
      error: record.error,
    }));
  }

  lastExec(): ToolboxExec | undefined {
    return this.records[this.records.length - 1]?.req;
  }

  execCount(): number {
    return this.records.length;
  }

  reset(): this {
    this.records.length = 0;
    this.queue.length = 0;
    return this;
  }

  async execute(req: ToolboxExec): Promise<ToolboxExecResult> {
    const exec = parseToolboxExec(req);

    if (this.error) {
      const err = resolveError(this.error);
      this.records.push({ req: exec, result: null, error: err.message });
      throw err;
    }

    let result: ToolboxExecResult;
    const queued = this.queue.shift();
    if (queued) {
      result = queued;
    } else if (this.handler) {
      result = copyResult(await this.handler(exec));
    } else {
      result = copyResult(this.defaultResult);
    }

    this.records.push({ req: exec, result, error: null });
    return copyResult(result);
  }
}
