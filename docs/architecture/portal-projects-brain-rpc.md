# Portal: route agent projects through Brain RPC

Bead: `lp-k7g.8.3` (phase 4 — Portal backend abstraction).

## Goal

Stop BFF route handlers from reading `$HERMES_HOME/projects.db` or shelling
`hermes project create` directly. Agent project list/create go through
`BackendRuntimeService`, which in production invokes Brain RPC.

| Surface | Contract | Production path |
| --- | --- | --- |
| List agent projects | `projects.list` (**required** v1) | `listAgentProjects` → `BackendRuntimeService.listProjects` → Brain RPC |
| Create agent project | `projects.create` (**expansion**) | `createAgentProject` → capability gate → `createProject?` → Brain RPC |
| Delete agent project | `projects.delete` (**expansion**, soft-archive) | `deleteAgentProject` → `deleteProject?` → Brain RPC `{id}` → `{id, archived:true}` |
| Control-plane vault_path projects | Portal CP APIs | Unchanged (`/api/projects` via authClient) |

### projects.delete semantics (`lp-uxy.5`)

Soft-archive only:

- Host marks the agent project registry row archived so it leaves the Directory
  list (`projects.list` default excludes archived).
- **Does not** purge vault/workspace folders or `rmtree` agent disk.
- Wire: `params_projects_delete` / `result_projects_delete` in
  `brain-rpc.schema.json`; examples `brain-rpc.projects-delete.*.json`.
- Portal confirm copy must state files stay on disk (see
  `ChatHistorySideNav` project delete confirm).

## Why two project concepts

| Kind | Today (pre-import Portal) | Source of truth |
| --- | --- | --- |
| **Agent working directories** | `GET/POST /api/hermes/projects` | Host `projects.db` via Hermes / Brain RPC |
| **Control-plane ACL projects** | `GET/POST /api/projects` | Control-plane DB `vault_path` rows |

Chat Directory uses **agent** projects. This bead only rewires that path.

## Package surface

[`portal/packages/backend-runtime`](../../portal/packages/backend-runtime/):

| Module | Role |
| --- | --- |
| `src/projects-bff.ts` | Thin BFF adapter: parse create contract, capability gate, list/create handlers |
| `src/hermes-adapter.ts` | `projectsRequireBrainRpc` + `createProductionHermesBackendRuntimeService` |
| `src/fake-backend.ts` | **Test-only** in-memory projects |
| `src/service.ts` | `listProjects` / optional `createProject` |

### Production composition (after Portal import)

```ts
// packages/bff composition root
import {
  createProductionHermesBackendRuntimeService,
  createAgentProjectsHandlers,
  backendContextFromSession,
  agentProjectsErrorToHttp,
} from "@lanyard/backend-runtime";

const backendRuntime = createProductionHermesBackendRuntimeService({
  invokeBrainRpc: (input) => relay.invokeBrainRpc(input), // brain-rpc.ts + relay
});

const agentProjects = createAgentProjectsHandlers(backendRuntime);

// app.ts — replace hermesProjects.listProjects() / createProject()
api.get("/hermes/projects", async (c) => {
  const ctx = backendContextFromSession({ /* tenant, user, rbac… */ });
  try {
    return c.json(await agentProjects.list(ctx));
  } catch (err) {
    const { status, body } = agentProjectsErrorToHttp(err);
    return c.json(body, status);
  }
});

api.post("/hermes/projects", csrfProtection, async (c) => {
  const ctx = backendContextFromSession({ /* … */ });
  try {
    const project = await agentProjects.create(ctx, await c.req.json());
    return c.json(project, 201);
  } catch (err) {
    const { status, body } = agentProjectsErrorToHttp(err);
    return c.json(body, status);
  }
});
```

**Do not** inject `projects: hermesProjectsService` into production composition.
Local SQLite/CLI ports remain available on `HermesBackendRuntimeService` only when
`projectsRequireBrainRpc: false` (unit tests / temporary migration harnesses).

## projects.create contract (defined before UI enablement)

Normative wire shapes live in
[`contracts/backend-runtime-v1/brain-rpc.schema.json`](../../contracts/backend-runtime-v1/brain-rpc.schema.json):

- `$defs/params_projects_create` — `{ name, folders? }`
- `$defs/result_projects_create` — `projectRow` (`id`, `name`, …)

Examples:

- [`brain-rpc.projects-create.request.json`](../../contracts/backend-runtime-v1/examples/brain-rpc.projects-create.request.json)
- [`brain-rpc.projects-create.result.json`](../../contracts/backend-runtime-v1/examples/brain-rpc.projects-create.result.json)

### UI / BFF gates (required)

1. **Capability**: host must advertise `features.projects_create === true` **or**
   `brain_rpc_methods` includes `projects.create`.
2. **BFF**: `createAgentProject` enforces the gate by default
   (`requireCapabilityAdvertisement: true`).
3. **UI**: do not show create until the same capability is true (follow-on:
   `lp-k7g.8.5` models capabilities in BFF responses).
4. Expansion hosts may return `method_not_found` — map to HTTP 404.

Legacy body alias: `vault_path` → single-element `folders` (current web
`createProject` mapping). Prefer `folders` in new clients.

## Local fixtures remain test-only

| Fixture | Allowed where |
| --- | --- |
| `FakeBackendRuntimeService` | Unit / contract tests |
| `createMemoryHermesProjectsStore` (real Portal) | BFF integration tests |
| Writable mini `projects.db` builders | Integration tests only |
| Live `$HERMES_HOME/projects.db` via local port | Migration harness with `projectsRequireBrainRpc: false` — **not** production default |

Production always: `createProductionHermesBackendRuntimeService({ invokeBrainRpc })`.

## Real portal paths (reference tree)

Live monorepo path: `portal/`

| Path | Role today |
| --- | --- |
| `packages/bff/src/app.ts` | `GET/POST /hermes/projects` using `hermesProjects` |
| `packages/bff/src/hermes-projects.ts` | SQLite + `hermes project create` CLI |
| `packages/bff/src/hermes/projects.ts` | Vault multi-root helpers over projects.db |
| `packages/bff/src/brain-rpc.ts` | Auth stamp + request frame builder |
| `packages/web/src/api/hermesProjects.ts` | `fetchHermesProjects` / `createHermesProject` |
| `packages/web/src/api/projects.ts` | Re-exports Hermes-backed chat Directory API |

### Migration steps when Portal lands

1. Add `@lanyard/backend-runtime` to Portal pnpm workspace.
2. Composition root: `createProductionHermesBackendRuntimeService({ invokeBrainRpc })`.
3. Swap `/hermes/projects` handlers to `createAgentProjectsHandlers`.
4. Keep `hermes-projects.ts` only for tests / optional offline dev flag.
5. Web: dual-mount `/api/hermes/projects` (deprecated alias) and preferred
   `/api/agent/projects`; attach deprecation headers on the legacy path
   (`lp-k7g.8.7` / `@lanyard/hermes-compat`).
6. Gate create UI on `projects_create` capability (`lp-k7g.8.5`).

## Acceptance mapping

| Criterion | Evidence |
| --- | --- |
| `projects.list` uses Brain RPC in production | `createProductionHermesBackendRuntimeService` + `listAgentProjects`; local port ignored when RPC configured |
| `projects.create` contract defined before UI uses it | Schema `$defs/params_projects_create` / `result_projects_create` + `parseProjectsCreateInput` + capability gate |
| Local fixtures remain test-only | Fake backend + `projectsRequireBrainRpc` fail-closed without invoker |

## Related

- [portal-backend-runtime-service.md](portal-backend-runtime-service.md) — interface boundary
- [backend-runtime-contract.md](backend-runtime-contract.md) — Brain RPC overview
- Phase plan: [phase-4-portal-backend-abstraction.md](../plans/0001-platform-monorepo-migration/phase-4-portal-backend-abstraction.md)
- Follow-on: [portal-settings-brain-rpc.md](portal-settings-brain-rpc.md) (`lp-k7g.8.4`); [portal-capabilities-bff.md](portal-capabilities-bff.md) (`lp-k7g.8.5`)
