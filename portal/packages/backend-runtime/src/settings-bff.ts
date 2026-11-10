/**
 * Thin BFF adapter: settings routes through {@link BackendRuntimeService}.
 *
 * Bead: `lp-k7g.8.4` — route settings through Brain RPC.
 *
 * ## Production path
 *
 * ```text
 * GET   /api/settings/snapshot              → getSettingsSnapshot(service, ctx)
 *                                             → BackendRuntimeService.settingsSnapshot
 *                                             → Brain RPC settings.snapshot  (required v1)
 *
 * POST  /api/settings/crons                 → createSettingsCron(...)  (lp-jzl.3)
 * PATCH /api/settings/skills/:id            → patchSettingsSkill(...)
 * PATCH /api/settings/crons/:id             → patchSettingsCron(...)  (enabled or full update)
 * PATCH /api/settings/mcp/:name             → patchSettingsMcp(...)
 * PATCH /api/settings/models/active         → patchSettingsActiveModel(...)
 *                                             → capability gate (settings_patch / models / cron)
 *                                             → config.schema validation
 *                                             → BackendRuntimeService.patchSettings?
 *                                             → Brain RPC settings.patch (expansion)
 * ```
 *
 * Route handlers must **not** import `settings-snapshot.ts` /
 * `settings-discover.ts`, open `$HERMES_HOME/config.yaml`, or write
 * `cron/jobs.json` directly. Those stay behind the Hermes migration adapter
 * ports for temporary fallback only — never as the production composition default.
 *
 * ## Local fixtures
 *
 * `FakeBackendRuntimeService` and local Hermes settings ports are
 * **test-only**. Production composition injects `invokeBrainRpc` with
 * `brainRpcPreferred: true` (and preferably `settingsRequireBrainRpc: true`).
 *
 * ## Real portal import (current paths)
 *
 * Reference tree (monorepo `portal/`):
 * - Routes: `portal/packages/bff/src/app.ts` (`GET /settings/snapshot`, PATCH skills/crons/mcp/models)
 * - SoT helpers: `portal/packages/bff/src/settings-snapshot.ts` + `settings-discover.ts`
 * - Web client: `portal/packages/web/src/api/settings.ts`
 * - Settings UI: `portal/packages/web/src/features/settings/*`
 *
 * Prefer `getSettingsSnapshot` / `patchSettingsSkill` etc. and wire composition
 * root via `createProductionHermesBackendRuntimeService({ invokeBrainRpc })`.
 */

import { BackendRuntimeError, backendRuntimeErrorToHttpStatus } from "./errors.js";
import type { BackendRuntimeService } from "./service.js";
import type {
  BackendRuntimeContext,
  SettingsCron,
  SettingsCronSchedule,
  SettingsMcpServer,
  SettingsModel,
  SettingsPatchInput,
  SettingsPatchOp,
  SettingsPatchResult,
  SettingsSkill,
  SettingsSnapshot,
  SettingsSnapshotParams,
} from "./types.js";

/** Brain RPC method names for settings. */
export const SETTINGS_SNAPSHOT_METHOD = "settings.snapshot" as const;
export const SETTINGS_PATCH_METHOD = "settings.patch" as const;
/** Related expansion methods hosts may advertise for model/cron ops. */
export const MODELS_SET_ACTIVE_METHOD = "models.set_active" as const;
export const CRON_PATCH_METHOD = "cron.patch" as const;
export const CRON_CREATE_METHOD = "cron.create" as const;
export const CRON_UPDATE_METHOD = "cron.update" as const;
export const CRON_LIST_METHOD = "cron.list" as const;

/** Max id / name lengths aligned with params_settings_patch. */
export const SETTINGS_PATCH_ID_MAX = 200;
export const SETTINGS_PATCH_MODEL_MAX = 500;
export const SETTINGS_PATCH_PROMPT_MAX = 20_000;
export const SETTINGS_PATCH_SCHEDULE_EXPR_MAX = 200;
export const SETTINGS_PATCH_SCHEDULE_DISPLAY_MAX = 500;
export const SETTINGS_PATCH_TIMEZONE_MAX = 120;
export const SETTINGS_PATCH_SKILLS_MAX = 50;

/**
 * Secret-shaped keys forbidden on settings patch bodies and results.
 * Mirrors config.schema.json `x-lanyard-secret-policy` + settings.snapshot redaction.
 */
const SECRET_KEY_RE =
  /^(api[_-]?key|secret|token|password|passwd|access[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret|auth|authorization|bearer|headers|env|credentials|secrets)$/i;

export type SettingsSnapshotHttpBody = SettingsSnapshot;

export type SettingsSkillPatchHttpBody = {
  skill: SettingsSkill;
  source: string;
};

export type SettingsCronPatchHttpBody = {
  cron: SettingsCron;
  source: string;
};

/** POST /api/settings/crons create response (lp-jzl.3). */
export type SettingsCronCreateHttpBody = SettingsCronPatchHttpBody;

export type SettingsMcpPatchHttpBody = {
  mcp: SettingsMcpServer;
  source: string;
};

export type SettingsModelPatchHttpBody = {
  model: SettingsModel;
  source: string;
};

/**
 * Structured HTTP error body for settings routes.
 * `unavailable: true` when the UI should render a clear unavailable state
 * (method not advertised, host missing, or service method not wired).
 */
export type SettingsHttpErrorBody = {
  error: string;
  code: string;
  retryable?: boolean;
  /** True when the settings surface is unavailable (UI empty/disabled, no crash). */
  unavailable?: boolean;
  method?: string;
};

export type GetSettingsSnapshotOptions = {
  params?: SettingsSnapshotParams;
};

export type PatchSettingsOptions = {
  /**
   * When true (default), refuse patch unless capabilities advertise the op.
   * Contract: define patch before UI uses it — UI must gate too.
   */
  requireCapabilityAdvertisement?: boolean;
};

/**
 * Whether a key name is secret-shaped (must not appear on settings wire).
 */
export function isSettingsSecretField(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

/**
 * Reject secret-shaped keys anywhere in a JSON-like value.
 * Throws {@link BackendRuntimeError} `invalid_argument`.
 */
export function assertNoSettingsSecrets(
  value: unknown,
  path = "$",
): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoSettingsSecrets(item, `${path}[${i}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSettingsSecretField(key)) {
      throw new BackendRuntimeError(
        "invalid_argument",
        `settings payload must not include secret-shaped key ${path}.${key}`,
        { retryable: false, details: { method: SETTINGS_PATCH_METHOD, path: `${path}.${key}` } },
      );
    }
    assertNoSettingsSecrets(child, `${path}.${key}`);
  }
}

function requireNonEmptyString(
  value: unknown,
  field: string,
  max: number,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BackendRuntimeError(
      "invalid_argument",
      `settings.patch requires non-empty ${field}`,
      { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new BackendRuntimeError(
      "invalid_argument",
      `settings.patch ${field} exceeds ${max} characters`,
      { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  return trimmed;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new BackendRuntimeError(
      "invalid_argument",
      `settings.patch requires boolean ${field}`,
      { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  return value;
}

/**
 * Normalize create/update schedule wire into domain shape.
 * Accepts a 5-field expr string or structured { kind, expr, display, timezone }.
 */
export function parseCronScheduleInput(
  value: unknown,
  field = "schedule",
): string | SettingsCronSchedule {
  if (typeof value === "string") {
    const expr = value.trim();
    if (!expr) {
      throw new BackendRuntimeError(
        "invalid_argument",
        `settings.patch requires non-empty ${field}`,
        { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
      );
    }
    if (expr.length > SETTINGS_PATCH_SCHEDULE_EXPR_MAX) {
      throw new BackendRuntimeError(
        "invalid_argument",
        `settings.patch ${field} exceeds ${SETTINGS_PATCH_SCHEDULE_EXPR_MAX} characters`,
        { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
      );
    }
    return expr;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BackendRuntimeError(
      "invalid_argument",
      `settings.patch ${field} must be a cron expr string or schedule object`,
      { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  assertNoSettingsSecrets(value as Record<string, unknown>, `$.${field}`);
  const raw = value as Record<string, unknown>;
  const expr =
    typeof raw.expr === "string" && raw.expr.trim()
      ? raw.expr.trim()
      : undefined;
  if (!expr) {
    throw new BackendRuntimeError(
      "invalid_argument",
      `settings.patch ${field}.expr is required`,
      { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  if (expr.length > SETTINGS_PATCH_SCHEDULE_EXPR_MAX) {
    throw new BackendRuntimeError(
      "invalid_argument",
      `settings.patch ${field}.expr exceeds ${SETTINGS_PATCH_SCHEDULE_EXPR_MAX} characters`,
      { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  const schedule: SettingsCronSchedule = {
    kind:
      typeof raw.kind === "string" && raw.kind.trim()
        ? raw.kind.trim()
        : "cron",
    expr,
  };
  if (typeof raw.display === "string" && raw.display.trim()) {
    const display = raw.display.trim();
    if (display.length > SETTINGS_PATCH_SCHEDULE_DISPLAY_MAX) {
      throw new BackendRuntimeError(
        "invalid_argument",
        `settings.patch ${field}.display exceeds ${SETTINGS_PATCH_SCHEDULE_DISPLAY_MAX} characters`,
        { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
      );
    }
    schedule.display = display;
  }
  if (typeof raw.timezone === "string" && raw.timezone.trim()) {
    const timezone = raw.timezone.trim();
    if (timezone.length > SETTINGS_PATCH_TIMEZONE_MAX) {
      throw new BackendRuntimeError(
        "invalid_argument",
        `settings.patch ${field}.timezone exceeds ${SETTINGS_PATCH_TIMEZONE_MAX} characters`,
        { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
      );
    }
    schedule.timezone = timezone;
  }
  if (typeof raw.run_at === "string" && raw.run_at.trim()) {
    schedule.run_at = raw.run_at.trim();
  }
  return schedule;
}

function parseOptionalSkills(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new BackendRuntimeError(
      "invalid_argument",
      "settings.patch skills must be an array of skill ids",
      { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  if (value.length > SETTINGS_PATCH_SKILLS_MAX) {
    throw new BackendRuntimeError(
      "invalid_argument",
      `settings.patch skills exceeds ${SETTINGS_PATCH_SKILLS_MAX} entries`,
      { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  return value.map((item, i) =>
    requireNonEmptyString(item, `skills[${i}]`, SETTINGS_PATCH_ID_MAX),
  );
}

/**
 * Validate a settings.patch domain input against backend config.schema.json
 * surfaces used by Portal settings:
 * - skill.set_enabled → skills.disabled[] (string ids)
 * - cron.set_enabled → cron job id + enabled (jobs.json; cron section in config)
 * - cron.create / cron.update → full jobs.json row (name, prompt, schedule, enabled)
 * - mcp.set_enabled → mcp_servers[name] object entry
 * - model.set_active → model object { provider, default } (modelSettings)
 *
 * Throws {@link BackendRuntimeError} `invalid_argument` on bad input.
 */
export function validateSettingsPatchAgainstConfigSchema(
  input: SettingsPatchInput,
): void {
  assertNoSettingsSecrets(input as unknown as Record<string, unknown>);

  switch (input.op) {
    case "skill.set_enabled": {
      requireNonEmptyString(input.skillId, "skill_id", SETTINGS_PATCH_ID_MAX);
      requireBoolean(input.enabled, "enabled");
      // Config fragment that would be written: skills.disabled is string[]
      const skillsFragment = {
        skills: {
          disabled: input.enabled ? [] : [input.skillId.trim()],
        },
      };
      assertNoSettingsSecrets(skillsFragment);
      break;
    }
    case "cron.set_enabled": {
      requireNonEmptyString(input.cronId, "cron_id", SETTINGS_PATCH_ID_MAX);
      requireBoolean(input.enabled, "enabled");
      // Cron job rows live in cron/jobs.json; config.cron is scheduler settings.
      // Id + enabled boolean are the only BFF-accepted fields for this op.
      break;
    }
    case "cron.create": {
      if (input.cronId !== undefined) {
        requireNonEmptyString(input.cronId, "cron_id", SETTINGS_PATCH_ID_MAX);
      }
      requireNonEmptyString(input.name, "name", SETTINGS_PATCH_ID_MAX);
      requireNonEmptyString(input.prompt, "prompt", SETTINGS_PATCH_PROMPT_MAX);
      // schedule already normalized by parse; re-validate shape
      parseCronScheduleInput(input.schedule, "schedule");
      if (input.enabled !== undefined) {
        requireBoolean(input.enabled, "enabled");
      }
      if (input.skills !== undefined) {
        parseOptionalSkills(input.skills);
      }
      break;
    }
    case "cron.update": {
      requireNonEmptyString(input.cronId, "cron_id", SETTINGS_PATCH_ID_MAX);
      const hasField =
        input.name !== undefined ||
        input.prompt !== undefined ||
        input.schedule !== undefined ||
        input.enabled !== undefined ||
        input.skills !== undefined;
      if (!hasField) {
        throw new BackendRuntimeError(
          "invalid_argument",
          "settings.patch cron.update requires at least one of name, prompt, schedule, enabled, skills",
          { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
        );
      }
      if (input.name !== undefined) {
        requireNonEmptyString(input.name, "name", SETTINGS_PATCH_ID_MAX);
      }
      if (input.prompt !== undefined) {
        requireNonEmptyString(input.prompt, "prompt", SETTINGS_PATCH_PROMPT_MAX);
      }
      if (input.schedule !== undefined) {
        parseCronScheduleInput(input.schedule, "schedule");
      }
      if (input.enabled !== undefined) {
        requireBoolean(input.enabled, "enabled");
      }
      if (input.skills !== undefined) {
        parseOptionalSkills(input.skills);
      }
      break;
    }
    case "mcp.set_enabled": {
      const name = requireNonEmptyString(
        input.mcpName,
        "mcp_name",
        SETTINGS_PATCH_ID_MAX,
      );
      requireBoolean(input.enabled, "enabled");
      // Config fragment: mcp_servers[name] = { enabled }
      const mcpFragment = {
        mcp_servers: {
          [name]: { enabled: input.enabled },
        },
      };
      assertNoSettingsSecrets(mcpFragment);
      break;
    }
    case "model.set_active": {
      const provider = requireNonEmptyString(
        input.provider,
        "provider",
        SETTINGS_PATCH_ID_MAX,
      );
      const model = requireNonEmptyString(
        input.model,
        "model",
        SETTINGS_PATCH_MODEL_MAX,
      );
      // Config fragment matching modelSettings (config.schema.json):
      // model: { provider, default } — never bare secrets.
      const modelFragment = {
        model: {
          provider,
          default: model,
        },
      };
      assertNoSettingsSecrets(modelFragment);
      break;
    }
    default: {
      const _exhaustive: never = input;
      throw new BackendRuntimeError(
        "invalid_argument",
        `settings.patch unknown op: ${(_exhaustive as SettingsPatchInput).op}`,
        { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
      );
    }
  }
}

/**
 * Parse and validate a settings.patch wire body
 * (`params_settings_patch` / Portal PATCH JSON).
 * Throws {@link BackendRuntimeError} `invalid_argument` on bad input.
 */
export function parseSettingsPatchInput(body: unknown): SettingsPatchInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BackendRuntimeError(
      "invalid_argument",
      "settings.patch body must be a JSON object",
      { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  const raw = body as Record<string, unknown>;
  assertNoSettingsSecrets(raw);

  const op = raw.op;
  if (
    op !== "skill.set_enabled" &&
    op !== "cron.set_enabled" &&
    op !== "cron.create" &&
    op !== "cron.update" &&
    op !== "mcp.set_enabled" &&
    op !== "model.set_active"
  ) {
    throw new BackendRuntimeError(
      "invalid_argument",
      "settings.patch requires op one of skill.set_enabled | cron.set_enabled | cron.create | cron.update | mcp.set_enabled | model.set_active",
      { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }

  let input: SettingsPatchInput;
  switch (op) {
    case "skill.set_enabled":
      input = {
        op,
        skillId: requireNonEmptyString(
          raw.skill_id ?? raw.skillId,
          "skill_id",
          SETTINGS_PATCH_ID_MAX,
        ),
        enabled: requireBoolean(raw.enabled, "enabled"),
      };
      break;
    case "cron.set_enabled":
      input = {
        op,
        cronId: requireNonEmptyString(
          raw.cron_id ?? raw.cronId,
          "cron_id",
          SETTINGS_PATCH_ID_MAX,
        ),
        enabled: requireBoolean(raw.enabled, "enabled"),
      };
      break;
    case "cron.create": {
      const cronIdRaw = raw.cron_id ?? raw.cronId ?? raw.id;
      const promptRaw = raw.prompt ?? raw.instructions;
      input = {
        op,
        ...(cronIdRaw !== undefined && cronIdRaw !== null
          ? {
              cronId: requireNonEmptyString(
                cronIdRaw,
                "cron_id",
                SETTINGS_PATCH_ID_MAX,
              ),
            }
          : {}),
        name: requireNonEmptyString(raw.name, "name", SETTINGS_PATCH_ID_MAX),
        prompt: requireNonEmptyString(
          promptRaw,
          "prompt",
          SETTINGS_PATCH_PROMPT_MAX,
        ),
        schedule: parseCronScheduleInput(raw.schedule, "schedule"),
        ...(raw.enabled !== undefined
          ? { enabled: requireBoolean(raw.enabled, "enabled") }
          : {}),
        ...(raw.skills !== undefined
          ? { skills: parseOptionalSkills(raw.skills) }
          : {}),
      };
      break;
    }
    case "cron.update": {
      const promptRaw = raw.prompt ?? raw.instructions;
      input = {
        op,
        cronId: requireNonEmptyString(
          raw.cron_id ?? raw.cronId,
          "cron_id",
          SETTINGS_PATCH_ID_MAX,
        ),
        ...(raw.name !== undefined
          ? {
              name: requireNonEmptyString(
                raw.name,
                "name",
                SETTINGS_PATCH_ID_MAX,
              ),
            }
          : {}),
        ...(promptRaw !== undefined
          ? {
              prompt: requireNonEmptyString(
                promptRaw,
                "prompt",
                SETTINGS_PATCH_PROMPT_MAX,
              ),
            }
          : {}),
        ...(raw.schedule !== undefined
          ? { schedule: parseCronScheduleInput(raw.schedule, "schedule") }
          : {}),
        ...(raw.enabled !== undefined
          ? { enabled: requireBoolean(raw.enabled, "enabled") }
          : {}),
        ...(raw.skills !== undefined
          ? { skills: parseOptionalSkills(raw.skills) }
          : {}),
      };
      break;
    }
    case "mcp.set_enabled":
      input = {
        op,
        mcpName: requireNonEmptyString(
          raw.mcp_name ?? raw.mcpName,
          "mcp_name",
          SETTINGS_PATCH_ID_MAX,
        ),
        enabled: requireBoolean(raw.enabled, "enabled"),
      };
      break;
    case "model.set_active":
      input = {
        op,
        provider: requireNonEmptyString(
          raw.provider,
          "provider",
          SETTINGS_PATCH_ID_MAX,
        ),
        model: requireNonEmptyString(
          raw.model,
          "model",
          SETTINGS_PATCH_MODEL_MAX,
        ),
      };
      break;
  }

  validateSettingsPatchAgainstConfigSchema(input);
  return input;
}

/**
 * Build settings.patch Brain RPC params from domain input.
 */
export function settingsPatchInputToWireParams(
  input: SettingsPatchInput,
): Record<string, unknown> {
  validateSettingsPatchAgainstConfigSchema(input);
  switch (input.op) {
    case "skill.set_enabled":
      return {
        op: input.op,
        skill_id: input.skillId,
        enabled: input.enabled,
      };
    case "cron.set_enabled":
      return {
        op: input.op,
        cron_id: input.cronId,
        enabled: input.enabled,
      };
    case "cron.create": {
      const wire: Record<string, unknown> = {
        op: input.op,
        name: input.name,
        prompt: input.prompt,
        schedule: input.schedule,
      };
      if (input.cronId !== undefined) wire.cron_id = input.cronId;
      if (input.enabled !== undefined) wire.enabled = input.enabled;
      if (input.skills !== undefined) wire.skills = input.skills;
      return wire;
    }
    case "cron.update": {
      const wire: Record<string, unknown> = {
        op: input.op,
        cron_id: input.cronId,
      };
      if (input.name !== undefined) wire.name = input.name;
      if (input.prompt !== undefined) wire.prompt = input.prompt;
      if (input.schedule !== undefined) wire.schedule = input.schedule;
      if (input.enabled !== undefined) wire.enabled = input.enabled;
      if (input.skills !== undefined) wire.skills = input.skills;
      return wire;
    }
    case "mcp.set_enabled":
      return {
        op: input.op,
        mcp_name: input.mcpName,
        enabled: input.enabled,
      };
    case "model.set_active":
      return {
        op: input.op,
        provider: input.provider,
        model: input.model,
      };
  }
}

/**
 * Whether the backend advertises settings.patch (expansion).
 * UI and BFF must both check before enabling the settings editor.
 */
export function settingsPatchIsAdvertised(caps: {
  features?: Record<string, boolean>;
  brain_rpc_methods?: string[];
}): boolean {
  if (caps.features?.settings_patch === true) return true;
  const methods = caps.brain_rpc_methods ?? [];
  return methods.includes(SETTINGS_PATCH_METHOD);
}

/**
 * Whether model.set_active is available (settings.patch or models expansion).
 */
export function modelPatchIsAdvertised(caps: {
  features?: Record<string, boolean>;
  brain_rpc_methods?: string[];
}): boolean {
  if (settingsPatchIsAdvertised(caps)) return true;
  if (caps.features?.models === true) return true;
  const methods = caps.brain_rpc_methods ?? [];
  return methods.includes(MODELS_SET_ACTIVE_METHOD);
}

/**
 * Whether cron enable patches are available (settings.patch or cron expansion).
 * Note: enable-only — does **not** imply full job create/update (lp-jzl.3).
 */
export function cronPatchIsAdvertised(caps: {
  features?: Record<string, boolean>;
  brain_rpc_methods?: string[];
}): boolean {
  if (settingsPatchIsAdvertised(caps)) return true;
  if (caps.features?.cron === true) return true;
  const methods = caps.brain_rpc_methods ?? [];
  return methods.includes(CRON_PATCH_METHOD);
}

/**
 * Whether full scheduled-task create/update is advertised (lp-jzl.3).
 *
 * Honest gate: settings_patch alone is **not** enough (LA baseline can toggle
 * enable without shipping create). Requires features.cron or a dedicated
 * cron method (cron.patch / cron.create / cron.update).
 */
export function cronCreateUpdateIsAdvertised(caps: {
  features?: Record<string, boolean>;
  brain_rpc_methods?: string[];
}): boolean {
  if (caps.features?.cron === true) return true;
  const methods = caps.brain_rpc_methods ?? [];
  return (
    methods.includes(CRON_PATCH_METHOD) ||
    methods.includes(CRON_CREATE_METHOD) ||
    methods.includes(CRON_UPDATE_METHOD)
  );
}

function patchCapabilityForOp(
  op: SettingsPatchOp,
  caps: { features?: Record<string, boolean>; brain_rpc_methods?: string[] },
): boolean {
  if (op === "model.set_active") return modelPatchIsAdvertised(caps);
  if (op === "cron.set_enabled") return cronPatchIsAdvertised(caps);
  if (op === "cron.create" || op === "cron.update") {
    return cronCreateUpdateIsAdvertised(caps);
  }
  return settingsPatchIsAdvertised(caps);
}

/**
 * Load redacted settings snapshot via BackendRuntimeService (production → Brain RPC).
 *
 * Maps to GET /api/settings/snapshot response shape — powers the settings page.
 */
export async function getSettingsSnapshot(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  options: GetSettingsSnapshotOptions = {},
): Promise<SettingsSnapshotHttpBody> {
  const result = await service.settingsSnapshot(ctx, options.params);
  return toSettingsSnapshotHttpBody(result);
}

/**
 * Apply a settings patch via BackendRuntimeService after config schema +
 * capability checks. Does **not** open config.yaml or jobs.json directly.
 */
export async function applySettingsPatch(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  input: SettingsPatchInput,
  options: PatchSettingsOptions = {},
): Promise<SettingsPatchResult> {
  validateSettingsPatchAgainstConfigSchema(input);
  const requireCap = options.requireCapabilityAdvertisement !== false;

  if (requireCap) {
    const caps = await service.capabilities(ctx);
    if (!patchCapabilityForOp(input.op, caps)) {
      throw new BackendRuntimeError(
        "method_not_found",
        `settings.patch op ${input.op} is not advertised by this backend; ` +
          "enable only after capabilities.features.settings_patch " +
          "(or models/cron for those ops) or brain_rpc_methods includes the method",
        {
          retryable: false,
          details: { method: SETTINGS_PATCH_METHOD, op: input.op },
        },
      );
    }
  }

  if (typeof service.patchSettings !== "function") {
    throw new BackendRuntimeError(
      "method_not_found",
      "BackendRuntimeService.patchSettings is not implemented; " +
        "settings editor is unavailable for this backend",
      {
        retryable: false,
        details: { method: SETTINGS_PATCH_METHOD, op: input.op },
      },
    );
  }

  const result = await service.patchSettings(ctx, input);
  assertNoSettingsSecrets(result as unknown as Record<string, unknown>);
  return result;
}

/** PATCH /api/settings/skills/:skillId — body `{ enabled: boolean }`. */
export async function patchSettingsSkill(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  skillId: string,
  body: unknown,
  options: PatchSettingsOptions = {},
): Promise<SettingsSkillPatchHttpBody> {
  const enabled = parseEnabledBody(body);
  const result = await applySettingsPatch(
    service,
    ctx,
    { op: "skill.set_enabled", skillId, enabled },
    options,
  );
  if (!result.skill) {
    throw new BackendRuntimeError(
      "internal",
      "settings.patch skill result missing skill entity",
      { retryable: true, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  return { skill: result.skill, source: result.source };
}

/**
 * PATCH /api/settings/crons/:cronId
 *
 * - Body `{ enabled: boolean }` only → `cron.set_enabled` (enable toggle)
 * - Body with name / prompt / schedule / skills → `cron.update` (full job)
 * - Body with enabled + other fields → `cron.update` including enabled
 */
export async function patchSettingsCron(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  cronId: string,
  body: unknown,
  options: PatchSettingsOptions = {},
): Promise<SettingsCronPatchHttpBody> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BackendRuntimeError(
      "invalid_argument",
      "settings cron patch body must be a JSON object",
      { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  const raw = body as Record<string, unknown>;
  assertNoSettingsSecrets(raw);

  const hasFullUpdateFields =
    raw.name !== undefined ||
    raw.prompt !== undefined ||
    raw.instructions !== undefined ||
    raw.schedule !== undefined ||
    raw.skills !== undefined;

  let input: SettingsPatchInput;
  if (hasFullUpdateFields) {
    input = parseSettingsPatchInput({
      op: "cron.update",
      cron_id: cronId,
      ...raw,
    });
  } else {
    const enabled = parseEnabledBody(body);
    input = { op: "cron.set_enabled", cronId, enabled };
  }

  const result = await applySettingsPatch(service, ctx, input, options);
  if (!result.cron) {
    throw new BackendRuntimeError(
      "internal",
      "settings.patch cron result missing cron entity",
      { retryable: true, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  return { cron: result.cron, source: result.source };
}

/**
 * POST /api/settings/crons — create full scheduled task (lp-jzl.3).
 * Body: `{ name, prompt|instructions, schedule, enabled?, skills?, id? }`.
 */
export async function createSettingsCron(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  body: unknown,
  options: PatchSettingsOptions = {},
): Promise<SettingsCronCreateHttpBody> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BackendRuntimeError(
      "invalid_argument",
      "settings cron create body must be a JSON object",
      { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  const raw = body as Record<string, unknown>;
  const input = parseSettingsPatchInput({
    op: "cron.create",
    ...raw,
  });
  const result = await applySettingsPatch(service, ctx, input, options);
  if (!result.cron) {
    throw new BackendRuntimeError(
      "internal",
      "settings.patch cron.create result missing cron entity",
      { retryable: true, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  return { cron: result.cron, source: result.source };
}

/** PATCH /api/settings/mcp/:mcpName — body `{ enabled: boolean }`. */
export async function patchSettingsMcp(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  mcpName: string,
  body: unknown,
  options: PatchSettingsOptions = {},
): Promise<SettingsMcpPatchHttpBody> {
  const enabled = parseEnabledBody(body);
  const result = await applySettingsPatch(
    service,
    ctx,
    { op: "mcp.set_enabled", mcpName, enabled },
    options,
  );
  if (!result.mcp) {
    throw new BackendRuntimeError(
      "internal",
      "settings.patch mcp result missing mcp entity",
      { retryable: true, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  return { mcp: result.mcp, source: result.source };
}

/** PATCH /api/settings/models/active — body `{ provider, model }`. */
export async function patchSettingsActiveModel(
  service: BackendRuntimeService,
  ctx: BackendRuntimeContext,
  body: unknown,
  options: PatchSettingsOptions = {},
): Promise<SettingsModelPatchHttpBody> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BackendRuntimeError(
      "invalid_argument",
      "settings model patch body must be a JSON object",
      { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  const raw = body as Record<string, unknown>;
  assertNoSettingsSecrets(raw);
  const provider = requireNonEmptyString(
    raw.provider,
    "provider",
    SETTINGS_PATCH_ID_MAX,
  );
  const model = requireNonEmptyString(
    raw.model,
    "model",
    SETTINGS_PATCH_MODEL_MAX,
  );
  const result = await applySettingsPatch(
    service,
    ctx,
    { op: "model.set_active", provider, model },
    options,
  );
  if (!result.model) {
    throw new BackendRuntimeError(
      "internal",
      "settings.patch model result missing model entity",
      { retryable: true, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  return { model: result.model, source: result.source };
}

function parseEnabledBody(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BackendRuntimeError(
      "invalid_argument",
      "settings enable patch body must be a JSON object",
      { retryable: false, details: { method: SETTINGS_PATCH_METHOD } },
    );
  }
  const raw = body as Record<string, unknown>;
  assertNoSettingsSecrets(raw);
  return requireBoolean(raw.enabled, "enabled");
}

/** Normalize snapshot for HTTP (ensure required fields). */
export function toSettingsSnapshotHttpBody(
  result: SettingsSnapshot,
): SettingsSnapshotHttpBody {
  if (!result || typeof result !== "object") {
    throw new BackendRuntimeError(
      "internal",
      "settings.snapshot result was not an object",
      { retryable: true, details: { method: SETTINGS_SNAPSHOT_METHOD } },
    );
  }
  if (typeof result.exported_at !== "string" || !result.exported_at) {
    throw new BackendRuntimeError(
      "internal",
      "settings.snapshot missing exported_at",
      { retryable: true, details: { method: SETTINGS_SNAPSHOT_METHOD } },
    );
  }
  const source =
    typeof result.source === "string" && result.source.length > 0
      ? result.source
      : "none";
  assertNoSettingsSecrets(result as unknown as Record<string, unknown>);
  return {
    ...result,
    source,
  };
}

/**
 * Map a service error to `{ status, body }` for Hono / Express handlers.
 * Marks clear unavailable states for method_not_found / unavailable /
 * not_implemented so the settings UI can render empty/disabled (no crash).
 */
export function settingsErrorToHttp(err: unknown): {
  status: number;
  body: SettingsHttpErrorBody;
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
    err instanceof Error ? err.message : "Internal settings route error";
  return {
    status: 500,
    body: { error: message, code: "internal", retryable: true },
  };
}

/**
 * Handler bundle for BFF route modules after Portal import.
 *
 * ```ts
 * const settings = createSettingsHandlers(backendRuntime);
 * api.get("/settings/snapshot", async (c) => {
 *   const ctx = backendContextFromSession(...);
 *   try {
 *     return c.json(await settings.snapshot(ctx));
 *   } catch (err) {
 *     const { status, body } = settingsErrorToHttp(err);
 *     return c.json(body, status);
 *   }
 * });
 * ```
 */
export function createSettingsHandlers(
  service: BackendRuntimeService,
  defaults: PatchSettingsOptions = {},
): {
  snapshot: (
    ctx: BackendRuntimeContext,
    params?: SettingsSnapshotParams,
  ) => Promise<SettingsSnapshotHttpBody>;
  createCron: (
    ctx: BackendRuntimeContext,
    body: unknown,
    options?: PatchSettingsOptions,
  ) => Promise<SettingsCronCreateHttpBody>;
  patchSkill: (
    ctx: BackendRuntimeContext,
    skillId: string,
    body: unknown,
    options?: PatchSettingsOptions,
  ) => Promise<SettingsSkillPatchHttpBody>;
  patchCron: (
    ctx: BackendRuntimeContext,
    cronId: string,
    body: unknown,
    options?: PatchSettingsOptions,
  ) => Promise<SettingsCronPatchHttpBody>;
  patchMcp: (
    ctx: BackendRuntimeContext,
    mcpName: string,
    body: unknown,
    options?: PatchSettingsOptions,
  ) => Promise<SettingsMcpPatchHttpBody>;
  patchActiveModel: (
    ctx: BackendRuntimeContext,
    body: unknown,
    options?: PatchSettingsOptions,
  ) => Promise<SettingsModelPatchHttpBody>;
  patch: (
    ctx: BackendRuntimeContext,
    input: SettingsPatchInput,
    options?: PatchSettingsOptions,
  ) => Promise<SettingsPatchResult>;
} {
  return {
    snapshot: (ctx, params) => getSettingsSnapshot(service, ctx, { params }),
    createCron: (ctx, body, options) =>
      createSettingsCron(service, ctx, body, {
        ...defaults,
        ...options,
      }),
    patchSkill: (ctx, skillId, body, options) =>
      patchSettingsSkill(service, ctx, skillId, body, {
        ...defaults,
        ...options,
      }),
    patchCron: (ctx, cronId, body, options) =>
      patchSettingsCron(service, ctx, cronId, body, {
        ...defaults,
        ...options,
      }),
    patchMcp: (ctx, mcpName, body, options) =>
      patchSettingsMcp(service, ctx, mcpName, body, {
        ...defaults,
        ...options,
      }),
    patchActiveModel: (ctx, body, options) =>
      patchSettingsActiveModel(service, ctx, body, {
        ...defaults,
        ...options,
      }),
    patch: (ctx, input, options) =>
      applySettingsPatch(service, ctx, input, { ...defaults, ...options }),
  };
}
