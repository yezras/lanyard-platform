import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  makeUpgradeToken,
  makeToken,
  verifyToken,
  verifyUpgradeToken,
  parseUpgradeToken,
  generateJti,
  isJtiShape,
  MAX_UPGRADE_TTL_SECONDS,
} from "../src/auth.js";

describe("relay auth (G2a jti upgrade tokens)", () => {
  it("round-trips upgrade token verification with jti", () => {
    const token = makeUpgradeToken("gw-abc", "super-secret");
    const parsed = parseUpgradeToken(token);
    expect(parsed?.format).toBe("jti");
    expect(parsed?.jti).toBeTruthy();
    expect(isJtiShape(parsed!.jti!)).toBe(true);

    expect(verifyToken(token, ["super-secret"])).toBe("gw-abc");
    expect(verifyToken(token, ["wrong"])).toBeNull();

    const verified = verifyUpgradeToken(token, ["super-secret"], {
      requireJti: true,
      rejectNonExpiring: true,
    });
    expect(verified).toMatchObject({
      gatewayId: "gw-abc",
      format: "jti",
    });
    expect(verified?.jti).toBe(parsed?.jti);
  });

  it("mints distinct jtis for successive tokens", () => {
    const a = parseUpgradeToken(makeUpgradeToken("gw", "s"));
    const b = parseUpgradeToken(makeUpgradeToken("gw", "s"));
    expect(a?.jti).toBeTruthy();
    expect(b?.jti).toBeTruthy();
    expect(a!.jti).not.toBe(b!.jti);
  });

  it("accepts fixed jti for tests", () => {
    const jti = generateJti();
    const token = makeUpgradeToken("gw-abc", "secret", { jti, ttlSeconds: 60 });
    expect(parseUpgradeToken(token)?.jti).toBe(jti);
  });

  it("legacy mint still verifies when dual-accept", () => {
    const token = makeUpgradeToken("gw-abc", "super-secret", {
      legacy: true,
      ttlSeconds: 120,
    });
    const parsed = parseUpgradeToken(token);
    expect(parsed?.format).toBe("legacy");
    expect(parsed?.jti).toBeUndefined();

    expect(
      verifyUpgradeToken(token, ["super-secret"], {
        requireJti: false,
        rejectNonExpiring: false,
      })?.gatewayId,
    ).toBe("gw-abc");

    expect(
      verifyUpgradeToken(token, ["super-secret"], {
        requireJti: true,
      }),
    ).toBeNull();
  });

  it("dual-accept policy verifies both jti and legacy claim shapes", () => {
    const secret = "dual-accept-secret";
    const jtiToken = makeUpgradeToken("gw-stock", secret, { ttlSeconds: 60 });
    const legacyToken = makeUpgradeToken("gw-stock", secret, {
      legacy: true,
      ttlSeconds: 60,
    });

    const dualOpts = { requireJti: false, rejectNonExpiring: true };
    expect(verifyUpgradeToken(jtiToken, [secret], dualOpts)).toMatchObject({
      gatewayId: "gw-stock",
      format: "jti",
    });
    expect(verifyUpgradeToken(legacyToken, [secret], dualOpts)).toMatchObject({
      gatewayId: "gw-stock",
      format: "legacy",
    });
  });

  it("stock pin jti verifies under production requireJti (no host legacy patch)", () => {
    // Mirrors hermes-lanyard g7h3 default: make_upgrade_token(..., legacy=False)
    const secret = "staging-shared-secret";
    const stockJti = makeUpgradeToken("e9add6fa-gw", secret, {
      ttlSeconds: 60,
    });
    expect(parseUpgradeToken(stockJti)?.format).toBe("jti");
    expect(
      verifyUpgradeToken(stockJti, [secret], {
        requireJti: true,
        rejectNonExpiring: true,
        maxTtlSeconds: 300,
      }),
    ).toMatchObject({ gatewayId: "e9add6fa-gw", format: "jti" });
  });

  it("hand-built Hermes wire form gatewayId:exp:jti:sig verifies", () => {
    const secret = "wire-secret";
    const gatewayId = "gw-wire";
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 60;
    const jti = generateJti();
    const signed = `${gatewayId}:${exp}:${jti}`;
    const sig = createHmac("sha256", secret).update(signed, "utf8").digest("hex");
    const token = Buffer.from(`${signed}:${sig}`, "utf8").toString("base64url");

    expect(parseUpgradeToken(token)).toMatchObject({
      gatewayId,
      exp,
      jti,
      format: "jti",
    });
    expect(
      verifyUpgradeToken(token, [secret], {
        requireJti: true,
        rejectNonExpiring: true,
      }),
    ).toMatchObject({ gatewayId, format: "jti", jti });
  });

  it("rejects expired tokens", () => {
    const now = Math.floor(Date.now() / 1000);
    // Build an already-expired jti token by hand.
    const jti = generateJti();
    const exp = now - 10;
    const signed = `gw-abc:${exp}:${jti}`;
    const sig = createHmac("sha256", "super-secret")
      .update(signed, "utf8")
      .digest("hex");
    const token = Buffer.from(`${signed}:${sig}`, "utf8").toString("base64url");

    expect(verifyUpgradeToken(token, ["super-secret"])).toBeNull();
    expect(verifyToken(token, ["super-secret"])).toBeNull();
  });

  it("rejects exp=0 in production policy", () => {
    const token = makeUpgradeToken("gw-abc", "super-secret", {
      ttlSeconds: 0,
    });
    expect(parseUpgradeToken(token)?.exp).toBe(0);

    expect(
      verifyUpgradeToken(token, ["super-secret"], {
        rejectNonExpiring: true,
        requireJti: true,
      }),
    ).toBeNull();

    expect(
      verifyUpgradeToken(token, ["super-secret"], {
        rejectNonExpiring: false,
        requireJti: true,
      })?.gatewayId,
    ).toBe("gw-abc");
  });

  it("rejects remaining TTL above max", () => {
    const token = makeUpgradeToken("gw-abc", "super-secret", {
      ttlSeconds: MAX_UPGRADE_TTL_SECONDS + 120,
    });
    expect(
      verifyUpgradeToken(token, ["super-secret"], {
        maxTtlSeconds: MAX_UPGRADE_TTL_SECONDS,
        requireJti: true,
      }),
    ).toBeNull();
  });

  it("makeToken remains legacy format (non-upgrade helper)", () => {
    const token = makeToken("payload:with:colons", "sec", 60);
    const parsed = parseUpgradeToken(token);
    // Payload has colons; still legacy because no jti-shaped field.
    expect(parsed?.format).toBe("legacy");
    expect(verifyToken(token, ["sec"])).toBe("payload:with:colons");
  });

  it("isJtiShape rejects short or invalid values", () => {
    expect(isJtiShape("short")).toBe(false);
    expect(isJtiShape("1234567890")).toBe(false);
    expect(isJtiShape(generateJti())).toBe(true);
  });
});
