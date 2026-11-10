import { describe, expect, it } from "vitest";

import {
  DEFAULT_SHARED_RELAY_WSS_URL,
  dedicatedRelayWssUrlForSlug,
  resolveTenantRelayWssUrl,
} from "../src/relay-tier.js";

describe("relay-tier URL resolution", () => {
  it("returns shared pool URL for shared tier", () => {
    expect(
      resolveTenantRelayWssUrl(
        {
          tenant_slug: "acme",
          relay_tier: "shared",
          dedicated_relay_wss_url: null,
        },
        "wss://relay.shared.test",
      ),
    ).toBe("wss://relay.shared.test");
  });

  it("uses slug convention for dedicated tier without override", () => {
    expect(dedicatedRelayWssUrlForSlug("Acme-Corp")).toBe(
      "wss://relay-acme-corp.withlanyard.com",
    );
    expect(
      resolveTenantRelayWssUrl({
        tenant_slug: "acme-corp",
        relay_tier: "dedicated",
        dedicated_relay_wss_url: null,
      }),
    ).toBe("wss://relay-acme-corp.withlanyard.com");
  });

  it("prefers ops override for dedicated tier", () => {
    expect(
      resolveTenantRelayWssUrl({
        tenant_slug: "acme-corp",
        relay_tier: "dedicated",
        dedicated_relay_wss_url: "wss://relay.acme.example",
      }),
    ).toBe("wss://relay.acme.example");
  });

  it("defaults shared pool when none configured", () => {
    expect(
      resolveTenantRelayWssUrl({
        tenant_slug: "demo",
        relay_tier: "shared",
        dedicated_relay_wss_url: null,
      }),
    ).toBe(DEFAULT_SHARED_RELAY_WSS_URL);
  });
});