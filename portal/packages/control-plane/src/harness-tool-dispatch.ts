/**
 * Harness tool dispatch (lp-hdzm.27 / 0018.27).
 *
 * Member subset omits tools from the tree and fail-closes the call.
 * First-class CLIs (gws, gh, wacli) are grant on/off only this epic —
 * never a read/write subset.
 */
import { connectorIsOnboarded } from "./connector-onboard.js";
import type { TenantConnectorEntitlement } from "./connectors.js";
import type { ConnectorId, FirstClassConnectorId } from "./connectors.js";
import {
  classifySnapshotTools,
  memberSubsetKindForConnector,
  parseToolName,
  personMayCallTool,
  type ClassifiedMemberTool,
  type MemberSubsetGroup,
  type MemberSubsetKind,
} from "./member-subset.js";
import {
  callOpenApiTool,
  type OpenApiTool,
} from "./openapi-adapter.js";
import {
  InvalidRemoteMcpToolNameError,
  unnamespaceRemoteMcpTool,
} from "./remote-mcp-adapter.js";
import type { ClassCFetch, ClassCHttpAttach } from "./class-c-attach.js";
import type { GuestConnectorStore } from "./connector-user-sandbox.js";
import type { OpsTenantUserRole } from "./types.js";

export const FIRST_CLASS_CLI_BINS = ["gws", "gh", "wacli"] as const;
export type FirstClassCliBin = (typeof FIRST_CLASS_CLI_BINS)[number];

export const FIRST_CLASS_CLI_CONNECTOR: Record<
  FirstClassCliBin,
  FirstClassConnectorId
> = {
  gws: "google",
  gh: "github",
  wacli: "whatsapp",
};

export const FIRST_CLASS_CLI_FOR_CONNECTOR: {
  readonly [K in FirstClassConnectorId]?: FirstClassCliBin;
} = {
  google: "gws",
  github: "gh",
  whatsapp: "wacli",
};

export const HARNESS_TOOL_DENY_REASONS = [
  "not_onboarded",
  "not_granted",
  "member_subset",
] as const;
export type HarnessToolDenyReason = (typeof HARNESS_TOOL_DENY_REASONS)[number];

export type HarnessToolCaller = {
  onboarded: boolean;
  granted: boolean;
  role: OpsTenantUserRole;
  subsetKind: MemberSubsetKind;
  allowlist: readonly string[];
};

export type HarnessToolRef = {
  connector_id: string;
  tool_name: string;
  cli: FirstClassCliBin | null;
};

export type HarnessExposedTool =
  | { kind: "allowlist"; name: string; group: MemberSubsetGroup }
  | { kind: "grant_only"; name: string };

export type HarnessToolAuthorizeOk = {
  status: "allowed";
  http_status: 200;
  connector_id: string;
  tool_name: string;
  kind: MemberSubsetKind;
  cli: FirstClassCliBin | null;
};

export type HarnessToolAuthorizeDenied = {
  status: "forbidden";
  http_status: 403;
  reason: HarnessToolDenyReason;
  message: string;
  connector_id: string;
  tool_name: string;
};

export type HarnessToolAuthorizeResult =
  | HarnessToolAuthorizeOk
  | HarnessToolAuthorizeDenied;

const DENY_MESSAGE: Record<HarnessToolDenyReason, string> = {
  not_onboarded: "Connector is not onboarded",
  not_granted: "Person is not granted this connector",
  member_subset: "Tool is not in the member subset allowlist",
};

export class HarnessToolForbiddenError extends Error {
  readonly code = "HARNESS_TOOL_FORBIDDEN" as const;
  readonly http_status = 403 as const;
  readonly reason: HarnessToolDenyReason;
  readonly connector_id: string;
  readonly tool_name: string;

  constructor(denied: HarnessToolAuthorizeDenied) {
    super(denied.message);
    this.name = "HarnessToolForbiddenError";
    this.reason = denied.reason;
    this.connector_id = denied.connector_id;
    this.tool_name = denied.tool_name;
  }
}

export function isFirstClassCliBin(value: string): value is FirstClassCliBin {
  return (FIRST_CLASS_CLI_BINS as readonly string[]).includes(value);
}

export function parseHarnessConnectorId(raw: string): string {
  const id = raw.trim();
  return isFirstClassCliBin(id) ? FIRST_CLASS_CLI_CONNECTOR[id] : id;
}

export function parseHarnessToolRef(input: {
  connector_id: string;
  tool_name: string;
}): HarnessToolRef {
  const connector_id = parseHarnessConnectorId(input.connector_id);
  const parsed = parseToolName(input.tool_name);
  let tool_name = parsed;
  try {
    tool_name = unnamespaceRemoteMcpTool(connector_id as ConnectorId, parsed);
  } catch (error) {
    if (!(error instanceof InvalidRemoteMcpToolNameError)) {
      throw error;
    }
  }
  const cli = isFirstClassCliBin(tool_name) ? tool_name : null;
  return { connector_id, tool_name, cli };
}

export function harnessToolCallerFrom(input: {
  entitlement: TenantConnectorEntitlement | null;
  granted: boolean;
  role: OpsTenantUserRole;
  subsetKind: MemberSubsetKind;
  allowlist: readonly string[];
}): HarnessToolCaller {
  return {
    onboarded: connectorIsOnboarded(input.entitlement),
    granted: input.granted,
    role: input.role,
    subsetKind: input.subsetKind,
    allowlist: input.allowlist,
  };
}

export function authorizeHarnessToolCall(input: {
  caller: HarnessToolCaller;
  connector_id: string;
  tool_name: string;
}): HarnessToolAuthorizeResult {
  const ref = parseHarnessToolRef({
    connector_id: input.connector_id,
    tool_name: input.tool_name,
  });
  const kind = memberSubsetKindForConnector(ref.connector_id);
  if (!input.caller.onboarded) {
    return deny("not_onboarded", ref);
  }
  if (!input.caller.granted) {
    return deny("not_granted", ref);
  }
  if (
    personMayCallTool({
      onboarded: input.caller.onboarded,
      granted: input.caller.granted,
      role: input.caller.role,
      subsetKind: kind,
      toolName: ref.tool_name,
      allowlist: input.caller.allowlist,
    })
  ) {
    return {
      status: "allowed",
      http_status: 200,
      connector_id: ref.connector_id,
      tool_name: ref.tool_name,
      kind,
      cli: ref.cli,
    };
  }
  return deny("member_subset", ref);
}

export function assertHarnessToolAllowed(input: {
  caller: HarnessToolCaller;
  connector_id: string;
  tool_name: string;
}): HarnessToolAuthorizeOk {
  const result = authorizeHarnessToolCall(input);
  if (result.status === "forbidden") {
    throw new HarnessToolForbiddenError(result);
  }
  return result;
}

export function listHarnessExposedTools(input: {
  connector_id: string;
  snapshot: unknown;
}): HarnessExposedTool[] {
  const kind = memberSubsetKindForConnector(input.connector_id);
  if (kind === "grant_only") {
    const cli =
      FIRST_CLASS_CLI_FOR_CONNECTOR[
        input.connector_id as FirstClassConnectorId
      ];
    return cli ? [{ kind: "grant_only", name: cli }] : [];
  }
  return classifySnapshotTools(input.snapshot).map((tool) =>
    classifiedToExposed(tool),
  );
}

export function filterHarnessExposedTools(
  caller: HarnessToolCaller,
  tools: readonly HarnessExposedTool[],
): HarnessExposedTool[] {
  return tools.filter((tool) =>
    personMayCallTool({
      onboarded: caller.onboarded,
      granted: caller.granted,
      role: caller.role,
      subsetKind: tool.kind,
      toolName: tool.name,
      allowlist: caller.allowlist,
    }),
  );
}

export async function dispatchHarnessOpenApiTool(input: {
  caller: HarnessToolCaller;
  connector_id: string;
  tool: OpenApiTool;
  args: Record<string, unknown>;
  attach: ClassCHttpAttach;
  fetch: ClassCFetch;
  baseUrl: string;
  guest?: Pick<GuestConnectorStore, "listFiles" | "printenv">;
  sandbox_id?: string;
}): Promise<{
  authorized: HarnessToolAuthorizeOk;
  call: Awaited<ReturnType<typeof callOpenApiTool>>;
}> {
  const authorized = assertHarnessToolAllowed({
    caller: input.caller,
    connector_id: input.connector_id,
    tool_name: input.tool.name,
  });
  const call = await callOpenApiTool({
    tool: input.tool,
    args: input.args,
    attach: input.attach,
    fetch: input.fetch,
    baseUrl: input.baseUrl,
    guest: input.guest,
    sandbox_id: input.sandbox_id,
  });
  return { authorized, call };
}

export function dispatchHarnessFirstClassCli(input: {
  caller: HarnessToolCaller;
  connector_id: string;
  cli: FirstClassCliBin;
}): HarnessToolAuthorizeOk {
  return assertHarnessToolAllowed({
    caller: input.caller,
    connector_id: input.connector_id,
    tool_name: input.cli,
  });
}

function classifiedToExposed(tool: ClassifiedMemberTool): HarnessExposedTool {
  return { kind: "allowlist", name: tool.name, group: tool.group };
}

function deny(
  reason: HarnessToolDenyReason,
  ref: HarnessToolRef,
): HarnessToolAuthorizeDenied {
  return {
    status: "forbidden",
    http_status: 403,
    reason,
    message: DENY_MESSAGE[reason],
    connector_id: ref.connector_id,
    tool_name: ref.tool_name,
  };
}
