/**
 * Durable scheduled-job store under the tenant S3 vault (lp-oop.38.8).
 *
 * Short-stack fire must not depend on guest `$BACKEND_HOME/cron/jobs.json`
 * (ephemeral Daytona disk). CP is the only S3 caller: jobs live at
 * `{s3_vault_prefix}cron/jobs.json`. Create/list/fire read this object
 * without a guest agent tree. Guest rematerialize (lp-jzl.10.1) is the
 * relay/guest-gateway path only.
 *
 * Shape matches {@link ScheduledJobsDocument} /
 * `contracts/backend-runtime-v1/examples/lanyard-agent.cron.jobs.json`.
 * Do not log prompt bodies.
 */

import type { ScheduledJob, ScheduledJobRegistry, ScheduledJobsDocument } from "./scheduled-job-registry.js";
import {
  normalizeScheduledJobsDocument,
  parseScheduledJobsDocument,
  serializeScheduledJobsDocument,
  ScheduledJobRegistryError,
} from "./scheduled-job-registry.js";
import {
  extractRelativeS3VaultPrefix,
  type VaultObjectStore,
} from "./vault-prefix.js";

/** Vault-root-relative product path (under the tenant/instance prefix). */
export const VAULT_SCHEDULED_JOBS_RELATIVE_PATH = "cron/jobs.json" as const;

export type VaultScheduledJobStore = {
  getDocument(s3VaultPrefix: string): Promise<ScheduledJobsDocument>;
  putDocument(s3VaultPrefix: string, doc: ScheduledJobsDocument): Promise<void>;
  list(s3VaultPrefix: string): Promise<ScheduledJob[]>;
  putJob(s3VaultPrefix: string, job: ScheduledJob): Promise<ScheduledJob>;
  deleteJob(s3VaultPrefix: string, jobId: string): Promise<void>;
};

export type CreateVaultScheduledJobStoreOptions = {
  objects: VaultObjectStore;
  bucket: string;
  now?: () => Date;
};

/** Join `{prefix}cron/jobs.json`. Prefix may be `tenants/{id}/vault/`. */
export function vaultScheduledJobsObjectKey(s3VaultPrefix: string): string {
  const prefix = extractRelativeS3VaultPrefix(s3VaultPrefix);
  return `${prefix}${VAULT_SCHEDULED_JOBS_RELATIVE_PATH}`;
}

function requireJobId(job: ScheduledJob): string {
  const id = String(job.id ?? "").trim();
  if (!id) {
    throw new ScheduledJobRegistryError("INVALID_JOB", "job.id is required");
  }
  return id;
}

/**
 * Vault-backed jobs.json. Missing object → empty `{ jobs: [] }` (not an error).
 */
export function createVaultScheduledJobStore(
  options: CreateVaultScheduledJobStoreOptions,
): VaultScheduledJobStore {
  const bucket = options.bucket?.trim();
  if (!bucket) {
    throw new ScheduledJobRegistryError(
      "INVALID_REGISTRY_PATH",
      "vault scheduled-job store requires a bucket",
    );
  }
  const nowFn = options.now ?? (() => new Date());

  async function read(s3VaultPrefix: string): Promise<ScheduledJobsDocument> {
    const key = vaultScheduledJobsObjectKey(s3VaultPrefix);
    const hit = await options.objects.getObject({ bucket, key });
    if (!hit.found) {
      return normalizeScheduledJobsDocument(
        { jobs: [] },
        nowFn().toISOString(),
      );
    }
    return parseScheduledJobsDocument(hit.body);
  }

  async function write(
    s3VaultPrefix: string,
    doc: ScheduledJobsDocument,
  ): Promise<void> {
    const key = vaultScheduledJobsObjectKey(s3VaultPrefix);
    const document = normalizeScheduledJobsDocument(doc, nowFn().toISOString());
    await options.objects.putObject({
      bucket,
      key,
      body: serializeScheduledJobsDocument(document),
      contentType: "application/json; charset=utf-8",
    });
  }

  return {
    async getDocument(s3VaultPrefix) {
      return read(s3VaultPrefix);
    },

    async putDocument(s3VaultPrefix, doc) {
      await write(s3VaultPrefix, doc);
    },

    async list(s3VaultPrefix) {
      return (await read(s3VaultPrefix)).jobs;
    },

    async putJob(s3VaultPrefix, job) {
      const jobId = requireJobId(job);
      const existing = await read(s3VaultPrefix);
      const jobs = [...existing.jobs];
      const nextJob: ScheduledJob = { ...job, id: jobId };
      const idx = jobs.findIndex((row) => row.id === jobId);
      if (idx >= 0) jobs[idx] = { ...jobs[idx], ...nextJob };
      else jobs.push(nextJob);
      await write(s3VaultPrefix, { jobs });
      const latest = (await read(s3VaultPrefix)).jobs.find((row) => row.id === jobId);
      return latest ?? nextJob;
    },

    async deleteJob(s3VaultPrefix, jobId) {
      const id = jobId?.trim() ?? "";
      if (!id) return;
      const existing = await read(s3VaultPrefix);
      await write(s3VaultPrefix, {
        jobs: existing.jobs.filter((row) => row.id !== id),
      });
    },
  };
}

export type VaultScheduledJobRegistryBindings = {
  store: VaultScheduledJobStore;
  /**
   * Permanent instance_id → durable vault prefix. Missing prefix → empty
   * document (create still records the instance so listInstanceIds works).
   */
  prefixForInstance: (
    instanceId: string,
  ) => string | null | Promise<string | null>;
};

/**
 * Adapt a vault store onto {@link ScheduledJobRegistry} (instance_id keyed).
 * Used by the platform evaluator + harness fire path.
 */
export function createScheduledJobRegistryFromVaultStore(
  input: VaultScheduledJobRegistryBindings,
): ScheduledJobRegistry & {
  /** Test helper: instance ids that have been read or written. */
  knownInstanceIds(): string[];
} {
  const known = new Set<string>();

  async function prefixOrThrow(instanceId: string): Promise<string> {
    const id = instanceId?.trim() ?? "";
    if (!id) {
      throw new ScheduledJobRegistryError(
        "INVALID_INSTANCE_ID",
        "instance_id is required",
      );
    }
    known.add(id);
    const prefix = await input.prefixForInstance(id);
    if (!prefix?.trim()) {
      throw new ScheduledJobRegistryError(
        "INVALID_VAULT_PREFIX",
        `no s3_vault_prefix for instance ${id}`,
      );
    }
    return prefix;
  }

  return {
    async getDocument(instanceId) {
      const prefix = await prefixOrThrow(instanceId);
      return input.store.getDocument(prefix);
    },

    async list(instanceId) {
      const prefix = await prefixOrThrow(instanceId);
      return input.store.list(prefix);
    },

    async listInstanceIds() {
      return [...known].sort();
    },

    async putDocument(instanceId, doc) {
      const prefix = await prefixOrThrow(instanceId);
      await input.store.putDocument(prefix, doc);
    },

    async putJob(instanceId, job) {
      const prefix = await prefixOrThrow(instanceId);
      await input.store.putJob(prefix, job);
    },

    async deleteJob(instanceId, jobId) {
      const prefix = await prefixOrThrow(instanceId);
      await input.store.deleteJob(prefix, jobId);
    },

    async deleteInstance(instanceId) {
      const id = instanceId?.trim() ?? "";
      if (!id) return;
      known.delete(id);
      const prefix = await input.prefixForInstance(id);
      if (!prefix?.trim()) return;
      await input.store.putDocument(prefix, { jobs: [] });
    },

    knownInstanceIds() {
      return [...known].sort();
    },
  };
}
