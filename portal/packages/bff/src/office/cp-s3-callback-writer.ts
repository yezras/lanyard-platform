/**
 * Office callback vault.write via CP vault/put (lp-zuh.12.7).
 *
 * Used when VaultPlane=cp_s3 — short-stack / MockLab has no Brain RPC
 * vault.write. Calls CP HTTP put with etag/content_hash CAS under the
 * tenant prefix. No @aws-sdk in BFF; CP is the only S3 caller.
 *
 * Never log the file body or its base64 form.
 */

import type { VaultWriteHttpBody } from "@lanyard/backend-runtime";

import {
  CONTROL_PLANE_SERVICE_TOKEN_HEADER,
  ControlPlaneRequestError,
  type ControlPlaneRequestFn,
} from "../control-plane-client.js";
import { VAULT_CP_HTTP_PATHS } from "../vault/cp-s3-provider.js";
import type { OfficeCallbackVaultWriter } from "./callback.js";

export type CpS3OfficeCallbackVaultWriterOptions = {
  baseUrl: string;
  requestFn?: ControlPlaneRequestFn;
  serviceToken?: string;
};

export function createCpS3OfficeCallbackVaultWriter(
  options: CpS3OfficeCallbackVaultWriterOptions,
): OfficeCallbackVaultWriter {
  const requestFn = options.requestFn ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  return async ({ session, params }) => {
    const ifMatch =
      params.ifMatch?.trim() ||
      params.expectedRevision?.token?.trim() ||
      "";
    if (params.mode === "replace_if_match" && !ifMatch) {
      const err = new Error(
        "replace_if_match requires if_match / expected_revision",
      );
      (err as { code?: string }).code = "invalid_argument";
      throw err;
    }

    if (params.content === undefined || params.encoding === undefined) {
      const err = new Error(
        "cp_s3 office callback writer requires inline content + encoding",
      );
      (err as { code?: string }).code = "invalid_argument";
      throw err;
    }

    const mode =
      params.mode === "write_checkpoint" ? "replace_if_match" : params.mode;

    const putBody: Record<string, unknown> = {
      path: params.path,
      body: params.content,
      encoding: params.encoding,
      mode,
      size_bytes: params.sizeBytes,
      idempotency_key: params.idempotencyKey,
    };
    if (ifMatch) {
      putBody.if_match = ifMatch;
    }
    if (params.mimeType) {
      putBody.content_type = params.mimeType;
    }

    const { status, body } = await requestVaultPut(
      requestFn,
      baseUrl,
      session.tenant_id,
      putBody,
      options.serviceToken,
    );

    if (status === 409 || body.code === "VAULT_REVISION_CONFLICT") {
      const err = new Error(
        typeof body.error === "string" ? body.error : "revision_mismatch",
      );
      (err as { code?: string }).code = "conflict";
      throw err;
    }
    if (status === 403 || body.code === "VAULT_CROSS_TENANT") {
      const err = new Error(
        typeof body.error === "string" ? body.error : "forbidden",
      );
      (err as { code?: string }).code = "forbidden";
      throw err;
    }
    if (status === 413 || body.code === "VAULT_PAYLOAD_TOO_LARGE") {
      const err = new Error(
        typeof body.error === "string" ? body.error : "payload_too_large",
      );
      (err as { code?: string }).code = "payload_too_large";
      throw err;
    }
    if (status === 501 || status === 503) {
      const err = new Error(
        typeof body.error === "string"
          ? body.error
          : "vault.put unavailable",
      );
      (err as { code?: string }).code = "method_not_found";
      throw err;
    }
    if (status === 404 || body.code === "VAULT_OBJECT_NOT_FOUND") {
      const err = new Error(
        typeof body.error === "string" ? body.error : "not found",
      );
      (err as { code?: string }).code = "conflict";
      throw err;
    }
    if (!statusOk(status)) {
      throw vaultHttpError(status, body, "Failed to write office vault file");
    }

    return mapPutResponse(body, params.path, params.sizeBytes, params.mimeType);
  };
}

function statusOk(status: number): boolean {
  return status >= 200 && status < 300;
}

function vaultHttpError(
  status: number,
  body: Record<string, unknown>,
  fallback: string,
): ControlPlaneRequestError {
  const message =
    typeof body.error === "string" && body.error.length > 0
      ? body.error
      : fallback;
  const code = typeof body.code === "string" ? body.code : undefined;
  return new ControlPlaneRequestError(status, message, code);
}

async function requestVaultPut(
  requestFn: ControlPlaneRequestFn,
  baseUrl: string,
  tenantId: string,
  putBody: Record<string, unknown>,
  serviceToken?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = `${baseUrl}${VAULT_CP_HTTP_PATHS.put(tenantId)}`;
  const headers = new Headers();
  if (serviceToken) {
    headers.set(CONTROL_PLANE_SERVICE_TOKEN_HEADER, serviceToken);
  }
  headers.set("x-lanyard-tenant-id", tenantId);
  headers.set("content-type", "application/json");
  const response = await requestFn(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(putBody),
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return { status: response.status, body };
}

function mapPutResponse(
  body: Record<string, unknown>,
  fallbackPath: string,
  fallbackSize: number,
  fallbackMime?: string,
): VaultWriteHttpBody {
  const revisionRaw =
    typeof body.revision === "object" && body.revision !== null
      ? (body.revision as Record<string, unknown>)
      : {};
  const token =
    typeof revisionRaw.token === "string" && revisionRaw.token.length > 0
      ? revisionRaw.token
      : typeof body.etag === "string"
        ? body.etag
        : "";
  if (!token) {
    const err = new Error("CP vault/put response missing revision.token");
    (err as { code?: string }).code = "unavailable";
    throw err;
  }
  const kind =
    revisionRaw.kind === "etag" || revisionRaw.kind === "content_hash"
      ? revisionRaw.kind
      : "content_hash";
  const sizeBytes =
    typeof body.size_bytes === "number" && Number.isFinite(body.size_bytes)
      ? body.size_bytes
      : fallbackSize;
  const path = typeof body.path === "string" ? body.path : fallbackPath;
  const mime =
    (typeof body.content_type === "string" && body.content_type) ||
    fallbackMime ||
    "application/octet-stream";
  const writtenAt =
    typeof body.written_at === "string" && body.written_at.length > 0
      ? body.written_at
      : new Date().toISOString();

  return {
    path,
    revision: {
      token,
      kind,
      size_bytes: sizeBytes,
      ...(typeof revisionRaw.modified_at === "string"
        ? { modified_at: revisionRaw.modified_at }
        : {}),
    },
    ...(typeof body.etag === "string" ? { etag: body.etag } : {}),
    size_bytes: sizeBytes,
    mime_type: mime,
    written_at: writtenAt,
    created: body.created === true,
    ...(body.idempotent_replay === true ? { idempotent_replay: true } : {}),
    source: "cp_s3",
  };
}
