/**
 * lp-nye — pure unit/schema tests for Daytona dual-run CP model fields.
 * No Postgres / live AWS / Daytona required (offline track).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  INSTANCE_PRESENCE_STATES,
  RUNTIME_KINDS,
  type GatewayInstance,
  type GatewayInstancePublic,
  type InstancePresence,
  type RuntimeKind,
} from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrateSrc = readFileSync(
  join(__dirname, "../src/migrate.ts"),
  "utf8",
);
const typesSrc = readFileSync(join(__dirname, "../src/types.ts"), "utf8");

describe("runtime_kind catalog (lp-nye)", () => {
  it("supports exactly ec2 | daytona", () => {
    expect(RUNTIME_KINDS).toEqual(["ec2", "daytona"]);
    const kinds: RuntimeKind[] = ["ec2", "daytona"];
    expect(kinds).toHaveLength(2);
  });

  it("presence field enum matches offline|waking|online|error", () => {
    expect(INSTANCE_PRESENCE_STATES).toEqual([
      "offline",
      "waking",
      "online",
      "error",
    ]);
    const states: InstancePresence[] = [
      "offline",
      "waking",
      "online",
      "error",
    ];
    expect(states).toHaveLength(4);
  });
});

describe("GatewayInstance type surface (lp-nye)", () => {
  it("includes dual-run fields on private and public shapes", () => {
    // Structural compile-time + runtime object shape check.
    const privateRow: GatewayInstance = {
      instance_id: "00000000-0000-4000-8000-000000000001",
      tenant_id: "00000000-0000-4000-8000-000000000002",
      secret_hash: "h",
      secret_salt: "s",
      previous_secret_hash: null,
      previous_secret_salt: null,
      previous_secret_expires_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      revoked_at: null,
      label: null,
      last_seen_at: null,
      health_status: "unknown",
      credential_rotated_at: null,
      secret_param_arn: null,
      ec2_instance_id: null,
      aws_region: null,
      runtime_kind: "daytona",
      sandbox_id: null,
      presence: "offline",
      agent_snapshot_id: "snap-agent-v1",
      s3_vault_prefix: "s3://vault/tenants/t1/vault/",
      last_activity_at: null,
      chat_delivery: null,
    };
    expect(privateRow.runtime_kind).toBe("daytona");
    expect(privateRow.chat_delivery).toBeNull();
    expect(privateRow.sandbox_id).toBeNull();
    expect(privateRow.presence).toBe("offline");
    expect(privateRow.agent_snapshot_id).toBe("snap-agent-v1");
    expect(privateRow.s3_vault_prefix).toContain("tenants/");
    expect(privateRow.last_activity_at).toBeNull();

    const publicRow: GatewayInstancePublic = {
      instance_id: privateRow.instance_id,
      created_at: privateRow.created_at,
      label: null,
      last_seen_at: null,
      health_status: "unknown",
      credential_rotated_at: null,
      secret_param_arn: null,
      ec2_instance_id: null,
      aws_region: null,
      revoked_at: null,
      runtime_kind: "ec2",
      sandbox_id: null,
      presence: "offline",
      agent_snapshot_id: null,
      s3_vault_prefix: null,
      last_activity_at: null,
      chat_delivery: null,
    };
    expect(publicRow.runtime_kind).toBe("ec2");
    expect(publicRow.chat_delivery).toBeNull();
  });
});

describe("schema migration plan (lp-nye)", () => {
  it("greenfield CREATE includes runtime_kind, sandbox_id, presence, snapshot, s3 prefix, last_activity_at", () => {
    for (const col of [
      "runtime_kind",
      "sandbox_id",
      "presence",
      "agent_snapshot_id",
      "s3_vault_prefix",
      "last_activity_at",
    ]) {
      expect(migrateSrc).toContain(col);
    }
  });

  it("defaults runtime_kind to ec2 and presence to offline", () => {
    expect(migrateSrc).toMatch(/runtime_kind TEXT NOT NULL DEFAULT 'ec2'/);
    expect(migrateSrc).toMatch(/presence TEXT NOT NULL DEFAULT 'offline'/);
  });

  it("CHECK constraints allow only ec2|daytona and presence states", () => {
    expect(migrateSrc).toMatch(
      /runtime_kind IN \('ec2', 'daytona'\)/,
    );
    expect(migrateSrc).toMatch(
      /presence IN \('offline', 'waking', 'online', 'error'\)/,
    );
  });

  it("creates scope indexes after ensureOptionalColumns (existing-DB upgrade)", () => {
    const columnsCall = migrateSrc.indexOf("await ensureOptionalColumns");
    const scopeIdx = migrateSrc.indexOf("idx_gateway_instances_tenant_scope");
    const ownerIdx = migrateSrc.indexOf("idx_gateway_instances_user_owner");
    expect(columnsCall).toBeGreaterThan(-1);
    expect(scopeIdx).toBeGreaterThan(columnsCall);
    expect(ownerIdx).toBeGreaterThan(columnsCall);
    expect(migrateSrc).toContain(
      "ALTER TABLE gateway_instances ADD COLUMN scope",
    );
  });

  it("ensureOptionalColumns upgrades existing gateway_instances tables", () => {
    expect(migrateSrc).toContain(
      "ALTER TABLE gateway_instances ADD COLUMN runtime_kind",
    );
    expect(migrateSrc).toContain(
      "ALTER TABLE gateway_instances ADD COLUMN sandbox_id",
    );
    expect(migrateSrc).toContain(
      "ALTER TABLE gateway_instances ADD COLUMN presence",
    );
    expect(migrateSrc).toContain(
      "ALTER TABLE gateway_instances ADD COLUMN agent_snapshot_id",
    );
    expect(migrateSrc).toContain(
      "ALTER TABLE gateway_instances ADD COLUMN s3_vault_prefix",
    );
    expect(migrateSrc).toContain(
      "ALTER TABLE gateway_instances ADD COLUMN last_activity_at",
    );
    expect(migrateSrc).toContain(
      "ALTER TABLE gateway_instances ADD COLUMN vault_writable",
    );
  });

  it("types document field meanings for dual-run", () => {
    expect(typesSrc).toContain("runtime_kind");
    expect(typesSrc).toContain("sandbox_id");
    expect(typesSrc).toContain("s3_vault_prefix");
    expect(typesSrc).toContain("agent_snapshot_id");
    expect(typesSrc).toContain("last_activity_at");
    expect(typesSrc).toContain("vault_writable");
    expect(typesSrc).toContain("INSTANCE_PRESENCE_STATES");
  });
});
