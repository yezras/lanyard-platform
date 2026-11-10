/**
 * Promote/custom snapshot compiler (lp-hdzm.19).
 *
 * Catalog rows become a frozen runnable snapshot, or not_runnable when the
 * surface is a pointer. GraphQL is never a compiled kind.
 */
import { isIP } from "node:net";

export const COMPILED_SNAPSHOT_VERSION = 1 as const;

export const REGISTRY_SOURCES = ["integrations.sh", "custom"] as const;
export type RegistrySource = (typeof REGISTRY_SOURCES)[number];

export const COMPILED_SURFACE_KINDS = ["mcp", "openapi", "cli"] as const;
export type CompiledSurfaceKind = (typeof COMPILED_SURFACE_KINDS)[number];

export const RUNNABILITY = ["runnable", "not_runnable"] as const;
export type Runnability = (typeof RUNNABILITY)[number];

export type CompiledSurface = {
  kind: CompiledSurfaceKind;
  slug: string;
  label: string;
  runnability: Runnability;
  initialize_url?: string;
  transport?: "streamable-http";
  auth_kind?: string;
  spec?: Record<string, unknown>;
  argv?: string[];
  reason?: string;
};

export type CompiledSnapshot = {
  version: typeof COMPILED_SNAPSHOT_VERSION;
  source: RegistrySource;
  domain: string | null;
  compiled_at: string;
  runnability: Runnability;
  surfaces: CompiledSurface[];
  credential_recipes?: unknown;
};

export type RegistryCompileDeps = {
  probeMcpInitialize?: (url: string) => Promise<boolean>;
  inlineOpenApi?: (
    url: string,
  ) => Promise<Record<string, unknown> | null>;
  now?: () => Date;
};

export class GraphQlRejectedError extends Error {
  readonly code = "GRAPHQL_REJECTED";

  constructor() {
    super("GraphQL is not supported");
    this.name = "GraphQlRejectedError";
  }
}

export class InvalidRegistrySurfaceError extends Error {
  readonly code = "INVALID_REGISTRY_SURFACE";

  constructor(message: string) {
    super(message);
    this.name = "InvalidRegistrySurfaceError";
  }
}

const SURFACE_SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;
export const CONNECTOR_SLUG_RE = SURFACE_SLUG_RE;

export function slugFromDomain(domain: string): string | null {
  const first = domain.trim().toLowerCase().split(".")[0] ?? "";
  return CONNECTOR_SLUG_RE.test(first) ? first : null;
}

/** Matches CP `insertCanonicalConnectorSchema.label` max. */
export const CANONICAL_LABEL_MAX = 128;

/**
 * Canonical row label for promote. Catalog summaries are prose and often
 * exceed CP's 128-char cap (live stripe.com is 175). Use the short summary
 * when it fits; otherwise title-case the slug.
 */
export function canonicalConnectorLabel(input: {
  id: string;
  summary?: string | null;
}): string {
  const summary = input.summary?.trim() ?? "";
  if (summary.length >= 1 && summary.length <= CANONICAL_LABEL_MAX) {
    return summary;
  }
  const id = input.id.trim();
  if (!id) {
    return "Connector";
  }
  return `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

export function parseConnectorSlug(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return CONNECTOR_SLUG_RE.test(value) ? value : null;
}

export function parseHttpsHostnameUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") {
    return null;
  }
  if (url.username || url.password) {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (isIP(host)) {
    return null;
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    return null;
  }
  if (url.port && url.port !== "443") {
    return null;
  }
  return url;
}

/** Origin-only URLs keep no trailing slash so probes match catalog strings. */
export function httpsUrlString(url: URL): string {
  if (url.pathname === "/" && !url.search && !url.hash) {
    return `${url.protocol}//${url.host}`;
  }
  return url.toString();
}

export function isPinnedArgv(argv: readonly string[]): boolean {
  if (argv.length === 0) {
    return false;
  }
  if (argv.some((part) => part.trim() === "")) {
    return false;
  }
  const bin = argv[0] ?? "";
  const isNpx = bin === "npx" || bin.endsWith("/npx");
  if (isNpx && (argv.includes("-y") || argv.includes("--yes"))) {
    return false;
  }
  if (argv.some((part) => part.includes("@latest"))) {
    return false;
  }
  return true;
}

export function parsePinnedArgv(value: unknown): string[] | null {
  if (typeof value === "string") {
    const parts = value.trim().split(/\s+/).filter(Boolean);
    return isPinnedArgv(parts) ? parts : null;
  }
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((part) => typeof part === "string")
  ) {
    return isPinnedArgv(value) ? [...value] : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function surfaceSlug(raw: unknown, fallback: string): string {
  if (typeof raw === "string" && SURFACE_SLUG_RE.test(raw)) {
    return raw;
  }
  if (SURFACE_SLUG_RE.test(fallback)) {
    return fallback;
  }
  return "surface";
}

function surfaceLabel(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
}

function authKindFrom(rec: Record<string, unknown>): string | undefined {
  if (typeof rec.auth_kind === "string" && rec.auth_kind.trim()) {
    return rec.auth_kind.trim();
  }
  const auth = asRecord(rec.auth);
  if (auth && typeof auth.status === "string") {
    return auth.status;
  }
  return undefined;
}

function transportsOf(rec: Record<string, unknown>): string[] {
  if (!Array.isArray(rec.transports)) {
    if (typeof rec.transport === "string") {
      return [rec.transport];
    }
    return [];
  }
  return rec.transports.filter((row): row is string => typeof row === "string");
}

function inlineSpec(rec: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of ["openapi", "spec", "spec_json"] as const) {
    const value = rec[key];
    const obj = asRecord(value);
    if (obj) {
      return obj;
    }
  }
  return null;
}

function specUrl(rec: Record<string, unknown>): string | null {
  for (const key of ["spec", "spec_url", "url"] as const) {
    if (typeof rec[key] === "string") {
      return rec[key] as string;
    }
  }
  return null;
}

function classifyKind(
  raw: unknown,
): CompiledSurfaceKind | "graphql" | "unknown" {
  if (typeof raw !== "string") {
    return "unknown";
  }
  const value = raw.trim().toLowerCase();
  if (value === "mcp") {
    return "mcp";
  }
  if (value === "openapi" || value === "http" || value === "api") {
    return "openapi";
  }
  if (value === "cli") {
    return "cli";
  }
  if (value === "graphql") {
    return "graphql";
  }
  return "unknown";
}

async function compileMcp(
  rec: Record<string, unknown>,
  slug: string,
  label: string,
  deps: RegistryCompileDeps,
): Promise<CompiledSurface> {
  const urlRaw =
    (typeof rec.initialize_url === "string" && rec.initialize_url) ||
    (typeof rec.url === "string" && rec.url) ||
    "";
  const url = parseHttpsHostnameUrl(urlRaw);
  const transports = transportsOf(rec);
  const hasStreamable = transports.includes("streamable-http");
  const auth_kind = authKindFrom(rec);
  if (!url || !hasStreamable) {
    return {
      kind: "mcp",
      slug,
      label,
      runnability: "not_runnable",
      reason: "mcp_requires_https_initialize_and_streamable_http",
      ...(auth_kind ? { auth_kind } : {}),
    };
  }
  const initializeUrl = httpsUrlString(url);
  const probed = deps.probeMcpInitialize
    ? await deps.probeMcpInitialize(initializeUrl)
    : false;
  if (!probed) {
    return {
      kind: "mcp",
      slug,
      label,
      runnability: "not_runnable",
      initialize_url: initializeUrl,
      transport: "streamable-http",
      reason: "mcp_initialize_probe_failed",
      ...(auth_kind ? { auth_kind } : {}),
    };
  }
  return {
    kind: "mcp",
    slug,
    label,
    runnability: "runnable",
    initialize_url: initializeUrl,
    transport: "streamable-http",
    ...(auth_kind ? { auth_kind } : {}),
  };
}

async function compileOpenApi(
  rec: Record<string, unknown>,
  slug: string,
  label: string,
  deps: RegistryCompileDeps,
): Promise<CompiledSurface> {
  const auth_kind = authKindFrom(rec);
  const inlined = inlineSpec(rec);
  if (inlined) {
    return {
      kind: "openapi",
      slug,
      label,
      runnability: "runnable",
      spec: inlined,
      ...(auth_kind ? { auth_kind } : {}),
    };
  }
  const pointer = specUrl(rec);
  const url = pointer ? parseHttpsHostnameUrl(pointer) : null;
  if (url && deps.inlineOpenApi) {
    const fetched = await deps.inlineOpenApi(httpsUrlString(url));
    if (fetched) {
      return {
        kind: "openapi",
        slug,
        label,
        runnability: "runnable",
        spec: fetched,
        ...(auth_kind ? { auth_kind } : {}),
      };
    }
  }
  return {
    kind: "openapi",
    slug,
    label,
    runnability: "not_runnable",
    reason: "openapi_pointer_not_inlined",
    ...(auth_kind ? { auth_kind } : {}),
  };
}

function compileCli(
  rec: Record<string, unknown>,
  slug: string,
  label: string,
): CompiledSurface {
  const auth_kind = authKindFrom(rec);
  const argv = parsePinnedArgv(rec.argv ?? rec.command);
  if (!argv) {
    return {
      kind: "cli",
      slug,
      label,
      runnability: "not_runnable",
      reason: "cli_argv_not_pinned",
      ...(auth_kind ? { auth_kind } : {}),
    };
  }
  return {
    kind: "cli",
    slug,
    label,
    runnability: "runnable",
    argv,
    ...(auth_kind ? { auth_kind } : {}),
  };
}

export async function compileRegistrySnapshot(input: {
  source: RegistrySource;
  domain?: string | null;
  surfaces: unknown[];
  credential_recipes?: unknown;
  deps?: RegistryCompileDeps;
}): Promise<CompiledSnapshot> {
  const deps = input.deps ?? {};
  const now = deps.now ?? (() => new Date());
  const compiled_at = now().toISOString();
  const surfaces: CompiledSurface[] = [];
  let sawGraphql = false;
  let sawOther = false;

  for (const [index, row] of input.surfaces.entries()) {
    const rec = asRecord(row);
    if (!rec) {
      throw new InvalidRegistrySurfaceError(`surface ${index} is not an object`);
    }
    const kind = classifyKind(rec.kind ?? rec.type);
    if (kind === "graphql") {
      sawGraphql = true;
      continue;
    }
    if (kind === "unknown") {
      throw new InvalidRegistrySurfaceError(
        `surface ${index} has unsupported kind`,
      );
    }
    sawOther = true;
    const slug = surfaceSlug(rec.slug, `${kind}-${index + 1}`);
    const label = surfaceLabel(rec.label ?? rec.name, slug);
    if (kind === "mcp") {
      surfaces.push(await compileMcp(rec, slug, label, deps));
    } else if (kind === "openapi") {
      surfaces.push(await compileOpenApi(rec, slug, label, deps));
    } else {
      surfaces.push(compileCli(rec, slug, label));
    }
  }

  if (sawGraphql && !sawOther) {
    throw new GraphQlRejectedError();
  }

  const runnability: Runnability = surfaces.some(
    (surface) => surface.runnability === "runnable",
  )
    ? "runnable"
    : "not_runnable";

  const snapshot: CompiledSnapshot = {
    version: COMPILED_SNAPSHOT_VERSION,
    source: input.source,
    domain: input.domain ?? null,
    compiled_at,
    runnability,
    surfaces,
  };
  if (input.credential_recipes !== undefined) {
    snapshot.credential_recipes = input.credential_recipes;
  }
  return snapshot;
}

export async function defaultProbeMcpInitialize(url: string): Promise<boolean> {
  const parsed = parseHttpsHostnameUrl(url);
  if (!parsed) {
    return false;
  }
  try {
    const response = await fetch(httpsUrlString(parsed), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "lanyard", version: "0" },
        },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return false;
    }
    const json: unknown = await response.json();
    return Boolean(json && typeof json === "object" && "result" in json);
  } catch {
    return false;
  }
}

/** Offline probe used by BFF tests. Live initialize is never called in CI. */
export function fixtureMcpInitializeProbe(url: string): Promise<boolean> {
  return Promise.resolve(
    url === "https://mcp.stripe.com" || url === "https://mcp.slack.com/mcp",
  );
}
