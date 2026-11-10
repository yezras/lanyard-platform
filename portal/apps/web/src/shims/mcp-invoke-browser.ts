/**
 * Browser stand-in for @lanyard/shared harness mcp-invoke.
 * The barrel re-exports Node stdio spawn; the SPA must not bundle it.
 */

export const LAB_ECHO_MCP_NAME = "lab_echo";
export const LAB_ECHO_QUALIFIED_TOOL = "mcp__lab_echo__lab_echo";
export const SEARCH_TOOL_NAME = "search_tool";
export const USE_TOOL_NAME = "use_tool";
export const DEFAULT_LAB_ECHO_IMAGE_PATH =
  "/opt/lanyard/lab-mcp/lab_echo_server.py";
export const HARNESS_MCP_VAULT_SESSION_FAIL_CLOSED =
  "MCP stdio that must see /mnt/vault is out of v1: JSON-RPC needs a Daytona process session, not toolbox process/execute";
export const HARNESS_MCP_UNSUPPORTED =
  "MCP server transport is not bound on this harness runner";

export function parseHarnessMcpServerSpec(
  name: string,
  raw: unknown,
): {
  name: string;
  enabled: boolean;
  transport: string;
  args: string[];
  requires_vault: boolean;
} {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    name,
    enabled: row.enabled === undefined ? true : Boolean(row.enabled),
    transport:
      typeof row.transport === "string"
        ? row.transport
        : typeof row.type === "string"
          ? row.type
          : "stdio",
    args: Array.isArray(row.args) ? row.args.filter((x) => typeof x === "string") : [],
    requires_vault: row.requires_vault === true,
  };
}

export function specTouchesVault(): boolean {
  return false;
}

export function classifyMcpPlacement(spec: { name: string }) {
  return {
    placement: "unsupported" as const,
    spec,
    reason: HARNESS_MCP_UNSUPPORTED,
  };
}

export function wantsHarnessMcpInvoke(): boolean {
  return false;
}

export function snapshotHasEnabledLabEcho(): boolean {
  return false;
}

export function resolveLabEchoServerPath(): string | undefined {
  return undefined;
}

export async function invokeLabEchoStdio(): Promise<never> {
  throw new Error("mcp-invoke is server-only");
}

export async function invokeVaultRequiredStdioMcp(): Promise<string> {
  return HARNESS_MCP_VAULT_SESSION_FAIL_CLOSED;
}

export async function runHarnessMcpLabEchoTurn(): Promise<never> {
  throw new Error("mcp-invoke is server-only");
}
