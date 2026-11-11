# Portal: preserve Hermes deployment compatibility

Bead: `lp-k7g.8.7` (phase 4 — Portal backend abstraction).

## Goal

Keep **current Hermes-Lanyard deployments** working while Portal moves to
backend-neutral names (`BACKEND_*`, Brain RPC, agent project routes). Provide:

1. **Env var aliases** — `HERMES_*` still accepted; map to `BACKEND_*`
2. **Deprecation notes** for `/hermes/*` (and `/api/hermes/*`) endpoints
3. **Explicit removal criteria** so compatibility code is not deleted early

Package (pre-import scaffolding):
[`portal/packages/hermes-compat`](../../portal/packages/hermes-compat/).

## Why a dedicated package

Sibling packages already dual-emit some Hermes names:

| Package | Hermes surface |
| --- | --- |
| `@lanyard/control-plane-fields` | `hermes_version`, `hermes_profile` columns / API |
| `@lanyard/backend-runtime` | `HermesBackendRuntimeService`, snapshot `hermes_home` |
| Deploy modules | `HERMES_ARTIFACT_*`, `HERMES_HOME` dual-write |

This bead consolidates **Portal process-env resolution**, **HTTP wire path
deprecation**, and a **single removal checklist** so operators and agents have
one place to answer: “can we drop Hermes names yet?”

## 1. Env var aliases

### Policy

| Rule | Behavior |
| --- | --- |
| Preferred | `BACKEND_HOME`, `BACKEND_INSTALL_PATH`, `BACKEND_ARTIFACT_*` |
| Accept | Matching `HERMES_*` when preferred is unset / sentinel |
| Equal dual-set | OK — effective value is either |
| Conflict | Prefer fail closed (`EnvAliasConflictError`) if both set and differ |
| Dual-write | Emit both names with the same value for systemd / bootstrap fragments |

Sentinels treated as unset: empty, `UNCONFIGURED`, `REPLACE_ME` (aligned with
deploy Terraform locals).

### Alias table

| Preferred | Temporary legacy | Role |
| --- | --- | --- |
| `BACKEND_HOME` | `HERMES_HOME` | Runtime home (`config.yaml`, profiles, projects.db) |
| `BACKEND_INSTALL_PATH` | `HERMES_INSTALL_PATH` | Artifact install prefix (not home) |
| `BACKEND_ARTIFACT_URL` | `HERMES_ARTIFACT_URL` | Pin URL |
| `BACKEND_ARTIFACT_VERSION` | `HERMES_ARTIFACT_VERSION` | Pin version |
| `BACKEND_ARTIFACT_SHA256` | `HERMES_ARTIFACT_SHA256` | Pin digest |
| `BACKEND_ARTIFACT_SIGNATURE_B64` | `HERMES_ARTIFACT_SIGNATURE_B64` | Optional signature |

Platform-only names (no Hermes alias): `BACKEND_KIND`, contract majors,
`VAULT_ROOT`, gateway relay vars, `BRAIN_*` — see
[filesystem-layout.md](../../contracts/backend-runtime-v1/filesystem-layout.md).

### BFF usage (after Portal import)

```ts
import {
  resolveBackendHome,
  resolveAllEnvAliases,
} from "@lanyard/hermes-compat";

// Composition / health probes / migration ports:
const backendHome = resolveBackendHome(process.env);
// Existing hosts that only export HERMES_HOME continue to work.
```

Normative host rule for Hermes-compatible kinds remains:

```text
HERMES_HOME=$BACKEND_HOME
```

## 2. Endpoint deprecation notes

### Agent projects (primary Hermes HTTP surface today)

| Method | Legacy (keep live) | Preferred (new clients) |
| --- | --- | --- |
| GET | `/api/hermes/projects` | `/api/agent/projects` |
| POST | `/api/hermes/projects` | `/api/agent/projects` |

BFF app mounts (without `/api` prefix used by Hono `api` router):

| Legacy mount | Preferred mount | Handler |
| --- | --- | --- |
| `/hermes/projects` | `/agent/projects` | `createAgentProjectsHandlers` from `@lanyard/backend-runtime` |

### Deprecation response headers (legacy path only)

| Header | Value |
| --- | --- |
| `Deprecation` | `true` |
| `Link` | `</api/agent/projects>; rel="successor-version"` |
| `X-Lanyard-Deprecation-Note` | Human note from catalog |
| `Sunset` | Optional HTTP-date once scheduled |

Helpers: `deprecationHeadersForLegacyPath`, `deprecationNoteForPath`,
`dualMountPlan` in `@lanyard/hermes-compat`.

### Composition sketch

```ts
import {
  createAgentProjectsHandlers,
  createProductionHermesBackendRuntimeService,
} from "@lanyard/backend-runtime";
import {
  deprecationHeadersForLegacyPath,
  dualMountPlan,
} from "@lanyard/hermes-compat";

const backend = createProductionHermesBackendRuntimeService({ invokeBrainRpc });
const agentProjects = createAgentProjectsHandlers(backend);

for (const mount of dualMountPlan()) {
  for (const method of mount.methods) {
    // preferred + legacy → same handler
    // on legacy only: set deprecationHeadersForLegacyPath(mount.legacyPath)
  }
}
```

Settings routes already use backend-neutral `/api/settings/*` (no Hermes path
rename required for `lp-k7g.8.4`). Control-plane ACL projects stay on
`/api/projects` (distinct from agent projects).

## 3. Removal criteria

Compatibility code must not be removed until
`HERMES_COMPAT_REMOVAL_CRITERIA` gates pass. Surfaces:

| Surface | Examples of gates |
| --- | --- |
| `env` | Units/docs use `BACKEND_*`; no prod legacy-only env |
| `endpoint` | Clients on `/api/agent/*`; sunset elapsed / no prod `/hermes` traffic |
| `control_plane` | Readers use `backend_*`; then DROP `hermes_*` columns |
| `wire_field` | Brain RPC subject / settings snapshot drop Hermes dual-emit |
| `deploy` | Bootstrap reads `BACKEND_ARTIFACT_*` only |
| `docs` | Runbooks lead with backend-neutral names |

Evaluate offline:

```ts
import {
  evaluateRemovalCriteria,
  removalChecklistMarkdown,
  canRemoveSurface,
} from "@lanyard/hermes-compat";

evaluateRemovalCriteria().allMet; // false until operators mark gates
canRemoveSurface("endpoint", statusMap);
```

**This bead defines the checklist; it does not execute cutover.** Phase 8 /
dedicated retirement beads flip status and delete aliases.

Control-plane DROP COLUMN SQL remains `phase: "cutover_later"` in
[`@lanyard/control-plane-fields` migration stubs](../../portal/packages/control-plane-fields/src/migration.ts).

## Acceptance mapping

| Criterion | Evidence |
| --- | --- |
| existing env vars still work | `resolveEnvAlias` / `resolveBackendHome` accept `HERMES_*`; unit tests |
| old endpoints have deprecation notes | `HERMES_ENDPOINT_DEPRECATIONS` + `deprecationHeadersForLegacyPath`; unit tests |
| compatibility code has removal criteria | `HERMES_COMPAT_REMOVAL_CRITERIA` + `evaluateRemovalCriteria` + markdown checklist |

## Verification (offline, pre-import)

```bash
cd portal/packages/hermes-compat
npm install
npm test
npm run build
```

## Related

| Doc / package | Role |
| --- | --- |
| [`portal/packages/hermes-compat`](../../portal/packages/hermes-compat/) | Implementation |
| [portal-backend-runtime-service.md](portal-backend-runtime-service.md) | BFF interface |
| [portal-projects-brain-rpc.md](portal-projects-brain-rpc.md) | `/hermes/projects` → Brain RPC |
| [portal-control-plane-backend-fields.md](portal-control-plane-backend-fields.md) | CP field aliases |
| [filesystem-layout.md](../../contracts/backend-runtime-v1/filesystem-layout.md) | `HERMES_HOME=$BACKEND_HOME` |
| [deploy-backend-artifact-variables.md](deploy-backend-artifact-variables.md) | Deploy env dual-write |
| Phase plan | [phase-4-portal-backend-abstraction.md](../plans/0001-platform-monorepo-migration/phase-4-portal-backend-abstraction.md) |
| Follow-on | `lp-k7g.8.8` fake backend contract tests; phase 8 cutover |
