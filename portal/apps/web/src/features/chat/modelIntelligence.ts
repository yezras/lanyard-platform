/**
 * Composer model intelligence tiers + Auto routing (lp-uxy.8 / lp-uxy.12).
 *
 * Preferred path (lp-uxy.12): map Auto|Simple|Moderate|Complex → LiteLLM
 * model_name ids (`lanyard-auto` auto_router + tier pins). Client heuristic
 * is offline fallback only when those models are absent from the catalog.
 * Host execution uses global active model (`model.set_active`) until
 * per-request model exists; see ADR 0007.
 */

import type { SettingsModel } from "../../api/types.js";

/** User-facing intelligence selection (includes Auto). */
export type ModelIntelligenceSelection =
  | "auto"
  | "simple"
  | "moderate"
  | "complex";

/** Concrete routing tier after Auto is resolved (client fallback path). */
export type ModelIntelligenceTier = "simple" | "moderate" | "complex";

/**
 * Where the route model id came from.
 * - litellm: catalog has deploy LiteLLM intelligence model_name (SoT)
 * - client_fallback: router models missing; client heuristic + catalog match
 */
export type ModelRoutingSource = "litellm" | "client_fallback";

export type ModelIntelligenceOption = {
  id: ModelIntelligenceSelection;
  label: string;
  description: string;
};

export const MODEL_INTELLIGENCE_OPTIONS: readonly ModelIntelligenceOption[] = [
  {
    id: "auto",
    label: "Auto",
    description: "LiteLLM auto_router by message complexity",
  },
  {
    id: "simple",
    label: "Simple",
    description: "Faster / lighter model (lanyard-simple)",
  },
  {
    id: "moderate",
    label: "Moderate",
    description: "Balanced default model (lanyard-moderate)",
  },
  {
    id: "complex",
    label: "Complex",
    description: "Stronger model for hard tasks (lanyard-complex)",
  },
] as const;

export const DEFAULT_MODEL_INTELLIGENCE: ModelIntelligenceSelection = "auto";

/**
 * Deploy LiteLLM `model_name` defaults (deploy/litellm/config.yaml).
 * Auto uses complexity_router; manual tiers pin the matching model_name.
 */
export const DEFAULT_LITELLM_INTELLIGENCE_MODELS: Readonly<
  Record<ModelIntelligenceSelection, string>
> = {
  auto: "lanyard-auto",
  simple: "lanyard-simple",
  moderate: "lanyard-moderate",
  complex: "lanyard-complex",
} as const;

/** localStorage key for user + per-thread selection. */
export const MODEL_INTELLIGENCE_STORAGE_KEY =
  "lanyard.portal.modelIntelligence.v1";

export type ModelIntelligenceStoredState = {
  selection: ModelIntelligenceSelection;
  /** Last Auto-resolved tier (client fallback indicator only). */
  lastEffectiveTier?: ModelIntelligenceTier;
  byThread?: Record<string, ModelIntelligenceSelection>;
};

/** Explicit selection → model id overrides (Settings / deploy pin). */
export type ModelIntelligenceModelMap = Partial<
  Record<ModelIntelligenceSelection, string>
>;

/** @deprecated Use ModelIntelligenceModelMap; tier-only map for fallback. */
export type ModelTierModelMap = Partial<
  Record<ModelIntelligenceTier, string>
>;

const SIMPLE_NAME =
  /(?:^|[/_.-])(mini|fast|lite|flash|haiku|small|nano|instant|turbo)(?:$|[/_.-])/i;
const COMPLEX_NAME =
  /(?:^|[/_.-])(opus|pro|build|reasoning|o1|o3|ultra|max|heavy|thinking)(?:$|[/_.-])/i;
const MODERATE_NAME =
  /(?:^|[/_.-])(sonnet|balanced|grok-3|gpt-4o|gpt-4\.1|default|medium)(?:$|[/_.-])/i;

const COMPLEX_TEXT =
  /\b(architect|architecture|refactor|multi[- ]?step|design system|migrate|migration|security audit|implement\b|debug|root cause|end[- ]to[- ]end|production incident)\b/i;
const SIMPLE_TEXT =
  /\b(summarize|summary|translate|format|typo|rename|rephrase|shorten|eli5|bullet)\b/i;
const GREETING_TEXT =
  /^(hi|hello|hey|thanks|thank you|yes|no|ok|okay|sure|yep|nope)[\s!.?]*$/i;

export function isModelIntelligenceSelection(
  value: unknown,
): value is ModelIntelligenceSelection {
  return (
    value === "auto" ||
    value === "simple" ||
    value === "moderate" ||
    value === "complex"
  );
}

export function labelForSelection(
  selection: ModelIntelligenceSelection,
  effectiveTier?: ModelIntelligenceTier | null,
): string {
  if (selection === "auto") {
    if (effectiveTier) {
      const tierLabel =
        MODEL_INTELLIGENCE_OPTIONS.find((o) => o.id === effectiveTier)
          ?.label ?? effectiveTier;
      return `Auto · ${tierLabel}`;
    }
    return "Auto";
  }
  return (
    MODEL_INTELLIGENCE_OPTIONS.find((o) => o.id === selection)?.label ??
    selection
  );
}

/**
 * Client-side heuristic for Auto — offline fallback only when LiteLLM
 * `lanyard-auto` (or override) is not in the settings catalog. Never throws;
 * empty → moderate. Prefer LiteLLM complexity_router in production.
 */
export function classifyMessageComplexity(
  text: string,
): ModelIntelligenceTier {
  const trimmed = text.trim();
  if (!trimmed) {
    return "moderate";
  }
  if (COMPLEX_TEXT.test(trimmed) || trimmed.length > 800) {
    return "complex";
  }
  if (GREETING_TEXT.test(trimmed)) {
    return "simple";
  }
  if (SIMPLE_TEXT.test(trimmed) && trimmed.length < 400) {
    return "simple";
  }
  if (trimmed.length < 60) {
    return "simple";
  }
  if (trimmed.length > 400) {
    return "complex";
  }
  return "moderate";
}

export function resolveEffectiveTier(
  selection: ModelIntelligenceSelection,
  text: string,
): ModelIntelligenceTier {
  if (selection === "auto") {
    return classifyMessageComplexity(text);
  }
  return selection;
}

function modelId(model: SettingsModel): string {
  return model.model.trim();
}

function modelIdsEqual(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

/**
 * Resolve the LiteLLM model_name for a composer selection.
 */
export function litellmModelNameForSelection(
  selection: ModelIntelligenceSelection,
  map?: ModelIntelligenceModelMap | null,
): string {
  const override = map?.[selection]?.trim();
  if (override) return override;
  return DEFAULT_LITELLM_INTELLIGENCE_MODELS[selection];
}

/**
 * Find a catalog entry matching a LiteLLM intelligence model_name.
 * Prefers provider `litellm` when multiple entries share the same model id.
 */
export function findCatalogModelById(
  models: SettingsModel[] | null | undefined,
  modelName: string,
): SettingsModel | null {
  const want = modelName.trim();
  if (!want) return null;
  const list = (models ?? []).filter((m) => m.model?.trim());
  const matches = list.filter((m) => modelIdsEqual(modelId(m), want));
  if (matches.length === 0) return null;
  return (
    matches.find((m) => m.provider === "litellm") ??
    matches.find((m) => m.connected !== false) ??
    matches[0] ??
    null
  );
}

/**
 * True when the catalog exposes the LiteLLM auto_router model (default
 * `lanyard-auto`). Manual tier pins alone do not count as "router online".
 */
export function hasLiteLlmIntelligenceRouter(
  models: SettingsModel[] | null | undefined,
  map?: ModelIntelligenceModelMap | null,
): boolean {
  const autoName = litellmModelNameForSelection("auto", map);
  return findCatalogModelById(models, autoName) !== null;
}

/**
 * Prefer LiteLLM intelligence model_name for this selection when present
 * in the catalog. Manual tiers require their pin; Auto requires the router.
 */
export function resolveLiteLlmIntelligenceModel(
  selection: ModelIntelligenceSelection,
  models: SettingsModel[] | null | undefined,
  map?: ModelIntelligenceModelMap | null,
): SettingsModel | null {
  const name = litellmModelNameForSelection(selection, map);
  return findCatalogModelById(models, name);
}

function scoreModelForTier(
  model: SettingsModel,
  tier: ModelIntelligenceTier,
): number {
  const name = modelId(model);
  let score = 0;
  if (tier === "simple") {
    if (SIMPLE_NAME.test(name)) score += 10;
    if (COMPLEX_NAME.test(name)) score -= 5;
    if (MODERATE_NAME.test(name)) score += 1;
  } else if (tier === "complex") {
    if (COMPLEX_NAME.test(name)) score += 10;
    if (SIMPLE_NAME.test(name)) score -= 5;
    if (MODERATE_NAME.test(name)) score += 1;
  } else {
    if (MODERATE_NAME.test(name)) score += 10;
    if (SIMPLE_NAME.test(name)) score += 2;
    if (COMPLEX_NAME.test(name)) score += 2;
    if (model.is_active) score += 3;
  }
  if (model.connected !== false) score += 1;
  if (model.is_active) score += 1;
  return score;
}

/**
 * Pick the best catalog model for a tier (client fallback path).
 * Prefer explicit overrides, then name heuristics, then active / first model.
 */
export function resolveModelForTier(
  tier: ModelIntelligenceTier,
  models: SettingsModel[] | null | undefined,
  options?: {
    overrides?: ModelTierModelMap | null;
    activeModelId?: string | null;
  },
): SettingsModel | null {
  const list = (models ?? []).filter((m) => m.model?.trim());
  if (list.length === 0) {
    return null;
  }

  const overrideId = options?.overrides?.[tier]?.trim();
  if (overrideId) {
    const hit = list.find(
      (m) => modelId(m) === overrideId || m.model === overrideId,
    );
    if (hit) return hit;
  }

  let best: SettingsModel | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const model of list) {
    const score = scoreModelForTier(model, tier);
    if (score > bestScore) {
      bestScore = score;
      best = model;
    }
  }

  if (best && bestScore > 0) {
    return best;
  }

  const activeId = options?.activeModelId?.trim();
  if (activeId) {
    const active = list.find((m) => modelId(m) === activeId);
    if (active) return active;
  }

  const active = list.find((m) => m.is_active);
  return active ?? list[0] ?? null;
}

export type ResolvedModelRoute = {
  selection: ModelIntelligenceSelection;
  /**
   * Client-resolved tier. Null when Auto uses LiteLLM auto_router (server
   * chooses SIMPLE/MEDIUM/COMPLEX/REASONING; Portal does not re-classify).
   */
  effectiveTier: ModelIntelligenceTier | null;
  model: SettingsModel | null;
  modelId: string | undefined;
  /** True when selection is Auto. */
  isAuto: boolean;
  /** litellm SoT vs client heuristic fallback. */
  routingSource: ModelRoutingSource;
};

export function resolveModelRoute(input: {
  selection: ModelIntelligenceSelection;
  text: string;
  models?: SettingsModel[] | null;
  /** LiteLLM model_name overrides (auto + tiers). */
  intelligenceModelMap?: ModelIntelligenceModelMap | null;
  /** @deprecated tier-only overrides for client fallback path */
  overrides?: ModelTierModelMap | null;
  activeModelId?: string | null;
}): ResolvedModelRoute {
  const isAuto = input.selection === "auto";

  // Preferred: LiteLLM-native model ids when present in the host catalog.
  const litellmModel = resolveLiteLlmIntelligenceModel(
    input.selection,
    input.models,
    input.intelligenceModelMap,
  );
  if (litellmModel) {
    return {
      selection: input.selection,
      // Server-side router owns Auto tier; manual tiers are the pin itself.
      effectiveTier: isAuto ? null : input.selection,
      model: litellmModel,
      modelId: modelId(litellmModel),
      isAuto,
      routingSource: "litellm",
    };
  }

  // Offline / thin catalog: client heuristic + name-based catalog match.
  const effectiveTier = resolveEffectiveTier(input.selection, input.text);
  const model = resolveModelForTier(effectiveTier, input.models, {
    overrides: input.overrides,
    activeModelId: input.activeModelId,
  });
  return {
    selection: input.selection,
    effectiveTier,
    model,
    modelId: model ? modelId(model) : input.activeModelId?.trim() || undefined,
    isAuto,
    routingSource: "client_fallback",
  };
}

export function readModelIntelligenceState(
  storage: Pick<Storage, "getItem"> | null | undefined = typeof localStorage !==
  "undefined"
    ? localStorage
    : null,
): ModelIntelligenceStoredState {
  if (!storage) {
    return { selection: DEFAULT_MODEL_INTELLIGENCE };
  }
  try {
    const raw = storage.getItem(MODEL_INTELLIGENCE_STORAGE_KEY);
    if (!raw) {
      return { selection: DEFAULT_MODEL_INTELLIGENCE };
    }
    const parsed = JSON.parse(raw) as ModelIntelligenceStoredState;
    const selection = isModelIntelligenceSelection(parsed?.selection)
      ? parsed.selection
      : DEFAULT_MODEL_INTELLIGENCE;
    const lastEffectiveTier =
      parsed?.lastEffectiveTier === "simple" ||
      parsed?.lastEffectiveTier === "moderate" ||
      parsed?.lastEffectiveTier === "complex"
        ? parsed.lastEffectiveTier
        : undefined;
    const byThread =
      parsed?.byThread && typeof parsed.byThread === "object"
        ? Object.fromEntries(
            Object.entries(parsed.byThread).filter(([, v]) =>
              isModelIntelligenceSelection(v),
            ),
          )
        : undefined;
    return {
      selection,
      ...(lastEffectiveTier ? { lastEffectiveTier } : {}),
      ...(byThread && Object.keys(byThread).length > 0 ? { byThread } : {}),
    };
  } catch {
    return { selection: DEFAULT_MODEL_INTELLIGENCE };
  }
}

export function writeModelIntelligenceState(
  state: ModelIntelligenceStoredState,
  storage: Pick<Storage, "setItem"> | null | undefined = typeof localStorage !==
  "undefined"
    ? localStorage
    : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(MODEL_INTELLIGENCE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota / private mode — ignore.
  }
}

export function selectionForThread(
  state: ModelIntelligenceStoredState,
  threadId: string | null | undefined,
): ModelIntelligenceSelection {
  if (threadId && state.byThread?.[threadId]) {
    return state.byThread[threadId]!;
  }
  return state.selection;
}

export function withSelectionUpdate(
  state: ModelIntelligenceStoredState,
  selection: ModelIntelligenceSelection,
  threadId?: string | null,
): ModelIntelligenceStoredState {
  const next: ModelIntelligenceStoredState = {
    ...state,
    selection,
  };
  if (threadId) {
    next.byThread = {
      ...(state.byThread ?? {}),
      [threadId]: selection,
    };
  }
  return next;
}

export function withEffectiveTierUpdate(
  state: ModelIntelligenceStoredState,
  tier: ModelIntelligenceTier,
): ModelIntelligenceStoredState {
  return {
    ...state,
    lastEffectiveTier: tier,
  };
}

/**
 * Whether the composer intelligence control should be interactive.
 * Mirrors Settings model edit gate when caps/ui are known; optimistic when null.
 */
export type ModelIntelligenceGate = {
  visible: boolean;
  interactive: boolean;
  disabledReason?: string;
};

export function modelIntelligenceGate(input: {
  modelEditSupported: boolean | null;
  modelEditDegraded?: boolean;
  hasModels: boolean;
}): ModelIntelligenceGate {
  // Unknown caps → optimistic show (Settings does the same), even before
  // the model catalog lands so the composer control is always discoverable.
  if (input.modelEditSupported === null) {
    return { visible: true, interactive: true };
  }
  if (input.modelEditSupported) {
    return { visible: true, interactive: true };
  }
  if (input.modelEditDegraded) {
    return {
      visible: true,
      interactive: false,
      disabledReason: "Model selector is degraded for this host.",
    };
  }
  // Unsupported: hide when there is no inventory; otherwise disable with reason.
  if (!input.hasModels) {
    return { visible: false, interactive: false };
  }
  return {
    visible: true,
    interactive: false,
    disabledReason: "Model selection is not supported by this backend.",
  };
}
