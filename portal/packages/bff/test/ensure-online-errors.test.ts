/**
 * lp-mrh — Map wake failures to user-visible errors and retries.
 * Fake CP errors only; no network / Daytona / secrets.
 */
import { describe, expect, it } from "vitest";

import { ControlPlaneRequestError } from "../src/control-plane-client.js";
import {
  mapControlPlaneWakeFailure,
  wakeFailureToBackendFields,
  wakeFailureToJsonBody,
  type WakeFailureCode,
} from "../src/ensure-online-errors.js";
import { controlPlaneEnsureOnlineToBackendError } from "../src/backend-runtime-compose.js";

function cp(
  status: number,
  message: string,
  code?: string,
): ControlPlaneRequestError {
  return new ControlPlaneRequestError(status, message, code);
}

describe("mapControlPlaneWakeFailure (lp-mrh)", () => {
  it("maps timeout → wake_timeout (retryable)", () => {
    const mapped = mapControlPlaneWakeFailure(
      cp(504, "ensure_online timed out after 60000ms", "ENSURE_ONLINE_TIMEOUT"),
    );
    expect(mapped).toMatchObject({
      code: "wake_timeout",
      httpStatus: 504,
      backendCode: "timeout",
      retryable: true,
      phase: "ensure_online",
      cpCode: "ENSURE_ONLINE_TIMEOUT",
    });
    expect(mapped.message).toMatch(/not delivered/i);
    expect(mapped.retryGuidance.length).toBeGreaterThan(10);
  });

  it("maps 504 without cp code from status alone", () => {
    const mapped = mapControlPlaneWakeFailure(cp(504, "gateway timeout"));
    expect(mapped.code).toBe("wake_timeout");
    expect(mapped.retryable).toBe(true);
  });

  it("maps Daytona API down → daytona_unavailable (retryable)", () => {
    const mapped = mapControlPlaneWakeFailure(
      cp(
        502,
        "ensure_online wake failed: Daytona API down",
        "ENSURE_ONLINE_WAKE_FAILED",
      ),
    );
    expect(mapped).toMatchObject({
      code: "daytona_unavailable",
      httpStatus: 502,
      backendCode: "unavailable",
      retryable: true,
    });
  });

  it("maps connection refused / network → daytona_unavailable", () => {
    const mapped = mapControlPlaneWakeFailure(
      cp(502, "wake failed: ECONNREFUSED 127.0.0.1:3986"),
    );
    expect(mapped.code).toBe("daytona_unavailable");
    expect(mapped.retryable).toBe(true);
  });

  it("maps vault mount fail closed → vault_mount_failed (not retryable)", () => {
    const cases = [
      "ensure_online wake failed: s3_vault_prefix is required for vault mount",
      "INVALID_S3_VAULT_PREFIX: absolute path not allowed",
      "VAULT_ROOT / mountPath must be an absolute guest path",
      "vault mount failed closed",
    ];
    for (const message of cases) {
      const mapped = mapControlPlaneWakeFailure(
        cp(502, message, "ENSURE_ONLINE_WAKE_FAILED"),
      );
      expect(mapped.code, message).toBe("vault_mount_failed");
      expect(mapped.retryable, message).toBe(false);
      expect(mapped.httpStatus).toBe(502);
      expect(mapped.message).toMatch(/not delivered/i);
    }
  });

  it("maps generic wake fail → wake_failed (retryable)", () => {
    const mapped = mapControlPlaneWakeFailure(
      cp(
        502,
        "ensure_online wake failed for instance x: simulated create failure",
        "ENSURE_ONLINE_WAKE_FAILED",
      ),
    );
    expect(mapped).toMatchObject({
      code: "wake_failed",
      httpStatus: 502,
      backendCode: "unavailable",
      retryable: true,
    });
  });

  it("maps path gated → daytona_path_gated (not retryable)", () => {
    const mapped = mapControlPlaneWakeFailure(
      cp(
        403,
        "Daytona path gated: tenant t1 is not on DAYTONA_TENANT_ALLOWLIST",
        "DAYTONA_PATH_GATED",
      ),
    );
    expect(mapped).toMatchObject({
      code: "daytona_path_gated",
      httpStatus: 403,
      backendCode: "forbidden",
      retryable: false,
    });
  });

  it("maps revoked instance → instance_revoked", () => {
    const mapped = mapControlPlaneWakeFailure(
      cp(403, "Instance is revoked", "ORCHESTRATOR_INSTANCE_REVOKED"),
    );
    expect(mapped.code).toBe("instance_revoked");
    expect(mapped.retryable).toBe(false);
  });

  it("maps 404 → not_found", () => {
    const mapped = mapControlPlaneWakeFailure(
      cp(404, "Instance not found"),
    );
    expect(mapped).toMatchObject({
      code: "not_found",
      httpStatus: 404,
      backendCode: "not_found",
      retryable: false,
    });
  });

  it("maps 501 → not_implemented", () => {
    const mapped = mapControlPlaneWakeFailure(
      cp(501, "not_implemented", "ORCHESTRATOR_NOT_IMPLEMENTED"),
    );
    expect(mapped).toMatchObject({
      code: "not_implemented",
      httpStatus: 501,
      backendCode: "not_implemented",
      retryable: false,
    });
  });

  it("maps 429 → rate_limited (retryable)", () => {
    const mapped = mapControlPlaneWakeFailure(cp(429, "slow down"));
    expect(mapped.code).toBe("rate_limited");
    expect(mapped.retryable).toBe(true);
  });

  it("maps 503 → daytona_unavailable", () => {
    const mapped = mapControlPlaneWakeFailure(
      cp(503, "service unavailable"),
    );
    expect(mapped.code).toBe("daytona_unavailable");
    expect(mapped.retryable).toBe(true);
  });
});

describe("wakeFailureToJsonBody (lp-mrh chat shape)", () => {
  it("emits stable chat error body fields", () => {
    const body = wakeFailureToJsonBody(
      mapControlPlaneWakeFailure(
        cp(504, "timed out", "ENSURE_ONLINE_TIMEOUT"),
      ),
    );
    expect(body).toMatchObject({
      error: "wake_timeout",
      code: "wake_timeout",
      retryable: true,
      phase: "ensure_online",
      cp_code: "ENSURE_ONLINE_TIMEOUT",
    });
    expect(body.message).toMatch(/not delivered/i);
    expect(typeof body.retry_guidance).toBe("string");
    expect(body.retry_guidance.length).toBeGreaterThan(10);
  });
});

describe("wakeFailureToBackendFields + controlPlaneEnsureOnlineToBackendError", () => {
  it("timeout → BackendRuntimeError timeout with wake_code", () => {
    const err = controlPlaneEnsureOnlineToBackendError(
      cp(504, "ensure_online timed out", "ENSURE_ONLINE_TIMEOUT"),
      "settings.snapshot",
    );
    expect(err.code).toBe("timeout");
    expect(err.retryable).toBe(true);
    expect(err.details).toMatchObject({
      method: "settings.snapshot",
      ensure_online: true,
      status: 504,
      wake_code: "wake_timeout",
    });
    expect(err.message).toMatch(/not delivered/i);
  });

  it("502 vault mount → unavailable + vault_mount_failed wake_code", () => {
    const err = controlPlaneEnsureOnlineToBackendError(
      cp(
        502,
        "s3_vault_prefix is required for vault mount",
        "ENSURE_ONLINE_WAKE_FAILED",
      ),
      "vault.list",
    );
    expect(err.code).toBe("unavailable");
    expect(err.retryable).toBe(false);
    expect(err.details).toMatchObject({
      wake_code: "vault_mount_failed",
      ensure_online: true,
      status: 502,
    });
  });

  it("502 generic wake → unavailable retryable", () => {
    const err = controlPlaneEnsureOnlineToBackendError(
      cp(502, "wake failed", "ENSURE_ONLINE_WAKE_FAILED"),
      "vault.list",
    );
    expect(err.code).toBe("unavailable");
    expect(err.retryable).toBe(true);
    expect(err.details).toMatchObject({ wake_code: "wake_failed" });
  });

  it("403 gated → forbidden", () => {
    const err = controlPlaneEnsureOnlineToBackendError(
      cp(403, "gated", "DAYTONA_PATH_GATED"),
      "projects.list",
    );
    expect(err.code).toBe("forbidden");
    expect(err.details).toMatchObject({ wake_code: "daytona_path_gated" });
  });

  it("404 → not_found", () => {
    const err = controlPlaneEnsureOnlineToBackendError(
      cp(404, "missing"),
      "vault.read",
    );
    expect(err.code).toBe("not_found");
    expect(err.details).toMatchObject({ wake_code: "not_found" });
  });

  it("wakeFailureToBackendFields includes retry_guidance", () => {
    const mapped = mapControlPlaneWakeFailure(cp(504, "t"));
    const fields = wakeFailureToBackendFields(mapped);
    expect(fields.details.retry_guidance).toBe(mapped.retryGuidance);
    const code: WakeFailureCode = "wake_timeout";
    expect(fields.details.wake_code).toBe(code);
  });
});
