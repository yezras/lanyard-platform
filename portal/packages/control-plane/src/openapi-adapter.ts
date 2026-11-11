/**
 * OpenAPI fromSpec adapter (lp-hdzm.25 / 0018.25).
 *
 * One native tool per supported operation. Unsupported ops are skipped
 * with a reason. More than NATIVE_TOOL_CAP tools refuses expose without
 * CodeMode (out of this epic). Auth is Class C attach at call time, never
 * a field on the tool schema.
 */
import {
  applyClassCHarnessHttp,
  stripSecretFieldsFromToolSchema,
  toolSchemaHasSecretFields,
  type ClassCFetch,
  type ClassCHttpAttach,
  type ClassCHttpRequest,
  type ClassCHttpResponse,
} from "./class-c-attach.js";
import type { CompiledSurface } from "./connector-registry.js";
import type { GuestConnectorStore } from "./connector-user-sandbox.js";

export const NATIVE_TOOL_CAP = 20 as const;

export const SUPPORTED_HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
] as const;
export type SupportedHttpMethod = (typeof SUPPORTED_HTTP_METHODS)[number];

export const OPENAPI_SKIP_REASONS = [
  "unsupported_method",
  "unsupported_content_type",
  "unresolved_ref",
  "invalid_operation",
] as const;
export type OpenApiSkipReason = (typeof OPENAPI_SKIP_REASONS)[number];

export const ARG_LOCATIONS = ["path", "query", "header", "body"] as const;
export type ArgLocation = (typeof ARG_LOCATIONS)[number];

export type JsonSchemaObject = {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
};

export type OpenApiTool = {
  name: string;
  description: string;
  method: SupportedHttpMethod;
  path: string;
  parameters: JsonSchemaObject;
  locations: Record<string, ArgLocation>;
};

export type SkippedOperation = {
  method: string;
  path: string;
  operation_id?: string;
  reason: OpenApiSkipReason;
};

export type FromSpecExposed = {
  kind: "exposed";
  tools: OpenApiTool[];
  skipped: SkippedOperation[];
  base_url?: string;
};

export type FromSpecRefusedOverCap = {
  kind: "refused_over_cap";
  cap: typeof NATIVE_TOOL_CAP;
  supported_count: number;
  skipped: SkippedOperation[];
  reason: "codemode_required";
};

export type FromSpecResult = FromSpecExposed | FromSpecRefusedOverCap;

export class InvalidOpenApiSpecError extends Error {
  readonly code = "INVALID_OPENAPI_SPEC" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidOpenApiSpecError";
  }
}

export class InvalidOpenApiCallError extends Error {
  readonly code = "INVALID_OPENAPI_CALL" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidOpenApiCallError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isSupportedMethod(value: string): value is SupportedHttpMethod {
  return (SUPPORTED_HTTP_METHODS as readonly string[]).includes(value);
}

function decodePointer(part: string): string {
  return part.replaceAll("~1", "/").replaceAll("~0", "~");
}

function resolvePointer(
  root: Record<string, unknown>,
  ref: string,
): unknown | undefined {
  if (!ref.startsWith("#/")) {
    return undefined;
  }
  const parts = ref.slice(2).split("/").map(decodePointer);
  let cur: unknown = root;
  for (const part of parts) {
    const rec = asRecord(cur);
    if (!rec || !(part in rec)) {
      return undefined;
    }
    cur = rec[part];
  }
  return cur;
}

function resolveNode(
  root: Record<string, unknown>,
  value: unknown,
  seen: Set<string>,
): unknown | undefined {
  const rec = asRecord(value);
  if (!rec) {
    return value;
  }
  const ref = rec.$ref;
  if (typeof ref !== "string") {
    return value;
  }
  if (!ref.startsWith("#/")) {
    return undefined;
  }
  if (seen.has(ref)) {
    return undefined;
  }
  seen.add(ref);
  const target = resolvePointer(root, ref);
  if (target === undefined) {
    return undefined;
  }
  const resolved = resolveNode(root, target, seen);
  if (resolved === undefined) {
    return undefined;
  }
  const { $ref: _, ...siblings } = rec;
  const targetRec = asRecord(resolved);
  if (!targetRec || Object.keys(siblings).length === 0) {
    return resolved;
  }
  return { ...targetRec, ...siblings };
}

function schemaType(schema: Record<string, unknown>): string {
  if (typeof schema.type === "string") {
    return schema.type;
  }
  return "string";
}

function parameterSchema(schema: unknown): Record<string, unknown> {
  const rec = asRecord(schema);
  if (!rec) {
    return { type: "string" };
  }
  const out: Record<string, unknown> = { ...rec };
  delete out.xml;
  delete out.example;
  delete out.examples;
  if (!("type" in out) && !("properties" in out) && !("items" in out)) {
    out.type = "string";
  }
  return out;
}

function contentJsonSchema(
  content: unknown,
): Record<string, unknown> | "unsupported" | "missing" {
  const rec = asRecord(content);
  if (!rec) {
    return "missing";
  }
  const json = asRecord(rec["application/json"]);
  if (json) {
    const schema = asRecord(json.schema) ?? {};
    return schema;
  }
  if (Object.keys(rec).length === 0) {
    return "missing";
  }
  return "unsupported";
}

function toolName(operationId: unknown, method: string, path: string): string {
  const raw =
    typeof operationId === "string" && operationId.trim()
      ? operationId.trim()
      : `${method}_${path}`;
  let name = raw
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  if (!name) {
    name = `${method}_op`;
  }
  if (!/^[A-Za-z]/.test(name)) {
    name = `op_${name}`.slice(0, 64);
  }
  return name;
}

function uniquify(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  for (let i = 2; i < 1000; i += 1) {
    const suffix = `_${i}`;
    const next = `${name.slice(0, 64 - suffix.length)}${suffix}`;
    if (!used.has(next)) {
      used.add(next);
      return next;
    }
  }
  const fallback = `${name.slice(0, 60)}_x`;
  used.add(fallback);
  return fallback;
}

function descriptionOf(
  operation: Record<string, unknown>,
  method: string,
  path: string,
): string {
  if (typeof operation.summary === "string" && operation.summary.trim()) {
    return operation.summary.trim();
  }
  if (
    typeof operation.description === "string" &&
    operation.description.trim()
  ) {
    return operation.description.trim();
  }
  return `${method.toUpperCase()} ${path}`;
}

function collectParameters(
  root: Record<string, unknown>,
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
): { ok: true; rows: Record<string, unknown>[] } | { ok: false } {
  const rows: Record<string, unknown>[] = [];
  for (const list of [pathItem.parameters, operation.parameters]) {
    if (list === undefined) {
      continue;
    }
    if (!Array.isArray(list)) {
      return { ok: false };
    }
    for (const entry of list) {
      const resolved = resolveNode(root, entry, new Set());
      const rec = asRecord(resolved);
      if (!rec) {
        return { ok: false };
      }
      rows.push(rec);
    }
  }
  return { ok: true, rows };
}

function isAuthParamName(name: string): boolean {
  return /^(authorization|api[_-]?key|x[_-]?api[_-]?key|token|access[_-]?token|secret|password|bearer|credential|credentials)$/i.test(
    name,
  );
}

function stripParameters(schema: JsonSchemaObject): JsonSchemaObject {
  const stripped = stripSecretFieldsFromToolSchema(schema);
  const rec = asRecord(stripped);
  const properties = asRecord(rec?.properties) ?? {};
  const requiredRaw = Array.isArray(rec?.required) ? rec.required : [];
  const required = requiredRaw.filter(
    (key): key is string => typeof key === "string" && key in properties,
  );
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

type BuiltTool =
  | { ok: true; tool: OpenApiTool }
  | { ok: false; reason: OpenApiSkipReason };

function buildTool(
  root: Record<string, unknown>,
  path: string,
  method: SupportedHttpMethod,
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
  usedNames: Set<string>,
): BuiltTool {
  const params = collectParameters(root, pathItem, operation);
  if (!params.ok) {
    return { ok: false, reason: "unresolved_ref" };
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const locations: Record<string, ArgLocation> = {};

  for (const param of params.rows) {
    if (typeof param.name !== "string" || !param.name) {
      return { ok: false, reason: "invalid_operation" };
    }
    const name = param.name;
    if (param.in === "cookie") {
      continue;
    }
    if (
      param.in === "header" &&
      (isAuthParamName(name) || /^authorization$/i.test(name))
    ) {
      continue;
    }
    let location: ArgLocation;
    if (param.in === "path") {
      location = "path";
    } else if (param.in === "query") {
      location = "query";
    } else if (param.in === "header") {
      location = "header";
    } else {
      return { ok: false, reason: "invalid_operation" };
    }
    const schemaResolved = resolveNode(root, param.schema, new Set());
    if (param.schema !== undefined && schemaResolved === undefined) {
      return { ok: false, reason: "unresolved_ref" };
    }
    properties[name] = parameterSchema(schemaResolved);
    locations[name] = location;
    if (param.required === true || location === "path") {
      required.push(name);
    }
  }

  const requestBody = resolveNode(root, operation.requestBody, new Set());
  if (operation.requestBody !== undefined && requestBody === undefined) {
    return { ok: false, reason: "unresolved_ref" };
  }
  const bodyRec = asRecord(requestBody);
  if (bodyRec) {
    const json = contentJsonSchema(bodyRec.content);
    if (json === "unsupported") {
      return { ok: false, reason: "unsupported_content_type" };
    }
    if (json !== "missing") {
      const bodySchema = resolveNode(root, json, new Set());
      if (bodySchema === undefined) {
        return { ok: false, reason: "unresolved_ref" };
      }
      const bodyObj = asRecord(bodySchema);
      const bodyProps = asRecord(bodyObj?.properties);
      if (bodyObj && schemaType(bodyObj) === "object" && bodyProps) {
        for (const [key, child] of Object.entries(bodyProps)) {
          if (key in properties) {
            continue;
          }
          const childResolved = resolveNode(root, child, new Set());
          if (childResolved === undefined) {
            return { ok: false, reason: "unresolved_ref" };
          }
          properties[key] = childResolved;
          locations[key] = "body";
        }
        const bodyRequired = Array.isArray(bodyObj.required)
          ? bodyObj.required
          : [];
        for (const key of bodyRequired) {
          if (typeof key === "string" && key in properties && !(key in required)) {
            required.push(key);
          }
        }
      } else {
        properties.body = bodySchema ?? { type: "object" };
        locations.body = "body";
        if (bodyRec.required === true) {
          required.push("body");
        }
      }
    }
  }

  const parameters = stripParameters({
    type: "object",
    properties,
    required: [...new Set(required)],
    additionalProperties: false,
  });
  const keptLocations: Record<string, ArgLocation> = {};
  for (const key of Object.keys(parameters.properties)) {
    const loc = locations[key];
    if (loc) {
      keptLocations[key] = loc;
    }
  }

  const tool: OpenApiTool = {
    name: uniquify(toolName(operation.operationId, method, path), usedNames),
    description: descriptionOf(operation, method, path),
    method,
    path,
    parameters,
    locations: keptLocations,
  };
  if (toolSchemaHasSecretFields(tool.parameters)) {
    tool.parameters = stripParameters(tool.parameters);
  }
  return { ok: true, tool };
}

function parseOpenApiVersion(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return /^3\.\d+/.test(value.trim());
}

function baseUrlFromSpec(spec: Record<string, unknown>): string | undefined {
  if (!Array.isArray(spec.servers) || spec.servers.length === 0) {
    return undefined;
  }
  const first = asRecord(spec.servers[0]);
  if (!first || typeof first.url !== "string" || !first.url.trim()) {
    return undefined;
  }
  const url = first.url.trim();
  if (url.includes("{")) {
    const variables = asRecord(first.variables) ?? {};
    const filled = url.replaceAll(/\{([^}]+)\}/g, (_m, name: string) => {
      const variable = asRecord(variables[name]);
      return typeof variable?.default === "string" ? variable.default : "";
    });
    if (!filled || filled.includes("{")) {
      return undefined;
    }
    return filled.replace(/\/+$/, "");
  }
  return url.replace(/\/+$/, "");
}

function skip(
  method: string,
  path: string,
  operation: Record<string, unknown> | null,
  reason: OpenApiSkipReason,
): SkippedOperation {
  const row: SkippedOperation = { method, path, reason };
  if (operation && typeof operation.operationId === "string") {
    row.operation_id = operation.operationId;
  }
  return row;
}

type CollectedSpec = {
  root: Record<string, unknown>;
  tools: OpenApiTool[];
  skipped: SkippedOperation[];
};

function collectFromSpec(spec: unknown): CollectedSpec {
  const root = asRecord(spec);
  if (!root) {
    throw new InvalidOpenApiSpecError("spec must be an object");
  }
  if (!parseOpenApiVersion(root.openapi)) {
    throw new InvalidOpenApiSpecError("spec.openapi must be 3.x");
  }
  const paths = asRecord(root.paths);
  if (root.paths !== undefined && !paths) {
    throw new InvalidOpenApiSpecError("spec.paths must be an object");
  }

  const tools: OpenApiTool[] = [];
  const skipped: SkippedOperation[] = [];
  const usedNames = new Set<string>();

  for (const [path, rawItem] of Object.entries(paths ?? {})) {
    if (!path.startsWith("/")) {
      skipped.push(skip("", path, null, "invalid_operation"));
      continue;
    }
    const resolvedItem = resolveNode(root, rawItem, new Set());
    const pathItem = asRecord(resolvedItem);
    if (!pathItem) {
      skipped.push(skip("", path, null, "unresolved_ref"));
      continue;
    }
    for (const [key, rawOp] of Object.entries(pathItem)) {
      const method = key.toLowerCase();
      if (
        method === "parameters" ||
        method === "summary" ||
        method === "description" ||
        method === "servers" ||
        method === "$ref"
      ) {
        continue;
      }
      const operation = asRecord(rawOp);
      if (!operation) {
        skipped.push(skip(method, path, null, "invalid_operation"));
        continue;
      }
      if (!isSupportedMethod(method)) {
        skipped.push(skip(method, path, operation, "unsupported_method"));
        continue;
      }
      const built = buildTool(root, path, method, pathItem, operation, usedNames);
      if (!built.ok) {
        skipped.push(skip(method, path, operation, built.reason));
        continue;
      }
      tools.push(built.tool);
    }
  }

  return { root, tools, skipped };
}

/**
 * Convert an OpenAPI 3 document into native tools, skipping unsupported
 * operations. Caps at NATIVE_TOOL_CAP; over-cap refuses without CodeMode.
 */
export function fromSpec(spec: unknown): FromSpecResult {
  const { root, tools, skipped } = collectFromSpec(spec);

  if (tools.length > NATIVE_TOOL_CAP) {
    return {
      kind: "refused_over_cap",
      cap: NATIVE_TOOL_CAP,
      supported_count: tools.length,
      skipped,
      reason: "codemode_required",
    };
  }

  const result: FromSpecExposed = {
    kind: "exposed",
    tools,
    skipped,
  };
  const base = baseUrlFromSpec(root);
  if (base) {
    result.base_url = base;
  }
  return result;
}

/** Same names as fromSpec, including over-cap. Used to classify member subset. */
export function listOpenApiToolsIgnoringCap(spec: unknown): OpenApiTool[] {
  return collectFromSpec(spec).tools;
}

export function fromCompiledSurface(surface: CompiledSurface): FromSpecResult {
  if (surface.kind !== "openapi") {
    throw new InvalidOpenApiSpecError("surface is not openapi");
  }
  if (surface.runnability !== "runnable" || !surface.spec) {
    throw new InvalidOpenApiSpecError("openapi surface is not runnable");
  }
  return fromSpec(surface.spec);
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%2F", "/");
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function buildOpenApiRequest(input: {
  tool: OpenApiTool;
  args: Record<string, unknown>;
  baseUrl: string;
}): ClassCHttpRequest {
  const baseUrl = input.baseUrl.trim();
  if (!baseUrl) {
    throw new InvalidOpenApiCallError("baseUrl is required");
  }
  let path = input.tool.path;
  const query = new URLSearchParams();
  const headers: Record<string, string> = { Accept: "application/json" };
  const body: Record<string, unknown> = {};
  let hasBody = false;

  for (const [name, location] of Object.entries(input.tool.locations)) {
    const present = Object.prototype.hasOwnProperty.call(input.args, name);
    const required = input.tool.parameters.required.includes(name);
    if (!present) {
      if (required || location === "path") {
        throw new InvalidOpenApiCallError(`missing argument: ${name}`);
      }
      continue;
    }
    const raw = input.args[name];
    const value =
      raw === undefined || raw === null
        ? ""
        : typeof raw === "string"
          ? raw
          : typeof raw === "number" || typeof raw === "boolean"
            ? String(raw)
            : JSON.stringify(raw);
    if (location === "path") {
      path = path.replaceAll(`{${name}}`, encodePathSegment(value));
    } else if (location === "query") {
      query.set(name, value);
    } else if (location === "header") {
      headers[name] = value;
    } else {
      body[name] = raw;
      hasBody = true;
    }
  }
  if (/\{[^}]+\}/.test(path)) {
    throw new InvalidOpenApiCallError(`unbound path template: ${path}`);
  }

  const qs = query.toString();
  const url = `${joinUrl(baseUrl, path)}${qs ? `?${qs}` : ""}`;
  const request: ClassCHttpRequest = {
    url,
    method: input.tool.method.toUpperCase(),
    headers,
  };
  if (hasBody && input.tool.method !== "get" && input.tool.method !== "delete") {
    request.body = JSON.stringify(body);
    request.headers = { ...headers, "Content-Type": "application/json" };
  }
  return request;
}

export async function callOpenApiTool(input: {
  tool: OpenApiTool;
  args: Record<string, unknown>;
  attach: ClassCHttpAttach;
  fetch: ClassCFetch;
  baseUrl: string;
  guest?: Pick<GuestConnectorStore, "listFiles" | "printenv">;
  sandbox_id?: string;
}): Promise<{
  response: ClassCHttpResponse;
  sent: ClassCHttpRequest;
  logged: ClassCHttpRequest;
  request: ClassCHttpRequest;
}> {
  const request = buildOpenApiRequest({
    tool: input.tool,
    args: input.args,
    baseUrl: input.baseUrl,
  });
  const result = await applyClassCHarnessHttp({
    fetch: input.fetch,
    request,
    attach: input.attach,
    guest: input.guest,
    sandbox_id: input.sandbox_id,
  });
  return { ...result, request };
}
