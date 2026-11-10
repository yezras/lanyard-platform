import {
  OPS_OAUTH_SLOT_IDS,
  PROVIDER_WAKE_ENV_KEYS,
  parseOpsSecretSlot,
  type OpsSecretSlot,
} from "@lanyard/shared";
import { apiErrorMessage, opsApiFetch } from "./opsApi.js";

export { OPS_OAUTH_SLOT_IDS, PROVIDER_WAKE_ENV_KEYS };
export type { OpsSecretSlot };

type ApiErrorBody = { error?: string; message?: string };

/** Row shown in the secrets table: allowlist slot + present status. */
export type OpsSecretSlotRow = {
  slot_id: string;
  slot: OpsSecretSlot;
  present: boolean;
  fingerprint: string | null;
  rotated_at: string | null;
};

function parseStatus(value: unknown): Omit<OpsSecretSlotRow, "slot_id" | "slot"> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const rec = value as Record<string, unknown>;
  const fingerprint =
    typeof rec.fingerprint === "string" && rec.fingerprint
      ? rec.fingerprint
      : null;
  const rotatedAt =
    typeof rec.rotated_at === "string" && rec.rotated_at ? rec.rotated_at : null;
  return {
    present: rec.present === true,
    fingerprint,
    rotated_at: rotatedAt,
  };
}

/** Merge CP statuses onto the closed slot allowlist (missing → absent). */
export function parseOpsSecretRows(body: unknown): OpsSecretSlotRow[] {
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const statuses = Array.isArray(rec.slots) ? rec.slots : [];
  const byId = new Map<string, unknown>();
  for (const item of statuses) {
    if (!item || typeof item !== "object") continue;
    const slotRec = (item as Record<string, unknown>).slot;
    if (!slotRec || typeof slotRec !== "object") continue;
    const s = slotRec as Record<string, unknown>;
    const slotId = s.kind === "env_key" ? s.env_name : s.provider_id;
    if (typeof slotId === "string") {
      byId.set(slotId, item);
    }
  }
  return [...PROVIDER_WAKE_ENV_KEYS, ...OPS_OAUTH_SLOT_IDS].map((slotId) => {
    const slot = parseOpsSecretSlot(slotId) as OpsSecretSlot;
    const status = parseStatus(byId.get(slotId)) ?? {
      present: false,
      fingerprint: null,
      rotated_at: null,
    };
    return { slot_id: slotId, slot, ...status };
  });
}

export async function fetchOpsSecrets(tenantId: string): Promise<OpsSecretSlotRow[]> {
  const res = await opsApiFetch(
    `/api/admin/tenants/${encodeURIComponent(tenantId)}/secrets`,
  );
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new Error(apiErrorMessage(body, "Secrets load failed", res.status));
  }
  return parseOpsSecretRows(body);
}

export async function putOpsSecret(input: {
  tenantId: string;
  slotId: string;
  value: string;
}): Promise<OpsSecretSlotRow> {
  const res = await opsApiFetch(
    `/api/admin/tenants/${encodeURIComponent(input.tenantId)}/secrets/${encodeURIComponent(input.slotId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ value: input.value }),
    },
  );
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new Error(apiErrorMessage(body, "Secret save failed", res.status));
  }
  const rows = parseOpsSecretRows({ slots: [body] });
  const row = rows.find((r) => r.slot_id === input.slotId);
  return (
    row ?? {
      slot_id: input.slotId,
      slot: parseOpsSecretSlot(input.slotId) as OpsSecretSlot,
      present: true,
      fingerprint: null,
      rotated_at: null,
    }
  );
}

export async function deleteOpsSecret(input: {
  tenantId: string;
  slotId: string;
}): Promise<void> {
  const res = await opsApiFetch(
    `/api/admin/tenants/${encodeURIComponent(input.tenantId)}/secrets/${encodeURIComponent(input.slotId)}`,
    { method: "DELETE" },
  );
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new Error(apiErrorMessage(body, "Secret delete failed", res.status));
  }
}
