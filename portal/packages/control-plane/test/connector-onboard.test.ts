import { describe, expect, it } from "vitest";

import {
  assertOnboardSurfacesAllowed,
  availableOnboardSurfaces,
  compiledKindToSurfaceId,
  ConnectorNotOnboardableError,
  droppedOnboardSurfaces,
  parseOnboardSurfaces,
} from "../src/connector-onboard.js";

describe("connector onboard domain (lp-hdzm.21)", () => {
  it("maps compiled kinds onto Class C surface ids", () => {
    expect(compiledKindToSurfaceId("mcp")).toBe("mcp");
    expect(compiledKindToSurfaceId("openapi")).toBe("api");
    expect(compiledKindToSurfaceId("cli")).toBe("cli");
  });

  it("uses first-class runtime surfaces, not an empty seeded snapshot", () => {
    expect(
      availableOnboardSurfaces({ id: "google", snapshot: {} }),
    ).toEqual(["cli"]);
    expect(
      availableOnboardSurfaces({ id: "hubspot", snapshot: {} }),
    ).toEqual(["api", "cli"]);
  });

  it("refuses not_runnable registry rows", () => {
    expect(
      availableOnboardSurfaces({
        id: "slack",
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
    ).toEqual([]);
  });

  it("collects runnable compiled surfaces and skips graphql-shaped junk via parse", () => {
    expect(
      availableOnboardSurfaces({
        id: "stripe",
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
            {
              kind: "openapi",
              slug: "api",
              label: "API",
              runnability: "runnable",
              spec: { openapi: "3.0.0" },
            },
            {
              kind: "cli",
              slug: "cli",
              label: "CLI",
              runnability: "not_runnable",
            },
          ],
        },
      }),
    ).toEqual(["mcp", "api"]);
  });

  it("parses surfaces_json and drops illegal ids", () => {
    expect(parseOnboardSurfaces('["mcp","api","mcp","graphql"]')).toEqual([
      "mcp",
      "api",
    ]);
    expect(parseOnboardSurfaces(["cli"])).toEqual(["cli"]);
    expect(parseOnboardSurfaces("nope")).toEqual([]);
  });

  it("rejects onboard when no runnable surface exists", () => {
    expect(() =>
      assertOnboardSurfacesAllowed("slack", ["mcp"], []),
    ).toThrow(ConnectorNotOnboardableError);
    expect(() =>
      assertOnboardSurfacesAllowed("slack", [], []),
    ).toThrow(ConnectorNotOnboardableError);
    expect(() =>
      assertOnboardSurfacesAllowed("stripe", ["cli"], ["mcp"]),
    ).toThrow(ConnectorNotOnboardableError);
    expect(() =>
      assertOnboardSurfacesAllowed("stripe", ["mcp"], ["mcp"]),
    ).not.toThrow();
  });

  it("drops every slot on un-onboard and only the turned-off surface otherwise", () => {
    expect(
      droppedOnboardSurfaces({ previous: ["mcp"], next: [] }),
    ).toEqual(["mcp", "api", "cli"]);
    expect(
      droppedOnboardSurfaces({ previous: ["mcp", "api"], next: ["mcp"] }),
    ).toEqual(["api"]);
  });
});
