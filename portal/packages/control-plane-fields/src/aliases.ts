/**
 * Dual-read / dual-write helpers for preferred backend_* fields and
 * temporary hermes_* aliases.
 *
 * Rules (migration window):
 * 1. Prefer preferred name when both are set and equal.
 * 2. If only one is set, use it for both effective values.
 * 3. If both set and conflict → throw AliasConflictError (callers return 400).
 * 4. API responses dual-emit both names when a value is known.
 */

import type {
  BackendCapabilitiesSnapshot,
  BackendKind,
} from "./types.js";
import { BACKEND_KINDS } from "./types.js";

export class AliasConflictError extends Error {
  readonly code = "ALIAS_CONFLICT";

  constructor(
    readonly preferredName: string,
    readonly legacyName: string,
    readonly preferredValue: string,
    readonly legacyValue: string,
  ) {
    super(
      `${preferredName} (${preferredValue}) conflicts with alias ${legacyName} (${legacyValue})`,
    );
    this.name = "AliasConflictError";
  }
}

export class InvalidBackendKindError extends Error {
  readonly code = "INVALID_BACKEND_KIND";

  constructor(value: string) {
    super(
      `backend_kind must be one of: ${BACKEND_KINDS.join(", ")} (got ${JSON.stringify(value)})`,
    );
    this.name = "InvalidBackendKindError";
  }
}

/**
 * Resolve a pair of string fields (preferred + legacy alias).
 * Returns the effective value, or null when neither is set.
 */
export function resolveStringAlias(input: {
  preferred?: string | null;
  legacy?: string | null;
  preferredName: string;
  legacyName: string;
}): string | null {
  const preferred =
    input.preferred === undefined || input.preferred === null
      ? null
      : input.preferred.trim() || null;
  const legacy =
    input.legacy === undefined || input.legacy === null
      ? null
      : input.legacy.trim() || null;

  if (preferred !== null && legacy !== null && preferred !== legacy) {
    throw new AliasConflictError(
      input.preferredName,
      input.legacyName,
      preferred,
      legacy,
    );
  }
  return preferred ?? legacy;
}

/**
 * Dual-write payload for a string preferred/legacy pair.
 * Both keys are set to the same effective value (or both null).
 */
export function dualWriteStringAlias(input: {
  preferred?: string | null;
  legacy?: string | null;
  preferredName: string;
  legacyName: string;
}): { preferred: string | null; legacy: string | null; effective: string | null } {
  const effective = resolveStringAlias(input);
  return {
    preferred: effective,
    legacy: effective,
    effective,
  };
}

/** Resolve backend_version / hermes_version. */
export function resolveBackendVersion(input: {
  backend_version?: string | null;
  hermes_version?: string | null;
}): string | null {
  return resolveStringAlias({
    preferred: input.backend_version,
    legacy: input.hermes_version,
    preferredName: "backend_version",
    legacyName: "hermes_version",
  });
}

/** Dual-write backend_version + hermes_version. */
export function dualWriteBackendVersion(input: {
  backend_version?: string | null;
  hermes_version?: string | null;
}): {
  backend_version: string | null;
  hermes_version: string | null;
} {
  const { preferred, legacy } = dualWriteStringAlias({
    preferred: input.backend_version,
    legacy: input.hermes_version,
    preferredName: "backend_version",
    legacyName: "hermes_version",
  });
  return { backend_version: preferred, hermes_version: legacy };
}

/** Resolve backend_profile / hermes_profile (roles, UserRbac). */
export function resolveBackendProfile(input: {
  backend_profile?: string | null;
  hermes_profile?: string | null;
}): string | null {
  return resolveStringAlias({
    preferred: input.backend_profile,
    legacy: input.hermes_profile,
    preferredName: "backend_profile",
    legacyName: "hermes_profile",
  });
}

/**
 * Dual-write backend_profile + hermes_profile.
 * Profile is required on role create — callers must reject null.
 */
export function dualWriteBackendProfile(input: {
  backend_profile?: string | null;
  hermes_profile?: string | null;
}): {
  backend_profile: string | null;
  hermes_profile: string | null;
} {
  const { preferred, legacy } = dualWriteStringAlias({
    preferred: input.backend_profile,
    legacy: input.hermes_profile,
    preferredName: "backend_profile",
    legacyName: "hermes_profile",
  });
  return { backend_profile: preferred, hermes_profile: legacy };
}

export function parseBackendKind(
  value: string | null | undefined,
): BackendKind | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const trimmed = value.trim();
  if ((BACKEND_KINDS as readonly string[]).includes(trimmed)) {
    return trimmed as BackendKind;
  }
  throw new InvalidBackendKindError(trimmed);
}

/**
 * Normalize a capabilities snapshot for storage.
 * Rejects non-objects; preserves unknown keys for forward-compat.
 */
export function normalizeBackendCapabilities(
  value: unknown,
): BackendCapabilitiesSnapshot | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("backend_capabilities must be a JSON object when set");
  }
  const obj = value as Record<string, unknown>;
  const schema_version = obj.schema_version;
  if (schema_version !== undefined && schema_version !== 1) {
    throw new TypeError("backend_capabilities.schema_version must be 1 when set");
  }
  return {
    ...(obj as Omit<BackendCapabilitiesSnapshot, "schema_version">),
    schema_version: 1,
  };
}

/**
 * Parse backend_capabilities from a DB TEXT/JSON column.
 */
export function parseBackendCapabilitiesColumn(
  raw: string | null | undefined,
): BackendCapabilitiesSnapshot | null {
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TypeError("backend_capabilities column is not valid JSON");
  }
  return normalizeBackendCapabilities(parsed);
}

export function serializeBackendCapabilities(
  value: BackendCapabilitiesSnapshot | null | undefined,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(normalizeBackendCapabilities(value));
}
