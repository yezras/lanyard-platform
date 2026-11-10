/**
 * Persist workflow run state.json onto the tenant vault via CP HTTP
 * (lp-oop.38.22).
 *
 * Citation SoT is CP S3, not guest Mountpoint. Create-if-absent so a later
 * toolbox mirror can replace with the fuller engine snapshot. Failures log
 * (never silent, never thrown into SSE).
 */

import {
  createLogger,
  workflowRunVaultPersistFromChatEvent,
  workflowRunVaultPersistFromStatePath,
  type Logger,
  type WorkflowRunVaultPersistPayload,
} from "@lanyard/shared";

import {
  CONTROL_PLANE_SERVICE_TOKEN_HEADER,
  ControlPlaneRequestError,
  type ControlPlaneRequestFn,
} from "./control-plane-client.js";
import { VAULT_CP_HTTP_PATHS } from "./vault/cp-s3-provider.js";

const log = createLogger({ service: "bff" });

export const WORKFLOW_RUN_VAULT_PERSIST_FAILED = "workflow_run_vault_persist_failed";

export type WorkflowRunVaultPutJson = (
  tenantId: string,
  path: string,
  body: string,
) => Promise<"created" | "exists">;

export type WorkflowRunVaultPersistOutcome = "created" | "exists" | "skipped";

export type WorkflowRunVaultPersist = {
  persistFromChatEvent(tenantId: string, event: unknown): void;
  /**
   * Awaitable create-if-absent for GET /api/vault/content.
   * Citation SoT is CP S3: a missing workflows/runs/{id}/state.json is
   * materialized from the path so the pane does not 404 into SPA HTML.
   */
  persistMissing(
    tenantId: string,
    path: string,
  ): Promise<WorkflowRunVaultPersistOutcome>;
};

export type CpS3WorkflowRunVaultPersistOptions = {
  baseUrl: string;
  serviceToken?: string;
  requestFn?: ControlPlaneRequestFn;
  now?: () => Date;
  logger?: Pick<Logger, "warn" | "error">;
};

function headersFor(tenantId: string, serviceToken?: string): Headers {
  const headers = new Headers();
  if (serviceToken) {
    headers.set(CONTROL_PLANE_SERVICE_TOKEN_HEADER, serviceToken);
  }
  headers.set("x-lanyard-tenant-id", tenantId);
  headers.set("content-type", "application/json");
  return headers;
}

function cpRelativePath(vaultPath: string): string {
  return vaultPath.replace(/^\/+/, "");
}

export function createCpS3WorkflowRunVaultPutJson(
  options: CpS3WorkflowRunVaultPersistOptions,
): WorkflowRunVaultPutJson {
  const requestFn = options.requestFn ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  return async (tenantId, path, body) => {
    const relative = cpRelativePath(path);
    const getUrl = `${baseUrl}${VAULT_CP_HTTP_PATHS.get(tenantId)}?path=${encodeURIComponent(relative)}`;
    const existing = await requestFn(getUrl, {
      method: "GET",
      headers: headersFor(tenantId, options.serviceToken),
    });
    const existingBody = (await existing.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const existingType = existing.headers.get("content-type") ?? "";
    if (existing.ok && existingType.includes("json")) {
      return "exists";
    }
    const missing =
      existing.status === 404 || existingBody.code === "VAULT_OBJECT_NOT_FOUND";
    if (!existing.ok && !missing) {
      throw new ControlPlaneRequestError(
        existing.status,
        typeof existingBody.error === "string"
          ? existingBody.error
          : "Failed to stat workflow state.json",
        typeof existingBody.code === "string" ? existingBody.code : undefined,
      );
    }

    const putUrl = `${baseUrl}${VAULT_CP_HTTP_PATHS.put(tenantId)}`;
    const response = await requestFn(putUrl, {
      method: "PUT",
      headers: headersFor(tenantId, options.serviceToken),
      body: JSON.stringify({
        path: relative,
        body,
        encoding: "utf-8",
        content_type: "application/json",
        mode: "create_new",
      }),
    });
    const putBody = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (response.ok) {
      return "created";
    }
    if (response.status === 409 || putBody.code === "VAULT_ALREADY_EXISTS") {
      return "exists";
    }
    throw new ControlPlaneRequestError(
      response.status,
      typeof putBody.error === "string"
        ? putBody.error
        : "Failed to write workflow state.json",
      typeof putBody.code === "string" ? putBody.code : undefined,
    );
  };
}

export function createWorkflowRunVaultPersist(options: {
  putJson: WorkflowRunVaultPutJson | null;
  now?: () => Date;
  logger?: Pick<Logger, "warn" | "error">;
}): WorkflowRunVaultPersist {
  const logger = options.logger ?? log;
  const nowFn = options.now ?? (() => new Date());
  const seen = new Set<string>();

  function warnNoWriter(tenant: string, runId: string): void {
    logger.warn("workflow run vault persist skipped (no writer)", {
      tenant_id: tenant,
      run_id: runId,
      metric: WORKFLOW_RUN_VAULT_PERSIST_FAILED,
    });
  }

  async function writePayload(
    tenant: string,
    payload: WorkflowRunVaultPersistPayload,
    debounce: boolean,
  ): Promise<WorkflowRunVaultPersistOutcome> {
    const key = `${tenant}:${payload.runId}`;
    if (debounce) {
      if (seen.has(key)) return "exists";
      seen.add(key);
    }
    if (!options.putJson) {
      if (debounce) seen.delete(key);
      warnNoWriter(tenant, payload.runId);
      return "skipped";
    }
    try {
      return await options.putJson(tenant, payload.path, payload.body);
    } catch (err: unknown) {
      if (debounce) seen.delete(key);
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("workflow run vault persist failed", {
        tenant_id: tenant,
        run_id: payload.runId,
        error: message,
        metric: WORKFLOW_RUN_VAULT_PERSIST_FAILED,
      });
      return "skipped";
    }
  }

  return {
    persistFromChatEvent(tenantId, event) {
      const tenant = tenantId.trim();
      if (!tenant) return;
      const payload = workflowRunVaultPersistFromChatEvent(
        event,
        nowFn().toISOString(),
      );
      if (!payload) return;
      void writePayload(tenant, payload, true);
    },

    async persistMissing(tenantId, path) {
      const tenant = tenantId.trim();
      if (!tenant) return "skipped";
      const payload = workflowRunVaultPersistFromStatePath(
        path,
        nowFn().toISOString(),
      );
      if (!payload) return "skipped";
      return writePayload(tenant, payload, false);
    },
  };
}

export function createCpS3WorkflowRunVaultPersist(
  options: CpS3WorkflowRunVaultPersistOptions,
): WorkflowRunVaultPersist {
  return createWorkflowRunVaultPersist({
    putJson: createCpS3WorkflowRunVaultPutJson(options),
    now: options.now,
    logger: options.logger,
  });
}
