import { describe, expect, it } from "vitest";

import {
  resolveAuthMode,
  resolveDevOpenMode,
} from "../src/auth-mode.js";

describe("resolveAuthMode", () => {
  it("defaults to development outside production NODE_ENV", () => {
    expect(resolveAuthMode({})).toBe("development");
    expect(resolveAuthMode({ NODE_ENV: "test" })).toBe("development");
  });

  it("defaults to production when NODE_ENV=production", () => {
    expect(resolveAuthMode({ NODE_ENV: "production" })).toBe("production");
  });

  it("honors CONTROL_PLANE_AUTH_MODE over NODE_ENV", () => {
    expect(
      resolveAuthMode({
        NODE_ENV: "production",
        CONTROL_PLANE_AUTH_MODE: "development",
      }),
    ).toBe("development");
    expect(
      resolveAuthMode({
        NODE_ENV: "development",
        CONTROL_PLANE_AUTH_MODE: "production",
      }),
    ).toBe("production");
  });

  it("honors explicit option", () => {
    expect(resolveAuthMode({}, "production")).toBe("production");
    expect(resolveAuthMode({ NODE_ENV: "production" }, "development")).toBe(
      "development",
    );
  });
});

describe("resolveDevOpenMode (explicit local-dev open)", () => {
  it("is off by default (fail closed)", () => {
    expect(resolveDevOpenMode({})).toBe(false);
    expect(resolveDevOpenMode({ CONTROL_PLANE_DEV_OPEN: "" })).toBe(false);
    expect(resolveDevOpenMode({ CONTROL_PLANE_DEV_OPEN: "0" })).toBe(false);
    expect(resolveDevOpenMode({ CONTROL_PLANE_DEV_OPEN: "no" })).toBe(false);
  });

  it("enables when CONTROL_PLANE_DEV_OPEN is truthy", () => {
    expect(resolveDevOpenMode({ CONTROL_PLANE_DEV_OPEN: "1" })).toBe(true);
    expect(resolveDevOpenMode({ CONTROL_PLANE_DEV_OPEN: "true" })).toBe(true);
    expect(resolveDevOpenMode({ CONTROL_PLANE_DEV_OPEN: "YES" })).toBe(true);
    expect(resolveDevOpenMode({ CONTROL_PLANE_DEV_OPEN: "on" })).toBe(true);
  });

  it("honors explicit option over env", () => {
    expect(resolveDevOpenMode({ CONTROL_PLANE_DEV_OPEN: "1" }, false)).toBe(
      false,
    );
    expect(resolveDevOpenMode({}, true)).toBe(true);
  });
});
