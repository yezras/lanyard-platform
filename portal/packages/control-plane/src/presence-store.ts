/**
 * Durable presence store backed by CP Postgres `gateway_instances` (lp-omt).
 *
 * Persists orchestrator fields per `instance_id`:
 *   - presence
 *   - sandbox_id
 *   - last_activity_at
 *   - mid_turn / mid_turn_until (lp-053 mid-turn protection)
 *   - vault_writable (lp-vqr0.4; independent of presence)
 *   - stop_after (lp-k5c4.4 spine toolbox hot window)
 *
 * Implements {@link OrchestratorInstanceStore} so InstanceOrchestrator can use
 * the same port as the offline in-memory store (lp-kng.2.2).
 *
 * Compare-and-swap uses `WHERE presence = expected` so a concurrent transition
 * cannot be clobbered by a stale patch.
 */

import type { SqlClient } from "./db.js";
import {
  OrchestratorInstanceNotFoundError,
  type OrchestratorInstancePatch,
  type OrchestratorInstanceRecord,
  type OrchestratorInstanceStore,
} from "./instance-orchestrator.js";
import { isInstancePresence } from "./presence.js";
import { parseVaultWritable } from "./readiness.js";
import {
  INSTANCE_PRESENCE_STATES,
  RUNTIME_KINDS,
  type InstancePresence,
  type RuntimeKind,
} from "./types.js";

/** Columns selected for orchestrator presence mapping. */
const ORCHESTRATOR_SELECT = `
  instance_id, tenant_id, runtime_kind, presence, sandbox_id,
  agent_snapshot_id, s3_vault_prefix, last_activity_at, revoked_at,
  mid_turn, mid_turn_until, vault_writable, stop_after
`;

type OrchestratorRow = {
  instance_id: string;
  tenant_id: string;
  runtime_kind: string | null;
  presence: string | null;
  sandbox_id: string | null;
  agent_snapshot_id: string | null;
  s3_vault_prefix: string | null;
  last_activity_at: string | null;
  revoked_at: string | null;
  mid_turn: boolean | number | null;
  mid_turn_until: string | null;
  vault_writable: boolean | number | string | null;
  stop_after: string | null;
};

function parseRuntimeKind(value: string | null | undefined): RuntimeKind {
  if (value && (RUNTIME_KINDS as readonly string[]).includes(value)) {
    return value as RuntimeKind;
  }
  return "ec2";
}

function parsePresence(value: string | null | undefined): InstancePresence {
  if (value && isInstancePresence(value)) {
    return value;
  }
  return "offline";
}

function assertPresence(value: InstancePresence): InstancePresence {
  if (!isInstancePresence(value)) {
    throw new Error(
      `Invalid presence state: ${String(value)}; expected one of ${INSTANCE_PRESENCE_STATES.join("|")}`,
    );
  }
  return value;
}

/** Coerce Postgres BOOLEAN / integer 0|1 / null → boolean. */
function parseMidTurn(value: boolean | number | null | undefined): boolean {
  if (value === true || value === 1) {
    return true;
  }
  return false;
}

function rowToRecord(row: OrchestratorRow): OrchestratorInstanceRecord {
  return {
    instance_id: row.instance_id,
    tenant_id: row.tenant_id,
    runtime_kind: parseRuntimeKind(row.runtime_kind),
    presence: parsePresence(row.presence),
    sandbox_id: row.sandbox_id ?? null,
    agent_snapshot_id: row.agent_snapshot_id ?? null,
    s3_vault_prefix: row.s3_vault_prefix ?? null,
    last_activity_at: row.last_activity_at ?? null,
    revoked_at: row.revoked_at ?? null,
    mid_turn: parseMidTurn(row.mid_turn),
    mid_turn_until: row.mid_turn_until ?? null,
    vault_writable: parseVaultWritable(row.vault_writable),
    stop_after: row.stop_after ?? null,
  };
}

function mergePatch(
  existing: OrchestratorInstanceRecord,
  patch: OrchestratorInstancePatch,
): Pick<
  OrchestratorInstanceRecord,
  | "presence"
  | "sandbox_id"
  | "last_activity_at"
  | "mid_turn"
  | "mid_turn_until"
  | "vault_writable"
  | "stop_after"
> {
  return {
    presence:
      patch.presence !== undefined
        ? assertPresence(patch.presence)
        : existing.presence,
    sandbox_id:
      patch.sandbox_id !== undefined ? patch.sandbox_id : existing.sandbox_id,
    last_activity_at:
      patch.last_activity_at !== undefined
        ? patch.last_activity_at
        : existing.last_activity_at,
    mid_turn:
      patch.mid_turn !== undefined ? patch.mid_turn : (existing.mid_turn ?? false),
    mid_turn_until:
      patch.mid_turn_until !== undefined
        ? patch.mid_turn_until
        : (existing.mid_turn_until ?? null),
    vault_writable:
      patch.vault_writable !== undefined
        ? parseVaultWritable(patch.vault_writable)
        : parseVaultWritable(existing.vault_writable),
    stop_after:
      patch.stop_after !== undefined
        ? patch.stop_after
        : (existing.stop_after ?? null),
  };
}

/**
 * Postgres-backed {@link OrchestratorInstanceStore} over `gateway_instances`.
 * Does not create instances — rows must already exist (provision / register).
 */
export function createSqlOrchestratorInstanceStore(
  db: SqlClient,
): OrchestratorInstanceStore {
  async function load(
    instanceId: string,
  ): Promise<OrchestratorInstanceRecord | null> {
    const row = await db.get<OrchestratorRow>(
      `SELECT ${ORCHESTRATOR_SELECT}
       FROM gateway_instances WHERE instance_id = ?`,
      [instanceId],
    );
    return row ? rowToRecord(row) : null;
  }

  return {
    async get(instanceId: string) {
      return load(instanceId);
    },

    async update(instanceId: string, patch: OrchestratorInstancePatch) {
      const existing = await load(instanceId);
      if (!existing) {
        throw new OrchestratorInstanceNotFoundError(instanceId);
      }
      const next = mergePatch(existing, patch);

      const row = await db.get<OrchestratorRow>(
        `UPDATE gateway_instances
         SET presence = ?,
             sandbox_id = ?,
             last_activity_at = ?,
             mid_turn = ?,
             mid_turn_until = ?,
             vault_writable = ?,
             stop_after = ?
         WHERE instance_id = ?
         RETURNING ${ORCHESTRATOR_SELECT}`,
        [
          next.presence,
          next.sandbox_id,
          next.last_activity_at,
          next.mid_turn ?? false,
          next.mid_turn_until ?? null,
          next.vault_writable ?? false,
          next.stop_after ?? null,
          instanceId,
        ],
      );
      if (!row) {
        throw new OrchestratorInstanceNotFoundError(instanceId);
      }
      return rowToRecord(row);
    },

    async compareAndUpdate(
      instanceId: string,
      expectedPresence: InstancePresence,
      patch: OrchestratorInstancePatch,
    ) {
      assertPresence(expectedPresence);
      const existing = await load(instanceId);
      if (!existing || existing.presence !== expectedPresence) {
        return null;
      }
      const next = mergePatch(existing, patch);

      // Atomic CAS: only apply when presence still matches expected.
      const row = await db.get<OrchestratorRow>(
        `UPDATE gateway_instances
         SET presence = ?,
             sandbox_id = ?,
             last_activity_at = ?,
             mid_turn = ?,
             mid_turn_until = ?,
             vault_writable = ?,
             stop_after = ?
         WHERE instance_id = ? AND presence = ?
         RETURNING ${ORCHESTRATOR_SELECT}`,
        [
          next.presence,
          next.sandbox_id,
          next.last_activity_at,
          next.mid_turn ?? false,
          next.mid_turn_until ?? null,
          next.vault_writable ?? false,
          next.stop_after ?? null,
          instanceId,
          expectedPresence,
        ],
      );
      return row ? rowToRecord(row) : null;
    },

    async list() {
      const rows = await db.all<OrchestratorRow>(
        `SELECT ${ORCHESTRATOR_SELECT}
         FROM gateway_instances
         ORDER BY created_at ASC`,
      );
      return rows.map(rowToRecord);
    },
  };
}
