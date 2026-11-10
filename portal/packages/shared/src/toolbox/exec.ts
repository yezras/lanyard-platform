/**
 * Daytona toolbox exec contract (plan 0015 / lp-oop.24).
 *
 * Harness tool calls exec on the user sandbox via
 * `POST …/toolbox/{sandbox_id}/process/execute`.
 * Types only here — HTTP client lives in control-plane.
 * In-memory fake: {@link FakeToolbox} in `./fake.ts` (lp-oop.25).
 */

export type ToolboxExec = {
  sandbox_id: string;
  argv: readonly string[];
  cwd: string;
  timeout_ms: number;
};

export type ToolboxExecResult = {
  stdout: string;
  stderr: string;
  exit_code: number;
};

/** Port the HTTP client and {@link FakeToolbox} implement. */
export interface ToolboxClient {
  execute(req: ToolboxExec): Promise<ToolboxExecResult>;
}

const TOOLBOX_EXEC_KEYS = [
  "sandbox_id",
  "argv",
  "cwd",
  "timeout_ms",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: "sandbox_id" | "cwd",
): string {
  if (typeof value !== "string") {
    throw new TypeError(`ToolboxExec.${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new TypeError(`ToolboxExec.${field} must be a non-empty string`);
  }
  return trimmed;
}

function requiredArgv(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("ToolboxExec.argv must be a non-empty string array");
  }
  const out: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item !== "string") {
      throw new TypeError(`ToolboxExec.argv[${i}] must be a string`);
    }
    out.push(item);
  }
  return out;
}

function requiredTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError("ToolboxExec.timeout_ms must be a positive number");
  }
  return value;
}

export function parseToolboxExec(value: unknown): ToolboxExec {
  if (!isRecord(value)) {
    throw new TypeError("ToolboxExec must be an object");
  }
  // Touch the key list so the contract stays explicit.
  for (const key of TOOLBOX_EXEC_KEYS) {
    if (!(key in value)) {
      throw new TypeError(`ToolboxExec.${key} is required`);
    }
  }
  return {
    sandbox_id: requiredString(value.sandbox_id, "sandbox_id"),
    argv: requiredArgv(value.argv),
    cwd: requiredString(value.cwd, "cwd"),
    timeout_ms: requiredTimeoutMs(value.timeout_ms),
  };
}

export function isToolboxExec(value: unknown): value is ToolboxExec {
  try {
    parseToolboxExec(value);
    return true;
  } catch {
    return false;
  }
}

export function isToolboxExecResult(value: unknown): value is ToolboxExecResult {
  if (!isRecord(value)) return false;
  return (
    typeof value.stdout === "string" &&
    typeof value.stderr === "string" &&
    typeof value.exit_code === "number" &&
    Number.isFinite(value.exit_code)
  );
}

export function isToolboxClient(value: unknown): value is ToolboxClient {
  if (value === null || typeof value !== "object") return false;
  return typeof (value as { execute?: unknown }).execute === "function";
}
