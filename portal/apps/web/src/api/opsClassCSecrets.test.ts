import { describe, expect, it } from "vitest";

import { parseOpsClassCSecretList } from "./opsClassCSecrets.js";

describe("parseOpsClassCSecretList (lp-hdzm.32)", () => {
  it("keeps fingerprint statuses and drops leaked values", () => {
    const parsed = parseOpsClassCSecretList(
      {
        tenant_id: "t1",
        connector_id: "stripe",
        value: "sk_should_never_parse",
        surfaces: [
          {
            surface_id: "mcp",
            present: true,
            fingerprint: "sha256:abc123def456",
            rotated_at: "2026-08-27T00:00:00.000Z",
            value: "sk_leaked",
          },
          {
            surface_id: "graphql",
            present: true,
            fingerprint: "sha256:nope",
          },
          {
            surface_id: "api",
            present: false,
            fingerprint: null,
            rotated_at: null,
          },
        ],
      },
      { tenantId: "t1", connectorId: "stripe" },
    );

    expect(parsed.surfaces.map((row) => row.surface_id)).toEqual(["mcp", "api"]);
    expect(parsed.surfaces[0]).toEqual({
      tenant_id: "t1",
      connector_id: "stripe",
      surface_id: "mcp",
      present: true,
      fingerprint: "sha256:abc123def456",
      rotated_at: "2026-08-27T00:00:00.000Z",
    });
    expect(JSON.stringify(parsed)).not.toContain("sk_leaked");
    expect(JSON.stringify(parsed)).not.toContain("sk_should_never_parse");
  });

  it("returns an empty surface list for a malformed body", () => {
    const parsed = parseOpsClassCSecretList(
      { nope: true },
      { tenantId: "t1", connectorId: "stripe" },
    );
    expect(parsed).toEqual({
      tenant_id: "t1",
      connector_id: "stripe",
      surfaces: [],
    });
  });
});
