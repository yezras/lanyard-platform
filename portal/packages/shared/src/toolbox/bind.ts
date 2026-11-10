/**
 * Bind ensure_online(tenant, user) to a ToolboxClient (plan 0015 / lp-oop.28).
 *
 * Harness tool path (lp-vqr0.11 T6): wake the user sandbox, then exec only
 * on that sandbox_id. No-tool chat send does not call this. Callers cannot
 * retarget another box.
 *
 * The bind requests `sandbox_create_profile=tool_only` so cold create
 * omits provider keys and GATEWAY_RELAY_SECRET (CP denylist).
 */

import {
  isToolboxClient,
  parseToolboxExec,
  type ToolboxClient,
  type ToolboxExec,
  type ToolboxExecResult,
} from "./exec.js";

export const TOOLBOX_BIND_CREATE_PROFILE = "tool_only" as const;

export type ToolboxEnsureOnlineRequest = {
  wait_timeout_ms?: number;
  sandbox_create_profile?: "guest_gateway" | "tool_only";
};

export type ToolboxEnsureOnlineResult = {
  instance_id: string;
  tenant_id: string;
  sandbox_id: string | null;
  presence: string;
  already_online: boolean;
};

export type ToolboxEnsureOnlineByUser = (
  tenantId: string,
  userId: string,
  body?: ToolboxEnsureOnlineRequest,
) => Promise<ToolboxEnsureOnlineResult>;

/** Exec input after bind — sandbox_id is forced from ensure_online. */
export type BoundToolboxExec = {
  argv: readonly string[];
  cwd: string;
  timeout_ms: number;
};

export type BoundToolbox = {
  tenant_id: string;
  user_id: string;
  instance_id: string;
  sandbox_id: string;
  already_online: boolean;
  execute(req: BoundToolboxExec): Promise<ToolboxExecResult>;
};

export type BindEnsureOnlineToolboxInput = {
  tenantId: string;
  userId: string;
  ensureOnlineByUser: ToolboxEnsureOnlineByUser;
  toolbox: ToolboxClient;
  waitTimeoutMs?: number;
};

export type ToolboxBindErrorCode = "INVALID_KEY" | "NO_SANDBOX";

export class ToolboxBindError extends Error {
  readonly code: ToolboxBindErrorCode;
  readonly tenantId: string;
  readonly userId: string;

  constructor(
    code: ToolboxBindErrorCode,
    message: string,
    ids: { tenantId: string; userId: string },
  ) {
    super(message);
    this.name = "ToolboxBindError";
    this.code = code;
    this.tenantId = ids.tenantId;
    this.userId = ids.userId;
  }
}

function requiredId(
  value: string | undefined,
  field: "tenantId" | "userId",
  ids: { tenantId: string; userId: string },
): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new ToolboxBindError(
      "INVALID_KEY",
      `bindEnsureOnlineToolbox requires a non-empty ${field}`,
      ids,
    );
  }
  return trimmed;
}

/**
 * Wake via ensure_online(tenant, user), then return a toolbox that execs
 * only on the resolved sandbox_id.
 */
export async function bindEnsureOnlineToolbox(
  input: BindEnsureOnlineToolboxInput,
): Promise<BoundToolbox> {
  const tenantId = requiredId(input.tenantId, "tenantId", {
    tenantId: input.tenantId?.trim() ?? "",
    userId: input.userId?.trim() ?? "",
  });
  const userId = requiredId(input.userId, "userId", {
    tenantId,
    userId: input.userId?.trim() ?? "",
  });
  if (!isToolboxClient(input.toolbox)) {
    throw new TypeError("bindEnsureOnlineToolbox requires a ToolboxClient");
  }
  if (typeof input.ensureOnlineByUser !== "function") {
    throw new TypeError("bindEnsureOnlineToolbox requires ensureOnlineByUser");
  }

  const body: ToolboxEnsureOnlineRequest = {
    sandbox_create_profile: TOOLBOX_BIND_CREATE_PROFILE,
  };
  if (input.waitTimeoutMs !== undefined) {
    body.wait_timeout_ms = input.waitTimeoutMs;
  }

  const online = await input.ensureOnlineByUser(tenantId, userId, body);
  const sandboxId = online.sandbox_id?.trim() ?? "";
  if (!sandboxId) {
    throw new ToolboxBindError(
      "NO_SANDBOX",
      `ensure_online(${tenantId}, ${userId}) returned no sandbox_id`,
      { tenantId, userId },
    );
  }

  const instanceId = online.instance_id?.trim() ?? "";
  if (!instanceId) {
    throw new ToolboxBindError(
      "NO_SANDBOX",
      `ensure_online(${tenantId}, ${userId}) returned no instance_id`,
      { tenantId, userId },
    );
  }

  const toolbox = input.toolbox;

  return {
    tenant_id: online.tenant_id?.trim() || tenantId,
    user_id: userId,
    instance_id: instanceId,
    sandbox_id: sandboxId,
    already_online: online.already_online === true,
    async execute(req: BoundToolboxExec): Promise<ToolboxExecResult> {
      const exec: ToolboxExec = parseToolboxExec({
        sandbox_id: sandboxId,
        argv: req.argv,
        cwd: req.cwd,
        timeout_ms: req.timeout_ms,
      });
      return toolbox.execute(exec);
    },
  };
}
