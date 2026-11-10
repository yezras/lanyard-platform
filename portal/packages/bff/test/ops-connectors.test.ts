import { describe, expect, it } from "vitest";

import { CONNECTOR_SPA_FORBIDDEN_KEYS } from "../src/connectors.js";
import { toOpsConnectorCatalog } from "../src/ops-connectors.js";

describe("toOpsConnectorCatalog (lp-xhf4.14)", () => {
  it("allowlists entitlement + status counts and drops secrets, OAuth, QR, sticky", () => {
    const catalog = toOpsConnectorCatalog({
      tenants: [
        {
          tenant_id: "t-alpha",
          tenant_slug: "alpha",
          display_name: "Alpha",
          connectors: [
            {
              connector_id: "google",
              enabled: true,
              status_counts: { connected: 2, pairing: 0, needs_reauth: 1 },
            },
          ],
        },
      ],
      totals: {
        google: {
          connected: 2,
          pairing: 0,
          needs_reauth: 1,
          entitled_tenants: 1,
        },
        hubspot: {
          connected: 0,
          pairing: 0,
          needs_reauth: 0,
          entitled_tenants: 0,
        },
        whatsapp: {
          connected: 0,
          pairing: 0,
          needs_reauth: 0,
          entitled_tenants: 0,
        },
        github: {
          connected: 0,
          pairing: 0,
          needs_reauth: 0,
          entitled_tenants: 0,
        },
      },
    });

    expect(catalog.tenants[0]?.connectors.map((row) => row.connector_id)).toEqual([
      "google",
      "hubspot",
      "whatsapp",
      "github",
    ]);
    expect(catalog.tenants[0]?.connectors[0]).toEqual({
      connector_id: "google",
      enabled: true,
      status_counts: { connected: 2, pairing: 0, needs_reauth: 1 },
    });
    const raw = JSON.stringify(catalog);
    for (const key of CONNECTOR_SPA_FORBIDDEN_KEYS) {
      expect(raw).not.toContain(key);
    }
    expect(raw).not.toContain("sticky");
    expect(raw).not.toContain("account_label");
  });

  it("drops unknown connector ids and fills missing v1 rows as off", () => {
    const catalog = toOpsConnectorCatalog({
      tenants: [
        {
          tenant_id: "t1",
          tenant_slug: "one",
          display_name: "One",
          connectors: [
            {
              connector_id: "outlook" as "google",
              enabled: true,
              status_counts: { connected: 9, pairing: 0, needs_reauth: 0 },
            },
          ],
        },
      ],
      totals: {
        google: {
          connected: 0,
          pairing: 0,
          needs_reauth: 0,
          entitled_tenants: 0,
        },
        hubspot: {
          connected: 0,
          pairing: 0,
          needs_reauth: 0,
          entitled_tenants: 0,
        },
        whatsapp: {
          connected: 0,
          pairing: 0,
          needs_reauth: 0,
          entitled_tenants: 0,
        },
        github: {
          connected: 0,
          pairing: 0,
          needs_reauth: 0,
          entitled_tenants: 0,
        },
      },
    });
    expect(catalog.tenants[0]?.connectors.every((row) => row.enabled === false)).toBe(
      true,
    );
  });
});
