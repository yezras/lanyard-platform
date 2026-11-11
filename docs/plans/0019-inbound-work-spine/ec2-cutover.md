# EC2 Company Brain → inbound spine

Bead: `lp-k5c4.14`. Decision 2026-08-27: **cutover, not wontfix.** Skip `lp-k5c4.9` (Rust leaser). `lp-k5c4.13` (drop `chat_delivery` column) waits on this leaf.

Existing compute checklist: [cutover-ec2-to-daytona.md](../0008-daytona-agent-sandboxes/cutover-ec2-to-daytona.md) (`lp-6h8`). Vault copy: [vault-ec2-to-s3-copy.md](../0008-daytona-agent-sandboxes/vault-ec2-to-s3-copy.md). Rollback: `lp-ky7`. Decommission host: `lp-u00`.

## Why they leave Relay

Relay exists so an **always-on EC2 guest** can dial out and keep a WebSocket. The agent loop ran **on that box**. Chat was `deliverInbound` onto the socket.

The spine puts the loop on **always-on Fargate LA**. Daytona is a toolbox VM, started for file/bash, stopped after the hot window. There is no guest gateway to dial Relay. If EC2 brains stayed on Relay, we would keep two products: MockLab on `startTurn`, everyone else on WSS. That is the dual-run we are deleting.

`runtime_kind=ec2` and `chat_delivery=relay` are different switches. Kind is compute. Delivery is the chat hop. Both have to move:

| Today | After cutover |
| --- | --- |
| Loop on EC2 guest | Loop on Fargate `startTurn` |
| Vault on EC2 disk (or already copied) | S3 prefix, `VAULT_PLANE=cp_s3` |
| `ensure_online` no-op (host always up) | `ensure_online` starts a Daytona toolbox when `sandbox_need=toolbox` |
| Idle reaper ignores the instance | Reaper can stop the sandbox, retain `sandbox_id` |
| Slack/cron `deliverInbound` | Same enqueue as MockLab |

Do **not** set `chat_delivery=harness` while the loop is still the EC2 guest. You would POST harness turns that do not share that guest’s session. Do **not** set global `CHAT_DELIVERY=harness`.

## Order per instance

Keep `instance_id` and instance secret. Do not re-register.

1. Vault copy EC2 → `tenants/{tenant_id}/vault/` verified (`lp-3ux`). Abort if copy FAIL.
2. Allowlist: append `tenant_id` to CP `DAYTONA_TENANT_ALLOWLIST`.
3. `PATCH …/instances/{id}/registry` `{ "runtime_kind": "daytona" }` (`lp-6h8`). Presence `offline`, `sandbox_id` null until first toolbox wake.
4. Confirm BFF `HARNESS_URL` healthy. `PATCH …/chat-delivery` `{ "chat_delivery": "harness" }`.
5. Prove: one `none` send (Taste) on enqueue, `deliverInbound` 0. One `toolbox` send: `start_from_stopped` or first `ensure_online`, not a guest WSS session.
6. Watch a day. Then stop/destroy that tenant’s EC2 (`lp-u00`). Vault stays on S3.

Rollback: `chat_delivery` null or `relay`, then `runtime_kind=ec2` (`lp-ky7`). Only works if the EC2 host is still up.

## Live inventory 2026-08-27

Queried staging CP RDS (`lanyard-platform-staging-cp`) and account EC2. Evidence: `artifacts/mocklab/lp-k5c4.14/tenant-inventory.json`.

| Surface | Result |
| --- | --- |
| CP `tenants` | **1 row:** MockLab `319d3808-e533-44db-bfdf-7b6ef8caaae1` |
| Other `tenant_id` values in any CP table | **none** |
| `runtime_kind=ec2` gateway rows | **empty** |
| Account EC2 instances | **none** |
| MockLab persist `chat_delivery` | `harness` (tenant; instance column null → inherit) |
| BFF env `CHAT_DELIVERY` | `relay` (global still not harness) |
| Active instance | `452b1348-…` `runtime_kind=daytona`, vault prefix `tenants/319d3808-…/vault/` |

No EC2 kind flip was applied: there was nothing to flip. Spine send proof is `lp-k5c4.10` (Taste 200, toolbox `already_online`, `deliverInbound` 0).

Leftover S3 prefixes that are **not** CP tenants (pilot seed, 6 objects total): `tenants/7d451eb7-…/` and `tenants/mocklab/`. Same unused UUID is still on `DAYTONA_TENANT_ALLOWLIST`. Left in place; not a second tenant.

## What this leaf does not do

- Terraform restage of the whole staging VPC
- Rust leaser (`lp-k5c4.9`)
- Dropping the `chat_delivery` column (`lp-k5c4.13`) until every remaining `runtime_kind=ec2` row is gone or listed as a named exception
