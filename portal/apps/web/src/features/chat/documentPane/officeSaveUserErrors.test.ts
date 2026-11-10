/**
 * lp-5q6.28 — user-facing Office save / callback error copy.
 */
import { describe, expect, it } from "vitest";

import { mapSaveFailureToEditorError } from "./onlyOfficeEditorErrors";
import { mapOfficeSaveFailureToUserError } from "./officeSaveUserErrors";

describe("mapOfficeSaveFailureToUserError", () => {
  it("maps save_error / failed to understandable callback_save_issue", () => {
    const err = mapOfficeSaveFailureToUserError({ code: "save_error" });
    expect(err.code).toBe("callback_save_issue");
    expect(err.message.length).toBeGreaterThan(20);
    expect(err.message.toLowerCase()).toMatch(/save|changes|server/);
    expect(err.retryable).toBe(true);
  });

  it("maps conflict distinctly", () => {
    const err = mapOfficeSaveFailureToUserError({ code: "conflict" });
    expect(err.code).toBe("save_conflict");
    expect(err.message.toLowerCase()).toMatch(/reload|changed/);
  });

  it("maps fetch_failed to document server unreachable", () => {
    const err = mapOfficeSaveFailureToUserError({ code: "fetch_failed" });
    expect(err.code).toBe("document_server_unreachable");
    expect(err.message.toLowerCase()).toMatch(/document server|reach/);
  });

  it("maps invalid_nonce without leaking the nonce", () => {
    const err = mapOfficeSaveFailureToUserError({ code: "invalid_nonce" });
    expect(err.code).toBe("save_rejected");
    expect(err.message).not.toMatch(/nonce|token|jwt/i);
  });

  it("maps expired session", () => {
    const err = mapOfficeSaveFailureToUserError({ code: "expired" });
    expect(err.code).toBe("session_expired");
    expect(err.message.toLowerCase()).toMatch(/expired|re-open|reopen/);
  });

  it("never embeds secrets or path-like material for unknown codes", () => {
    const err = mapOfficeSaveFailureToUserError({
      code: "write_failed",
    });
    expect(JSON.stringify(err)).not.toMatch(
      /callback-nonce|download-token|\/Projects\//i,
    );
  });
});

describe("mapSaveFailureToEditorError (wired into OnlyOfficeEditorHost)", () => {
  it("surfaces invalid_nonce as callback_save_issue with save_rejected copy", () => {
    const err = mapSaveFailureToEditorError({ code: "invalid_nonce" });
    expect(err.code).toBe("callback_save_issue");
    expect(err.message.toLowerCase()).toMatch(/rejected|save|reload/);
    expect(err.message).not.toMatch(/nonce|token|jwt/i);
    expect(err.retryable).toBe(true);
  });
});
