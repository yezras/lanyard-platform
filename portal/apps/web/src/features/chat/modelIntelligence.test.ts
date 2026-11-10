import { describe, expect, it } from "vitest";

import type { SettingsModel } from "../../api/types.js";

import {
  classifyMessageComplexity,
  DEFAULT_LITELLM_INTELLIGENCE_MODELS,
  findCatalogModelById,
  hasLiteLlmIntelligenceRouter,
  labelForSelection,
  litellmModelNameForSelection,
  modelIntelligenceGate,
  readModelIntelligenceState,
  resolveEffectiveTier,
  resolveLiteLlmIntelligenceModel,
  resolveModelForTier,
  resolveModelRoute,
  selectionForThread,
  withEffectiveTierUpdate,
  withSelectionUpdate,
  writeModelIntelligenceState,
  MODEL_INTELLIGENCE_STORAGE_KEY,
} from "./modelIntelligence.js";

/** Thin catalog without LiteLLM intelligence pins → client fallback. */
const models: SettingsModel[] = [
  { provider: "anthropic", model: "claude-haiku-4", connected: true },
  {
    provider: "xai",
    model: "grok-3",
    is_active: true,
    connected: true,
  },
  { provider: "xai", model: "xai/grok-build-0.1", connected: true },
];

/** Host catalog with deploy LiteLLM intelligence model_name entries. */
const litellmModels: SettingsModel[] = [
  {
    provider: "litellm",
    model: "lanyard-simple",
    connected: true,
  },
  {
    provider: "litellm",
    model: "lanyard-moderate",
    is_active: true,
    connected: true,
  },
  {
    provider: "litellm",
    model: "lanyard-complex",
    connected: true,
  },
  {
    provider: "litellm",
    model: "lanyard-auto",
    connected: true,
  },
  // Unrelated catalog noise
  { provider: "xai", model: "xai/grok-build-0.1", connected: true },
];

describe("classifyMessageComplexity", () => {
  it("classifies greetings and short prompts as simple", () => {
    expect(classifyMessageComplexity("hi")).toBe("simple");
    expect(classifyMessageComplexity("Summarize this note")).toBe("simple");
  });

  it("classifies architecture / long prompts as complex", () => {
    expect(
      classifyMessageComplexity("Please refactor the auth architecture"),
    ).toBe("complex");
    expect(classifyMessageComplexity("x".repeat(900))).toBe("complex");
  });

  it("defaults empty and mid-length to moderate", () => {
    expect(classifyMessageComplexity("")).toBe("moderate");
    expect(
      classifyMessageComplexity(
        "Walk me through how the chat SSE pipeline works in Portal for a teammate who is new.",
      ),
    ).toBe("moderate");
  });
});

describe("LiteLLM intelligence model map (lp-uxy.12)", () => {
  it("exports stable deploy model_name defaults", () => {
    expect(DEFAULT_LITELLM_INTELLIGENCE_MODELS).toEqual({
      auto: "lanyard-auto",
      simple: "lanyard-simple",
      moderate: "lanyard-moderate",
      complex: "lanyard-complex",
    });
  });

  it("honors intelligence model map overrides", () => {
    expect(
      litellmModelNameForSelection("auto", { auto: "smart-router" }),
    ).toBe("smart-router");
    expect(litellmModelNameForSelection("complex")).toBe("lanyard-complex");
  });

  it("detects router presence and finds catalog pins", () => {
    expect(hasLiteLlmIntelligenceRouter(models)).toBe(false);
    expect(hasLiteLlmIntelligenceRouter(litellmModels)).toBe(true);
    expect(findCatalogModelById(litellmModels, "lanyard-auto")?.provider).toBe(
      "litellm",
    );
    expect(
      resolveLiteLlmIntelligenceModel("complex", litellmModels)?.model,
    ).toBe("lanyard-complex");
  });
});

describe("resolveModelForTier", () => {
  it("maps tiers to catalog models by name heuristics", () => {
    expect(resolveModelForTier("simple", models)?.model).toBe("claude-haiku-4");
    expect(resolveModelForTier("complex", models)?.model).toBe(
      "xai/grok-build-0.1",
    );
    expect(resolveModelForTier("moderate", models)?.model).toBe("grok-3");
  });

  it("honors explicit overrides", () => {
    const hit = resolveModelForTier("simple", models, {
      overrides: { simple: "xai/grok-build-0.1" },
    });
    expect(hit?.model).toBe("xai/grok-build-0.1");
  });

  it("falls back to active model when catalog is thin", () => {
    const only: SettingsModel[] = [
      { provider: "xai", model: "only-one", is_active: true },
    ];
    expect(resolveModelForTier("complex", only)?.model).toBe("only-one");
  });
});

describe("resolveModelRoute", () => {
  it("lp-uxy.12: Auto prefers LiteLLM auto_router model id (no client tier pick)", () => {
    const route = resolveModelRoute({
      selection: "auto",
      text: "hi", // would be simple under client heuristic
      models: litellmModels,
      activeModelId: "lanyard-moderate",
    });
    expect(route.isAuto).toBe(true);
    expect(route.routingSource).toBe("litellm");
    expect(route.modelId).toBe("lanyard-auto");
    expect(route.effectiveTier).toBeNull();
    expect(route.model?.provider).toBe("litellm");
  });

  it("lp-uxy.12: manual tiers pin LiteLLM model_name entries", () => {
    for (const [selection, modelId] of [
      ["simple", "lanyard-simple"],
      ["moderate", "lanyard-moderate"],
      ["complex", "lanyard-complex"],
    ] as const) {
      const route = resolveModelRoute({
        selection,
        text: "anything",
        models: litellmModels,
      });
      expect(route.routingSource).toBe("litellm");
      expect(route.isAuto).toBe(false);
      expect(route.modelId).toBe(modelId);
      expect(route.effectiveTier).toBe(selection);
    }
  });

  it("falls back to client heuristic when LiteLLM router models missing", () => {
    const route = resolveModelRoute({
      selection: "auto",
      text: "hi",
      models,
      activeModelId: "grok-3",
    });
    expect(route.isAuto).toBe(true);
    expect(route.routingSource).toBe("client_fallback");
    expect(route.effectiveTier).toBe("simple");
    expect(route.modelId).toBe("claude-haiku-4");
  });

  it("resolves manual Complex via client fallback without classifier", () => {
    const route = resolveModelRoute({
      selection: "complex",
      text: "hi",
      models,
    });
    expect(route.isAuto).toBe(false);
    expect(route.routingSource).toBe("client_fallback");
    expect(route.effectiveTier).toBe("complex");
    expect(route.modelId).toBe("xai/grok-build-0.1");
  });
});

describe("labelForSelection", () => {
  it("shows Auto and Auto · tier when known", () => {
    expect(labelForSelection("auto")).toBe("Auto");
    expect(labelForSelection("auto", "simple")).toBe("Auto · Simple");
    expect(labelForSelection("moderate")).toBe("Moderate");
  });
});

describe("resolveEffectiveTier", () => {
  it("passes through manual tiers", () => {
    expect(resolveEffectiveTier("complex", "hi")).toBe("complex");
  });
});

describe("storage helpers", () => {
  it("reads and writes selection + per-thread overrides", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    };

    writeModelIntelligenceState(
      withSelectionUpdate(
        { selection: "auto" },
        "complex",
        "thread-a",
      ),
      storage,
    );
    const loaded = readModelIntelligenceState(storage);
    expect(loaded.selection).toBe("complex");
    expect(selectionForThread(loaded, "thread-a")).toBe("complex");
    expect(selectionForThread(loaded, "thread-b")).toBe("complex");
    expect(mem.get(MODEL_INTELLIGENCE_STORAGE_KEY)).toBeTruthy();

    const withTier = withEffectiveTierUpdate(loaded, "simple");
    expect(withTier.lastEffectiveTier).toBe("simple");
  });
});

describe("modelIntelligenceGate", () => {
  it("stays visible when supported even without catalog yet", () => {
    expect(
      modelIntelligenceGate({
        modelEditSupported: true,
        hasModels: false,
      }),
    ).toEqual({ visible: true, interactive: true });
  });

  it("is optimistic when support is unknown", () => {
    expect(
      modelIntelligenceGate({
        modelEditSupported: null,
        hasModels: false,
      }),
    ).toEqual({ visible: true, interactive: true });
  });

  it("hides when unsupported and no models", () => {
    expect(
      modelIntelligenceGate({
        modelEditSupported: false,
        hasModels: false,
      }),
    ).toEqual({ visible: false, interactive: false });
  });

  it("disables with reason when unsupported", () => {
    const gate = modelIntelligenceGate({
      modelEditSupported: false,
      hasModels: true,
    });
    expect(gate.visible).toBe(true);
    expect(gate.interactive).toBe(false);
    expect(gate.disabledReason).toMatch(/not supported/i);
  });
});
