/**
 * Process-env aliases: accept legacy HERMES_* names and map to preferred BACKEND_*.
 *
 * Bead: `lp-k7g.8.7` — preserve existing Hermes deployment compatibility.
 *
 * Rules (migration window):
 * 1. Prefer BACKEND_* when set (non-empty after trim).
 * 2. Fall back to HERMES_* so existing unit files / .env / operator shells keep working.
 * 3. If both set and differ → EnvAliasConflictError (callers fail closed at startup).
 * 4. Dual-write helpers emit both names with the same effective value for
 *    systemd Environment= lines and bootstrap env fragments.
 *
 * Normative layout aliases: contracts/backend-runtime-v1/filesystem-layout.md
 * Deploy artifact env dual-write: docs/architecture/deploy-backend-artifact-variables.md
 */

/** Empty / sentinel values treated as unset for conflict and coalesce. */
export const ENV_UNSET_SENTINELS = new Set([
  "",
  "UNCONFIGURED",
  "REPLACE_ME",
]);

/**
 * Preferred platform env name → temporary Hermes alias.
 * Only pairs listed here are accepted as dual-name aliases.
 */
export const ENV_ALIAS_PAIRS = [
  {
    preferred: "BACKEND_HOME",
    legacy: "HERMES_HOME",
    role: "Runtime home tree (config.yaml, profiles, projects.db, …).",
  },
  {
    preferred: "BACKEND_INSTALL_PATH",
    legacy: "HERMES_INSTALL_PATH",
    role: "Unpacked artifact install prefix (not the runtime home).",
  },
  {
    preferred: "BACKEND_ARTIFACT_URL",
    legacy: "HERMES_ARTIFACT_URL",
    role: "Pinned backend artifact URL (bootstrap / user_data).",
  },
  {
    preferred: "BACKEND_ARTIFACT_VERSION",
    legacy: "HERMES_ARTIFACT_VERSION",
    role: "Pinned backend artifact version label.",
  },
  {
    preferred: "BACKEND_ARTIFACT_SHA256",
    legacy: "HERMES_ARTIFACT_SHA256",
    role: "Pinned backend artifact digest.",
  },
  {
    preferred: "BACKEND_ARTIFACT_SIGNATURE_B64",
    legacy: "HERMES_ARTIFACT_SIGNATURE_B64",
    role: "Optional Ed25519 signature over artifact bytes.",
  },
] as const;

export type EnvAliasPair = (typeof ENV_ALIAS_PAIRS)[number];
export type PreferredEnvName = EnvAliasPair["preferred"];
export type LegacyEnvName = EnvAliasPair["legacy"];

/** Platform-owned names with no Hermes alias (still documented for completeness). */
export const PLATFORM_ONLY_ENV_NAMES = [
  "BACKEND_KIND",
  "BACKEND_CONTRACT_RUNTIME_LAYOUT",
  "BACKEND_CONTRACT_RELAY",
  "BACKEND_CONTRACT_BRAIN_RPC",
  "VAULT_ROOT",
  "COMPANY_BRAIN_VAULT_ROOT",
  "GATEWAY_RELAY_URL",
  "GATEWAY_RELAY_ID",
  "GATEWAY_RELAY_SECRET",
  "GATEWAY_RELAY_INSTANCE_ID",
  "BRAIN_TENANT_ID",
  "BRAIN_RPC_ENABLED",
  "BRAIN_PROFILES_DIR",
  "RELAY_CONTRACT_MAJOR",
  "BRAIN_RPC_CONTRACT_MAJOR",
] as const;

export class EnvAliasConflictError extends Error {
  readonly code = "ENV_ALIAS_CONFLICT";

  constructor(
    readonly preferredName: string,
    readonly legacyName: string,
    readonly preferredValue: string,
    readonly legacyValue: string,
  ) {
    super(
      `${preferredName}=${JSON.stringify(preferredValue)} conflicts with alias ` +
        `${legacyName}=${JSON.stringify(legacyValue)}. ` +
        `Deploy must set them equal or only set the preferred name.`,
    );
    this.name = "EnvAliasConflictError";
  }
}

export class UnknownEnvAliasError extends Error {
  readonly code = "UNKNOWN_ENV_ALIAS";

  constructor(name: string) {
    super(`No HERMES_* alias mapping registered for ${JSON.stringify(name)}`);
    this.name = "UnknownEnvAliasError";
  }
}

export type EnvSource = Record<string, string | undefined> | NodeJS.ProcessEnv;

function normalizeEnvValue(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (ENV_UNSET_SENTINELS.has(trimmed)) return null;
  return trimmed;
}

function pairForPreferred(name: string): EnvAliasPair | undefined {
  return ENV_ALIAS_PAIRS.find((p) => p.preferred === name);
}

function pairForLegacy(name: string): EnvAliasPair | undefined {
  return ENV_ALIAS_PAIRS.find((p) => p.legacy === name);
}

/**
 * Resolve a single preferred env var, accepting its HERMES_* alias.
 * Returns null when neither is set (or both are sentinels).
 */
export function resolveEnvAlias(
  preferredName: PreferredEnvName | string,
  env: EnvSource = process.env,
): string | null {
  const pair = pairForPreferred(preferredName);
  if (!pair) {
    throw new UnknownEnvAliasError(preferredName);
  }
  const preferred = normalizeEnvValue(env[pair.preferred]);
  const legacy = normalizeEnvValue(env[pair.legacy]);

  if (preferred !== null && legacy !== null && preferred !== legacy) {
    throw new EnvAliasConflictError(
      pair.preferred,
      pair.legacy,
      preferred,
      legacy,
    );
  }
  return preferred ?? legacy;
}

/**
 * Dual-write payload for one preferred/legacy env pair.
 * Both keys receive the same effective value (or both null).
 */
export function dualWriteEnvAlias(
  preferredName: PreferredEnvName | string,
  env: EnvSource = process.env,
): {
  preferredName: string;
  legacyName: string;
  preferred: string | null;
  legacy: string | null;
  effective: string | null;
  usedLegacyOnly: boolean;
} {
  const pair = pairForPreferred(preferredName);
  if (!pair) {
    throw new UnknownEnvAliasError(preferredName);
  }
  const preferredRaw = normalizeEnvValue(env[pair.preferred]);
  const legacyRaw = normalizeEnvValue(env[pair.legacy]);
  const effective = resolveEnvAlias(pair.preferred, env);
  return {
    preferredName: pair.preferred,
    legacyName: pair.legacy,
    preferred: effective,
    legacy: effective,
    effective,
    usedLegacyOnly: preferredRaw === null && legacyRaw !== null,
  };
}

/**
 * Resolve all registered env aliases from a process env object.
 * Throws on the first conflict.
 */
export function resolveAllEnvAliases(env: EnvSource = process.env): {
  values: Record<PreferredEnvName, string | null>;
  usedLegacyOnly: PreferredEnvName[];
  dualWrite: Record<string, string | null>;
} {
  const values = {} as Record<PreferredEnvName, string | null>;
  const usedLegacyOnly: PreferredEnvName[] = [];
  const dualWrite: Record<string, string | null> = {};

  for (const pair of ENV_ALIAS_PAIRS) {
    const result = dualWriteEnvAlias(pair.preferred, env);
    values[pair.preferred] = result.effective;
    dualWrite[pair.preferred] = result.effective;
    dualWrite[pair.legacy] = result.effective;
    if (result.usedLegacyOnly) {
      usedLegacyOnly.push(pair.preferred);
    }
  }

  return { values, usedLegacyOnly, dualWrite };
}

/**
 * Convenience: effective BACKEND_HOME (HERMES_HOME accepted).
 * Primary Portal / BFF host path used during migration for local ports.
 */
export function resolveBackendHome(env: EnvSource = process.env): string | null {
  return resolveEnvAlias("BACKEND_HOME", env);
}

/**
 * Convenience: effective BACKEND_INSTALL_PATH (HERMES_INSTALL_PATH accepted).
 */
export function resolveBackendInstallPath(
  env: EnvSource = process.env,
): string | null {
  return resolveEnvAlias("BACKEND_INSTALL_PATH", env);
}

/**
 * True when `name` is a known temporary Hermes env alias (not preferred).
 */
export function isLegacyHermesEnvName(name: string): boolean {
  return pairForLegacy(name) !== undefined;
}

/**
 * True when `name` is a preferred BACKEND_* name that has a Hermes alias.
 */
export function isPreferredBackendEnvName(name: string): boolean {
  return pairForPreferred(name) !== undefined;
}

/**
 * Look up the Hermes alias for a preferred name (or null if none / unknown).
 */
export function legacyEnvNameFor(preferredName: string): string | null {
  return pairForPreferred(preferredName)?.legacy ?? null;
}

/**
 * Look up the preferred name for a Hermes alias (or null if unknown).
 */
export function preferredEnvNameFor(legacyName: string): string | null {
  return pairForLegacy(legacyName)?.preferred ?? null;
}

/**
 * Operator-facing warning when only the legacy name is set.
 */
export function legacyEnvOnlyWarning(preferredName: PreferredEnvName): string {
  const pair = pairForPreferred(preferredName);
  if (!pair) {
    throw new UnknownEnvAliasError(preferredName);
  }
  return (
    `${pair.legacy} is a temporary alias of ${pair.preferred}. ` +
    `Prefer ${pair.preferred} in new unit files and operator runbooks ` +
    `(lp-k7g.8.7 removal criteria).`
  );
}
