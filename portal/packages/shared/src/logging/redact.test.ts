import { afterEach, describe, expect, it } from "vitest";

import {
  REDACTED,
  assertNoSecretLeaks,
  createLogger,
  isDebugPayloadsEnabled,
  isPayloadKey,
  isSecretKey,
  redactAuditMetadata,
  redactForLog,
} from "./index.js";

describe("isSecretKey / isPayloadKey", () => {
  it("classifies secret keys", () => {
    expect(isSecretKey("password")).toBe(true);
    expect(isSecretKey("api_key")).toBe(true);
    expect(isSecretKey("Authorization")).toBe(true);
    expect(isSecretKey("gateway_secret")).toBe(true);
    expect(isSecretKey("session_secret")).toBe(true);
    expect(isSecretKey("tenant_id")).toBe(false);
    expect(isSecretKey("instance_id")).toBe(false);
  });

  it("classifies Office bridge secret keys (lp-5q6.33)", () => {
    expect(isSecretKey("download_token")).toBe(true);
    expect(isSecretKey("callback_nonce")).toBe(true);
    expect(isSecretKey("nonce")).toBe(true);
    expect(isSecretKey("jwt")).toBe(true);
    expect(isSecretKey("editor_jwt")).toBe(true);
    expect(isSecretKey("onlyoffice_token")).toBe(true);
    expect(isSecretKey("office_session_id")).toBe(false);
    expect(isSecretKey("error_code")).toBe(false);
    expect(isSecretKey("size_bucket")).toBe(false);
  });

  it("classifies payload keys", () => {
    expect(isPayloadKey("body")).toBe(true);
    expect(isPayloadKey("content")).toBe(true);
    expect(isPayloadKey("vault_content")).toBe(true);
    expect(isPayloadKey("file_bytes")).toBe(true);
    expect(isPayloadKey("request_body")).toBe(true);
    expect(isPayloadKey("status")).toBe(false);
    expect(isPayloadKey("route")).toBe(false);
  });

  it("classifies Office bridge payload / URL keys (lp-5q6.33)", () => {
    expect(isPayloadKey("callback_url")).toBe(true);
    expect(isPayloadKey("download_url")).toBe(true);
    expect(isPayloadKey("changesurl")).toBe(true);
    expect(isPayloadKey("document_url")).toBe(true);
    expect(isPayloadKey("assembled_url")).toBe(true);
    expect(isPayloadKey("operator_class")).toBe(false);
    expect(isPayloadKey("latency_ms")).toBe(false);
  });
});

describe("isDebugPayloadsEnabled", () => {
  it("defaults to false", () => {
    expect(isDebugPayloadsEnabled({})).toBe(false);
    expect(isDebugPayloadsEnabled({ PORTAL_DEBUG_PAYLOADS: "0" })).toBe(false);
    expect(isDebugPayloadsEnabled({ PORTAL_DEBUG_PAYLOADS: "false" })).toBe(
      false,
    );
  });

  it("enables only on explicit truthy values", () => {
    expect(isDebugPayloadsEnabled({ PORTAL_DEBUG_PAYLOADS: "true" })).toBe(
      true,
    );
    expect(isDebugPayloadsEnabled({ PORTAL_DEBUG_PAYLOADS: "1" })).toBe(true);
    expect(isDebugPayloadsEnabled({ LOG_DEBUG_PAYLOADS: "yes" })).toBe(true);
  });
});

describe("redactForLog (default — shared sink safe)", () => {
  it("redacts secrets and vault/body payloads by default", () => {
    const input = {
      tenant_id: "t-1",
      route: "/api/vault/content",
      status: 200,
      password: "super-secret",
      api_key: "xai-secret",
      authorization: "Bearer abc",
      content: "TOP SECRET VAULT FILE BODY",
      vault_content: "-----BEGIN PRIVATE KEY-----\n...",
      body: { text: "chat message that must not ship to CloudWatch" },
      file_bytes: Buffer.from("vault-bytes"),
    };

    const redacted = redactForLog(input) as Record<string, unknown>;

    expect(redacted.tenant_id).toBe("t-1");
    expect(redacted.route).toBe("/api/vault/content");
    expect(redacted.status).toBe(200);
    expect(redacted.password).toBe(REDACTED);
    expect(redacted.api_key).toBe(REDACTED);
    expect(redacted.authorization).toBe(REDACTED);
    expect(redacted.content).toBe(REDACTED);
    expect(redacted.vault_content).toBe(REDACTED);
    expect(redacted.body).toBe(REDACTED);
    // Payload key → marker (do not dump buffer bytes).
    expect(redacted.file_bytes).toBe(REDACTED);

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("xai-secret");
    expect(serialized).not.toContain("TOP SECRET");
    expect(serialized).not.toContain("chat message");
    expect(serialized).not.toContain("vault-bytes");
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");

    expect(() => assertNoSecretLeaks(redacted)).not.toThrow();
  });

  it("never dumps Error custom body fields; keeps message metadata", () => {
    const err = new Error("boom");
    (err as Error & { body?: string }).body = "should-not-matter-on-Error";
    const redacted = redactForLog(err) as Record<string, unknown>;
    expect(redacted.name).toBe("Error");
    expect(redacted.message).toBe("boom");
    expect(redacted).not.toHaveProperty("body");
  });

  it("redacts nested secret keys even under allowPayloads", () => {
    const redacted = redactForLog(
      {
        content: {
          text: "visible when debug on",
          api_key: "still-secret",
          password: "nope",
        },
      },
      { allowPayloads: true },
    ) as { content: Record<string, unknown> };

    expect(redacted.content.text).toBe("visible when debug on");
    expect(redacted.content.api_key).toBe(REDACTED);
    expect(redacted.content.password).toBe(REDACTED);
    expect(JSON.stringify(redacted)).not.toContain("still-secret");
  });

  it("truncates long strings", () => {
    const long = "x".repeat(600);
    const redacted = redactForLog({ note: long }) as { note: string };
    expect(redacted.note.length).toBeLessThan(600);
    expect(redacted.note).toContain("truncated");
  });
});

describe("redactAuditMetadata", () => {
  it("strips secrets and payloads from audit rows", () => {
    const meta = redactAuditMetadata({
      instance_id: "i-1",
      reason: "invalid_secret",
      secret: "plaintext-must-never-audit",
      body: { password: "x", text: "chat" },
    });
    expect(meta.instance_id).toBe("i-1");
    expect(meta.reason).toBe("invalid_secret");
    expect(meta.secret).toBe(REDACTED);
    expect(meta.body).toBe(REDACTED);
    expect(JSON.stringify(meta)).not.toContain("plaintext");
    expect(JSON.stringify(meta)).not.toContain("chat");
  });
});

describe("Office bridge redaction (lp-5q6.33)", () => {
  it("redacts download token, JWT, callback nonce, vault body, and secret URLs", () => {
    const input = {
      tenant_id: "t-1",
      office_session_id: "ofs_abc123",
      error_code: "invalid_nonce",
      operator_class: "bff_callback_rejected",
      size_bucket: "1kb_64kb",
      latency_ms: 42,
      download_token: "dtok_super_secret",
      callback_nonce: "nonce_super_secret",
      jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
      editor_jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.editor.sig",
      body: "RAW VAULT FILE BYTES MUST NOT SHIP",
      vault_content: "-----BEGIN DOC-----\nsecret-doc\n",
      file_bytes: Buffer.from("office-binary"),
      callback_url: "http://onlyoffice/cache/files/doc.docx?md5=abc&token=xyz",
      download_url: "http://bff/api/office/sessions/x/content?token=leak",
      changesurl: "http://onlyoffice/changes?token=c",
    };

    const redacted = redactForLog(input) as Record<string, unknown>;

    expect(redacted.tenant_id).toBe("t-1");
    expect(redacted.office_session_id).toBe("ofs_abc123");
    expect(redacted.error_code).toBe("invalid_nonce");
    expect(redacted.operator_class).toBe("bff_callback_rejected");
    expect(redacted.size_bucket).toBe("1kb_64kb");
    expect(redacted.latency_ms).toBe(42);

    expect(redacted.download_token).toBe(REDACTED);
    expect(redacted.callback_nonce).toBe(REDACTED);
    expect(redacted.jwt).toBe(REDACTED);
    expect(redacted.editor_jwt).toBe(REDACTED);
    expect(redacted.body).toBe(REDACTED);
    expect(redacted.vault_content).toBe(REDACTED);
    expect(redacted.file_bytes).toBe(REDACTED);
    expect(redacted.callback_url).toBe(REDACTED);
    expect(redacted.download_url).toBe(REDACTED);
    expect(redacted.changesurl).toBe(REDACTED);

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("dtok_super_secret");
    expect(serialized).not.toContain("nonce_super_secret");
    expect(serialized).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(serialized).not.toContain("RAW VAULT");
    expect(serialized).not.toContain("secret-doc");
    expect(serialized).not.toContain("office-binary");
    expect(serialized).not.toContain("token=leak");
    expect(serialized).not.toContain("token=xyz");

    expect(() => assertNoSecretLeaks(redacted)).not.toThrow();
  });

  it("still redacts Office secrets when debug payloads are enabled", () => {
    const redacted = redactForLog(
      {
        content: "allowed when debug on",
        download_token: "still-secret",
        jwt: "still-jwt",
        callback_url: "http://ds/file?token=x",
      },
      { allowPayloads: true },
    ) as Record<string, unknown>;

    expect(redacted.content).toBe("allowed when debug on");
    expect(redacted.download_token).toBe(REDACTED);
    expect(redacted.jwt).toBe(REDACTED);
    // callback_url is a payload key — with allowPayloads it may pass, but
    // operators must not put raw callback tokens in logs. Prefer redactors.
    // Secret keys remain fail-closed regardless of debug gate.
    expect(JSON.stringify(redacted)).not.toContain("still-secret");
    expect(JSON.stringify(redacted)).not.toContain("still-jwt");
  });
});

describe("createLogger", () => {
  const lines: string[] = [];
  afterEach(() => {
    lines.length = 0;
  });

  it("emits structured JSON without payloads by default", () => {
    const log = createLogger({
      service: "bff",
      env: {},
      debugPayloads: false,
      stdout: (l) => lines.push(l),
      stderr: (l) => lines.push(l),
      now: () => new Date("2026-07-12T00:00:00.000Z"),
    });

    log.info("request complete", {
      tenant_id: "t-1",
      route: "/api/vault/content",
      status: 200,
      content: "VAULT DUMP",
      password: "secret",
    });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.service).toBe("bff");
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("request complete");
    expect(parsed.tenant_id).toBe("t-1");
    expect(parsed.content).toBe(REDACTED);
    expect(parsed.password).toBe(REDACTED);
    expect(lines[0]).not.toContain("VAULT DUMP");
    expect(lines[0]).not.toContain('"secret"');
    // password value redacted
    expect(lines[0]).not.toMatch(/"password":"(?!\[REDACTED\])/);
  });

  it("debug payloads gated: still redacts secrets when enabled", () => {
    const log = createLogger({
      service: "relay",
      env: { PORTAL_DEBUG_PAYLOADS: "true" },
      stdout: (l) => lines.push(l),
      stderr: (l) => lines.push(l),
    });

    expect(log.debugPayloads).toBe(true);
    log.warn("debug dump", {
      content: "chat body allowed in debug",
      secret: "never",
    });

    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.content).toBe("chat body allowed in debug");
    expect(parsed.secret).toBe(REDACTED);
    expect(lines[0]).not.toContain("never");
  });

  it("respects LOG_LEVEL for debug lines", () => {
    const log = createLogger({
      service: "control-plane",
      env: { LOG_LEVEL: "info" },
      stdout: (l) => lines.push(l),
      stderr: (l) => lines.push(l),
    });
    log.debug("hidden");
    expect(lines).toHaveLength(0);
    log.info("shown");
    expect(lines).toHaveLength(1);
  });
});
