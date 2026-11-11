# Platform monorepo migration

## Context

Lanyard currently has separate repositories for Portal, client-core, company-brain-deploy, Lanyard Agent, Hermes-Lanyard, and Hermes upstream. Portal should be able to use different backend agents without changing Portal behavior. The new monorepo will own the platform, deployment pipeline, shared contracts, docs, and Beads. Backend agent source remains outside the monorepo and ships as versioned tarballs.

## Scope

Included:

- Create the Lanyard Platform monorepo as the home for Portal, client-core, deploy, shared contracts, docs, and Beads.
- Define `backend-runtime-v1` using Hermes-Lanyard as the reference.
- Generalize deploy from `hermes.*` artifact pins to `backend.*` artifact pins.
- Generalize Portal from Hermes-specific settings/projects paths to a backend runtime interface.
- Preserve client-core as a separate artifact that deploy installs next to the selected backend.
- Add conformance tests so Hermes-Lanyard, Hermes upstream, and Lanyard Agent can prove compatibility before release.

Excluded:

- Copying Hermes upstream source into the monorepo.
- Copying Hermes-Lanyard source into the monorepo.
- Copying Lanyard Agent source into the monorepo by default.
- Changing production infrastructure during planning.
- Storing runtime secrets or customer-specific live configuration in git.

## Constraints

- Hermes-Lanyard remains synced from the Nous upstream line, so it stays outside the monorepo.
- Lanyard Agent remains a backend product unless a later decision changes that boundary.
- Existing EC2 deploy already downloads tarball artifacts and verifies SHA-256. The migration should generalize that pipeline rather than replace it.
- Portal should talk to the selected backend through relay and Brain RPC, not by reading backend-specific files directly.
- Runtime config values live on the host or in AWS secrets/config systems. The monorepo owns schemas, defaults, templates, pins, validators, and runbooks.

## Alternatives considered

### Put every repository into one monorepo

This gives the most local context, but it creates friction for Hermes upstream sync and blurs backend product boundaries. It also makes backend swapping look like a source layout problem when it is really a runtime contract problem.

### Keep all repositories separate

This preserves existing release boundaries, but it leaves docs, deploy pins, Beads, and shared contracts spread across repositories. Agents need too much context loaded before they can make a safe change.

### Platform monorepo with external backend products

This is the selected design. Portal, client-core, deploy, contracts, docs, and Beads move into one platform monorepo. Backend agents stay external and publish artifacts that conform to `backend-runtime-v1`.

## Applicable skills and principles

Implementation work should use these skills:

- `pstack-playbooks`
- `how`
- `architect`
- `typescript-best-practices` for Portal TypeScript
- `principle-foundational-thinking`
- `principle-boundary-discipline`
- `principle-model-the-domain`
- `principle-make-operations-idempotent`
- `principle-sequence-verifiable-units`
- `principle-redesign-from-first-principles`
- `principle-prove-it-works`
- `unslop`

The main design decisions come from:

- Foundational thinking. Define contracts and data shapes before moving code.
- Boundary discipline. Validate artifact manifests, config files, and network frames at boundaries.
- Model the domain. Represent backend runtime selection as data, not as Hermes-specific conditionals.
- Idempotent operations. Bootstrap and migration scripts must be safe to rerun.
- Sequence verifiable units. Each phase must end with a real check.

## Phases

1. [Repository foundation](phase-1-repository-foundation.md). Bead `lp-k7g.5`.
2. [Backend runtime contract](phase-2-backend-runtime-contract.md). Bead `lp-k7g.6`.
3. [Artifact and deploy generalization](phase-3-artifact-deploy-generalization.md). Bead `lp-k7g.7`.
4. [Portal backend abstraction](phase-4-portal-backend-abstraction.md). Bead `lp-k7g.8`.
5. [Client-core migration](phase-5-client-core-migration.md). Bead `lp-k7g.9`.
6. [Deploy migration](phase-6-deploy-migration.md). Bead `lp-k7g.10`.
7. [Backend conformance and external backend readiness](phase-7-backend-conformance.md). Bead `lp-k7g.11`.
8. [Cutover and repository archival](phase-8-cutover.md). Bead `lp-k7g.12`.

## Verification

Planning verification:

```bash
bash scripts/validate.sh
git status --short
bd status
bd list
```

Offline checks (docs links, pins example, contract stub, Beads export) and future CI placement: [validation-plan.md](../../architecture/validation-plan.md).

Future implementation verification:

```bash
bash deploy/scripts/validate-compatibility.sh compatibility/pins.example.yaml
bash deploy/scripts/smoke-bootstrap-extract.sh
pnpm -C portal test
pnpm -C portal typecheck
terraform -chdir=deploy/environments/platform-staging validate
```

These paths are permanent per [ADR 0004](../../adr/0004-monorepo-workspace-paths.md) (`portal/`, `client-core/`, `deploy/`, `contracts/`, `docs/`, `compatibility/`). Commands may gain env-specific flags after import, but the path prefixes should not change without a superseding ADR. See [workspace-map.md](../../architecture/workspace-map.md).

## Beads

The migration backlog lives in Beads in this repository.

Main epic: `lp-k7g`. Phase epics: `lp-k7g.5` … `lp-k7g.12` (one per phase above).

```bash
bd ready
bd show lp-k7g
bd show <id>
```

Agent workflow (claim, update, close with completion evidence, link deps): [beads-workflow.md](../../architecture/beads-workflow.md). Full task index: [issue-map.md](issue-map.md).

Closed planning records:

- `lp-k7g.1`: read pstack principles and playbook.
- `lp-k7g.2`: capture scope and repository boundary.
- `lp-k7g.3`: write migration plan docs.
- `lp-k7g.4`: create migration backlog.
