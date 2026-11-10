/**
 * Office binary via CP vault getObject (lp-oop.12).
 *
 * Signed GET reads bytes from CP HTTP `vault/get` (which calls store.getObject).
 * No gRPC. No Brain RPC chunked read. No ensureOnline. No @aws-sdk.
 * Default Office plane is unchanged — callers select this when VaultPlane=cp_s3.
 *
 * Never log the file body or its base64 form.
 */

import {
  CONTROL_PLANE_SERVICE_TOKEN_HEADER,
  ControlPlaneRequestError,
  type ControlPlaneRequestFn,
} from "../control-plane-client.js";
import { VAULT_CP_HTTP_PATHS } from "../vault/cp-s3-provider.js";
import {
  assertOfficeDownloadSize,
  mimeForOfficeFileType,
} from "./download.js";
import {
  DEFAULT_OFFICE_FILE_MAX_BYTES,
  type OfficeFileType,
} from "./types.js";
import type {
  OfficeBinaryContentSource,
  OfficeBinaryReadResult,
} from "./binary-source.js";

export type CpS3OfficeBinarySourceOptions = {
  tenantId: string | (() => string);
  baseUrl: string;
  requestFn?: ControlPlaneRequestFn;
  serviceToken?: string;
};

export function createCpS3OfficeBinaryContentSource(
  options: CpS3OfficeBinarySourceOptions,
): OfficeBinaryContentSource {
  const requestFn = options.requestFn ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  function resolveTenantId(): string {
    return typeof options.tenantId === "function"
      ? options.tenantId()
      : options.tenantId;
  }

  return {
    async read(input: {
      path: string;
      file_type: OfficeFileType;
      max_bytes: number;
      known_size_bytes?: number;
    }): Promise<OfficeBinaryReadResult> {
      const maxBytes = input.max_bytes || DEFAULT_OFFICE_FILE_MAX_BYTES;

      if (input.known_size_bytes !== undefined) {
        const early = assertOfficeDownloadSize(input.known_size_bytes, maxBytes);
        if (!early.ok) {
          return { ok: false, reason: "oversized" };
        }
      }

      const tenantId = resolveTenantId();
      const { status, body } = await requestVaultGet(
        requestFn,
        baseUrl,
        tenantId,
        input.path,
        options.serviceToken,
      );

      if (status === 404 || isNotAFile(status, body)) {
        return { ok: false, reason: "missing_file" };
      }
      if (!statusOk(status)) {
        throw vaultHttpError(status, body, "Failed to read office vault file");
      }

      const declaredSize =
        typeof body.size_bytes === "number" && Number.isFinite(body.size_bytes)
          ? body.size_bytes
          : undefined;
      if (declaredSize !== undefined) {
        const declared = assertOfficeDownloadSize(declaredSize, maxBytes);
        if (!declared.ok) {
          return { ok: false, reason: "oversized" };
        }
      }

      const bytes = decodeVaultGetBody(body);
      if (bytes === null) {
        return { ok: false, reason: "missing_file" };
      }
      if (bytes.byteLength > maxBytes) {
        return { ok: false, reason: "payload_too_large" };
      }

      const path = typeof body.path === "string" ? body.path : input.path;
      const mime =
        mimeForOfficeFileType(input.file_type) ||
        (typeof body.content_type === "string" ? body.content_type : "");

      return {
        ok: true,
        bytes,
        mime_type: mime,
        size_bytes: bytes.byteLength,
        path,
      };
    },
  };
}

function statusOk(status: number): boolean {
  return status >= 200 && status < 300;
}

function isNotAFile(status: number, body: Record<string, unknown>): boolean {
  return status === 400 && body.code === "VAULT_NOT_A_FILE";
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

async function requestVaultGet(
  requestFn: ControlPlaneRequestFn,
  baseUrl: string,
  tenantId: string,
  vaultPath: string,
  serviceToken?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const params = new URLSearchParams({ path: vaultPath });
  const url = `${baseUrl}${VAULT_CP_HTTP_PATHS.get(tenantId)}?${params}`;
  const headers = new Headers();
  if (serviceToken) {
    headers.set(CONTROL_PLANE_SERVICE_TOKEN_HEADER, serviceToken);
  }
  headers.set("x-lanyard-tenant-id", tenantId);
  const response = await requestFn(url, { method: "GET", headers });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return { status: response.status, body };
}

/**
 * Decode CP vault/get JSON body to raw bytes. CP FakeS3 getObject currently
 * returns encoding=utf-8; accept base64 when the wire uses it for binaries.
 */
function decodeVaultGetBody(body: Record<string, unknown>): Uint8Array | null {
  if (typeof body.body !== "string") {
    return null;
  }
  if (body.encoding === "base64") {
    return new Uint8Array(Buffer.from(body.body, "base64"));
  }
  return new TextEncoder().encode(body.body);
}
