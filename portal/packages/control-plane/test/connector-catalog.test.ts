import { describe, expect, it } from "vitest";

import {
  assertPublicConnectorJson,
  buildConnectorCatalog,
  CONNECTOR_ID_PATTERN,
  CONNECTOR_PUBLIC_FORBIDDEN_KEYS,
  FIRST_CLASS_CONNECTOR_IDS,
  isConnectorId,
  isFirstClassConnectorId,
  emptyConnectorStatusCounts,
} from "../src/connectors.js";

describe("buildConnectorCatalog (lp-xhf4.14)", () => {
  it("emits every v1 connector for every tenant even when no entitlement row exists", () => {
    const catalog = buildConnectorCatalog({
      tenants: [
        {
          tenant_id: "t-alpha",
          tenant_slug: "alpha",
          display_name: "Alpha",
        },
        {
          tenant_id: "t-beta",
          tenant_slug: "beta",
          display_name: "Beta",
        },
      ],
      entitlements: [
        { tenant_id: "t-alpha", connector_id: "google", enabled: true },
      ],
      statusRows: [
        {
          tenant_id: "t-alpha",
          connector_id: "google",
          status: "connected",
          n: 2,
        },
        {
          tenant_id: "t-alpha",
          connector_id: "google",
          status: "needs_reauth",
          n: 1,
        },
        {
          tenant_id: "t-beta",
          connector_id: "whatsapp",
          status: "pairing",
          n: 1,
        },
        {
          tenant_id: "t-alpha",
          connector_id: "google",
          status: "not_connected",
          n: 9,
        },
      ],
    });

    expect(catalog.tenants).toHaveLength(2);
    expect(catalog.tenants[0]).toMatchObject({
      tenant_slug: "alpha",
      connectors: [
        {
          connector_id: "google",
          enabled: true,
          status_counts: { connected: 2, pairing: 0, needs_reauth: 1 },
        },
        {
          connector_id: "hubspot",
          enabled: false,
          status_counts: emptyConnectorStatusCounts(),
        },
        {
          connector_id: "whatsapp",
          enabled: false,
          status_counts: emptyConnectorStatusCounts(),
        },
        {
          connector_id: "github",
          enabled: false,
          status_counts: emptyConnectorStatusCounts(),
        },
      ],
    });
    expect(catalog.tenants[1]?.connectors.find((c) => c.connector_id === "whatsapp")).toEqual({
      connector_id: "whatsapp",
      enabled: false,
      status_counts: { connected: 0, pairing: 1, needs_reauth: 0 },
    });
    expect(catalog.totals.google).toEqual({
      connected: 2,
      pairing: 0,
      needs_reauth: 1,
      entitled_tenants: 1,
    });
    expect(catalog.totals.whatsapp).toEqual({
      connected: 0,
      pairing: 1,
      needs_reauth: 0,
      entitled_tenants: 0,
    });
    assertPublicConnectorJson(catalog);
    for (const key of CONNECTOR_PUBLIC_FORBIDDEN_KEYS) {
      expect(JSON.stringify(catalog)).not.toContain(key);
    }
  });

  it("ignores non-positive counts so bad SQL rows cannot invent usage", () => {
    const catalog = buildConnectorCatalog({
      tenants: [
        { tenant_id: "t1", tenant_slug: "one", display_name: "One" },
      ],
      entitlements: [],
      statusRows: [
        {
          tenant_id: "t1",
          connector_id: "hubspot",
          status: "connected",
          n: 0,
        },
        {
          tenant_id: "t1",
          connector_id: "hubspot",
          status: "connected",
          n: Number.NaN,
        },
      ],
    });
    expect(catalog.tenants[0]?.connectors[1]?.status_counts).toEqual(
      emptyConnectorStatusCounts(),
    );
  });
});

describe("ConnectorId (lp-hdzm.4)", () => {
  it("first-class ids stay google|hubspot|whatsapp|github", () => {
    expect([...FIRST_CLASS_CONNECTOR_IDS]).toEqual([
      "google",
      "hubspot",
      "whatsapp",
      "github",
    ]);
    for (const id of FIRST_CLASS_CONNECTOR_IDS) {
      expect(isFirstClassConnectorId(id)).toBe(true);
      expect(isConnectorId(id)).toBe(true);
    }
    expect(isFirstClassConnectorId("slack")).toBe(false);
  });

  it("slug shape accepts slack and rejects empty or uppercase", () => {
    expect(CONNECTOR_ID_PATTERN.test("slack")).toBe(true);
    expect(isConnectorId("slack")).toBe(true);
    expect(isConnectorId("")).toBe(false);
    expect(isConnectorId("Google")).toBe(false);
    expect(isConnectorId("google_workspace")).toBe(false);
  });
});
