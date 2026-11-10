import { afterEach, describe, expect, it, vi } from "vitest";

import { resetOpsCsrfToken } from "./opsApi.js";
import {
  createCustomConnector,
  deleteCanonicalConnector,
  fetchCanonicalConnectors,
  parseCanonicalConnectors,
  parseRegistrySearchHits,
  promoteRegistryDomain,
  searchOpsRegistry,
} from "./opsRegistry.js";

describe("parseRegistrySearchHits", () => {
  it("keeps catalog kinds and drops malformed rows", () => {
    const hits = parseRegistrySearchHits({
      source: "integrations.sh",
      snapshot: { secret: "nope" },
      results: [
        {
          domain: "stripe.com",
          name: "Stripe",
          description: "Payments",
          kinds: ["mcp", "openapi", "cli", "bogus"],
        },
        { domain: "slack.com", name: "Slack", kinds: ["mcp"] },
        { name: "No domain", kinds: ["mcp"] },
        "junk",
      ],
    });
    expect(hits).toEqual([
      {
        domain: "stripe.com",
        name: "Stripe",
        description: "Payments",
        kinds: ["mcp", "openapi", "cli"],
      },
      {
        domain: "slack.com",
        name: "Slack",
        description: "",
        kinds: ["mcp"],
      },
    ]);
    expect(JSON.stringify(hits)).not.toContain("secret");
  });
});

describe("parseCanonicalConnectors", () => {
  it("parses public fields and drops snapshot bodies", () => {
    const rows = parseCanonicalConnectors({
      connectors: [
        {
          id: "stripe",
          domain: "stripe.com",
          label: "Stripe",
          source: "integrations.sh",
          source_entry_id: "integrations.sh:stripe.com",
          archived: false,
          onboarded_tenant_count: "2",
          snapshot: { token: "leak" },
        },
        { id: "", label: "Bad" },
        {
          id: "linear",
          label: "Linear",
          domain: null,
          source: "custom",
          archived: true,
          onboarded_tenant_count: 0,
        },
      ],
    });
    expect(rows).toEqual([
      {
        id: "stripe",
        domain: "stripe.com",
        label: "Stripe",
        source: "integrations.sh",
        source_entry_id: "integrations.sh:stripe.com",
        archived: false,
        onboarded_tenant_count: 2,
      },
      {
        id: "linear",
        domain: null,
        label: "Linear",
        source: "custom",
        source_entry_id: null,
        archived: true,
        onboarded_tenant_count: 0,
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("leak");
  });
});

describe("ops registry fetches", () => {
  afterEach(() => {
    resetOpsCsrfToken();
    vi.unstubAllGlobals();
  });

  it("GETs search through the BFF, not integrations.sh", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toBe("/api/admin/registry/search?q=slack");
      return Response.json({
        source: "integrations.sh",
        results: [
          {
            domain: "slack.com",
            name: "Slack",
            description: "",
            kinds: ["mcp"],
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const hits = await searchOpsRegistry(" slack ");
    expect(hits[0]?.domain).toBe("slack.com");
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain(
      "integrations.sh",
    );
  });

  it("lists, promotes, customs, and deletes via /api/admin/registry", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/admin/auth/csrf") {
        return Response.json({ csrf_token: "csrf" });
      }
      if (url === "/api/admin/registry/connectors" && method === "GET") {
        return Response.json({
          connectors: [
            {
              id: "stripe",
              domain: "stripe.com",
              label: "Stripe",
              source: "integrations.sh",
              onboarded_tenant_count: 1,
            },
          ],
        });
      }
      if (url === "/api/admin/registry/promote") {
        expect(init?.body).toBe(JSON.stringify({ domain: "slack.com" }));
        return Response.json(
          {
            id: "slack",
            domain: "slack.com",
            label: "Slack",
            source: "integrations.sh",
            onboarded_tenant_count: 0,
          },
          { status: 201 },
        );
      }
      if (url === "/api/admin/registry/custom") {
        return Response.json(
          {
            id: "linear",
            label: "Linear",
            source: "custom",
            onboarded_tenant_count: 0,
          },
          { status: 201 },
        );
      }
      if (url === "/api/admin/registry/connectors/linear" && method === "DELETE") {
        return Response.json({
          id: "linear",
          label: "Linear",
          source: "custom",
          archived: true,
          onboarded_tenant_count: 0,
        });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const listed = await fetchCanonicalConnectors();
    expect(listed[0]?.id).toBe("stripe");
    expect(listed[0]?.onboarded_tenant_count).toBe(1);

    const promoted = await promoteRegistryDomain("slack.com");
    expect(promoted.id).toBe("slack");

    const custom = await createCustomConnector({
      slug: "linear",
      label: "Linear",
      surfaces: [
        {
          kind: "mcp",
          initialize_url: "https://mcp.linear.app/mcp",
          transports: ["streamable-http"],
        },
      ],
    });
    expect(custom.id).toBe("linear");

    const deleted = await deleteCanonicalConnector("linear");
    expect(deleted.archived).toBe(true);
  });
});
