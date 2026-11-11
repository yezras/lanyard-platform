# Phase 8 — Dual-run and MockLab proof

Back: [overview](./overview.md). Beads: `lp-oop.29`–`.34`. `.35` is P3 after this.

## Goal

Turn the new path on for MockLab without rewriting the guest-gateway snapshot. Prove invariants. Relay leave of the Daytona harness hop is [phase 9](./phase-9-relay-retire.md) (`lp-oop.35`).

## Changes

- Per-tenant or per-instance `chat_delivery` (or env on MockLab only). Default relay.
- Deploy harness as a platform task (existing ECS cluster). No new AWS product. Operator notes: [mocklab-harness-deploy.md](./mocklab-harness-deploy.md), [mocklab-short-stack-harness.md](../../../deploy/references/runbooks/mocklab-short-stack-harness.md) (`lp-oop.30`).
- Live no-tool turn (`lp-oop.31`): `bash deploy/scripts/prove-mocklab-short-stack-no-tool-turn.sh` (real LA `createHarnessTurnServer`; Relay not on the hop). Offline check: `bash deploy/scripts/smoke-mocklab-short-stack-no-tool-turn.sh`. Live AWS MockLab `chat_delivery` stays default relay until an operator flips it (`lp-oop.29`) after the harness task is healthy.
- Live echo → LA runner (`lp-oop.37.4`): live Fargate is `createHarnessTurnServer` (`lanyard-platform-staging-harness:3`, tag `la-52f5e4d`; [LA PR 242](https://github.com/LanyardBrain/lanyard-agent/pull/242) MERGED). Replies are still `echo: <message>` until a non-echo runner is bound and an operator rolls the image. Pin + cutover notes: [replace-echo-harness-la.md](./replace-echo-harness-la.md). Offline: `bash deploy/scripts/smoke-mocklab-replace-echo-harness-la.sh`. Do not put the loop in the Daytona snapshot.
- Browser no-tool proof (`lp-oop.36`): `bash deploy/scripts/prove-mocklab-short-stack-no-tool-ui.sh`. Local BFF `ChatDelivery=harness` + Playwright. Not live AWS.
- Playwright UI QA on harness path (`lp-oop.33`): send, stream, vault tree without wake. `bash deploy/scripts/prove-mocklab-short-stack-harness-ui.sh`. Evidence `artifacts/ui/lp-oop.33/` (`REPORT.json` + screenshots). `GET /api/vault/tree` must not 502 wake. Live AWS `chat_delivery` stays default relay. Offline: `bash deploy/scripts/smoke-mocklab-short-stack-harness-ui.sh`.
- Overview invariants (`lp-oop.32`): `bash deploy/scripts/prove-mocklab-short-stack-invariants.sh`. Offline: `bash deploy/scripts/smoke-mocklab-short-stack-invariants.sh`. Do **not** write `DAYTONA_DEFAULT_SNAPSHOT` or MockLab `agent_snapshot_id` from this leaf.
- Live tool turn on the tool-only snapshot only after a human pin decision.
- Playwright UI QA. Kitchen-sink gate with waivers listed, not hidden. `needs_ui_qa=true` on `.33` and `.34`. `.36` is the UI re-open of `.31` (local harness hop, not production Hermes).
- Kitchen-sink re-QA (`lp-oop.34`): `bash deploy/scripts/prove-mocklab-short-stack-kitchen-sink.sh`. Local BFF `ChatDelivery=harness` + `VaultPlane=cp_s3`. Guest path stays default relay (live pin unchanged; no flip). Verdict `GO` or `GO_WITH_WAIVERS` in `artifacts/mocklab/short-stack/kitchen-sink/RESULT.md`. Offline: `bash deploy/scripts/smoke-mocklab-short-stack-kitchen-sink.sh`.

## Persist (`lp-oop.29`)

Dual-run is **not** a global-only cutover. Persist `chat_delivery` so MockLab can flip alone. Do **not** rewrite the guest-gateway snapshot.

| Layer | Field | Default |
|---|---|---|
| BFF env | `CHAT_DELIVERY=relay\|harness` | `relay` |
| Tenant | `tenants.chat_delivery` | `NULL` (inherit env) |
| Instance | `gateway_instances.chat_delivery` | `NULL` (inherit tenant then env) |

Resolve: **instance > tenant > env > `relay`**. Unknown values inherit (fail closed to today's path).

Operator flip MockLab only (guest snapshot unchanged):

```http
PATCH /internal/tenants/{mocklab_tenant_id}/chat-delivery
x-internal-ops-token: …
{ "chat_delivery": "harness" }
```

Or `PATCH /tenants/{id}/instances/{instanceId}/registry` with `{ "chat_delivery": "harness" }`. Other tenants stay `NULL` → env → relay. Clear with `null` to inherit again.

## Data structures

Same flags as phase 1, now set on the live MockLab instance.

## Verification

See overview invariants. Evidence under `artifacts/mocklab/short-stack/`. `needs_ui_qa=true` on `.33` and `.34`.
