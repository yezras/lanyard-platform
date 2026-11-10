import { describe, expect, it } from "vitest";

import type { CanonicalConnectorRow, RegistrySearchHit } from "../../api/opsRegistry.js";
import {
  buildRegistrySearchRows,
  canDeleteCanonical,
  emptyCustomSurfaceDraft,
  parseCustomConnectorForm,
  searchActionForHit,
} from "./opsRegistry.js";

const slack: RegistrySearchHit = {
  domain: "slack.com",
  name: "Slack",
  description: "",
  kinds: ["mcp"],
};

const stripeHit: RegistrySearchHit = {
  domain: "stripe.com",
  name: "Stripe",
  description: "",
  kinds: ["mcp", "openapi", "cli"],
};

const stripeRow: CanonicalConnectorRow = {
  id: "stripe",
  domain: "stripe.com",
  label: "Stripe",
  source: "integrations.sh",
  source_entry_id: "integrations.sh:stripe.com",
  archived: false,
  onboarded_tenant_count: 2,
};

describe("searchActionForHit", () => {
  it("promotes catalog hits that are not on the canonical list", () => {
    expect(searchActionForHit(slack, [stripeRow])).toEqual({
      kind: "promote",
      domain: "slack.com",
    });
  });

  it("marks domain and source_entry_id matches as on registry", () => {
    expect(searchActionForHit(stripeHit, [stripeRow])).toEqual({
      kind: "on_registry",
    });
    expect(
      searchActionForHit(stripeHit, [
        { ...stripeRow, domain: null },
      ]),
    ).toEqual({ kind: "on_registry" });
  });

  it("ignores archived canonical rows", () => {
    expect(
      searchActionForHit(stripeHit, [{ ...stripeRow, archived: true }]),
    ).toEqual({ kind: "promote", domain: "stripe.com" });
  });
});

describe("buildRegistrySearchRows", () => {
  it("attaches Promote vs On registry per hit", () => {
    const rows = buildRegistrySearchRows([slack, stripeHit], [stripeRow]);
    expect(rows.map((row) => row.action.kind)).toEqual([
      "promote",
      "on_registry",
    ]);
  });
});

describe("canDeleteCanonical", () => {
  it("blocks delete while any tenant is onboarded", () => {
    expect(canDeleteCanonical(stripeRow)).toBe(false);
    expect(canDeleteCanonical({ ...stripeRow, onboarded_tenant_count: 0 })).toBe(
      true,
    );
  });
});

describe("parseCustomConnectorForm", () => {
  it("accepts MCP, OpenAPI JSON, and CLI argv", () => {
    expect(
      parseCustomConnectorForm({
        slug: "Linear",
        label: " Linear ",
        surface: {
          ...emptyCustomSurfaceDraft(),
          kind: "mcp",
          initialize_url: "https://mcp.linear.app/mcp",
          auth_kind: "api_key",
        },
      }),
    ).toEqual({
      ok: true,
      value: {
        slug: "linear",
        label: "Linear",
        surfaces: [
          {
            kind: "mcp",
            initialize_url: "https://mcp.linear.app/mcp",
            transports: ["streamable-http"],
            auth_kind: "api_key",
          },
        ],
      },
    });

    expect(
      parseCustomConnectorForm({
        slug: "acme",
        label: "Acme",
        surface: {
          ...emptyCustomSurfaceDraft(),
          kind: "openapi",
          spec_text: '{"openapi":"3.0.0"}',
        },
      }).ok,
    ).toBe(true);

    expect(
      parseCustomConnectorForm({
        slug: "acme",
        label: "Acme",
        surface: {
          ...emptyCustomSurfaceDraft(),
          kind: "cli",
          argv_text: "acme --json",
        },
      }),
    ).toMatchObject({
      ok: true,
      value: { surfaces: [{ kind: "cli", argv: ["acme", "--json"] }] },
    });
  });

  it("rejects invalid slugs, empty labels, and non-JSON OpenAPI", () => {
    expect(
      parseCustomConnectorForm({
        slug: "Google",
        label: "Google",
        surface: {
          ...emptyCustomSurfaceDraft(),
          initialize_url: "https://mcp.google.com",
        },
      }).ok,
    ).toBe(true);
    expect(
      parseCustomConnectorForm({
        slug: "1bad",
        label: "Bad",
        surface: emptyCustomSurfaceDraft(),
      }),
    ).toEqual({ ok: false, error: "Invalid slug" });
    expect(
      parseCustomConnectorForm({
        slug: "acme",
        label: "  ",
        surface: emptyCustomSurfaceDraft(),
      }),
    ).toEqual({ ok: false, error: "Label is required" });
    expect(
      parseCustomConnectorForm({
        slug: "acme",
        label: "Acme",
        surface: {
          ...emptyCustomSurfaceDraft(),
          kind: "openapi",
          spec_text: "not-json",
        },
      }),
    ).toEqual({ ok: false, error: "OpenAPI spec must be JSON" });
  });
});
