/**
 * Durable scheduled-job registry (platform SoT) + guest rematerialize (lp-jzl.10.1).
 *
 * Problem: LA product store is `$BACKEND_HOME/cron/jobs.json`. On Daytona,
 * `BACKEND_HOME` is ephemeral sandbox disk — stop/start or cold recreate
 * loses job definitions if they only live on the guest.
 *
 * Decision (see docs/plans/0012-scheduled-tasks/durable-job-registry.md):
 *   - **Platform SoT** — Control Plane holds the durable job document per
 *     permanent `instance_id` (survives stop, retain, cold create, CP restart
 *     when file-backed).
 *   - **Rematerialize on ensure_online** — after sandbox is Started, inject
 *     the platform document into guest `$BACKEND_HOME/cron/jobs.json` so the
 *     agent ticker / Brain RPC snapshot see the same definitions as the fire
 *     path (lp-jzl.10.2 evaluator reads platform SoT; guest sees rematerialized
 *     copy).
 *
 * Vault-backed rematerialize was rejected for V1 ops fire: platform schedule
 * evaluation must not require guest online or Mountpoint I/O. Vault remains
 * for tenant content (`VAULT_ROOT`), not runtime job registry.
 *
 * Scope of this module: durability + materialize ports. Create/update dual-write
 * from Brain RPC and the platform fire evaluator are sibling beads.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Relative path under `$BACKEND_HOME` for the product job store. */
export const GUEST_CRON_JOBS_RELATIVE_PATH = "cron/jobs.json" as const;

/**
 * Default guest BACKEND_HOME used when materializing without an override.
 * Matches backend-runtime / EC2 layout; Daytona inject may set a different path
 * via env — materializer records the relative product path either way.
 */
export const DEFAULT_GUEST_BACKEND_HOME =
  "/var/lib/company-brain-backend" as const;

/** Env: durable JSON registry path on CP volume (optional). */
export const SCHEDULED_JOB_REGISTRY_PATH_ENV =
  "SCHEDULED_JOB_REGISTRY_PATH" as const;

/** Structured schedule (jobs.json / Brain RPC cron.create). */
export type ScheduledJobSchedule = {
  kind?: string;
  expr?: string;
  display?: string;
  timezone?: string;
  run_at?: string;
  [key: string]: unknown;
};

/**
 * One scheduled task row. Shape aligns with
 * `contracts/backend-runtime-v1/examples/lanyard-agent.cron.jobs.json`.
 * Extra host fields are preserved on put.
 */
export type ScheduledJob = {
  id: string;
  name?: string;
  enabled?: boolean;
  state?: string | null;
  schedule?: string | ScheduledJobSchedule;
  prompt?: string;
  deliver?: string;
  skills?: string[];
  created_at?: string;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  path?: string;
  [key: string]: unknown;
};

/** Full product store document under cron/jobs.json. */
export type ScheduledJobsDocument = {
  jobs: ScheduledJob[];
  updated_at?: string;
  [key: string]: unknown;
};

/**
 * Platform source-of-truth for scheduled jobs, keyed by permanent instance_id.
 * Implementations must not log prompt bodies (may contain tenant content).
 */
export type ScheduledJobRegistry = {
  getDocument(instanceId: string): Promise<ScheduledJobsDocument | null>;
  list(instanceId: string): Promise<ScheduledJob[]>;
  /**
   * Permanent instance_ids with a registry document (platform SoT scan).
   * Used by the schedule evaluator (lp-jzl.10.2) to find due jobs without
   * guest online.
   */
  listInstanceIds(): Promise<string[]>;
  putDocument(instanceId: string, doc: ScheduledJobsDocument): Promise<void>;
  putJob(instanceId: string, job: ScheduledJob): Promise<void>;
  deleteJob(instanceId: string, jobId: string): Promise<void>;
  /** Drop all jobs for an instance (deprovision). */
  deleteInstance(instanceId: string): Promise<void>;
};

export type MaterializeScheduledJobsInput = {
  instanceId: string;
  sandboxId: string;
  /** Absolute guest BACKEND_HOME; default DEFAULT_GUEST_BACKEND_HOME. */
  backendHome?: string;
  document: ScheduledJobsDocument;
};

export type MaterializeScheduledJobsResult = {
  /** Absolute guest path written (or virtual path in fake). */
  path: string;
  jobCount: number;
  sandboxId: string;
  instanceId: string;
};

/**
 * Writes the platform job document into the guest ephemeral BACKEND_HOME tree.
 * Real Daytona: FS/exec adapter (follow-on). Fake: in-memory guest FS for tests.
 */
export type GuestCronMaterializer = {
  materialize(
    input: MaterializeScheduledJobsInput,
  ): Promise<MaterializeScheduledJobsResult>;
  /** Read guest jobs.json when present (tests / ops). */
  readGuest(sandboxId: string): Promise<ScheduledJobsDocument | null>;
  /**
   * Wipe ephemeral guest files for a sandbox (simulates stop/recreate disk loss).
   * Platform registry is **not** cleared.
   */
  wipeEphemeral(sandboxId: string): Promise<void>;
};

export class ScheduledJobRegistryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ScheduledJobRegistryError";
    this.code = code;
  }
}

/** Absolute guest path for jobs.json. */
export function guestCronJobsAbsolutePath(
  backendHome: string = DEFAULT_GUEST_BACKEND_HOME,
): string {
  const home = backendHome.replace(/\/+$/, "") || DEFAULT_GUEST_BACKEND_HOME;
  return `${home}/${GUEST_CRON_JOBS_RELATIVE_PATH}`;
}

/** Normalize / clone a jobs document (stable jobs array). */
export function normalizeScheduledJobsDocument(
  doc: ScheduledJobsDocument | null | undefined,
  updatedAt?: string,
): ScheduledJobsDocument {
  const jobs = Array.isArray(doc?.jobs)
    ? doc!.jobs.map((j) => cloneJob(j)).filter((j) => Boolean(j.id))
    : [];
  const out: ScheduledJobsDocument = {
    jobs,
    updated_at:
      (typeof doc?.updated_at === "string" && doc.updated_at) ||
      updatedAt ||
      new Date().toISOString(),
  };
  return out;
}

/** Serialize product jobs.json (pretty for guest readability). */
export function serializeScheduledJobsDocument(
  doc: ScheduledJobsDocument,
): string {
  return `${JSON.stringify(normalizeScheduledJobsDocument(doc), null, 2)}\n`;
}

export function parseScheduledJobsDocument(
  raw: string,
): ScheduledJobsDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ScheduledJobRegistryError(
      "INVALID_JOBS_JSON",
      "jobs document is not valid JSON",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ScheduledJobRegistryError(
      "INVALID_JOBS_JSON",
      "jobs document must be an object with jobs[]",
    );
  }
  const obj = parsed as Record<string, unknown>;
  const jobsRaw = obj.jobs;
  if (jobsRaw !== undefined && !Array.isArray(jobsRaw)) {
    throw new ScheduledJobRegistryError(
      "INVALID_JOBS_JSON",
      "jobs must be an array",
    );
  }
  const jobs: ScheduledJob[] = [];
  for (const row of Array.isArray(jobsRaw) ? jobsRaw : []) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const id = String((row as ScheduledJob).id ?? "").trim();
    if (!id) continue;
    jobs.push(cloneJob({ ...(row as ScheduledJob), id }));
  }
  return normalizeScheduledJobsDocument({
    jobs,
    updated_at:
      typeof obj.updated_at === "string" ? obj.updated_at : undefined,
  });
}

function cloneJob(job: ScheduledJob): ScheduledJob {
  const id = String(job.id ?? "").trim();
  return {
    ...job,
    id,
    path: job.path ?? GUEST_CRON_JOBS_RELATIVE_PATH,
  };
}

function requireInstanceId(instanceId: string): string {
  const id = instanceId?.trim() ?? "";
  if (!id) {
    throw new ScheduledJobRegistryError(
      "INVALID_INSTANCE_ID",
      "instance_id is required",
    );
  }
  return id;
}

/**
 * In-process platform registry for unit tests and single-process CP default.
 */
export function createInMemoryScheduledJobRegistry(): ScheduledJobRegistry & {
  size(): number;
  clear(): void;
  /** Test helper: raw snapshot of all instance documents. */
  snapshot(): Record<string, ScheduledJobsDocument>;
} {
  const byInstance = new Map<string, ScheduledJobsDocument>();

  return {
    async getDocument(instanceId: string) {
      const row = byInstance.get(requireInstanceId(instanceId));
      return row ? normalizeScheduledJobsDocument(row) : null;
    },

    async list(instanceId: string) {
      const doc = byInstance.get(requireInstanceId(instanceId));
      return doc ? normalizeScheduledJobsDocument(doc).jobs : [];
    },

    async listInstanceIds() {
      return [...byInstance.keys()].sort();
    },

    async putDocument(instanceId: string, doc: ScheduledJobsDocument) {
      const id = requireInstanceId(instanceId);
      byInstance.set(
        id,
        normalizeScheduledJobsDocument(doc, new Date().toISOString()),
      );
    },

    async putJob(instanceId: string, job: ScheduledJob) {
      const id = requireInstanceId(instanceId);
      const jobId = String(job.id ?? "").trim();
      if (!jobId) {
        throw new ScheduledJobRegistryError(
          "INVALID_JOB",
          "job.id is required",
        );
      }
      const existing = byInstance.get(id);
      const jobs = existing ? [...normalizeScheduledJobsDocument(existing).jobs] : [];
      const nextJob = cloneJob({ ...job, id: jobId });
      const idx = jobs.findIndex((j) => j.id === jobId);
      if (idx >= 0) jobs[idx] = { ...jobs[idx], ...nextJob };
      else jobs.push(nextJob);
      byInstance.set(
        id,
        normalizeScheduledJobsDocument(
          { jobs, updated_at: new Date().toISOString() },
        ),
      );
    },

    async deleteJob(instanceId: string, jobId: string) {
      const id = requireInstanceId(instanceId);
      const jid = jobId?.trim() ?? "";
      const existing = byInstance.get(id);
      if (!existing || !jid) return;
      const jobs = normalizeScheduledJobsDocument(existing).jobs.filter(
        (j) => j.id !== jid,
      );
      byInstance.set(
        id,
        normalizeScheduledJobsDocument({
          jobs,
          updated_at: new Date().toISOString(),
        }),
      );
    },

    async deleteInstance(instanceId: string) {
      byInstance.delete(requireInstanceId(instanceId));
    },

    size() {
      return byInstance.size;
    },

    clear() {
      byInstance.clear();
    },

    snapshot() {
      const out: Record<string, ScheduledJobsDocument> = {};
      for (const [k, v] of byInstance) {
        out[k] = normalizeScheduledJobsDocument(v);
      }
      return out;
    },
  };
}

type FileRegistryFile = {
  version: 1;
  instances: Record<string, ScheduledJobsDocument>;
};

/**
 * File-backed platform registry on a durable CP volume.
 * Survives CP task replacement when path is on durable storage.
 * Not multi-writer safe (single-process CP). Postgres multi-replica is a follow-on.
 */
export function createFileScheduledJobRegistry(
  filePath: string,
): ScheduledJobRegistry {
  const path = filePath?.trim();
  if (!path) {
    throw new ScheduledJobRegistryError(
      "INVALID_REGISTRY_PATH",
      "file path is required for file scheduled job registry",
    );
  }

  let cache: FileRegistryFile | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  async function load(): Promise<FileRegistryFile> {
    if (cache) return cache;
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as FileRegistryFile;
      if (!parsed || parsed.version !== 1 || typeof parsed.instances !== "object") {
        cache = { version: 1, instances: {} };
      } else {
        cache = {
          version: 1,
          instances: { ...parsed.instances },
        };
      }
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : "";
      if (code === "ENOENT") {
        cache = { version: 1, instances: {} };
      } else {
        throw err;
      }
    }
    return cache;
  }

  async function persist(next: FileRegistryFile): Promise<void> {
    cache = next;
    const body = `${JSON.stringify(next, null, 2)}\n`;
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, path);
  }

  function enqueue(op: () => Promise<void>): Promise<void> {
    const run = writeChain.then(op, op);
    writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    async getDocument(instanceId: string) {
      const id = requireInstanceId(instanceId);
      const file = await load();
      const row = file.instances[id];
      return row ? normalizeScheduledJobsDocument(row) : null;
    },

    async list(instanceId: string) {
      const doc = await this.getDocument(instanceId);
      return doc?.jobs ?? [];
    },

    async listInstanceIds() {
      const file = await load();
      return Object.keys(file.instances).sort();
    },

    async putDocument(instanceId: string, doc: ScheduledJobsDocument) {
      const id = requireInstanceId(instanceId);
      await enqueue(async () => {
        const file = await load();
        const next: FileRegistryFile = {
          version: 1,
          instances: {
            ...file.instances,
            [id]: normalizeScheduledJobsDocument(
              doc,
              new Date().toISOString(),
            ),
          },
        };
        await persist(next);
      });
    },

    async putJob(instanceId: string, job: ScheduledJob) {
      const id = requireInstanceId(instanceId);
      const jobId = String(job.id ?? "").trim();
      if (!jobId) {
        throw new ScheduledJobRegistryError(
          "INVALID_JOB",
          "job.id is required",
        );
      }
      await enqueue(async () => {
        const file = await load();
        const existing = file.instances[id];
        const jobs = existing
          ? [...normalizeScheduledJobsDocument(existing).jobs]
          : [];
        const nextJob = cloneJob({ ...job, id: jobId });
        const idx = jobs.findIndex((j) => j.id === jobId);
        if (idx >= 0) jobs[idx] = { ...jobs[idx], ...nextJob };
        else jobs.push(nextJob);
        const next: FileRegistryFile = {
          version: 1,
          instances: {
            ...file.instances,
            [id]: normalizeScheduledJobsDocument({
              jobs,
              updated_at: new Date().toISOString(),
            }),
          },
        };
        await persist(next);
      });
    },

    async deleteJob(instanceId: string, jobId: string) {
      const id = requireInstanceId(instanceId);
      const jid = jobId?.trim() ?? "";
      if (!jid) return;
      await enqueue(async () => {
        const file = await load();
        const existing = file.instances[id];
        if (!existing) return;
        const jobs = normalizeScheduledJobsDocument(existing).jobs.filter(
          (j) => j.id !== jid,
        );
        const next: FileRegistryFile = {
          version: 1,
          instances: {
            ...file.instances,
            [id]: normalizeScheduledJobsDocument({
              jobs,
              updated_at: new Date().toISOString(),
            }),
          },
        };
        await persist(next);
      });
    },

    async deleteInstance(instanceId: string) {
      const id = requireInstanceId(instanceId);
      await enqueue(async () => {
        const file = await load();
        if (!(id in file.instances)) return;
        const instances = { ...file.instances };
        delete instances[id];
        await persist({ version: 1, instances });
      });
    },
  };
}

/**
 * Resolve registry from env: file path when set, else in-memory.
 */
export function resolveScheduledJobRegistry(
  env: NodeJS.ProcessEnv = process.env,
): {
  kind: "memory" | "file";
  store: ScheduledJobRegistry;
  path: string | null;
} {
  const path = env[SCHEDULED_JOB_REGISTRY_PATH_ENV]?.trim() || "";
  if (path) {
    return {
      kind: "file",
      store: createFileScheduledJobRegistry(path),
      path,
    };
  }
  return {
    kind: "memory",
    store: createInMemoryScheduledJobRegistry(),
    path: null,
  };
}

/**
 * In-memory guest FS for offline tests: materialize writes jobs.json per
 * sandbox_id; wipeEphemeral simulates ephemeral BACKEND_HOME loss on stop.
 */
export function createInMemoryGuestCronMaterializer(): GuestCronMaterializer & {
  /** Test: number of sandboxes with guest material. */
  sandboxCount(): number;
  clear(): void;
} {
  const bySandbox = new Map<
    string,
    { path: string; document: ScheduledJobsDocument; instanceId: string }
  >();

  return {
    async materialize(input) {
      const sandboxId = input.sandboxId?.trim();
      const instanceId = input.instanceId?.trim();
      if (!sandboxId || !instanceId) {
        throw new ScheduledJobRegistryError(
          "INVALID_MATERIALIZE",
          "instanceId and sandboxId are required to materialize jobs",
        );
      }
      const backendHome =
        input.backendHome?.trim() || DEFAULT_GUEST_BACKEND_HOME;
      const path = guestCronJobsAbsolutePath(backendHome);
      const document = normalizeScheduledJobsDocument(
        input.document,
        new Date().toISOString(),
      );
      bySandbox.set(sandboxId, {
        path,
        document,
        instanceId,
      });
      return {
        path,
        jobCount: document.jobs.length,
        sandboxId,
        instanceId,
      };
    },

    async readGuest(sandboxId: string) {
      const row = bySandbox.get(sandboxId.trim());
      return row ? normalizeScheduledJobsDocument(row.document) : null;
    },

    async wipeEphemeral(sandboxId: string) {
      bySandbox.delete(sandboxId.trim());
    },

    sandboxCount() {
      return bySandbox.size;
    },

    clear() {
      bySandbox.clear();
    },
  };
}

/**
 * Rematerialize platform SoT → guest for one wake. No-op when ports omitted.
 * Always writes a document (empty jobs[] when SoT empty) so guest list is complete.
 */
export async function rematerializeScheduledJobsOnWake(input: {
  instanceId: string;
  sandboxId: string;
  registry: ScheduledJobRegistry | null | undefined;
  materializer: GuestCronMaterializer | null | undefined;
  backendHome?: string;
  now?: () => Date;
}): Promise<MaterializeScheduledJobsResult | null> {
  const { registry, materializer } = input;
  if (!registry || !materializer) return null;

  const instanceId = requireInstanceId(input.instanceId);
  const sandboxId = input.sandboxId?.trim();
  if (!sandboxId) {
    throw new ScheduledJobRegistryError(
      "INVALID_MATERIALIZE",
      "sandboxId is required to rematerialize jobs",
    );
  }

  const existing = await registry.getDocument(instanceId);
  const document = normalizeScheduledJobsDocument(
    existing ?? { jobs: [] },
    (input.now ?? (() => new Date()))().toISOString(),
  );

  return materializer.materialize({
    instanceId,
    sandboxId,
    backendHome: input.backendHome,
    document,
  });
}
