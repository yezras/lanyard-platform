# Phase 7. Backend conformance and external backend readiness

Back to [overview](overview.md).

## Goal

Prove that each backend product can be swapped into Portal and deploy through the same contract.

Bead: `lp-k7g.11`.

## Changes

- Add a fake relay harness for backend conformance tests.
  - **Landed (`lp-k7g.11.1`):** offline harness under
    [`contracts/backend-runtime-v1/harness/`](../../../contracts/backend-runtime-v1/harness/)
    — validates `hello`, injects chat `inbound`, sends `interrupt_inbound` and
    `brain_rpc_request` over a mock socket (`python3 …/harness/run_tests.py`;
    `scripts/validate.sh` check 18).
- Validate backend artifact manifests.
  - **Landed (`lp-k7g.11.2`):** offline tarball check
    [`scripts/validate-backend-tarball.py`](../../../scripts/validate-backend-tarball.py)
    — fixture archive has schema-valid `manifest/backend.json`, executable
    `bin/company-brain-backend`, kind/version/contract match pins
    (`scripts/validate.sh` check 19;
    fixture under `contracts/backend-runtime-v1/fixtures/`).
- Verify gateway startup, relay hello, chat injection, interrupt, Brain RPC, settings snapshot, projects list, and vault read.
  - **Landed offline (`lp-k7g.11.3`):** required Brain RPC methods via
    [`harness/fake_brain_rpc.py`](../../../contracts/backend-runtime-v1/harness/fake_brain_rpc.py)
    + harness wire tests (`run_brain_rpc_conformance.py`; `validate.sh` check 20)
    and Portal
    [`FakeBrainRpcInvoker`](../../../portal/packages/backend-runtime/src/fake-brain-rpc.ts)
    suite (`test/brain-rpc-conformance.test.ts`). Covers ping/health, vault ACL
    (contributor vs admin), schema-shaped `settings.snapshot` / `projects.list`.
  - **Landed job (`lp-k7g.11.4`):** Hermes-Lanyard artifact conformance job
    [`scripts/run-hermes-lanyard-conformance.py`](../../../scripts/run-hermes-lanyard-conformance.py)
    — offline: pin resolve → fixture tarball validate → entrypoint smoke →
    fake relay + required Brain RPC (`validate.sh` check 21). Download mode
    documented for `s3://` / `https://` when CI secrets + real pins exist
    (workflow [`.github/workflows/conformance.yml`](../../../.github/workflows/conformance.yml); path filters + release gate in `lp-k7g.12.4`).
- Track external readiness work for Hermes-Lanyard, Hermes upstream, and Lanyard Agent.
  - **Landed (`lp-k7g.11.5`):** Hermes upstream compatibility assessment —
    missing contract pieces, shim/adapter options, upstream sync constraints —
    [`docs/architecture/hermes-upstream-compatibility.md`](../../architecture/hermes-upstream-compatibility.md).
    Production hosts stay on `hermes_lanyard`; raw Nous is not a customer pin.
  - **Landed (`lp-k7g.11.6`):** Lanyard Agent external implementation checklist —
    platform ACs mapped 1:1 (Brain RPC, `BACKEND_HOME`, settings/profile/projects,
    artifact manifest/entrypoint), owners, definitions of done, and GitHub follow-ups
    on [LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent)
    (#134–#137) —
    [`docs/architecture/lanyard-agent-conformance-gaps.md`](../../architecture/lanyard-agent-conformance-gaps.md).
    Product code stays external; monorepo does not vendor LA source.
- Publish a compatibility matrix for backend versions and contract versions.
  - **Landed (`lp-k7g.11.7`):** published matrix of backend kind, version,
    contract majors, capabilities, conformance result, and deploy readiness —
    [backend-compatibility-matrix.md](../../architecture/backend-compatibility-matrix.md).
    Surface detail remains in
    [conformance.md](../../../contracts/backend-runtime-v1/conformance.md);
    deploy docs (`deploy/references/readiness-matrix.md`, pin-update,
    compatibility README) link to the published matrix.

## Data structures

- `BackendConformanceRun`: backend kind, artifact version, contract version, result, evidence.
- `BackendCapabilityMatrix`: method support by backend family and version.

Recorded in [backend-compatibility-matrix.md](../../architecture/backend-compatibility-matrix.md)
(summary + evidence log) and surface tables in
[conformance.md](../../../contracts/backend-runtime-v1/conformance.md).

## Verification

- Hermes-Lanyard passes conformance first.
- Lanyard Agent failing checks are explicit backlog items (seed list:
  [lanyard-agent-conformance-gaps.md](../../architecture/lanyard-agent-conformance-gaps.md);
  published matrix: [backend-compatibility-matrix.md](../../architecture/backend-compatibility-matrix.md);
  surface matrix: [conformance.md](../../../contracts/backend-runtime-v1/conformance.md)).
- A selected backend can be deployed without Portal code changes.
