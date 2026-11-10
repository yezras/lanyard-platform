/**
 * @lanyard/hermes-compat
 *
 * Preserve existing Hermes-Lanyard deployments during Portal backend abstraction:
 * - HERMES_* process env aliases → BACKEND_*
 * - /api/hermes/* endpoint deprecation notes → backend-neutral routes
 * - Explicit removal criteria checklist (do not delete compat until gates pass)
 *
 * Bead: `lp-k7g.8.7`
 */

export {
  ENV_ALIAS_PAIRS,
  ENV_UNSET_SENTINELS,
  PLATFORM_ONLY_ENV_NAMES,
  EnvAliasConflictError,
  UnknownEnvAliasError,
  resolveEnvAlias,
  dualWriteEnvAlias,
  resolveAllEnvAliases,
  resolveBackendHome,
  resolveBackendInstallPath,
  isLegacyHermesEnvName,
  isPreferredBackendEnvName,
  legacyEnvNameFor,
  preferredEnvNameFor,
  legacyEnvOnlyWarning,
} from "./env-aliases.js";

export type {
  EnvAliasPair,
  PreferredEnvName,
  LegacyEnvName,
  EnvSource,
} from "./env-aliases.js";

export {
  HERMES_ENDPOINT_DEPRECATIONS,
  PREFERRED_AGENT_PROJECT_ROUTES,
  LEGACY_HERMES_PROJECT_ROUTES,
  deprecationsForPath,
  isLegacyHermesEndpoint,
  preferredPathForLegacy,
  deprecationNoteForPath,
  deprecationHeadersForLegacyPath,
  dualMountPlan,
} from "./endpoints.js";

export type {
  EndpointCompatStatus,
  HttpMethod,
  HermesEndpointDeprecation,
} from "./endpoints.js";

export {
  HERMES_COMPAT_REMOVAL_CRITERIA,
  REMOVAL_POLICY,
  evaluateRemovalCriteria,
  criteriaForSurface,
  canRemoveSurface,
  removalChecklistMarkdown,
} from "./removal-criteria.js";

export type {
  RemovalSurface,
  RemovalCriterion,
  RemovalCriterionId,
} from "./removal-criteria.js";
