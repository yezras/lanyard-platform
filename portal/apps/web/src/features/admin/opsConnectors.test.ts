import { describe, expect, it } from "vitest";

import type { OpsTenantOnboardedConnector } from "../../api/opsConnectors.js";
import {
  availableOnboardSurfaces,
  buildOnboardedRows,
  connectorStatus,
  isLastSurfaceOff,
  remainingSurfaces,
  searchCanonicalNotOnTenant,
} from "./opsConnectors.js";

const onboarded: OpsTenantOnboardedConnector[] = [
  {
    connector_id: "google",
    label: "Google",
    surfaces: ["cli"],
    available_surfaces: ["cli"],
    status_counts: { connected: 3, pairing: 0, needs_reauth: 0 },
    auth_chips: ["OAuth"],
  },
  {
    connector_id: "stripe",
    label: "Stripe",
    surfaces: ["mcp"],
    available_surfaces: ["mcp", "api"],
    status_counts: { connected: 0, pairing: 0, needs_reauth: 0 },
    auth_chips: ["MCP"],
  },
];

describe("buildOnboardedRows (lp-hdzm.21)", () => {
  it("lists onboarded connectors only", () => {
    const rows = buildOnboardedRows(onboarded);
    expect(rows.map((row) => row.connector_id)).toEqual(["google", "stripe"]);
    expect(rows.find((row) => row.connector_id === "google")?.authChips).toEqual([
      "OAuth",
    ]);
  });

  it("derives status and user counts per row without Entitled", () => {
    const rows = buildOnboardedRows(onboarded);
    expect(rows.find((row) => row.connector_id === "google")?.status).toBe(
      "connected",
    );
    expect(rows.find((row) => row.connector_id === "stripe")?.status).toBe(
      "not_connected",
    );
  });
});

describe("connectorStatus", () => {
  it("ranks reauth over pairing over connected over not connected", () => {
    expect(connectorStatus({ connected: 1, pairing: 1, needs_reauth: 1 })).toBe(
      "reauth",
    );
    expect(connectorStatus({ connected: 1, pairing: 1, needs_reauth: 0 })).toBe(
      "pairing",
    );
    expect(connectorStatus({ connected: 1, pairing: 0, needs_reauth: 0 })).toBe(
      "connected",
    );
    expect(connectorStatus({ connected: 0, pairing: 0, needs_reauth: 0 })).toBe(
      "not_connected",
    );
  });
});

describe("searchCanonicalNotOnTenant", () => {
  const canonical = [
    {
      id: "google",
      domain: "google.com",
      label: "Google",
      archived: false,
      snapshot: {},
    },
    {
      id: "stripe",
      domain: "stripe.com",
      label: "Stripe",
      archived: false,
      snapshot: {
        runnability: "runnable",
        surfaces: [{ kind: "mcp", runnability: "runnable" }],
      },
    },
    {
      id: "slack",
      domain: "slack.com",
      label: "Slack",
      archived: false,
      snapshot: {
        runnability: "not_runnable",
        surfaces: [{ kind: "mcp", runnability: "not_runnable" }],
      },
    },
  ];

  it("searches canonical rows not on the tenant and skips not_runnable", () => {
    const found = searchCanonicalNotOnTenant({
      canonical,
      onboardedIds: new Set(["google"]),
      query: "str",
    });
    expect(found.map((row) => row.id)).toEqual(["stripe"]);
  });

  it("does not use a 50-item catalog seed", () => {
    expect(availableOnboardSurfaces({ id: "google", snapshot: {} })).toEqual([
      "cli",
    ]);
    expect(
      searchCanonicalNotOnTenant({
        canonical,
        onboardedIds: new Set(),
        query: "",
      }).map((row) => row.id),
    ).toEqual(["google", "stripe"]);
  });
});

describe("last-off surfaces", () => {
  it("detects last surface off and remaining slots", () => {
    expect(isLastSurfaceOff(["mcp"], "mcp")).toBe(true);
    expect(isLastSurfaceOff(["mcp", "api"], "api")).toBe(false);
    expect(remainingSurfaces(["mcp", "api"], "api")).toEqual(["mcp"]);
  });
});
