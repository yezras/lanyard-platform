/**
 * lp-oop.38.8 — durable scheduled jobs under the S3 vault (FakeS3).
 * No guest disk. No live AWS.
 */
import { describe, expect, it } from "vitest";

import { FakeS3ObjectStore } from "../src/fake-s3-object-store.js";
import {
  createScheduledJobRegistryFromVaultStore,
  createVaultScheduledJobStore,
  VAULT_SCHEDULED_JOBS_RELATIVE_PATH,
  vaultScheduledJobsObjectKey,
} from "../src/vault-scheduled-job-store.js";

const BUCKET = "lanyard-mocklab-vault-test";
const TENANT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const INSTANCE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PREFIX = `tenants/${TENANT}/vault/`;
const T0 = new Date("2026-08-20T12:00:00.000Z");

describe("vault scheduled-job store (lp-oop.38.8)", () => {
  it("keys jobs.json under the tenant vault prefix, not guest BACKEND_HOME", () => {
    expect(VAULT_SCHEDULED_JOBS_RELATIVE_PATH).toBe("cron/jobs.json");
    expect(vaultScheduledJobsObjectKey(PREFIX)).toBe(
      `tenants/${TENANT}/vault/cron/jobs.json`,
    );
    expect(vaultScheduledJobsObjectKey(PREFIX)).not.toMatch(
      /var\/lib\/company-brain-backend/,
    );
  });

  it("missing object is an empty document; putJob survives as S3 bytes", async () => {
    const objects = new FakeS3ObjectStore({ now: () => T0 });
    const store = createVaultScheduledJobStore({
      objects,
      bucket: BUCKET,
      now: () => T0,
    });

    const empty = await store.getDocument(PREFIX);
    expect(empty.jobs).toEqual([]);

    await store.putJob(PREFIX, {
      id: "st-digest",
      name: "Daily digest",
      enabled: true,
      prompt: "Summarize overnight vault changes.",
      schedule: { kind: "cron", expr: "0 9 * * 1-5" },
      tenant_id: TENANT,
      user_id: "user-ada",
      instance_id: INSTANCE,
    });

    const key = vaultScheduledJobsObjectKey(PREFIX);
    expect(objects.has(BUCKET, key)).toBe(true);
    const listed = await store.list(PREFIX);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe("st-digest");
    expect(listed[0]?.prompt).toBe("Summarize overnight vault changes.");
    expect(objects.get(BUCKET, key)?.body).toContain('"id": "st-digest"');
  });

  it("instance-keyed registry adapter round-trips without guest materialize", async () => {
    const objects = new FakeS3ObjectStore({ now: () => T0 });
    const store = createVaultScheduledJobStore({
      objects,
      bucket: BUCKET,
      now: () => T0,
    });
    const prefixes = new Map<string, string>([[INSTANCE, PREFIX]]);
    const registry = createScheduledJobRegistryFromVaultStore({
      store,
      prefixForInstance: (id) => prefixes.get(id) ?? null,
    });

    await registry.putJob(INSTANCE, {
      id: "st-once",
      name: "Once",
      enabled: true,
      prompt: "Ping",
      schedule: { kind: "once", run_at: "2026-08-21T09:00:00.000Z" },
    });

    expect(await registry.listInstanceIds()).toEqual([INSTANCE]);
    const doc = await registry.getDocument(INSTANCE);
    expect(doc.jobs.map((j) => j.id)).toEqual(["st-once"]);
    expect(objects.has(BUCKET, vaultScheduledJobsObjectKey(PREFIX))).toBe(true);
  });
});
