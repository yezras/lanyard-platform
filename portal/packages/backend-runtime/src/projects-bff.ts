/**
 * Thin BFF adapter: agent projects routes through {@link BackendRuntimeService}.
 *
 * Bead: `lp-k7g.8.3` — route projects through Brain RPC.
 *
 * ## Production path
 *
 * ```text
 * GET  /api/agent/projects   →  listAgentProjects(service, ctx)     [preferred]
 * GET  /api/hermes/projects  →  same handler + deprecation headers  [legacy alias]
 *                               → BackendRuntimeService.listProjects
 *                               → Brain RPC projects.list  (required v1)
 *
 * POST /api/agent/projects   →  createAgentProject(service, ctx, body) [preferred]
 * POST /api/hermes/projects  →  same handler + deprecation headers     [legacy]
 *                               → capability gate (projects_create)
 *                               → BackendRuntimeService.createProject?
 *                               → Brain RPC projects.create (expansion)
 *
 * DELETE /api/agent/projects/:id  → deleteAgentProject (soft-archive)
 * DELETE /api/hermes/projects/:id → same + deprecation headers
 *                               → BackendRuntimeService.deleteProject?
 *                               → Brain RPC projects.delete → {id, archived:true}
 *                               → does NOT purge workspace disk (lp-uxy.5)
 *
 * Deprecation catalog / dual-mount: @lanyard/hermes-compat (lp-k7g.8.7)
 * ```
 *
 * Route handlers must **not** import `hermes-projects.ts`, open
 * `$HERMES_HOME/projects.db`, or shell `hermes project create` directly.
 * Those stay behind the Hermes migration adapter ports for temporary
 * fallback only — never as the production composition default.
 *
 * ## Local fixtures
 *
 * `FakeBackendRuntimeService` and in-memory Hermes project stores are
 * **test-only**. Production composition injects `invokeBrainRpc` with
 * `brainRpcPreferred: true` (and preferably `projectsRequireBrainRpc: true`).
 *
 * ## Control-plane vs agent projects
 *
 * - Agent working directories (this module): Brain RPC `projects.*`
 * - Control-plane vault_path ACL records: `/api/projects` via authClient —
 *   unchanged; separate surface.
 *
 * ## Real portal import (current paths)
 *
 * Reference tree (monorepo `portal/`):
 * - Routes: `portal/packages/bff/src/app.ts` (`GET|POST /hermes/projects`)
 * - SoT helpers: `portal/packages/bff/src/hermes-projects.ts` + `hermes/projects.ts`
 * - Web client: `portal/packages/web/src/api/hermesProjects.ts` / `projects.ts`
 * - Brain RPC helpers: `portal/packages/bff/src/brain-rpc.ts`
 *
 * Prefer `listAgentProjects(backendRuntime, ctxFromRequest(c))` and wire
 * composition root via `createHermesBackendRuntimeService({ invokeBrainRpc })`.
 */

import { BackendRuntimeError, backendRuntimeErrorToHttpStatus } from "./errors.js";
import type { BackendRuntimeService } from "./service.js";
import type {
  BackendProject,
  BackendRuntimeContext,
  CreateProjectInput,
  ListProjectsParams,
  ProjectsListResult,
} from "./types.js";

/** Brain RPC method names for agent projects. */
export const PROJECTS_LIST_METHOD = "projects.list" as const;
export const PROJECTS_CREATE_METHOD = "projects.create" as const;
export const PROJECTS_DELETE_METHOD = "projects.delete" as const;

/** Max project name length (matches brain-rpc params_projects_create). */
export const PROJECTS_CREATE_NAME_MAX = 200;

/**
 * HTTP JSON body for GET agent projects (compatible with current web client).
 * `source` is additive for diagnostics; older clients ignore unknown fields.
 */
export type AgentProjectsListHttpBody = {
  projects: BackendProject[];
  /** Origin tag from host / adapter (brain_rpc, hermes_projects_db, fake, none). */
  source: string;
};

/**
 * HTTP JSON body for POST agent project create (201).
 * Same shape as a projects.list item.
 */
export type AgentProjectCreateHttpBody = BackendProject;

/**
 * Wire input for projects.create / POST body.
 * Prefer `folders`; accept legacy `vault_path` as a single-folder alias
 * (matches current web `createProject` mapping).
 */
export type ProjectsCreateWireInput = {
  name: string;
  folders?: string[];
  /** Legacy UI alias → first folder when `folders` omitted. */
  vault_path?: string;
};

export type ListAgentProjectsOptions = {
  params?: ListProjectsParams;
};

export type CreateAgentProjectOptions = {
  /**
   * When true (default), refuse create unless capabilities advertise
   * `projects_create` or `projects.create` in brain_rpc_methods.
   * Contract: define create before UI uses it — UI must gate too.
   */
  requireCapabilityAdvertisement?: boolean;
};

/**
 * Parse and validate projects.create body against the expansion contract.
 * Throws {@link BackendRuntimeError} `invalid_argument` on bad input.
 */
export function parseProjectsCreateInput(body: unknown): CreateProjectInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BackendRuntimeError(
      "invalid_argument",
      "projects.create body must be a JSON object",
      { retryable: false, details: { method: PROJECTS_CREATE_METHOD } },
    );
  }
  const raw = body as Record<string, unknown>;

  if (typeof raw.name !== "string" || !raw.name.trim()) {
    throw new BackendRuntimeError(
      "invalid_argument",
      "projects.create requires a non-empty name",
      { retryable: false, details: { method: PROJECTS_CREATE_METHOD } },
    );
  }
  const name = raw.name.trim();
  if (name.length > PROJECTS_CREATE_NAME_MAX) {
    throw new BackendRuntimeError(
      "invalid_argument",
      `projects.create name exceeds ${PROJECTS_CREATE_NAME_MAX} characters`,
      { retryable: false, details: { method: PROJECTS_CREATE_METHOD } },
    );
  }

  let folders: string[] | undefined;

  if (raw.folders !== undefined && raw.folders !== null) {
    if (!Array.isArray(raw.folders)) {
      throw new BackendRuntimeError(
        "invalid_argument",
        "projects.create folders must be an array of strings",
        { retryable: false, details: { method: PROJECTS_CREATE_METHOD } },
      );
    }
    folders = [];
    for (let i = 0; i < raw.folders.length; i++) {
      const item = raw.folders[i];
      if (typeof item !== "string" || !item.trim()) {
        throw new BackendRuntimeError(
          "invalid_argument",
          `projects.create folders[${i}] must be a non-empty string`,
          { retryable: false, details: { method: PROJECTS_CREATE_METHOD } },
        );
      }
      folders.push(item.trim());
    }
  } else if (typeof raw.vault_path === "string" && raw.vault_path.trim()) {
    // Migration alias used by current web createProject → folders mapping.
    folders = [raw.vault_path.trim()];
  }

  return { name, folders };
}

/**
 * Whether the backend advertises projects.create (expansion).
 * UI and BFF must both check before enabling create.
 */
export function projectsCreateIsAdvertised(caps: {
  features?: Record<string, boolean>;
  brain_rpc_methods?: string[];
}): boolean {
  if (caps.features?.projects_create === true) return true;
  const methods = caps.brain_rpc_methods ?? [];
  return methods.includes(PROJECTS_CREATE_METHOD);
}

/**
 * List agent projects via BackendRuntimeService (production → Brain RPC).
 *
 * Maps to GET /api/hermes/projects response shape.
 */
export async function listAgentProjects(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  options: ListAgentProjectsOptions = {},
): Promise<AgentProjectsListHttpBody> {
  const result: ProjectsListResult = await service.listProjects(
    ctx,
    options.params,
  );
  return toAgentProjectsListHttpBody(result);
}

/**
 * Create an agent project via BackendRuntimeService after contract + capability checks.
 *
 * Maps to POST /api/hermes/projects. Returns the created project row.
 * Does **not** open projects.db or shell hermes CLI.
 */
export async function createAgentProject(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  body: unknown,
  options: CreateAgentProjectOptions = {},
): Promise<AgentProjectCreateHttpBody> {
  const input = parseProjectsCreateInput(body);
  const requireCap = options.requireCapabilityAdvertisement !== false;

  if (requireCap) {
    const caps = await service.capabilities(ctx);
    if (!projectsCreateIsAdvertised(caps)) {
      throw new BackendRuntimeError(
        "method_not_found",
        "projects.create is not advertised by this backend; " +
          "enable only after capabilities.features.projects_create " +
          "(or brain_rpc_methods includes projects.create)",
        {
          retryable: false,
          details: { method: PROJECTS_CREATE_METHOD },
        },
      );
    }
  }

  if (typeof service.createProject !== "function") {
    throw new BackendRuntimeError(
      "method_not_found",
      "BackendRuntimeService.createProject is not implemented",
      {
        retryable: false,
        details: { method: PROJECTS_CREATE_METHOD },
      },
    );
  }

  return service.createProject(ctx, input);
}

/** Soft-delete (archive) an agent project via Brain RPC projects.delete. */
export async function deleteAgentProject(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  projectId: string,
): Promise<{ id: string; archived: true }> {
  const id = projectId.trim();
  if (!id) {
    throw new BackendRuntimeError(
      "invalid_argument",
      "projects.delete requires a non-empty project id",
      { retryable: false, details: { method: PROJECTS_DELETE_METHOD } },
    );
  }
  if (typeof service.deleteProject !== "function") {
    throw new BackendRuntimeError(
      "method_not_found",
      "BackendRuntimeService.deleteProject is not implemented",
      {
        retryable: false,
        details: { method: PROJECTS_DELETE_METHOD },
      },
    );
  }
  return service.deleteProject(ctx, { id });
}

/** Normalize list result for HTTP. */
export function toAgentProjectsListHttpBody(
  result: ProjectsListResult,
): AgentProjectsListHttpBody {
  return {
    projects: Array.isArray(result.projects) ? result.projects : [],
    source:
      typeof result.source === "string" && result.source.length > 0
        ? result.source
        : "none",
  };
}

/**
 * Map a service error to `{ status, body }` for Hono / Express handlers.
 * Uses the same Brain RPC → HTTP table as other backend ops.
 */
export function agentProjectsErrorToHttp(err: unknown): {
  status: number;
  body: { error: string; code: string; retryable?: boolean };
} {
  if (err instanceof BackendRuntimeError) {
    return {
      status: backendRuntimeErrorToHttpStatus(err.code),
      body: {
        error: err.message,
        code: String(err.code),
        retryable: err.retryable,
      },
    };
  }
  const message =
    err instanceof Error ? err.message : "Internal projects route error";
  return {
    status: 500,
    body: { error: message, code: "internal", retryable: true },
  };
}

/**
 * Build BackendRuntimeContext fields typically stamped from a BFF request.
 * Scaffold helper for composition after Portal import — does not read cookies.
 */
export function backendContextFromSession(input: {
  tenantId: string;
  instanceId: string;
  userId: string;
  sessionId: string;
  profileName: string;
  pathPrefixes: string[];
  roles: string[];
  /** Legacy hermes_profile alias; defaults to profileName. */
  hermesProfileAlias?: string;
  timeoutMs?: number;
}): BackendRuntimeContext {
  return {
    tenantId: input.tenantId,
    instanceId: input.instanceId,
    userId: input.userId,
    sessionId: input.sessionId,
    profile: {
      name: input.profileName,
      pathPrefixes: [...input.pathPrefixes],
      hermesProfileAlias: input.hermesProfileAlias ?? input.profileName,
    },
    roles: [...input.roles],
    timeoutMs: input.timeoutMs,
  };
}

/**
 * Handler bundle for BFF route modules after Portal import.
 *
 * ```ts
 * const projects = createAgentProjectsHandlers(backendRuntime);
 * api.get("/hermes/projects", async (c) => {
 *   const ctx = backendContextFromSession(...);
 *   const body = await projects.list(ctx);
 *   return c.json(body);
 * });
 * ```
 */
export function createAgentProjectsHandlers(
  service: BackendRuntimeService,
  defaults: CreateAgentProjectOptions = {},
): {
  list: (
    ctx: BackendRuntimeContext,
    params?: ListProjectsParams,
  ) => Promise<AgentProjectsListHttpBody>;
  create: (
    ctx: BackendRuntimeContext,
    body: unknown,
    options?: CreateAgentProjectOptions,
  ) => Promise<AgentProjectCreateHttpBody>;
  delete: (
    ctx: BackendRuntimeContext,
    projectId: string,
  ) => Promise<{ id: string; archived: true }>;
} {
  return {
    list: (ctx, params) => listAgentProjects(service, ctx, { params }),
    create: (ctx, body, options) =>
      createAgentProject(service, ctx, body, { ...defaults, ...options }),
    delete: (ctx, projectId) => deleteAgentProject(service, ctx, projectId),
  };
}
