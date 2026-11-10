/**
 * lp-5q6.33 — Office metrics, size buckets, operator classes, safe logs.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  OfficeMetrics,
  buildOfficeSafeLogFields,
  classifyOfficeDownloadReason,
  classifyOfficeError,
  officeMetrics,
  officeSizeBucket,
  scrubOfficeLogFields,
} from "../src/office/index.js";

afterEach(() => {
  officeMetrics.reset();
});

describe("officeSizeBucket", () => {
  it("maps ranges and unknowns", () => {
    expect(officeSizeBucket(undefined)).toBe("unknown");
    expect(officeSizeBucket(-1)).toBe("unknown");
    expect(officeSizeBucket(0)).toBe("empty");
    expect(officeSizeBucket(500)).toBe("lt_1kb");
    expect(officeSizeBucket(2048)).toBe("1kb_64kb");
    expect(officeSizeBucket(100_000)).toBe("64kb_1mb");
    expect(officeSizeBucket(2_000_000)).toBe("1mb_10mb");
    expect(officeSizeBucket(20_000_000)).toBe("10mb_50mb");
    expect(officeSizeBucket(60_000_000)).toBe("gte_50mb");
  });
});

describe("classifyOfficeError / classifyOfficeDownloadReason", () => {
  it("distinguishes DS unreachable, BFF reject, host conflict, unsupported type", () => {
    expect(classifyOfficeError("fetch_failed")).toBe(
      "document_server_unreachable",
    );
    expect(classifyOfficeError("invalid_nonce")).toBe("bff_callback_rejected");
    expect(classifyOfficeError("bad_url")).toBe("bff_callback_rejected");
    expect(classifyOfficeError("write_conflict")).toBe("host_write_conflict");
    expect(classifyOfficeError("conflict")).toBe("host_write_conflict");
    expect(classifyOfficeError("unsupported_file_type")).toBe(
      "unsupported_type",
    );
    expect(classifyOfficeDownloadReason("unsupported_file_type")).toBe(
      "unsupported_type",
    );
    expect(classifyOfficeDownloadReason("invalid_token")).toBe("auth_denied");
  });
});

describe("OfficeMetrics counters", () => {
  it("covers config mint, download, editor load, callback write/conflict/error, pane", () => {
    const m = new OfficeMetrics();

    m.recordConfigMint({ outcome: "success" });
    m.recordConfigMint({ outcome: "denied", error_code: "mode" });
    m.recordDownload({ outcome: "success" });
    m.recordDownload({ outcome: "denied", reason: "unsupported_file_type" });
    m.recordEditorLoad({ outcome: "success" });
    m.recordEditorLoad({ outcome: "error", error_code: "fetch_failed" });
    m.recordCallback({
      code: "saved",
      onlyoffice_status: 2,
      save_status: "saved",
    });
    m.recordCallback({
      code: "conflict",
      onlyoffice_status: 2,
      save_status: "conflict",
      error_code: "write_conflict",
    });
    m.recordCallback({
      code: "fetch_failed",
      onlyoffice_status: 2,
      save_status: "upstream_error",
      error_code: "fetch_failed",
    });
    m.recordCallback({
      code: "invalid_nonce",
      error_code: "invalid_nonce",
    });
    m.recordPane({ kind: "open" });
    m.recordPane({ kind: "load" });
    m.recordPane({ kind: "error", error_code: "unsupported_type" });
    m.recordCallbackFetch({ reason: "success" });
    m.recordCallbackFetch({ reason: "oversized", capped: true });
    m.recordCallbackFetch({ reason: "timeout" });

    const snap = m.snapshot();
    expect(snap.config_mint_total).toBe(2);
    expect(snap.config_mint_by_outcome.success).toBe(1);
    expect(snap.download_total).toBe(2);
    expect(snap.download_by_reason.unsupported_file_type).toBe(1);
    expect(snap.editor_load_total).toBe(2);
    expect(snap.callback_total).toBe(4);
    expect(snap.callback_fetch_total).toBe(3);
    expect(snap.callback_fetch_by_reason.success).toBe(1);
    expect(snap.callback_fetch_by_reason.oversized).toBe(1);
    expect(snap.callback_fetch_by_reason.timeout).toBe(1);
    expect(snap.callback_fetch_capped_total).toBe(1);
    expect(snap.write_success_total).toBe(1);
    expect(snap.write_conflict_total).toBe(1);
    expect(snap.write_error_total).toBeGreaterThanOrEqual(1);
    expect(snap.pane_open_total).toBe(1);
    expect(snap.pane_load_total).toBe(1);
    expect(snap.pane_error_total).toBe(1);
    expect(snap.error_by_operator_class.document_server_unreachable).toBeGreaterThanOrEqual(
      1,
    );
    expect(snap.error_by_operator_class.host_write_conflict).toBeGreaterThanOrEqual(
      1,
    );
    expect(snap.error_by_operator_class.bff_callback_rejected).toBeGreaterThanOrEqual(
      1,
    );
    expect(snap.error_by_operator_class.unsupported_type).toBeGreaterThanOrEqual(
      1,
    );
  });
});

describe("buildOfficeSafeLogFields / scrubOfficeLogFields", () => {
  it("emits correlation fields and size bucket without secrets", () => {
    const fields = buildOfficeSafeLogFields({
      event: "office_download",
      request_id: "req-1",
      tenant_id: "t-1",
      office_session_id: "ofs_abc",
      route: "/api/office/sessions/:id/content",
      status: 200,
      latency_ms: 12.4,
      size_bytes: 2048,
      size_bucket: officeSizeBucket(2048),
      outcome: "success",
      file_type: "docx",
      mode: "edit",
    });

    expect(fields.request_id).toBe("req-1");
    expect(fields.tenant_id).toBe("t-1");
    expect(fields.office_session_id).toBe("ofs_abc");
    expect(fields.latency_ms).toBe(12);
    expect(fields.size_bucket).toBe("1kb_64kb");
    expect(fields).not.toHaveProperty("token");
    expect(fields).not.toHaveProperty("download_token");
    expect(fields).not.toHaveProperty("path");
  });

  it("scrubs forbidden keys if a caller smuggles them", () => {
    const scrubbed = scrubOfficeLogFields({
      tenant_id: "t-1",
      download_token: "super-secret-token",
      nonce: "callback-nonce-value",
      jwt: "eyJhbGciOiJIUzI1NiJ9.payload.sig",
      body: "VAULT BYTES",
      callback_url: "http://ds/cache/file?token=x",
      error_code: "ok",
    });
    expect(scrubbed.tenant_id).toBe("t-1");
    expect(scrubbed.error_code).toBe("ok");
    expect(scrubbed).not.toHaveProperty("download_token");
    expect(scrubbed).not.toHaveProperty("nonce");
    expect(scrubbed).not.toHaveProperty("jwt");
    expect(scrubbed).not.toHaveProperty("body");
    expect(scrubbed).not.toHaveProperty("callback_url");
    const serialized = JSON.stringify(scrubbed);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("VAULT");
    expect(serialized).not.toContain("eyJ");
  });
});
