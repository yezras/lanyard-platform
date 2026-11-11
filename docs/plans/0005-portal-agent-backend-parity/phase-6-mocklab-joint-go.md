# Phase 6 — Docker mocklab joint GO

**Back-link:** [overview.md](./overview.md)  
**Bead:** `lp-rt5.8`  
**Depends on:** monorepo phases 1–5 complete **and** agent plan joint-ready (Brain RPC + settings + projects + sandbox)

## Goal

Falsifiable joint proof on **Docker mocklab** with backend kind `lanyard_agent`: Settings, projects/Directory sandbox stamp, composer inventory, Office inline preview. Evidence artifact written. Epic `lp-rt5` may close only when this passes (grill Q7–Q8).

## Changes

- Topology: [docs/architecture/mocklab-agent-parity-topology.md](../../architecture/mocklab-agent-parity-topology.md)
- Compose sketch: [deploy/dev/mocklab-agent-parity/](../../../deploy/dev/mocklab-agent-parity/)
  (CP, relay, BFF, postgres; optional DS profile; LA external pin / host process)
- Proof script: `deploy/scripts/prove-mocklab-agent-parity.sh` that:
  - probes/pins LA backend (`lanyard-agent-gateway` + Brain RPC)
  - checks Settings snapshot (non-fixture; sections for host)
  - lists projects and stamps working directory
  - exercises composer inventory from host skills; no default agent stubs
  - Office client preview residual (docx/xlsx/pptx; never Unsupported placeholder)
  - host sandbox residual (agent-core ProjectPathEscape)
  - Hermes-Lanyard residual on same Portal build
  - writes `artifacts/mocklab/lp-rt5/joint-go-evidence-*.json` (+ `joint-go-evidence-latest.json`)
- Sister agent plan phase-6 cross-links this script and evidence path.


## Data structures

- Evidence JSON schema: topology, backend.kind/version, checks[], timestamps, non-claims (no AWS, no prod).

## Verification

**Runtime only (gate):** script exit 0 + evidence `joint_go: GO` with all required checks true.

**Not GO:** synthetic unit tests alone; Portal-only fixture backend; host without Brain RPC.

## Sister awareness

Agent joint-go phase must publish the container/image pin and host readiness checks this script waits on. Coordinate instance id / relay secrets like pilot plan 06.
