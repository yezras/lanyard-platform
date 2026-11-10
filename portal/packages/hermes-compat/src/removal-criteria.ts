/**
 * Explicit removal criteria for Hermes deployment compatibility.
 *
 * Bead: `lp-k7g.8.7` — preserve existing Hermes deployment compatibility.
 *
 * Compatibility code in this package (and dual-emit surfaces in sibling
 * packages) must **not** be deleted until every criterion below is satisfied
 * and recorded. Phase 8 cutover beads may flip checklist status; this bead
 * only defines the gates.
 */

export type RemovalSurface =
  | "env"
  | "endpoint"
  | "control_plane"
  | "wire_field"
  | "deploy"
  | "docs";

/**
 * Checklist item. `met` is always false in this package until a future bead
 * records evidence; helpers accept an overrides map for CI / operator review.
 */
export type RemovalCriterion = {
  /** Stable id for tracking (e.g. env.backend-home-only). */
  id: string;
  surface: RemovalSurface;
  /** What is still kept for compatibility. */
  keeps: string;
  /** What "done" looks like before removal is allowed. */
  gate: string;
  /** Suggested evidence (logs, grep, pin audits). */
  evidenceHint: string;
  /** Related beads / packages / docs. */
  related: readonly string[];
};

/**
 * Master checklist. Order is documentation only — all must be met to retire
 * the corresponding surface; use `criteriaForSurface` for partial retirements.
 */
export const HERMES_COMPAT_REMOVAL_CRITERIA: readonly RemovalCriterion[] = [
  {
    id: "env.preferred-names-in-all-units",
    surface: "env",
    keeps: "HERMES_HOME, HERMES_INSTALL_PATH, HERMES_ARTIFACT_* accepted as aliases",
    gate:
      "All systemd units, bootstrap scripts, and operator .env examples set BACKEND_* " +
      "preferred names. HERMES_* either equals BACKEND_* dual-write or is absent.",
    evidenceHint:
      "grep -R HERMES_HOME deploy/ portal/ ; unit files show BACKEND_HOME=; no unit-only HERMES_HOME",
    related: [
      "lp-k7g.8.7",
      "contracts/backend-runtime-v1/filesystem-layout.md",
      "@lanyard/hermes-compat resolveEnvAlias",
    ],
  },
  {
    id: "env.no-legacy-only-production",
    surface: "env",
    keeps: "resolveEnvAlias fall-back when only HERMES_* is set",
    gate:
      "Production Hermes-Lanyard and deploy smoke inventories show zero hosts that set " +
      "only HERMES_* without the matching BACKEND_* name.",
    evidenceHint:
      "Fleet / mocklab inventory audit; dualWriteEnvAlias.usedLegacyOnly empty in prod probes",
    related: ["lp-k7g.8.7", "lp-k7g.7.4", "deploy/"],
  },
  {
    id: "endpoint.clients-on-preferred-paths",
    surface: "endpoint",
    keeps: "GET|POST /api/hermes/projects dual-mounted with deprecation headers",
    gate:
      "Portal web and any external API clients call /api/agent/projects (or equivalent " +
      "preferred path). Access logs show no production traffic to /api/hermes/* for N>=14 days " +
      "or an explicit operator waiver is filed.",
    evidenceHint:
      "BFF access logs; packages/web fetch paths; OpenAPI preferred paths only",
    related: [
      "lp-k7g.8.3",
      "lp-k7g.8.7",
      "@lanyard/hermes-compat HERMES_ENDPOINT_DEPRECATIONS",
    ],
  },
  {
    id: "endpoint.sunset-elapsed",
    surface: "endpoint",
    keeps: "legacy path registration + Deprecation/Link headers",
    gate:
      "Each HERMES_ENDPOINT_DEPRECATIONS entry has sunset set and that date has passed, " +
      "or the entry status is already retired with a tracked bead.",
    evidenceHint: "Catalog sunset fields + calendar / release notes",
    related: ["lp-k7g.8.7", "phase-8 cutover"],
  },
  {
    id: "control_plane.no-hermes-columns-readers",
    surface: "control_plane",
    keeps: "hermes_version / hermes_profile dual-read dual-write",
    gate:
      "All control-plane readers use backend_version / backend_profile only. " +
      "API clients no longer require hermes_* keys on responses.",
    evidenceHint:
      "grep hermes_version hermes_profile portal/; dual-emit flag off in staging",
    related: [
      "lp-k7g.8.2",
      "lp-k7g.8.7",
      "@lanyard/control-plane-fields",
      "docs/architecture/portal-control-plane-backend-fields.md",
    ],
  },
  {
    id: "control_plane.drop-hermes-columns",
    surface: "control_plane",
    keeps: "DB columns hermes_version, hermes_profile (cutover_later SQL stubs)",
    gate:
      "control_plane.no-hermes-columns-readers is met; migration DROP COLUMN applied " +
      "in a dedicated cutover bead (not lp-k7g.8.2 apply scripts).",
    evidenceHint:
      "CONTROL_PLANE_BACKEND_FIELD_MIGRATION phase cutover_later executed; schema dump",
    related: [
      "lp-k7g.8.2",
      "phase-8",
      "@lanyard/control-plane-fields migration.ts",
    ],
  },
  {
    id: "wire_field.brain-rpc-subject",
    surface: "wire_field",
    keeps: "hermes_profile on Brain RPC subject alongside backend_profile",
    gate:
      "All backends and Portal BFF stamp backend_profile; hosts ignore hermes_profile; " +
      "brain-rpc schema marks hermes_profile removed or optional-deprecated with no readers.",
    evidenceHint:
      "contracts/backend-runtime-v1/brain-rpc.schema.json; host auth subject parsers",
    related: ["lp-k7g.8.1", "lp-k7g.8.7", "backend-runtime-v1"],
  },
  {
    id: "wire_field.settings-snapshot-hermes-home",
    surface: "wire_field",
    keeps: "settings.snapshot hermes_home alias of backend_home",
    gate:
      "Clients read backend_home only; hermes_home dual-emit disabled after soak.",
    evidenceHint: "settings snapshot consumers; OpenAPI",
    related: ["lp-k7g.8.4", "lp-k7g.8.7"],
  },
  {
    id: "deploy.artifact-env-primary",
    surface: "deploy",
    keeps: "user_data dual-write HERMES_ARTIFACT_* with BACKEND_ARTIFACT_*",
    gate:
      "Bootstrap and host units read BACKEND_ARTIFACT_* only; HERMES_ARTIFACT_* dual-write " +
      "removed from templates after lp-k7g.7.x consumers migrate.",
    evidenceHint:
      "artifact-pins.env fragments; bootstrap-backend-install.sh env parser",
    related: [
      "lp-k7g.7.3",
      "lp-k7g.7.4",
      "docs/architecture/deploy-backend-artifact-variables.md",
    ],
  },
  {
    id: "docs.no-hermes-operator-primary",
    surface: "docs",
    keeps: "Migration docs that still show Hermes names as primary examples",
    gate:
      "Runbooks and Portal operator docs lead with BACKEND_* and /api/agent/*; " +
      "Hermes names appear only in a dedicated compatibility appendix.",
    evidenceHint: "docs/ + portal/ README review checklist",
    related: ["lp-k7g.8.7", "phase-8"],
  },
] as const;

export type RemovalCriterionId =
  (typeof HERMES_COMPAT_REMOVAL_CRITERIA)[number]["id"];

/**
 * Evaluate checklist against an operator/CI status map.
 * Unknown ids in `met` are ignored; missing ids default to false.
 */
export function evaluateRemovalCriteria(
  met: Partial<Record<string, boolean>> = {},
): {
  total: number;
  metCount: number;
  unmet: RemovalCriterion[];
  allMet: boolean;
  bySurface: Record<RemovalSurface, { total: number; metCount: number }>;
} {
  const unmet: RemovalCriterion[] = [];
  let metCount = 0;
  const bySurface = {} as Record<
    RemovalSurface,
    { total: number; metCount: number }
  >;

  for (const criterion of HERMES_COMPAT_REMOVAL_CRITERIA) {
    if (!bySurface[criterion.surface]) {
      bySurface[criterion.surface] = { total: 0, metCount: 0 };
    }
    bySurface[criterion.surface].total += 1;
    if (met[criterion.id] === true) {
      metCount += 1;
      bySurface[criterion.surface].metCount += 1;
    } else {
      unmet.push(criterion);
    }
  }

  return {
    total: HERMES_COMPAT_REMOVAL_CRITERIA.length,
    metCount,
    unmet,
    allMet: unmet.length === 0,
    bySurface,
  };
}

/** Criteria for one surface (env, endpoint, …). */
export function criteriaForSurface(
  surface: RemovalSurface,
): RemovalCriterion[] {
  return HERMES_COMPAT_REMOVAL_CRITERIA.filter((c) => c.surface === surface);
}

/**
 * Whether a surface may be retired given a status map.
 * Requires every criterion on that surface to be marked met.
 */
export function canRemoveSurface(
  surface: RemovalSurface,
  met: Partial<Record<string, boolean>> = {},
): boolean {
  const items = criteriaForSurface(surface);
  if (items.length === 0) return false;
  return items.every((c) => met[c.id] === true);
}

/**
 * Markdown checklist for docs / PR evidence (all items unchecked by default).
 */
export function removalChecklistMarkdown(
  met: Partial<Record<string, boolean>> = {},
): string {
  const lines: string[] = [
    "# Hermes compatibility removal criteria",
    "",
    "Do **not** delete HERMES_* env aliases, `/api/hermes/*` routes, or control-plane",
    "`hermes_*` columns until every box is checked with evidence.",
    "",
    "Bead: `lp-k7g.8.7` (definition) · execution: phase 8 / dedicated cutover beads.",
    "",
  ];

  let current: RemovalSurface | null = null;
  for (const c of HERMES_COMPAT_REMOVAL_CRITERIA) {
    if (c.surface !== current) {
      current = c.surface;
      lines.push(`## Surface: \`${current}\``, "");
    }
    const mark = met[c.id] === true ? "x" : " ";
    lines.push(`- [${mark}] **\`${c.id}\`** — ${c.gate}`);
    lines.push(`  - Keeps: ${c.keeps}`);
    lines.push(`  - Evidence: ${c.evidenceHint}`);
    lines.push(`  - Related: ${c.related.join(", ")}`);
    lines.push("");
  }

  const summary = evaluateRemovalCriteria(met);
  lines.push(
    `## Summary`,
    "",
    `${summary.metCount} / ${summary.total} criteria met. ` +
      (summary.allMet
        ? "All gates passed — removal PRs may proceed per surface."
        : "Compatibility layer must remain."),
    "",
  );
  return lines.join("\n");
}

/**
 * Hard rule for code comments and linters: removal of hermes-compat exports
 * requires evaluateRemovalCriteria(…).allMet === true for the surfaces touched.
 */
export const REMOVAL_POLICY = {
  package: "@lanyard/hermes-compat",
  beadDefined: "lp-k7g.8.7",
  beadExecute: "phase-8 cutover / dedicated retirement beads",
  rule:
    "Never remove ENV_ALIAS_PAIRS, HERMES_ENDPOINT_DEPRECATIONS, or dual-emit " +
    "helpers while evaluateRemovalCriteria reports unmet items on that surface.",
} as const;
