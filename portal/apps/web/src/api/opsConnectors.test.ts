import { afterEach, describe, expect, it, vi } from "vitest";

import { resetOpsCsrfToken } from "./opsApi.js";
import {
  fetchOpsCanonicalConnectors,
  fetchOpsConnectorCatalog,
  fetchOpsTenantConnectors,
  parseOpsCanonicalConnectors,
  parseOpsConnectorCatalog,
  parseOpsTenantOnboarded,
  putOpsConnectorEntitlement,
} from "./opsConnectors.js";

describe("parseOpsConnectorCatalog", () => {
  it("keeps entitlement and counts and drops secrets, OAuth, QR, sticky", () => {
    const parsed = parseOpsConnectorCatalog({
      oauth_refresh: "leaked",
      tenants: [
        {
          tenant_id: "t1",
          tenant_slug: "alpha",
          display_name: "Alpha",
          secrets: "nope",
          connectors: [
            {
              connector_id: "google",
              enabled: true,
              status_counts: { connected: 2, pairing: 0, needs_reauth: 1 },
              account_label: "alice@gmail.com",
              sticky: { "gmail.read": true },
            },
            {
              connector_id: "outlook",
              enabled: true,
              status_counts: { connected: 9, pairing: 0, needs_reauth: 0 },
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
      },
    });

    expect(parsed.tenants[0]?.connectors.map((row) => row.connector_id)).toEqual([
      "google",
      "hubspot",
      "whatsapp",
      "github",
    ]);
    expect(parsed.tenants[0]?.connectors[0]).toEqual({
      connector_id: "google",
      enabled: true,
      status_counts: { connected: 2, pairing: 0, needs_reauth: 1 },
    });
    expect(JSON.stringify(parsed)).not.toContain("oauth_refresh");
    expect(JSON.stringify(parsed)).not.toContain("alice@gmail.com");
  });
});

describe("ops connector fetches", () => {
  afterEach(() => {
    resetOpsCsrfToken();
    vi.unstubAllGlobals();
  });

  it("GETs the catalog from /api/admin/connectors", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toBe("/api/admin/connectors");
      return Response.json({
        tenants: [
          {
            tenant_id: "t1",
            tenant_slug: "alpha",
            display_name: "Alpha",
            connectors: [
              {
                connector_id: "google",
                enabled: true,
                status_counts: { connected: 1, pairing: 0, needs_reauth: 0 },
              },
            ],
          },
        ],
        totals: {
          google: {
            connected: 1,
            pairing: 0,
            needs_reauth: 0,
            entitled_tenants: 1,
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const catalog = await fetchOpsConnectorCatalog();
    expect(catalog.tenants[0]?.connectors[0]?.enabled).toBe(true);
  });

  it("PUTs entitlement with the ops CSRF cookie", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/auth/csrf") {
        return Response.json({ csrf_token: "ops-csrf" });
      }
      expect(url).toBe("/api/admin/tenants/t1/connectors/hubspot");
      expect(init?.method).toBe("PUT");
      const headers = new Headers(init?.headers);
      expect(headers.get("X-CSRF-Token")).toBe("ops-csrf");
      expect(JSON.parse(String(init?.body))).toEqual({ enabled: true });
      return Response.json({
        tenant_id: "t1",
        connector_id: "hubspot",
        enabled: true,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await putOpsConnectorEntitlement({
      tenantId: "t1",
      connectorId: "hubspot",
      enabled: true,
    });
    expect(result).toEqual({
      tenant_id: "t1",
      connector_id: "hubspot",
      enabled: true,
      surfaces: [],
    });
  });

  it("GETs onboarded tenant connectors and canonical registry", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/tenants/t1/connectors") {
        return Response.json({
          tenant_id: "t1",
          connectors: [
            {
              connector_id: "stripe",
              label: "Stripe",
              surfaces: ["mcp"],
              available_surfaces: ["mcp", "api"],
              status_counts: { connected: 0, pairing: 0, needs_reauth: 0 },
              auth_chips: ["MCP"],
            },
          ],
        });
      }
      expect(url).toBe("/api/admin/registry/connectors");
      return Response.json({
        connectors: [{ id: "stripe", label: "Stripe", archived: false }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const onboarded = await fetchOpsTenantConnectors("t1");
    expect(onboarded).toEqual([
      {
        connector_id: "stripe",
        label: "Stripe",
        surfaces: ["mcp"],
        available_surfaces: ["mcp", "api"],
        status_counts: { connected: 0, pairing: 0, needs_reauth: 0 },
        auth_chips: ["MCP"],
      },
    ]);
    const canonical = await fetchOpsCanonicalConnectors();
    expect(canonical[0]?.id).toBe("stripe");
  });
});

describe("parseOpsTenantOnboarded", () => {
  it("keeps surfaces and drops graphql", () => {
    expect(
      parseOpsTenantOnboarded({
        connectors: [
          {
            connector_id: "stripe",
            label: "Stripe",
            surfaces: ["mcp", "graphql"],
            available_surfaces: ["mcp"],
            status_counts: { connected: 0, pairing: 0, needs_reauth: 0 },
            auth_chips: ["MCP"],
          },
        ],
      }),
    ).toEqual([
      {
        connector_id: "stripe",
        label: "Stripe",
        surfaces: ["mcp"],
        available_surfaces: ["mcp"],
        status_counts: { connected: 0, pairing: 0, needs_reauth: 0 },
        auth_chips: ["MCP"],
      },
    ]);
  });
});

describe("parseOpsCanonicalConnectors", () => {
  it("reads registry rows", () => {
    expect(
      parseOpsCanonicalConnectors({
        connectors: [{ id: "stripe", label: "Stripe", domain: "stripe.com" }],
      }),
    ).toEqual([
      {
        id: "stripe",
        domain: "stripe.com",
        label: "Stripe",
        archived: false,
        snapshot: undefined,
      },
    ]);
  });
});
