import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  LITELLM_AUTO_ROUTER_MODEL,
  loadModelCatalog,
  routeCatalogModel,
  saveModelCatalog,
  type ModelCatalog,
} from "../src/model-catalog.js";

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

describe("model catalog", () => {
  it("asks LiteLLM auto router for every message length", async () => {
    const root = await tempRoot("catalog-auto-");
    const catalog = await loadModelCatalog(root);
    expect(catalog.models.map((model) => model.id)).toEqual([
      "lanyard-simple",
      "lanyard-moderate",
      "lanyard-complex",
    ]);

    for (const length of [1, 79, 80, 399, 400, 2000]) {
      expect(routeCatalogModel(catalog, "a".repeat(length))).toEqual({
        ok: true,
        modelId: LITELLM_AUTO_ROUTER_MODEL,
      });
    }
  });

  it("does not send a disabled tier id; LiteLLM classifies", () => {
    const catalog: ModelCatalog = {
      models: [
        { id: "lanyard-simple", tier: "simple", enabled: false },
        { id: "tenant-simple", tier: "simple", enabled: true },
        { id: "lanyard-moderate", tier: "moderate", enabled: true },
      ],
    };
    const routed = routeCatalogModel(catalog, "short note");
    expect(routed).toEqual({
      ok: true,
      modelId: "lanyard-auto",
    });
    if (routed.ok) {
      expect(routed.modelId).not.toBe("lanyard-simple");
    }
  });

  it("fails when no model is enabled", () => {
    const empty: ModelCatalog = {
      models: [
        { id: "lanyard-simple", tier: "simple", enabled: false },
        { id: "lanyard-moderate", tier: "moderate", enabled: false },
        { id: "lanyard-complex", tier: "complex", enabled: false },
      ],
    };
    expect(routeCatalogModel(empty, "hello")).toEqual({
      ok: false,
      error: "No model is available",
    });
    expect(routeCatalogModel({ models: [] }, "x".repeat(500))).toEqual({
      ok: false,
      error: "No model is available",
    });
  });

  it("keeps two vault catalogs isolated and still uses the auto router", async () => {
    const alphaRoot = await tempRoot("catalog-alpha-");
    const betaRoot = await tempRoot("catalog-beta-");
    await saveModelCatalog(alphaRoot, {
      models: [{ id: "alpha-simple", tier: "simple", enabled: true }],
    });
    await saveModelCatalog(betaRoot, {
      models: [{ id: "beta-complex", tier: "complex", enabled: true }],
    });

    const alpha = await loadModelCatalog(alphaRoot);
    const beta = await loadModelCatalog(betaRoot);
    expect(alpha.models).toEqual([{ id: "alpha-simple", tier: "simple", enabled: true }]);
    expect(beta.models).toEqual([{ id: "beta-complex", tier: "complex", enabled: true }]);
    expect(alpha.models.map((model) => model.id)).not.toContain("beta-complex");
    expect(beta.models.map((model) => model.id)).not.toContain("alpha-simple");

    expect(routeCatalogModel(alpha, "hi")).toEqual({
      ok: true,
      modelId: "lanyard-auto",
    });
    expect(routeCatalogModel(beta, "hi")).toEqual({
      ok: true,
      modelId: "lanyard-auto",
    });
  });
});
