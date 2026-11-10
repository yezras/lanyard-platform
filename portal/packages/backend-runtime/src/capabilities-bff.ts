/**
 * Thin BFF adapter: backend capabilities → portal context + UI state.
 *
 * Bead: `lp-k7g.8.5` — model backend capabilities in BFF responses.
 *
 * ## Production path
 *
 * ```text
 * GET /api/context  →  getPortalContext(service, ctx)
 *                      → BackendRuntimeService.capabilities
 *                      → brain.capabilities (live) or artifact/static fallback
 *                      → normalize + derive ui_affordances
 *                      → PortalContextHttpBody { backend_capabilities, ui, … }
 * ```
 *
 * Web must derive affordances / feature gates from this payload — never from
 * `backend_kind` string compares or Hermes-specific flags.
 *
 * ## Graceful degradation
 *
 * Missing live discovery, host errors, or malformed descriptors must **not**
 * crash the context request. The BFF always returns HTTP 200 with a usable
 * descriptor (static defaults) and marks `capabilities_degraded: true`.
 *
 * Route handlers still map unexpected programming errors via
 * {@link contextErrorToHttp}, but {@link getPortalContext} itself never throws
 * for discovery failures.
 *
 * ## Real portal import (current paths)
 *
 * Reference tree (monorepo `portal/`):
 * - Routes: `portal/packages/bff/src/app.ts` (`GET /context`)
 * - Web: `portal/packages/web/src/api/context.ts` + UI gate helpers
 * - Contract: `contracts/backend-runtime-v1/capabilities.schema.json`
 *   (`x-lanyard-ui-affordance-catalog`, derivation rules)
 *
 * Wire `createContextHandlers(backendRuntime)` and have web load context once
 * (session bootstrap) to drive nav/settings/projects gates.
 */

import { BackendRuntimeError, backendRuntimeErrorToHttpStatus } from "./errors.js";
import {
  defaultHermesLanyardCapabilities,
  REQUIRED_BRAIN_RPC_METHODS,
} from "./capability-defaults.js";
import type { BackendRuntimeService } from "./service.js";
import type {
  BackendCapabilitySet,
  BackendKind,
  BackendRuntimeContext,
  UiAffordanceState,
} from "./types.js";

/** Brain RPC method for live capability discovery. */
export const BRAIN_CAPABILITIES_METHOD = "brain.capabilities" as const;

// ---------------------------------------------------------------------------
// Catalog constants (mirror capabilities.schema.json x-lanyard-* catalogs)
// ---------------------------------------------------------------------------

/** v1 Portal UI affordance ids from x-lanyard-ui-affordance-catalog. */
export const UI_AFFORDANCE_NAMES = [
  "chat_panel",
  "vault_browser",
  "vault_editor",
  "settings_page",
  "settings_editor",
  "project_picker",
  "project_create",
  "model_selector",
  "cron_manager",
  "host_health",
] as const;

export type UiAffordanceName = (typeof UI_AFFORDANCE_NAMES)[number];

/** v1 feature flag names from x-lanyard-feature-catalog. */
export const FEATURE_FLAG_NAMES = [
  "chat",
  "health",
  "capabilities_discovery",
  "vault_read",
  "vault_write",
  "settings_snapshot",
  "settings_patch",
  "projects_list",
  "projects_create",
  "models",
  "cron",
  "history_read",
  "heads_read",
] as const;

export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number];

/**
 * Affordance → feature/method requirements
 * (capabilities.schema.json x-lanyard-ui-affordance-catalog).
 */
export type UiAffordanceRequirement = {
  requires_features_all_of: readonly FeatureFlagName[];
  requires_methods_all_of: readonly string[];
  /** When non-empty, at least one method must be listed. */
  requires_methods_any_of: readonly string[];
  /** Operator-safe empty-state copy for unsupported. */
  unsupported_ui: string;
};

export const UI_AFFORDANCE_CATALOG: Record<
  UiAffordanceName,
  UiAffordanceRequirement
> = {
  chat_panel: {
    requires_features_all_of: ["chat"],
    requires_methods_all_of: [],
    requires_methods_any_of: [],
    unsupported_ui:
      "Show chat unavailable empty state; disable send; do not open relay chat session for host ops assumptions",
  },
  vault_browser: {
    requires_features_all_of: ["vault_read"],
    requires_methods_all_of: ["vault.list", "vault.stat", "vault.read"],
    requires_methods_any_of: [],
    unsupported_ui:
      "Hide vault nav entry or show Vault unavailable; never invoke vault.* RPC",
  },
  vault_editor: {
    requires_features_all_of: ["vault_write"],
    requires_methods_all_of: ["vault.write"],
    requires_methods_any_of: [],
    unsupported_ui:
      "Read-only vault: hide save/create controls; optional tooltip that host does not support vault write",
  },
  settings_page: {
    requires_features_all_of: ["settings_snapshot"],
    requires_methods_all_of: ["settings.snapshot"],
    requires_methods_any_of: [],
    unsupported_ui:
      "Settings page shows Backend settings unavailable; no local Hermes-home fallback",
  },
  settings_editor: {
    requires_features_all_of: ["settings_patch"],
    requires_methods_all_of: ["settings.patch"],
    requires_methods_any_of: [],
    unsupported_ui:
      "Show read-only settings; disable Save; do not call settings.patch",
  },
  project_picker: {
    requires_features_all_of: ["projects_list"],
    requires_methods_all_of: ["projects.list"],
    requires_methods_any_of: [],
    unsupported_ui:
      "Empty project list with Host projects unavailable; no filesystem scrape of Hermes projects",
  },
  project_create: {
    requires_features_all_of: ["projects_create"],
    requires_methods_all_of: ["projects.create"],
    requires_methods_any_of: [],
    unsupported_ui: "Hide or disable Create project",
  },
  model_selector: {
    requires_features_all_of: ["models"],
    requires_methods_all_of: [],
    requires_methods_any_of: ["models.list", "models.set_active"],
    unsupported_ui:
      "Hide model selector section or show Models not supported by this backend",
  },
  cron_manager: {
    requires_features_all_of: ["cron"],
    requires_methods_all_of: [],
    requires_methods_any_of: ["cron.list", "cron.patch"],
    unsupported_ui:
      "Hide cron section or show Cron not supported by this backend",
  },
  host_health: {
    requires_features_all_of: ["health"],
    requires_methods_all_of: ["brain.health"],
    requires_methods_any_of: [],
    unsupported_ui:
      "Show health unknown; degrade pilot gates rather than assume ok",
  },
};

// ---------------------------------------------------------------------------
// HTTP / UI types
// ---------------------------------------------------------------------------

/**
 * Convenience booleans for web UI gates.
 * Derived only from `ui_affordances` (supported → true; degraded/unsupported → false).
 * Degraded surfaces stay visible but disabled at the affordance layer; `can.*`
 * is the "full write/use" gate (supported only).
 */
export type PortalUiCanFlags = {
  chat: boolean;
  vault_browse: boolean;
  vault_edit: boolean;
  settings_view: boolean;
  settings_edit: boolean;
  project_list: boolean;
  project_create: boolean;
  model_select: boolean;
  cron_manage: boolean;
  host_health: boolean;
};

/**
 * UI state derived from backend capabilities (no backend-kind conditionals).
 * Web stores this on session/bootstrap and drives nav + feature panels.
 */
export type PortalUiState = {
  /** Complete map for every catalogued affordance. */
  affordances: Record<UiAffordanceName, UiAffordanceState>;
  /**
   * Full-support gates (affordance === "supported").
   * Use `affordances` when you need to distinguish degraded vs unsupported.
   */
  can: PortalUiCanFlags;
  /**
   * Surfaces that are present but limited (affordance === "degraded").
   * Keys are affordance names that are currently degraded.
   */
  degraded: UiAffordanceName[];
  /**
   * Surfaces that must render empty/disabled states (unsupported).
   */
  unsupported: UiAffordanceName[];
};

/**
 * HTTP JSON body for GET /api/context (or equivalent session bootstrap).
 * Always safe for web consumption; never requires backend_kind branches.
 */
export type PortalContextHttpBody = {
  /**
   * Normalized backend capability descriptor
   * (capabilities.schema.json capabilityDescriptor).
   * Always includes complete `ui_affordances` for the v1 catalog.
   */
  backend_capabilities: BackendCapabilitySet;
  /** Pre-derived UI state for web affordance gating. */
  ui: PortalUiState;
  /**
   * Discovery source tag (mirrors descriptor.source; always set on wire).
   */
  capabilities_source:
    | "brain_rpc"
    | "artifact_manifest"
    | "combined"
    | "static_default";
  /**
   * True when live discovery failed or the descriptor was repaired from
   * static defaults — UI may show a soft notice but must not crash.
   */
  capabilities_degraded: boolean;
  /** Operator-safe note when degraded or partial. */
  capabilities_notes?: string;
};

/** Structured HTTP error body for context routes (rare; discovery soft-fails). */
export type ContextHttpErrorBody = {
  error: string;
  code: string;
  retryable?: boolean;
  unavailable?: boolean;
  method?: string;
};

export type GetPortalContextOptions = {
  /**
   * Static fallback when `service.capabilities` throws or returns unusable data.
   * Defaults to Hermes-Lanyard v1 required set.
   */
  fallbackCapabilities?: BackendCapabilitySet;
  /**
   * When true (default), ensure every catalogued ui_affordance is present by
   * deriving missing ones from features + brain_rpc_methods.
   */
  ensureUiAffordances?: boolean;
};

// ---------------------------------------------------------------------------
// Derivation (capabilities.schema.json x-lanyard-ui-affordance-catalog.derivation)
// ---------------------------------------------------------------------------

/**
 * Derive a single affordance state from features + methods.
 * Rules: supported only when all required features are true AND all required
 * methods are listed AND (if any_of non-empty) at least one any_of method is
 * listed. Otherwise unsupported. Degraded is never invented here.
 */
export function deriveUiAffordanceState(
  name: UiAffordanceName,
  caps: {
    features?: Record<string, boolean>;
    brain_rpc_methods?: string[];
  },
): UiAffordanceState {
  const req = UI_AFFORDANCE_CATALOG[name];
  const features = caps.features ?? {};
  const methods = new Set(caps.brain_rpc_methods ?? []);

  for (const flag of req.requires_features_all_of) {
    if (features[flag] !== true) return "unsupported";
  }
  for (const method of req.requires_methods_all_of) {
    if (!methods.has(method)) return "unsupported";
  }
  if (req.requires_methods_any_of.length > 0) {
    const anyHit = req.requires_methods_any_of.some((m) => methods.has(m));
    if (!anyHit) return "unsupported";
  }
  return "supported";
}

/**
 * Build a complete affordances map.
 * Explicit host-asserted states win; missing keys are derived.
 * Host may assert "degraded"; derivation never invents degraded.
 */
export function deriveUiAffordances(caps: {
  features?: Record<string, boolean>;
  brain_rpc_methods?: string[];
  ui_affordances?: Record<string, UiAffordanceState | string>;
}): Record<UiAffordanceName, UiAffordanceState> {
  const out = {} as Record<UiAffordanceName, UiAffordanceState>;
  const explicit = caps.ui_affordances ?? {};

  for (const name of UI_AFFORDANCE_NAMES) {
    const raw = explicit[name];
    if (raw === "supported" || raw === "unsupported" || raw === "degraded") {
      out[name] = raw;
    } else {
      out[name] = deriveUiAffordanceState(name, caps);
    }
  }
  return out;
}

/**
 * Map affordances → PortalUiState (can / degraded / unsupported lists).
 */
export function uiStateFromAffordances(
  affordances: Record<UiAffordanceName, UiAffordanceState>,
): PortalUiState {
  const degraded: UiAffordanceName[] = [];
  const unsupported: UiAffordanceName[] = [];
  for (const name of UI_AFFORDANCE_NAMES) {
    if (affordances[name] === "degraded") degraded.push(name);
    if (affordances[name] === "unsupported") unsupported.push(name);
  }
  const is = (name: UiAffordanceName) => affordances[name] === "supported";
  return {
    affordances,
    can: {
      chat: is("chat_panel"),
      vault_browse: is("vault_browser"),
      vault_edit: is("vault_editor"),
      settings_view: is("settings_page"),
      settings_edit: is("settings_editor"),
      project_list: is("project_picker"),
      project_create: is("project_create"),
      model_select: is("model_selector"),
      cron_manage: is("cron_manager"),
      host_health: is("host_health"),
    },
    degraded,
    unsupported,
  };
}

/**
 * Convenience: derive UI state directly from a capability set.
 */
export function uiStateFromCapabilities(
  caps: BackendCapabilitySet | {
    features?: Record<string, boolean>;
    brain_rpc_methods?: string[];
    ui_affordances?: Record<string, UiAffordanceState | string>;
  },
): PortalUiState {
  return uiStateFromAffordances(deriveUiAffordances(caps));
}

/** Whether an affordance is fully usable (supported). */
export function isAffordanceSupported(
  ui: PortalUiState | Record<UiAffordanceName, UiAffordanceState>,
  name: UiAffordanceName,
): boolean {
  const affordances =
    "affordances" in ui && ui.affordances
      ? ui.affordances
      : (ui as Record<UiAffordanceName, UiAffordanceState>);
  return affordances[name] === "supported";
}

/** Whether an affordance should render empty/disabled (unsupported). */
export function isAffordanceUnsupported(
  ui: PortalUiState | Record<UiAffordanceName, UiAffordanceState>,
  name: UiAffordanceName,
): boolean {
  const affordances =
    "affordances" in ui && ui.affordances
      ? ui.affordances
      : (ui as Record<UiAffordanceName, UiAffordanceState>);
  return affordances[name] === "unsupported";
}

// ---------------------------------------------------------------------------
// Descriptor normalization
// ---------------------------------------------------------------------------

const KNOWN_KINDS = new Set<BackendKind>([
  "hermes_upstream",
  "hermes_lanyard",
  "lanyard_agent",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize an arbitrary capability payload into BackendCapabilitySet.
 * Fills missing required fields from fallback; never throws.
 */
export function normalizeCapabilityDescriptor(
  raw: unknown,
  fallback: BackendCapabilitySet = defaultHermesLanyardCapabilities(),
): {
  capabilities: BackendCapabilitySet;
  repaired: boolean;
  notes?: string;
} {
  if (!isRecord(raw)) {
    return {
      capabilities: {
        ...fallback,
        source: fallback.source ?? "static_default",
        schema_version: 1,
      },
      repaired: true,
      notes: "capability descriptor was not an object; using static fallback",
    };
  }

  let repaired = false;
  const notes: string[] = [];

  const brain_rpc_methods = Array.isArray(raw.brain_rpc_methods)
    ? raw.brain_rpc_methods.filter(
        (m): m is string => typeof m === "string" && m.length > 0,
      )
    : [...(fallback.brain_rpc_methods ?? REQUIRED_BRAIN_RPC_METHODS)];
  if (!Array.isArray(raw.brain_rpc_methods) || brain_rpc_methods.length === 0) {
    repaired = true;
    notes.push("brain_rpc_methods missing or empty; filled from fallback");
    if (brain_rpc_methods.length === 0) {
      brain_rpc_methods.push(...REQUIRED_BRAIN_RPC_METHODS);
    }
  }

  let features: Record<string, boolean>;
  if (isRecord(raw.features)) {
    features = {};
    for (const [k, v] of Object.entries(raw.features)) {
      if (typeof v === "boolean") features[k] = v;
    }
  } else {
    features = { ...(fallback.features ?? {}) };
    repaired = true;
    notes.push("features missing; filled from fallback");
  }

  // Ensure catalog flags exist as booleans (missing = false for gating).
  for (const flag of FEATURE_FLAG_NAMES) {
    if (typeof features[flag] !== "boolean") {
      // Prefer method-list inference for required v1 methods when flag absent.
      if (flag === "vault_read") {
        features[flag] =
          brain_rpc_methods.includes("vault.list") &&
          brain_rpc_methods.includes("vault.stat") &&
          brain_rpc_methods.includes("vault.read");
      } else if (flag === "settings_snapshot") {
        features[flag] = brain_rpc_methods.includes("settings.snapshot");
      } else if (flag === "projects_list") {
        features[flag] = brain_rpc_methods.includes("projects.list");
      } else if (flag === "health") {
        features[flag] = brain_rpc_methods.includes("brain.health");
      } else if (flag === "capabilities_discovery") {
        features[flag] = brain_rpc_methods.includes(BRAIN_CAPABILITIES_METHOD);
      } else if (flag === "settings_patch") {
        features[flag] = brain_rpc_methods.includes("settings.patch");
      } else if (flag === "projects_create") {
        features[flag] = brain_rpc_methods.includes("projects.create");
      } else if (flag === "vault_write") {
        features[flag] = brain_rpc_methods.includes("vault.write");
      } else if (flag === "history_read") {
        features[flag] = brain_rpc_methods.includes("history.list");
      } else if (flag === "heads_read") {
        features[flag] =
          brain_rpc_methods.includes("heads.artifact") ||
          brain_rpc_methods.includes("heads.workspace");
      } else if (flag === "models") {
        features[flag] =
          brain_rpc_methods.includes("models.list") ||
          brain_rpc_methods.includes("models.set_active");
      } else if (flag === "cron") {
        features[flag] =
          brain_rpc_methods.includes("cron.list") ||
          brain_rpc_methods.includes("cron.patch");
      } else if (flag === "chat") {
        features[flag] = fallback.features?.chat === true;
      } else {
        features[flag] = false;
      }
      repaired = true;
    }
  }

  let kind: BackendKind | undefined;
  if (typeof raw.kind === "string" && KNOWN_KINDS.has(raw.kind as BackendKind)) {
    kind = raw.kind as BackendKind;
  } else if (fallback.kind) {
    kind = fallback.kind;
  }

  let source: BackendCapabilitySet["source"];
  if (
    raw.source === "brain_rpc" ||
    raw.source === "artifact_manifest" ||
    raw.source === "combined" ||
    raw.source === "static_default"
  ) {
    source = raw.source;
  } else {
    source = fallback.source ?? "static_default";
    if (raw.source !== undefined) repaired = true;
  }

  const profiles = Array.isArray(raw.profiles)
    ? raw.profiles.filter((p): p is string => typeof p === "string" && p.length > 0)
    : fallback.profiles
      ? [...fallback.profiles]
      : undefined;

  let contract = fallback.contract;
  if (isRecord(raw.contract)) {
    const rl = raw.contract.runtime_layout;
    const relay = raw.contract.relay;
    const br = raw.contract.brain_rpc;
    if (
      typeof rl === "number" &&
      typeof relay === "number" &&
      typeof br === "number"
    ) {
      contract = {
        runtime_layout: rl,
        relay,
        brain_rpc: br,
      };
    }
  }

  let limits = fallback.limits;
  if (isRecord(raw.limits)) {
    limits = {};
    for (const [k, v] of Object.entries(raw.limits)) {
      if (typeof v === "number" && Number.isFinite(v)) limits[k] = v;
    }
  }

  let ui_affordances: Record<string, UiAffordanceState> | undefined;
  if (isRecord(raw.ui_affordances)) {
    ui_affordances = {};
    for (const [k, v] of Object.entries(raw.ui_affordances)) {
      if (v === "supported" || v === "unsupported" || v === "degraded") {
        ui_affordances[k] = v;
      }
    }
  }

  const version =
    typeof raw.version === "string" && raw.version.length > 0
      ? raw.version
      : fallback.version;

  const hostNotes =
    typeof raw.notes === "string" && raw.notes.length > 0
      ? raw.notes
      : undefined;

  const capabilities: BackendCapabilitySet = {
    schema_version: 1,
    source,
    kind,
    version,
    contract,
    profiles,
    brain_rpc_methods: [...new Set(brain_rpc_methods)],
    features,
    ui_affordances,
    limits,
    notes: hostNotes,
  };

  return {
    capabilities,
    repaired,
    notes: notes.length > 0 ? notes.join("; ") : undefined,
  };
}

/**
 * Ensure descriptor has complete ui_affordances (explicit + derived).
 */
export function withDerivedUiAffordances(
  caps: BackendCapabilitySet,
): BackendCapabilitySet {
  const affordances = deriveUiAffordances(caps);
  return {
    ...caps,
    schema_version: 1,
    ui_affordances: affordances,
  };
}

// ---------------------------------------------------------------------------
// Context BFF entrypoints
// ---------------------------------------------------------------------------

function buildContextBody(
  caps: BackendCapabilitySet,
  options: {
    degraded: boolean;
    notes?: string;
  },
): PortalContextHttpBody {
  const withUi = withDerivedUiAffordances(caps);
  const ui = uiStateFromAffordances(
    withUi.ui_affordances as Record<UiAffordanceName, UiAffordanceState>,
  );
  const source =
    withUi.source === "brain_rpc" ||
    withUi.source === "artifact_manifest" ||
    withUi.source === "combined" ||
    withUi.source === "static_default"
      ? withUi.source
      : "static_default";

  const notesParts = [withUi.notes, options.notes].filter(
    (n): n is string => typeof n === "string" && n.length > 0,
  );

  return {
    backend_capabilities: withUi,
    ui,
    capabilities_source: source,
    capabilities_degraded: options.degraded,
    ...(notesParts.length > 0
      ? { capabilities_notes: notesParts.join("; ") }
      : {}),
  };
}

/**
 * Load portal context (capabilities + UI state) for GET /api/context.
 *
 * **Never throws** for discovery failures or bad descriptors — returns a
 * degraded payload with static defaults so web bootstrap cannot crash.
 */
export async function getPortalContext(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  options: GetPortalContextOptions = {},
): Promise<PortalContextHttpBody> {
  const fallback =
    options.fallbackCapabilities ?? defaultHermesLanyardCapabilities();
  const ensureUi = options.ensureUiAffordances !== false;

  try {
    const raw = await service.capabilities(ctx);
    const { capabilities, repaired, notes } = normalizeCapabilityDescriptor(
      raw,
      fallback,
    );
    const finalCaps = ensureUi
      ? withDerivedUiAffordances(capabilities)
      : capabilities;
    const sourceIsFallback =
      finalCaps.source === "artifact_manifest" ||
      finalCaps.source === "static_default";
    return buildContextBody(finalCaps, {
      degraded: repaired || sourceIsFallback,
      notes,
    });
  } catch (err) {
    // Discovery failure must not crash context.
    const message =
      err instanceof BackendRuntimeError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : "unknown capabilities error";
    const fallbackCaps = ensureUi
      ? withDerivedUiAffordances({
          ...fallback,
          source: "static_default",
          notes:
            fallback.notes ??
            `brain.capabilities failed (${message}); using static fallback`,
        })
      : {
          ...fallback,
          source: "static_default" as const,
          notes:
            fallback.notes ??
            `brain.capabilities failed (${message}); using static fallback`,
        };
    return buildContextBody(fallbackCaps, {
      degraded: true,
      notes: `capabilities discovery failed: ${message}`,
    });
  }
}

/**
 * Load only the capability set (normalized + UI affordances), same soft-fail.
 * Prefer {@link getPortalContext} for web bootstrap.
 */
export async function getBackendCapabilities(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  options: GetPortalContextOptions = {},
): Promise<BackendCapabilitySet> {
  const body = await getPortalContext(service, ctx, options);
  return body.backend_capabilities;
}

/**
 * Map a programming/route error to HTTP. Discovery soft-fails inside
 * getPortalContext; this is for invalid session context construction etc.
 */
export function contextErrorToHttp(err: unknown): {
  status: number;
  body: ContextHttpErrorBody;
} {
  if (err instanceof BackendRuntimeError) {
    const unavailable =
      err.code === "method_not_found" ||
      err.code === "unavailable" ||
      err.code === "not_implemented";
    const method =
      typeof err.details?.method === "string" ? err.details.method : undefined;
    return {
      status: backendRuntimeErrorToHttpStatus(err.code),
      body: {
        error: err.message,
        code: String(err.code),
        retryable: err.retryable,
        ...(unavailable ? { unavailable: true as const } : {}),
        ...(method ? { method } : {}),
      },
    };
  }
  const message =
    err instanceof Error ? err.message : "Internal context route error";
  return {
    status: 500,
    body: { error: message, code: "internal", retryable: true },
  };
}

/**
 * Handler bundle for BFF route modules after Portal import.
 *
 * ```ts
 * const context = createContextHandlers(backendRuntime);
 * api.get("/context", async (c) => {
 *   const ctx = backendContextFromSession(...);
 *   return c.json(await context.get(ctx)); // always 200 for discovery soft-fail
 * });
 * ```
 */
export function createContextHandlers(
  service: BackendRuntimeService,
  defaults: GetPortalContextOptions = {},
): {
  get: (
    ctx: BackendRuntimeContext,
    options?: GetPortalContextOptions,
  ) => Promise<PortalContextHttpBody>;
  capabilities: (
    ctx: BackendRuntimeContext,
    options?: GetPortalContextOptions,
  ) => Promise<BackendCapabilitySet>;
} {
  return {
    get: (ctx, options) =>
      getPortalContext(service, ctx, { ...defaults, ...options }),
    capabilities: (ctx, options) =>
      getBackendCapabilities(service, ctx, { ...defaults, ...options }),
  };
}
