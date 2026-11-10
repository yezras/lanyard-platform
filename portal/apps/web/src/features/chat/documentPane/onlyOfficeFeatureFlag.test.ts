import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildOnlyOfficeScriptSrcCsp,
  getOnlyOfficeDocumentServerUrl,
  getTrustedDocumentServerAllowlist,
  isOnlyOfficeEditorEnabled,
  onlyOfficeApiScriptUrl,
  onlyOfficeScriptSrcCspSources,
  parseDocumentServerOrigin,
  setOnlyOfficeProductionModeForTests,
  validateOnlyOfficeDocumentServerUrl,
} from "./onlyOfficeFeatureFlag.js";

afterEach(() => {
  delete window.__LANYARD_FEATURE_FLAGS__;
  window.history.replaceState({}, "", "/");
  setOnlyOfficeProductionModeForTests(undefined);
  vi.unstubAllEnvs();
});

function stubLocationSearch(search: string): () => void {
  const original = window.location;
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...original, search },
  });
  return () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: original,
    });
  };
}

describe("isOnlyOfficeEditorEnabled", () => {
  it("defaults to false", () => {
    expect(isOnlyOfficeEditorEnabled()).toBe(false);
  });

  it("honors explicit override", () => {
    expect(isOnlyOfficeEditorEnabled(true)).toBe(true);
    expect(isOnlyOfficeEditorEnabled(false)).toBe(false);
  });

  it("reads runtime window flags", () => {
    window.__LANYARD_FEATURE_FLAGS__ = { onlyoffice_editor: true };
    expect(isOnlyOfficeEditorEnabled()).toBe(true);
    window.__LANYARD_FEATURE_FLAGS__ = { onlyoffice_editor: false };
    expect(isOnlyOfficeEditorEnabled()).toBe(false);
  });

  it("reads lab URL query in non-production builds", () => {
    setOnlyOfficeProductionModeForTests(false);
    const restore = stubLocationSearch("?onlyoffice_editor=1");
    expect(isOnlyOfficeEditorEnabled()).toBe(true);
    restore();
    const restore2 = stubLocationSearch("?onlyoffice=false");
    expect(isOnlyOfficeEditorEnabled()).toBe(false);
    restore2();
  });

  it("ignores malicious query enablement in production builds", () => {
    setOnlyOfficeProductionModeForTests(true);
    const restore = stubLocationSearch(
      "?onlyoffice_editor=1&onlyoffice=1&onlyoffice_ds_url=https://evil.example",
    );
    expect(isOnlyOfficeEditorEnabled()).toBe(false);
    restore();
  });
});

describe("getOnlyOfficeDocumentServerUrl", () => {
  it("defaults to empty", () => {
    expect(getOnlyOfficeDocumentServerUrl()).toBe("");
  });

  it("strips trailing slash from override and allows loopback http", () => {
    expect(getOnlyOfficeDocumentServerUrl("http://127.0.0.1:8080/")).toBe(
      "http://127.0.0.1:8080",
    );
  });

  it("rejects non-https remote overrides", () => {
    expect(getOnlyOfficeDocumentServerUrl("http://evil.example")).toBe("");
    expect(getOnlyOfficeDocumentServerUrl("https://docs.example.com/")).toBe(
      "https://docs.example.com",
    );
  });

  it("builds api.js path only for validated origins", () => {
    expect(onlyOfficeApiScriptUrl("http://127.0.0.1:8080")).toBe(
      "http://127.0.0.1:8080/web-apps/apps/api/documents/api.js",
    );
    expect(onlyOfficeApiScriptUrl("")).toBe("");
    expect(onlyOfficeApiScriptUrl("https://evil.example")).toBe("");
  });

  it("ignores query-controlled DS origin in production builds", () => {
    setOnlyOfficeProductionModeForTests(true);
    const restore = stubLocationSearch(
      "?onlyoffice_ds_url=https://evil.example&ds_url=https://evil.example",
    );
    expect(getOnlyOfficeDocumentServerUrl()).toBe("");
    restore();
  });

  it("ignores untrusted runtime DS URL override in production builds", () => {
    setOnlyOfficeProductionModeForTests(true);
    window.__LANYARD_FEATURE_FLAGS__ = {
      onlyoffice_document_server_url: "https://evil.example",
    };
    expect(getOnlyOfficeDocumentServerUrl()).toBe("");
  });

  it("allows lab query DS URL in non-production when localhost", () => {
    setOnlyOfficeProductionModeForTests(false);
    const restore = stubLocationSearch(
      "?onlyoffice_ds_url=http://127.0.0.1:8080",
    );
    expect(getOnlyOfficeDocumentServerUrl()).toBe("http://127.0.0.1:8080");
    restore();
  });

  it("rejects malicious non-localhost query DS URL even in non-production", () => {
    setOnlyOfficeProductionModeForTests(false);
    const restore = stubLocationSearch(
      "?onlyoffice_ds_url=https://evil.example",
    );
    // No allowlist entry → rejected
    expect(getOnlyOfficeDocumentServerUrl()).toBe("");
    restore();
  });
});

describe("validateOnlyOfficeDocumentServerUrl", () => {
  it("requires HTTPS for remote origins", () => {
    expect(
      validateOnlyOfficeDocumentServerUrl("http://docs.example.com", {
        allowLocalhost: false,
        allowlist: ["https://docs.example.com"],
      }),
    ).toEqual({ ok: false, reason: "https_required" });
  });

  it("accepts allowed configured DS URL", () => {
    expect(
      validateOnlyOfficeDocumentServerUrl("https://docs.example.com/", {
        allowlist: ["https://docs.example.com"],
      }),
    ).toEqual({ ok: true, origin: "https://docs.example.com" });
  });

  it("rejects missing / empty DS URL", () => {
    expect(validateOnlyOfficeDocumentServerUrl("")).toEqual({
      ok: false,
      reason: "invalid_url",
    });
  });

  it("rejects origins not on the allowlist", () => {
    expect(
      validateOnlyOfficeDocumentServerUrl("https://evil.example", {
        allowlist: ["https://docs.example.com"],
      }),
    ).toEqual({ ok: false, reason: "not_allowlisted" });
  });

  it("fails closed when allowlist is empty (non-localhost)", () => {
    expect(
      validateOnlyOfficeDocumentServerUrl("https://docs.example.com", {
        allowlist: [],
        allowLocalhost: false,
      }),
    ).toEqual({ ok: false, reason: "empty_allowlist" });
  });

  it("allows localhost http when allowLocalhost is true", () => {
    expect(
      validateOnlyOfficeDocumentServerUrl("http://localhost:8080", {
        allowLocalhost: true,
        allowlist: [],
      }),
    ).toEqual({ ok: true, origin: "http://localhost:8080" });
  });

  it("rejects localhost http when allowLocalhost is false (production)", () => {
    expect(
      validateOnlyOfficeDocumentServerUrl("http://127.0.0.1:8080", {
        allowLocalhost: false,
        allowlist: ["http://127.0.0.1:8080"],
      }),
    ).toEqual({ ok: false, reason: "https_required" });
  });

  it("rejects credentials in URL", () => {
    expect(
      validateOnlyOfficeDocumentServerUrl("https://user:pass@docs.example.com", {
        allowlist: ["https://docs.example.com"],
      }),
    ).toEqual({ ok: false, reason: "invalid_url" });
  });

  it("rejects non-http(s) schemes", () => {
    expect(validateOnlyOfficeDocumentServerUrl("javascript:alert(1)")).toEqual(
      { ok: false, reason: "invalid_url" },
    );
    expect(validateOnlyOfficeDocumentServerUrl("data:text/html,x")).toEqual({
      ok: false,
      reason: "invalid_url",
    });
  });
});

describe("parseDocumentServerOrigin / CSP helpers", () => {
  it("normalizes origin", () => {
    expect(parseDocumentServerOrigin("https://docs.example.com/path")?.origin).toBe(
      "https://docs.example.com",
    );
  });

  it("builds script-src CSP covering approved DS origins", () => {
    const allowlist = ["https://docs.example.com", "https://ds2.example.com"];
    expect(onlyOfficeScriptSrcCspSources(allowlist)).toEqual(allowlist);
    expect(buildOnlyOfficeScriptSrcCsp(allowlist)).toBe(
      "script-src 'self' https://docs.example.com https://ds2.example.com;",
    );
  });

  it("reads allowlist from trusted config shape", () => {
    // Without env stubs, allowlist is empty in unit tests.
    expect(getTrustedDocumentServerAllowlist()).toEqual([]);
  });
});
