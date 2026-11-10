import { describe, expect, it } from "vitest";

import {
  CANONICAL_LABEL_MAX,
  GraphQlRejectedError,
  canonicalConnectorLabel,
  compileRegistrySnapshot,
  isPinnedArgv,
  parseHttpsHostnameUrl,
  parsePinnedArgv,
  slugFromDomain,
} from "../src/registry-snapshot.js";

describe("canonicalConnectorLabel (lp-hdzm.33)", () => {
  it("uses a short catalog summary", () => {
    expect(
      canonicalConnectorLabel({
        id: "stripe",
        summary: "Stripe MCP, OpenAPI, and CLI.",
      }),
    ).toBe("Stripe MCP, OpenAPI, and CLI.");
  });

  it("title-cases the slug when the live summary exceeds CP label max", () => {
    const liveSummary =
      "Stripe exposes a REST HTTP API at https://api.stripe.com, an OAuth-protected MCP server at https://mcp.stripe.com, and the `stripe` CLI; all require Stripe-issued credentials.";
    expect(liveSummary.length).toBeGreaterThan(CANONICAL_LABEL_MAX);
    expect(
      canonicalConnectorLabel({ id: "stripe", summary: liveSummary }),
    ).toBe("Stripe");
  });
});

describe("registry snapshot compiler (lp-hdzm.19)", () => {
  it("inlines OpenAPI JSON and marks MCP runnable after initialize+streamable-http", async () => {
    const snapshot = await compileRegistrySnapshot({
      source: "integrations.sh",
      domain: "stripe.com",
      surfaces: [
        {
          type: "mcp",
          slug: "stripe-mcp",
          name: "Stripe MCP",
          url: "https://mcp.stripe.com",
          transports: ["streamable-http"],
        },
        {
          type: "http",
          slug: "stripe-api",
          name: "Stripe API",
          openapi: {
            openapi: "3.0.0",
            info: { title: "Stripe", version: "1" },
            paths: { "/v1/customers": { get: { operationId: "listCustomers" } } },
          },
        },
      ],
      deps: {
        probeMcpInitialize: async (url) => url === "https://mcp.stripe.com",
        now: () => new Date("2026-08-26T00:00:00.000Z"),
      },
    });
    expect(snapshot.runnability).toBe("runnable");
    expect(snapshot.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "mcp",
          runnability: "runnable",
          initialize_url: "https://mcp.stripe.com",
          transport: "streamable-http",
        }),
        expect.objectContaining({
          kind: "openapi",
          runnability: "runnable",
          spec: expect.objectContaining({ openapi: "3.0.0" }),
        }),
      ]),
    );
  });

  it("marks pointer-only OpenAPI and unprobed MCP as not_runnable", async () => {
    const snapshot = await compileRegistrySnapshot({
      source: "integrations.sh",
      domain: "pointer.example",
      surfaces: [
        {
          type: "http",
          slug: "pointer-api",
          spec: "https://pointer.example/openapi.json",
        },
        {
          type: "mcp",
          slug: "pointer-mcp",
          url: "https://mcp.pointer.example",
          transports: ["sse"],
        },
      ],
    });
    expect(snapshot.runnability).toBe("not_runnable");
    expect(snapshot.surfaces.every((row) => row.runnability === "not_runnable")).toBe(
      true,
    );
  });

  it("rejects GraphQL-only surfaces", async () => {
    await expect(
      compileRegistrySnapshot({
        source: "custom",
        surfaces: [{ kind: "graphql", slug: "gql", url: "https://gql.example/graphql" }],
      }),
    ).rejects.toBeInstanceOf(GraphQlRejectedError);
  });

  it("drops GraphQL when mixed with a runnable surface", async () => {
    const snapshot = await compileRegistrySnapshot({
      source: "custom",
      surfaces: [
        { kind: "graphql", slug: "gql", url: "https://gql.example/graphql" },
        {
          kind: "cli",
          slug: "tool",
          argv: ["stripe"],
        },
      ],
    });
    expect(snapshot.surfaces).toHaveLength(1);
    expect(snapshot.surfaces[0]?.kind).toBe("cli");
    expect(snapshot.runnability).toBe("runnable");
  });

  it("refuses unpinned npx CLI argv", () => {
    expect(isPinnedArgv(["npx", "-y", "@pkg@latest"])).toBe(false);
    expect(parsePinnedArgv("npx -y @modelcontextprotocol/server-github@latest")).toBe(
      null,
    );
    expect(parsePinnedArgv(["stripe"])).toEqual(["stripe"]);
  });

  it("derives a slug from the domain label", () => {
    expect(slugFromDomain("stripe.com")).toBe("stripe");
    expect(slugFromDomain("google.com")).toBe("google");
  });

  it("refuses IP and localhost initialize URLs", () => {
    expect(parseHttpsHostnameUrl("http://mcp.stripe.com")).toBeNull();
    expect(parseHttpsHostnameUrl("https://127.0.0.1/mcp")).toBeNull();
    expect(parseHttpsHostnameUrl("https://localhost/mcp")).toBeNull();
    expect(parseHttpsHostnameUrl("https://mcp.stripe.com")).not.toBeNull();
  });
});
