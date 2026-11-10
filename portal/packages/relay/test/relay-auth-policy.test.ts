import { describe, it, expect } from "vitest";
import {
  resolveRelayAuthMode,
  resolveRelayAuthPolicy,
} from "../src/relay-auth-policy.js";

describe("relay auth policy (fail-closed production)", () => {
  it("defaults to development without NODE_ENV=production", () => {
    expect(resolveRelayAuthMode({ NODE_ENV: "test" })).toBe("development");
    expect(resolveRelayAuthMode({})).toBe("development");
  });

  it("NODE_ENV=production selects production mode", () => {
    expect(resolveRelayAuthMode({ NODE_ENV: "production" })).toBe("production");
  });

  it("RELAY_AUTH_MODE overrides NODE_ENV", () => {
    expect(
      resolveRelayAuthMode({
        NODE_ENV: "production",
        RELAY_AUTH_MODE: "development",
      }),
    ).toBe("development");
    expect(
      resolveRelayAuthMode({
        NODE_ENV: "development",
        RELAY_AUTH_MODE: "production",
      }),
    ).toBe("production");
  });

  it("production requires jti and rejects non-expiring by default", () => {
    const policy = resolveRelayAuthPolicy({ NODE_ENV: "production" });
    expect(policy.mode).toBe("production");
    expect(policy.requireJti).toBe(true);
    expect(policy.rejectNonExpiring).toBe(true);
    expect(policy.allowQueryToken).toBe(false);
    expect(policy.maxTtlSeconds).toBe(300);
  });

  it("development dual-accepts legacy by default", () => {
    const policy = resolveRelayAuthPolicy({ NODE_ENV: "development" });
    expect(policy.requireJti).toBe(false);
    expect(policy.rejectNonExpiring).toBe(false);
  });

  it("RELAY_ALLOW_LEGACY_UPGRADE_TOKEN=1 enables legacy in production", () => {
    const policy = resolveRelayAuthPolicy({
      NODE_ENV: "production",
      RELAY_ALLOW_LEGACY_UPGRADE_TOKEN: "1",
    });
    expect(policy.requireJti).toBe(false);
  });

  it("RELAY_ALLOW_LEGACY_UPGRADE_TOKEN=0 disables legacy in development", () => {
    const policy = resolveRelayAuthPolicy({
      NODE_ENV: "development",
      RELAY_ALLOW_LEGACY_UPGRADE_TOKEN: "0",
    });
    expect(policy.requireJti).toBe(true);
  });

  it("RELAY_REQUIRE_UPGRADE_JTI forces jti in development", () => {
    const policy = resolveRelayAuthPolicy({
      NODE_ENV: "development",
      RELAY_REQUIRE_UPGRADE_JTI: "1",
    });
    expect(policy.requireJti).toBe(true);
  });

  it("production dual-accept (legacy=1) still accepts jti path for stock pins", () => {
    // Migration window: both claim shapes allowed; stock g7h3 jti must still work.
    const policy = resolveRelayAuthPolicy({
      NODE_ENV: "production",
      RELAY_ALLOW_LEGACY_UPGRADE_TOKEN: "1",
    });
    expect(policy.mode).toBe("production");
    expect(policy.requireJti).toBe(false);
    expect(policy.rejectNonExpiring).toBe(true);
  });

  it("RELAY_REQUIRE_UPGRADE_JTI wins over allow-legacy in production", () => {
    const policy = resolveRelayAuthPolicy({
      NODE_ENV: "production",
      RELAY_ALLOW_LEGACY_UPGRADE_TOKEN: "1",
      RELAY_REQUIRE_UPGRADE_JTI: "1",
    });
    expect(policy.requireJti).toBe(true);
  });
});
