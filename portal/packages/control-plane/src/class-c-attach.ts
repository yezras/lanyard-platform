/**
 * Class C request-time harness attach (lp-hdzm.24 / 0018.24).
 *
 * The harness HTTP client receives `Authorization`. Tool schemas never
 * include secret fields. Daytona guest never receives a token file or
 * Class C env. `buildProviderWakeEnv` is Class B only.
 */

import { REDACTED, isSecretKey } from "@lanyard/shared";

import type { ConnectorId } from "./connectors.js";
import type { GuestConnectorStore } from "./connector-user-sandbox.js";
import type {
  ClassCSecretPayload,
  ConnectorSurfaceId,
} from "./class-c-secrets.js";
import { buildProviderWakeEnv } from "./provider-wake-env.js";

export const CLASS_C_AUTHORIZATION_HEADER = "Authorization" as const;

export const CLASS_C_GUEST_TOKEN_PATHS = [
  "/var/lib/company-brain-backend/mcp-auth.json",
  "/mnt/vault/mcp-auth.json",
  "/root/.config/mcp-auth.json",
  "/tmp/mcp-auth.json",
] as const;

const TOOL_SCHEMA_SECRET_KEY =
  /^(api[_-]?key|x[_-]?api[_-]?key|authorization|auth|token|access[_-]?token|refresh[_-]?token|secret|password|passwd|bearer|credential|credentials)$/i;

export type ClassCHttpAttach = {
  tenant_id: string;
  connector_id: ConnectorId;
  surface_id: ConnectorSurfaceId;
  headers: { Authorization: string };
};

export type ClassCHttpRequest = {
  url: string;
  method?: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
};

export type ClassCHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type ClassCFetch = (
  request: ClassCHttpRequest,
) => Promise<ClassCHttpResponse>;

export class ClassCGuestInjectError extends Error {
  readonly code = "CLASS_C_GUEST_INJECT" as const;

  constructor(
    message = "Class C must not inject onto the Daytona guest",
  ) {
    super(message);
    this.name = "ClassCGuestInjectError";
  }
}

export class ClassCWakeEnvError extends Error {
  readonly code = "CLASS_C_WAKE_ENV" as const;

  constructor(message = "Class C must not use buildProviderWakeEnv") {
    super(message);
    this.name = "ClassCWakeEnvError";
  }
}

export function authorizationValueFor(
  payload: ClassCSecretPayload,
): string {
  const value = payload.value.trim();
  if (/^bearer\s+/i.test(value)) {
    return value.replace(/^bearer\s+/i, "Bearer ");
  }
  return `Bearer ${value}`;
}

export function buildClassCHttpAttach(input: {
  tenant_id: string;
  connector_id: ConnectorId;
  surface_id: ConnectorSurfaceId;
  payload: ClassCSecretPayload;
}): ClassCHttpAttach {
  return {
    tenant_id: input.tenant_id,
    connector_id: input.connector_id,
    surface_id: input.surface_id,
    headers: {
      Authorization: authorizationValueFor(input.payload),
    },
  };
}

export function attachClassCAuthorization(
  request: ClassCHttpRequest,
  attach: ClassCHttpAttach,
): ClassCHttpRequest {
  return {
    ...request,
    headers: {
      ...(request.headers ?? {}),
      [CLASS_C_AUTHORIZATION_HEADER]: attach.headers.Authorization,
    },
  };
}

export async function sendClassCHttp(
  fetchImpl: ClassCFetch,
  request: ClassCHttpRequest,
  attach: ClassCHttpAttach,
): Promise<ClassCHttpResponse> {
  return fetchImpl(attachClassCAuthorization(request, attach));
}

export function redactClassCHeaders(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = isSecretKey(key) || /authorization/i.test(key) ? REDACTED : value;
  }
  return out;
}

export function redactClassCHttpRequest(
  request: ClassCHttpRequest,
): ClassCHttpRequest {
  return {
    ...request,
    headers: request.headers ? redactClassCHeaders(request.headers) : undefined,
  };
}

function stripSecretFieldsFromObject(
  rec: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(rec)) {
    if (TOOL_SCHEMA_SECRET_KEY.test(key) || isSecretKey(key)) {
      continue;
    }
    if (key === "security" || key === "securitySchemes") {
      continue;
    }
    out[key] = stripSecretFieldsFromToolSchema(child);
  }
  return out;
}

/** Drop secret-named properties and OpenAPI security blocks from a tool schema. */
export function stripSecretFieldsFromToolSchema(schema: unknown): unknown {
  if (schema == null) {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map((item) => stripSecretFieldsFromToolSchema(item));
  }
  if (typeof schema !== "object") {
    return schema;
  }
  return stripSecretFieldsFromObject(schema as Record<string, unknown>);
}

export function toolSchemaHasSecretFields(schema: unknown): boolean {
  if (schema == null || typeof schema !== "object") {
    return false;
  }
  if (Array.isArray(schema)) {
    return schema.some((item) => toolSchemaHasSecretFields(item));
  }
  for (const [key, child] of Object.entries(schema as Record<string, unknown>)) {
    if (
      TOOL_SCHEMA_SECRET_KEY.test(key) ||
      isSecretKey(key) ||
      key === "security" ||
      key === "securitySchemes"
    ) {
      return true;
    }
    if (toolSchemaHasSecretFields(child)) {
      return true;
    }
  }
  return false;
}

/**
 * Class C is not a provider wake slot. Calling `buildProviderWakeEnv` with a
 * Class C token in the source map must not copy it; this asserts that.
 */
export function assertClassCNotInProviderWakeEnv(
  attach: ClassCHttpAttach,
  source: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string>> {
  const env = buildProviderWakeEnv(source);
  const token = classCTokenFromAttach(attach);
  for (const [key, value] of Object.entries(env)) {
    if (value === token || value === attach.headers.Authorization) {
      throw new ClassCWakeEnvError(
        `Class C token leaked into provider wake env via ${key}`,
      );
    }
  }
  return env;
}

export function classCTokenFromAttach(attach: ClassCHttpAttach): string {
  return attach.headers.Authorization.replace(/^Bearer\s+/i, "");
}

export function refuseClassCGuestInject(): never {
  throw new ClassCGuestInjectError();
}

export function assertClassCNotOnGuestFs(
  guest: Pick<GuestConnectorStore, "listFiles" | "printenv">,
  sandbox_id: string,
  attach: ClassCHttpAttach,
): void {
  const files = guest.listFiles(sandbox_id);
  for (const path of files) {
    const base = path.replaceAll("\\", "/").split("/").pop() ?? path;
    if (
      CLASS_C_GUEST_TOKEN_PATHS.includes(
        path as (typeof CLASS_C_GUEST_TOKEN_PATHS)[number],
      ) ||
      /mcp-auth|token|secret|stripe|linear/i.test(base)
    ) {
      throw new ClassCGuestInjectError(
        `Class C token file present on guest: ${path}`,
      );
    }
  }
  const token = classCTokenFromAttach(attach);
  const env = guest.printenv(sandbox_id);
  for (const [key, value] of Object.entries(env)) {
    if (value === token || value === attach.headers.Authorization) {
      throw new ClassCGuestInjectError(
        `Class C token present on guest env ${key}`,
      );
    }
  }
}

/**
 * Harness-side call: attach Authorization, never write the guest.
 * `guest` is optional so unit tests can pass a fake fs and prove it stays empty.
 */
export async function applyClassCHarnessHttp(input: {
  fetch: ClassCFetch;
  request: ClassCHttpRequest;
  attach: ClassCHttpAttach;
  guest?: Pick<GuestConnectorStore, "listFiles" | "printenv">;
  sandbox_id?: string;
}): Promise<{
  response: ClassCHttpResponse;
  sent: ClassCHttpRequest;
  logged: ClassCHttpRequest;
}> {
  const sent = attachClassCAuthorization(input.request, input.attach);
  const response = await input.fetch(sent);
  if (input.guest && input.sandbox_id) {
    assertClassCNotOnGuestFs(input.guest, input.sandbox_id, input.attach);
  }
  return {
    response,
    sent,
    logged: redactClassCHttpRequest(sent),
  };
}
