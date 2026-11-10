/**
 * Ops registry (lp-hdzm.5 search + lp-hdzm.19 promote/custom/delete).
 *
 * Search reads ConnectorSource. Promote/custom compile a snapshot in the
 * BFF and persist it on CP. Client-supplied snapshot bodies are rejected.
 */
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import {
  clientSuppliedSnapshot,
  parseCatalogDomain,
  parseConnectorSourceKind,
  parseSearchLimit,
  type ConnectorSource,
  type ConnectorSourceFailure,
} from "./connector-source.js";
import { ControlPlaneRequestError } from "./control-plane-client.js";
import { createIntegrationsShSource } from "./integrations-sh-source.js";
import { csrfProtection } from "./middleware/csrf.js";
import { requireOpsOperator } from "./ops-connectors.js";
import type { OpsVariables } from "./ops-session.js";
import {
  GraphQlRejectedError,
  InvalidRegistrySurfaceError,
  canonicalConnectorLabel,
  compileRegistrySnapshot,
  defaultProbeMcpInitialize,
  parseConnectorSlug,
  slugFromDomain,
  type RegistryCompileDeps,
} from "./registry-snapshot.js";
import type { BffBindings } from "./types.js";

const snapshotRequestSchema = z.object({
  domain: z.string().min(1),
});

const promoteRequestSchema = z.object({
  domain: z.string().min(1),
});

const customSurfaceSchema = z.object({
  kind: z.string().min(1),
  slug: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  initialize_url: z.string().optional(),
  url: z.string().optional(),
  transport: z.string().optional(),
  transports: z.array(z.string()).optional(),
  auth_kind: z.string().optional(),
  spec: z.unknown().optional(),
  openapi: z.unknown().optional(),
  argv: z.array(z.string()).optional(),
  command: z.union([z.string(), z.array(z.string())]).optional(),
});

const customRequestSchema = z.object({
  slug: z.string().min(1),
  label: z.string().min(1).max(128),
  domain: z.string().min(1).optional(),
  surfaces: z.array(customSurfaceSchema).min(1),
});

function throwSourceFailure(failure: ConnectorSourceFailure): never {
  switch (failure.reason) {
    case "bad_domain":
      throw new HTTPException(400, { message: "Invalid domain" });
    case "bad_query":
      throw new HTTPException(400, { message: "q query parameter is required" });
    case "bad_url":
      throw new HTTPException(400, { message: "Refused catalog URL" });
    case "not_found":
      throw new HTTPException(404, { message: "Catalog domain not found" });
    case "oversized":
      throw new HTTPException(502, { message: "Catalog response exceeded size cap" });
    case "invalid_payload":
      throw new HTTPException(502, { message: "Catalog response was not valid JSON" });
    case "upstream":
      throw new HTTPException(502, { message: "Catalog upstream failed" });
    default: {
      const _exhaustive: never = failure.reason;
      throw new HTTPException(502, { message: String(_exhaustive) });
    }
  }
}

function throwControlPlane(error: unknown): never {
  if (error instanceof ControlPlaneRequestError) {
    throw new HTTPException(error.status as ContentfulStatusCode, {
      message: error.message,
    });
  }
  throw error;
}

function throwCompile(error: unknown): never {
  if (error instanceof GraphQlRejectedError) {
    throw new HTTPException(400, { message: error.message });
  }
  if (error instanceof InvalidRegistrySurfaceError) {
    throw new HTTPException(400, { message: error.message });
  }
  throw error;
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }
}

export function resolveConnectorSource(bindings: BffBindings): ConnectorSource {
  return bindings.connectorSource ?? createIntegrationsShSource();
}

function resolveCompileDeps(bindings: BffBindings): RegistryCompileDeps {
  return {
    probeMcpInitialize: defaultProbeMcpInitialize,
    ...bindings.registryCompileDeps,
  };
}

export function registerOpsRegistryRoutes(
  admin: Hono<{ Variables: OpsVariables }>,
  bindings: BffBindings,
): void {
  const source = resolveConnectorSource(bindings);
  const compileDeps = resolveCompileDeps(bindings);

  admin.get("/registry/search", async (c) => {
    requireOpsOperator(c);
    const q = c.req.query("q") ?? "";
    const kind = parseConnectorSourceKind(c.req.query("kind"));
    if (kind === null) {
      throw new HTTPException(400, { message: "Invalid kind" });
    }
    const limit = parseSearchLimit(c.req.query("limit"));
    if (limit === null) {
      throw new HTTPException(400, { message: "Invalid limit" });
    }
    const result = await source.search({ q, kind, limit });
    if (!result.ok) {
      throwSourceFailure(result);
    }
    return c.json({
      source: source.id,
      results: result.value.results,
    });
  });

  admin.get("/registry/envelope", async (c) => {
    requireOpsOperator(c);
    const result = await source.getEnvelope();
    if (!result.ok) {
      throwSourceFailure(result);
    }
    return c.json(result.value);
  });

  admin.get("/registry/surfaces/:domain", async (c) => {
    requireOpsOperator(c);
    const result = await source.getSurface(c.req.param("domain"));
    if (!result.ok) {
      throwSourceFailure(result);
    }
    return c.json({
      source: source.id,
      surface: result.value,
    });
  });

  admin.post("/registry/snapshots", csrfProtection, async (c) => {
    requireOpsOperator(c);
    const body = await readJson(c);
    if (clientSuppliedSnapshot(body)) {
      throw new HTTPException(400, {
        message: "Client-supplied snapshot is not allowed",
      });
    }
    const parsed = snapshotRequestSchema.parse(body);
    const result = await source.getSurface(parsed.domain);
    if (!result.ok) {
      throwSourceFailure(result);
    }
    return c.json({
      source: source.id,
      domain: result.value.domain,
      snapshot: result.value,
    });
  });

  admin.get("/registry/connectors", async (c) => {
    requireOpsOperator(c);
    try {
      const connectors = await bindings.authClient.listCanonicalConnectors();
      return c.json({ connectors });
    } catch (error) {
      throwControlPlane(error);
    }
  });

  admin.post("/registry/promote", csrfProtection, async (c) => {
    const operator = requireOpsOperator(c);
    const body = await readJson(c);
    if (clientSuppliedSnapshot(body)) {
      throw new HTTPException(400, {
        message: "Client-supplied snapshot is not allowed",
      });
    }
    const parsed = promoteRequestSchema.parse(body);
    const domain = parseCatalogDomain(parsed.domain);
    if (!domain) {
      throw new HTTPException(400, { message: "Invalid domain" });
    }
    const id = slugFromDomain(domain);
    if (!id) {
      throw new HTTPException(400, { message: "Invalid domain" });
    }
    const catalog = await source.getSurface(domain);
    if (!catalog.ok) {
      throwSourceFailure(catalog);
    }
    let snapshot;
    try {
      snapshot = await compileRegistrySnapshot({
        source: "integrations.sh",
        domain,
        surfaces: catalog.value.surfaces,
        credential_recipes: catalog.value.credentials,
        deps: compileDeps,
      });
    } catch (error) {
      throwCompile(error);
    }
    const label = canonicalConnectorLabel({
      id,
      summary:
        typeof catalog.value.summary === "string"
          ? catalog.value.summary
          : null,
    });
    try {
      const connector = await bindings.authClient.insertCanonicalConnector({
        id,
        domain,
        label,
        source: "integrations.sh",
        source_entry_id: `integrations.sh:${domain}`,
        snapshot,
        actor: operator.email,
      });
      return c.json(connector, 201);
    } catch (error) {
      throwControlPlane(error);
    }
  });

  admin.post("/registry/custom", csrfProtection, async (c) => {
    const operator = requireOpsOperator(c);
    const body = await readJson(c);
    if (clientSuppliedSnapshot(body)) {
      throw new HTTPException(400, {
        message: "Client-supplied snapshot is not allowed",
      });
    }
    const parsed = customRequestSchema.parse(body);
    const slug = parseConnectorSlug(parsed.slug);
    if (!slug) {
      throw new HTTPException(400, { message: "Invalid slug" });
    }
    const domain = parsed.domain ? parseCatalogDomain(parsed.domain) : null;
    if (parsed.domain && !domain) {
      throw new HTTPException(400, { message: "Invalid domain" });
    }
    let snapshot;
    try {
      snapshot = await compileRegistrySnapshot({
        source: "custom",
        domain,
        surfaces: parsed.surfaces,
        deps: compileDeps,
      });
    } catch (error) {
      throwCompile(error);
    }
    try {
      const connector = await bindings.authClient.insertCanonicalConnector({
        id: slug,
        domain,
        label: parsed.label,
        source: "custom",
        snapshot,
        actor: operator.email,
      });
      return c.json(connector, 201);
    } catch (error) {
      throwControlPlane(error);
    }
  });

  admin.delete("/registry/connectors/:id", csrfProtection, async (c) => {
    const operator = requireOpsOperator(c);
    const id = parseConnectorSlug(c.req.param("id"));
    if (!id) {
      throw new HTTPException(400, { message: "Invalid slug" });
    }
    try {
      const connector = await bindings.authClient.archiveCanonicalConnector({
        id,
        actor: operator.email,
      });
      return c.json(connector);
    } catch (error) {
      throwControlPlane(error);
    }
  });
}
