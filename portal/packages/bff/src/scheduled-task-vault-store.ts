/**
 * BFF durable scheduled-task store (lp-oop.38.8).
 *
 * ChatDelivery=harness + VaultPlane=cp_s3: create/list/patch write
 * `cron/jobs.json` under the tenant vault via CP HTTP. No guest Brain RPC,
 * no ensure_online, no GATEWAY_RELAY_SECRET. Fire is CP harness-turn
 * (`fireScheduledTaskHarnessTurn`); this module is create/SoT only.
 *
 * Tests inject {@link createInMemoryScheduledJobStore}. Production uses
 * {@link createCpS3ScheduledJobStore}.
 */

import { randomUUID } from "node:crypto";

import type { SettingsCron, SettingsCronSchedule } from "@lanyard/backend-runtime";

import {
  CONTROL_PLANE_SERVICE_TOKEN_HEADER,
  ControlPlaneRequestError,
  type ControlPlaneRequestFn,
} from "./control-plane-client.js";
import { VAULT_CP_HTTP_PATHS } from "./vault/cp-s3-provider.js";

/** Vault-root-relative product path. Matches CP VAULT_SCHEDULED_JOBS_RELATIVE_PATH. */
export const BFF_VAULT_SCHEDULED_JOBS_PATH = "cron/jobs.json" as const;

export type BffScheduledJobSchedule =
  | { kind: "cron"; expr: string; display?: string; timezone?: string }
  | { kind: "once"; run_at: string; display?: string };

export type BffScheduledJob = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string | BffScheduledJobSchedule | SettingsCronSchedule;
  prompt: string;
  skills?: string[];
  deliver?: string;
  path?: string;
  tenant_id?: string;
  user_id?: string;
  /** Owner of user-principal connectors (lp-xhf4.13). */
  owner_user_id?: string;
  /** google / hubspot / whatsapp when the job uses those CLIs. */
  connector_ids?: string[];
  instance_id?: string;
  created_at?: string;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  state?: string | null;
};

export type BffScheduledJobsDocument = {
  jobs: BffScheduledJob[];
  updated_at?: string;
};

export type BffScheduledJobPatch = Partial<
  Omit<BffScheduledJob, "id">
>;

export type BffScheduledJobStore = {
  getDocument(tenantId: string): Promise<BffScheduledJobsDocument>;
  list(tenantId: string): Promise<BffScheduledJob[]>;
  get(tenantId: string, jobId: string): Promise<BffScheduledJob | null>;
  putJob(tenantId: string, job: BffScheduledJob): Promise<BffScheduledJob>;
  update(
    tenantId: string,
    jobId: string,
    patch: BffScheduledJobPatch,
  ): Promise<BffScheduledJob | null>;
};

export class BffScheduledJobStoreError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "BffScheduledJobStoreError";
    this.code = code;
    this.status = status;
  }
}

function cloneJob(job: BffScheduledJob): BffScheduledJob {
  return {
    ...job,
    skills: job.skills ? [...job.skills] : undefined,
    connector_ids: job.connector_ids ? [...job.connector_ids] : undefined,
  };
}

function normalizeDocument(
  doc: BffScheduledJobsDocument | null | undefined,
  updatedAt: string,
): BffScheduledJobsDocument {
  const jobs = Array.isArray(doc?.jobs)
    ? doc!.jobs.map(cloneJob).filter((j) => Boolean(j.id?.trim()))
    : [];
  return {
    jobs,
    updated_at:
      (typeof doc?.updated_at === "string" && doc.updated_at) || updatedAt,
  };
}

export function createInMemoryScheduledJobStore(options?: {
  now?: () => Date;
}): BffScheduledJobStore & {
  snapshot(): Record<string, BffScheduledJobsDocument>;
  clear(): void;
} {
  const nowFn = options?.now ?? (() => new Date());
  const byTenant = new Map<string, BffScheduledJobsDocument>();

  function requireTenant(tenantId: string): string {
    const id = tenantId?.trim() ?? "";
    if (!id) {
      throw new BffScheduledJobStoreError(
        "INVALID_TENANT_ID",
        "tenant_id is required",
      );
    }
    return id;
  }

  return {
    async getDocument(tenantId) {
      const id = requireTenant(tenantId);
      return normalizeDocument(byTenant.get(id), nowFn().toISOString());
    },

    async list(tenantId) {
      return (await this.getDocument(tenantId)).jobs;
    },

    async get(tenantId, jobId) {
      const id = jobId?.trim() ?? "";
      if (!id) return null;
      const jobs = await this.list(tenantId);
      const hit = jobs.find((j) => j.id === id);
      return hit ? cloneJob(hit) : null;
    },

    async putJob(tenantId, job) {
      const id = requireTenant(tenantId);
      const jobId = job.id?.trim() ?? "";
      if (!jobId) {
        throw new BffScheduledJobStoreError("INVALID_JOB", "job.id is required");
      }
      const existing = normalizeDocument(
        byTenant.get(id),
        nowFn().toISOString(),
      );
      const jobs = [...existing.jobs];
      const next = cloneJob({ ...job, id: jobId });
      const idx = jobs.findIndex((j) => j.id === jobId);
      if (idx >= 0) jobs[idx] = { ...jobs[idx], ...next };
      else jobs.push(next);
      byTenant.set(id, {
        jobs,
        updated_at: nowFn().toISOString(),
      });
      return cloneJob(jobs[idx >= 0 ? idx : jobs.length - 1]!);
    },

    async update(tenantId, jobId, patch) {
      const existing = await this.get(tenantId, jobId);
      if (!existing) return null;
      return this.putJob(tenantId, { ...existing, ...patch, id: existing.id });
    },

    snapshot() {
      const out: Record<string, BffScheduledJobsDocument> = {};
      for (const [k, v] of byTenant) {
        out[k] = normalizeDocument(v, v.updated_at ?? "");
      }
      return out;
    },

    clear() {
      byTenant.clear();
    },
  };
}

export type CpS3ScheduledJobStoreOptions = {
  baseUrl: string;
  requestFn?: ControlPlaneRequestFn;
  serviceToken?: string;
  now?: () => Date;
};

function headersFor(
  tenantId: string,
  serviceToken: string | undefined,
  extra?: Record<string, string>,
): Headers {
  const headers = new Headers(extra);
  if (serviceToken) {
    headers.set(CONTROL_PLANE_SERVICE_TOKEN_HEADER, serviceToken);
  }
  headers.set("x-lanyard-tenant-id", tenantId);
  return headers;
}

/**
 * CP vault/get + vault/put adapter. Missing jobs.json → empty document.
 */
export function createCpS3ScheduledJobStore(
  options: CpS3ScheduledJobStoreOptions,
): BffScheduledJobStore {
  const requestFn = options.requestFn ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const nowFn = options.now ?? (() => new Date());

  async function read(tenantId: string): Promise<BffScheduledJobsDocument> {
    const url = `${baseUrl}${VAULT_CP_HTTP_PATHS.get(tenantId)}?path=${encodeURIComponent(BFF_VAULT_SCHEDULED_JOBS_PATH)}`;
    const response = await requestFn(url, {
      method: "GET",
      headers: headersFor(tenantId, options.serviceToken),
    });
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (response.status === 404 || body.code === "VAULT_OBJECT_NOT_FOUND") {
      return { jobs: [], updated_at: nowFn().toISOString() };
    }
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        typeof body.error === "string" ? body.error : "Failed to read jobs.json",
        typeof body.code === "string" ? body.code : undefined,
      );
    }
    const raw =
      typeof body.body === "string" && body.encoding === "base64"
        ? Buffer.from(body.body, "base64").toString("utf8")
        : typeof body.body === "string"
          ? body.body
          : "";
    if (!raw.trim()) {
      return { jobs: [], updated_at: nowFn().toISOString() };
    }
    try {
      const parsed = JSON.parse(raw) as BffScheduledJobsDocument;
      return normalizeDocument(parsed, nowFn().toISOString());
    } catch {
      throw new BffScheduledJobStoreError(
        "INVALID_JOBS_JSON",
        "vault cron/jobs.json is not valid JSON",
        502,
      );
    }
  }

  async function write(
    tenantId: string,
    doc: BffScheduledJobsDocument,
  ): Promise<void> {
    const document = normalizeDocument(doc, nowFn().toISOString());
    const getUrl = `${baseUrl}${VAULT_CP_HTTP_PATHS.get(tenantId)}?path=${encodeURIComponent(BFF_VAULT_SCHEDULED_JOBS_PATH)}`;
    const existing = await requestFn(getUrl, {
      method: "GET",
      headers: headersFor(tenantId, options.serviceToken),
    });
    const existingBody = (await existing.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const exists = existing.ok;
    const ifMatch =
      typeof existingBody.etag === "string" && existingBody.etag
        ? existingBody.etag
        : undefined;
    const url = `${baseUrl}${VAULT_CP_HTTP_PATHS.put(tenantId)}`;
    const putBody: Record<string, unknown> = {
      path: BFF_VAULT_SCHEDULED_JOBS_PATH,
      body: `${JSON.stringify(document, null, 2)}\n`,
      encoding: "utf-8",
      content_type: "application/json; charset=utf-8",
      mode: exists ? "replace_if_match" : "create_new",
    };
    if (exists && ifMatch) {
      putBody.if_match = ifMatch;
    }
    const response = await requestFn(url, {
      method: "PUT",
      headers: headersFor(tenantId, options.serviceToken, {
        "content-type": "application/json",
      }),
      body: JSON.stringify(putBody),
    });
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        typeof body.error === "string" ? body.error : "Failed to write jobs.json",
        typeof body.code === "string" ? body.code : undefined,
      );
    }
  }

  return {
    async getDocument(tenantId) {
      return read(tenantId);
    },
    async list(tenantId) {
      return (await read(tenantId)).jobs;
    },
    async get(tenantId, jobId) {
      const id = jobId?.trim() ?? "";
      if (!id) return null;
      const hit = (await read(tenantId)).jobs.find((j) => j.id === id);
      return hit ? cloneJob(hit) : null;
    },
    async putJob(tenantId, job) {
      const jobId = job.id?.trim() ?? "";
      if (!jobId) {
        throw new BffScheduledJobStoreError("INVALID_JOB", "job.id is required");
      }
      const existing = await read(tenantId);
      const jobs = [...existing.jobs];
      const next = cloneJob({ ...job, id: jobId });
      const idx = jobs.findIndex((j) => j.id === jobId);
      if (idx >= 0) jobs[idx] = { ...jobs[idx], ...next };
      else jobs.push(next);
      await write(tenantId, { jobs });
      return cloneJob(jobs[idx >= 0 ? idx : jobs.length - 1]!);
    },
    async update(tenantId, jobId, patch) {
      const existing = await this.get(tenantId, jobId);
      if (!existing) return null;
      return this.putJob(tenantId, { ...existing, ...patch, id: existing.id });
    },
  };
}

export function newScheduledTaskJobId(): string {
  return `st_${randomUUID()}`;
}

/** Map a vault job row onto Settings snapshot cron chrome. */
export function scheduledJobToSettingsCron(job: BffScheduledJob): SettingsCron {
  return {
    id: job.id,
    name: job.name,
    schedule: job.schedule,
    enabled: job.enabled,
    path: job.path ?? BFF_VAULT_SCHEDULED_JOBS_PATH,
    prompt: job.prompt,
    skills: job.skills,
    last_run_at: job.last_run_at,
    next_run_at: job.next_run_at,
    state: job.state,
    last_status: job.last_status,
  };
}

export function overlayVaultCronsOnSnapshot(
  snapshot: Record<string, unknown>,
  jobs: BffScheduledJob[],
): Record<string, unknown> {
  return {
    ...snapshot,
    crons: jobs.map(scheduledJobToSettingsCron),
  };
}
