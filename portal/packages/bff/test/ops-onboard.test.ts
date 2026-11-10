import { describe, expect, it } from "vitest";

import type { CanonicalConnector } from "../src/control-plane-client.js";
import {
  availableOnboardSurfaces,
  searchCanonicalNotOnTenant,
  toOpsTenantOnboarded,
} from "../src/ops-onboard.js";

function canonical(partial: Partial<CanonicalConnector> & { id: string; label: string }): CanonicalConnector {
  return {
    domain: null,
    archived: false,
    seeded: false,
    source: "integrations.sh",
    source_entry_id: null,
    snapshot: {},
    onboarded_tenant_count: 0,
    created_at: "2026-08-26T00:00:00.000Z",
    ...partial,
  };
}

describe("ops onboard domain (lp-hdzm.21)", () => {
  it("lists only enabled entitlements with labels from canonical", () => {
    const rows = toOpsTenantOnboarded({
      canonical: [
        canonical({ id: "google", label: "Google", seeded: true, source: "seeded" }),
        canonical({ id: "stripe", label: "Stripe" }),
      ],
      entitlements: [
        { connector_id: "google", enabled: true, surfaces: ["cli"] },
        { connector_id: "stripe", enabled: false, surfaces: [] },
      ],
      statusByConnector: {
        google: { connected: 2, pairing: 0, needs_reauth: 0 },
      },
    });
    expect(rows.map((row) => row.connector_id)).toEqual(["google"]);
    expect(rows[0]?.label).toBe("Google");
    expect(rows[0]?.surfaces).toEqual(["cli"]);
    expect(rows[0]?.available_surfaces).toEqual(["cli"]);
  });

  it("searches canonical-not-on-tenant and skips not_runnable", () => {
    const found = searchCanonicalNotOnTenant({
      query: "str",
      onboardedIds: new Set(["google"]),
      canonical: [
        canonical({ id: "google", label: "Google", seeded: true, source: "seeded" }),
        canonical({
          id: "stripe",
          label: "Stripe",
          domain: "stripe.com",
          snapshot: {
            version: 1,
            source: "integrations.sh",
            domain: "stripe.com",
            compiled_at: "2026-08-26T00:00:00.000Z",
            runnability: "runnable",
            surfaces: [
              {
                kind: "mcp",
                slug: "mcp",
                label: "MCP",
                runnability: "runnable",
              },
            ],
          },
        }),
        canonical({
          id: "slack",
          label: "Slack",
          domain: "slack.com",
          snapshot: {
            version: 1,
            source: "integrations.sh",
            domain: "slack.com",
            compiled_at: "2026-08-26T00:00:00.000Z",
            runnability: "not_runnable",
            surfaces: [
              {
                kind: "mcp",
                slug: "mcp",
                label: "MCP",
                runnability: "not_runnable",
              },
            ],
          },
        }),
      ],
    });
    expect(found.map((row) => row.id)).toEqual(["stripe"]);
  });

  it("does not treat first-class empty snapshots as not onboardable", () => {
    expect(availableOnboardSurfaces({ id: "hubspot", snapshot: {} })).toEqual([
      "api",
      "cli",
    ]);
  });
});
