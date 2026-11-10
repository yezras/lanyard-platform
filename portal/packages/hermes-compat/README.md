# `@lanyard/hermes-compat`

Preserve **existing Hermes-Lanyard deployments** during Portal backend
abstraction.

Bead: **`lp-k7g.8.7`** (phase 4 — Portal backend abstraction).

## What this package provides

| Surface | Behavior |
| --- | --- |
| **Env aliases** | Accept `HERMES_*` process env; map to preferred `BACKEND_*` |
| **Endpoint deprecations** | Catalog of `/api/hermes/*` → backend-neutral routes + response headers |
| **Removal criteria** | Explicit checklist — do not delete compat code until gates pass |

Design: [`docs/architecture/portal-hermes-deployment-compat.md`](../../../docs/architecture/portal-hermes-deployment-compat.md).

## Env aliases

```ts
import {
  resolveBackendHome,
  resolveEnvAlias,
  dualWriteEnvAlias,
  resolveAllEnvAliases,
} from "@lanyard/hermes-compat";

// Existing deployments that only set HERMES_HOME keep working:
resolveBackendHome({ HERMES_HOME: "/home/hermes/.hermes" });
// → "/home/hermes/.hermes"

// Prefer BACKEND_* when both set and equal; conflict if they differ:
resolveEnvAlias("BACKEND_HOME", {
  BACKEND_HOME: "/var/lib/company-brain-backend",
  HERMES_HOME: "/var/lib/company-brain-backend",
});
```

| Preferred | Temporary legacy |
| --- | --- |
| `BACKEND_HOME` | `HERMES_HOME` |
| `BACKEND_INSTALL_PATH` | `HERMES_INSTALL_PATH` |
| `BACKEND_ARTIFACT_URL` | `HERMES_ARTIFACT_URL` |
| `BACKEND_ARTIFACT_VERSION` | `HERMES_ARTIFACT_VERSION` |
| `BACKEND_ARTIFACT_SHA256` | `HERMES_ARTIFACT_SHA256` |
| `BACKEND_ARTIFACT_SIGNATURE_B64` | `HERMES_ARTIFACT_SIGNATURE_B64` |

Sentinels `UNCONFIGURED` / `REPLACE_ME` / empty are treated as unset (same idea
as deploy Terraform locals).

## Endpoint deprecation

Legacy wire paths stay live for web clients; new clients use preferred paths.

| Legacy (deprecated) | Preferred |
| --- | --- |
| `GET/POST /api/hermes/projects` | `GET/POST /api/agent/projects` |

```ts
import {
  deprecationHeadersForLegacyPath,
  dualMountPlan,
  deprecationNoteForPath,
} from "@lanyard/hermes-compat";

// On legacy route only:
const headers = deprecationHeadersForLegacyPath("/api/hermes/projects");
// Deprecation: true
// Link: </api/agent/projects>; rel="successor-version"
// X-Lanyard-Deprecation-Note: …

// BFF composition: dual-register mounts from dualMountPlan()
```

## Removal criteria

```ts
import {
  HERMES_COMPAT_REMOVAL_CRITERIA,
  evaluateRemovalCriteria,
  canRemoveSurface,
  removalChecklistMarkdown,
} from "@lanyard/hermes-compat";

// Default: nothing met — keep the compatibility layer.
evaluateRemovalCriteria().allMet; // false
canRemoveSurface("endpoint"); // false

// Print operator checklist:
console.log(removalChecklistMarkdown());
```

Surfaces covered: `env`, `endpoint`, `control_plane`, `wire_field`, `deploy`,
`docs`. See `HERMES_COMPAT_REMOVAL_CRITERIA` for gates and evidence hints.

**Do not** drop `ENV_ALIAS_PAIRS`, dual-mounted `/hermes/*` routes, or
control-plane `hermes_*` columns until the relevant surface criteria are met
(phase 8 / dedicated cutover beads).

## Layout

```text
portal/packages/hermes-compat/
  src/
    env-aliases.ts       # HERMES_* → BACKEND_*
    endpoints.ts         # /hermes/* deprecation catalog + headers
    removal-criteria.ts  # checklist + evaluateRemovalCriteria
    index.ts
  test/
    hermes-compat.test.ts
```

## Develop

```bash
cd portal/packages/hermes-compat
npm install
npm test
npm run build
```

## Related

- `@lanyard/backend-runtime` — BFF host ops; agent projects handlers still dual-mountable on `/hermes/projects`
- `@lanyard/control-plane-fields` — `hermes_version` / `hermes_profile` dual-emit (retire under control_plane criteria)
- Deploy dual-write: [`docs/architecture/deploy-backend-artifact-variables.md`](../../../docs/architecture/deploy-backend-artifact-variables.md)
- Layout alias rule: [`contracts/backend-runtime-v1/filesystem-layout.md`](../../../contracts/backend-runtime-v1/filesystem-layout.md)
