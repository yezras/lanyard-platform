import { apiErrorMessage, opsApiFetch } from "./opsApi.js";
import { OPS_SURFACE_IDS, type OpsSurfaceId } from "./opsConnectors.js";

type ApiErrorBody = { error?: string; message?: string };

export type OpsClassCSecretStatus = {
  tenant_id: string;
  connector_id: string;
  surface_id: OpsSurfaceId;
  present: boolean;
  fingerprint: string | null;
  rotated_at: string | null;
};

export type OpsClassCSecretList = {
  tenant_id: string;
  connector_id: string;
  surfaces: OpsClassCSecretStatus[];
};

function isOpsSurfaceId(value: unknown): value is OpsSurfaceId {
  return (
    typeof value === "string" &&
    (OPS_SURFACE_IDS as readonly string[]).includes(value)
  );
}

function parseStatus(
  value: unknown,
  fallback: { tenantId: string; connectorId: string; surfaceId: OpsSurfaceId },
): OpsClassCSecretStatus {
  const rec =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const surfaceId = isOpsSurfaceId(rec.surface_id)
    ? rec.surface_id
    : fallback.surfaceId;
  return {
    tenant_id:
      typeof rec.tenant_id === "string" && rec.tenant_id
        ? rec.tenant_id
        : fallback.tenantId,
    connector_id:
      typeof rec.connector_id === "string" && rec.connector_id
        ? rec.connector_id
        : fallback.connectorId,
    surface_id: surfaceId,
    present: rec.present === true,
    fingerprint:
      typeof rec.fingerprint === "string" && rec.fingerprint
        ? rec.fingerprint
        : null,
    rotated_at:
      typeof rec.rotated_at === "string" && rec.rotated_at
        ? rec.rotated_at
        : null,
  };
}

export function parseOpsClassCSecretList(
  body: unknown,
  fallback: { tenantId: string; connectorId: string },
): OpsClassCSecretList {
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const tenantId =
    typeof rec.tenant_id === "string" && rec.tenant_id
      ? rec.tenant_id
      : fallback.tenantId;
  const connectorId =
    typeof rec.connector_id === "string" && rec.connector_id
      ? rec.connector_id
      : fallback.connectorId;
  const rows = Array.isArray(rec.surfaces) ? rec.surfaces : [];
  const surfaces: OpsClassCSecretStatus[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const surfaceRec = item as Record<string, unknown>;
    if (!isOpsSurfaceId(surfaceRec.surface_id)) {
      continue;
    }
    surfaces.push(
      parseStatus(item, {
        tenantId,
        connectorId,
        surfaceId: surfaceRec.surface_id,
      }),
    );
  }
  return { tenant_id: tenantId, connector_id: connectorId, surfaces };
}

export async function fetchOpsClassCSecrets(input: {
  tenantId: string;
  connectorId: string;
}): Promise<OpsClassCSecretList> {
  const res = await opsApiFetch(
    `/api/admin/tenants/${encodeURIComponent(input.tenantId)}/connectors/${encodeURIComponent(input.connectorId)}/class-c-secrets`,
  );
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new Error(
      apiErrorMessage(body, "Class C secrets load failed", res.status),
    );
  }
  return parseOpsClassCSecretList(body, input);
}

export async function putOpsClassCSecret(input: {
  tenantId: string;
  connectorId: string;
  surfaceId: OpsSurfaceId;
  value: string;
  authKind?: "bearer" | "api_key";
}): Promise<OpsClassCSecretStatus> {
  const res = await opsApiFetch(
    `/api/admin/tenants/${encodeURIComponent(input.tenantId)}/connectors/${encodeURIComponent(input.connectorId)}/class-c-secrets/${encodeURIComponent(input.surfaceId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        value: input.value,
        auth_kind: input.authKind,
      }),
    },
  );
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new Error(
      apiErrorMessage(body, "Class C secret save failed", res.status),
    );
  }
  return parseStatus(body, {
    tenantId: input.tenantId,
    connectorId: input.connectorId,
    surfaceId: input.surfaceId,
  });
}

export async function deleteOpsClassCSecret(input: {
  tenantId: string;
  connectorId: string;
  surfaceId: OpsSurfaceId;
}): Promise<void> {
  const res = await opsApiFetch(
    `/api/admin/tenants/${encodeURIComponent(input.tenantId)}/connectors/${encodeURIComponent(input.connectorId)}/class-c-secrets/${encodeURIComponent(input.surfaceId)}`,
    { method: "DELETE" },
  );
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new Error(
      apiErrorMessage(body, "Class C secret delete failed", res.status),
    );
  }
}
