# lp-k5c4.10 — MockLab inbound spine evidence

**Result:** PASS
**Stamp:** 20260827T132818Z
**Bead:** `lp-k5c4.10`

HOLD lifted 2026-08-27 for this bead only. No `terraform apply`. No restage.

## Checks

| Check | Result |
|-------|--------|
| `hold.no_terraform_apply` | PASS |
| `persist.harness` | PASS |
| `spineEnabled.predicate` | PASS |
| `taste.http_200` | PASS |
| `taste.sse_not_hang` | PASS |
| `toolbox.path_not_cold_create_when_bound` | PASS |
| `cron.enqueue_or_ops_fire` | PASS |
| `hop.deliverInbound_zero` | PASS |

## Persist / spineEnabled

- Tenant persist `chat_delivery`: `harness`
- Process env `CHAT_DELIVERY`: `relay`
- `HARNESS_URL` wired: `True`
- `spineEnabled` predicate: `True`

## Taste send

{
  "http_status": 200,
  "send_ok": true,
  "send_preview": {
    "ok": true,
    "thread_id": "63f7854c-19e6-444a-b888-10615057958b",
    "status": null,
    "error": null
  },
  "sse": {
    "history_status": 200,
    "completed": true,
    "stalled": false,
    "hung": false,
    "outcome": "completed",
    "preview": "pong lp-k5c4.10-taste"
  },
  "thread_id": "63f7854c-19e6-444a-b888-10615057958b"
}

## Toolbox

{
  "http_status": 200,
  "thread_id": "63f7854c-19e6-444a-b888-10615057958b",
  "sandbox_id_bound": true,
  "path": "already_online",
  "cold_create": false,
  "send_ok": true,
  "send_preview": {
    "ok": true,
    "thread_id": "63f7854c-19e6-444a-b888-10615057958b",
    "status": null,
    "error": null
  },
  "sse": {
    "history_status": 200,
    "completed": true,
    "stalled": false,
    "hung": false,
    "outcome": "completed",
    "preview": "pong lp-k5c4.10-toolbox"
  },
  "cloudwatch_cold_create_hits": 0
}

## Cron

{
  "snapshot_status": 200,
  "listed": [
    {
      "id": "09b7330db248",
      "name": "GPU capacity brief lp-zuh.10.4-20260814170905",
      "enabled": true
    }
  ],
  "create_status": 201,
  "create_preview": {
    "id": null,
    "job_id": null,
    "name": null,
    "error": null,
    "code": null
  },
  "via": "ops_fire_create",
  "evaluator": "off_or_unknown",
  "live_ops_fire": true
}

## Hop

{
  "deliverInbound_calls": 0,
  "bff_deliver_inbound_log_hits": 0,
  "relay_deliver_inbound_log_hits": 0,
  "harness_marker_hits": 0,
  "path": "harness"
}

## Residuals

- Live BFF image pin is v62i.8 (task :52). Spine enqueue + CONTROL_PLANE_DATABASE_URL are on main, not this pin. Live hop is persist-harness startTurn, not Postgres enqueue.
- Live BFF has no CONTROL_PLANE_DATABASE_URL secret; inboundQueue is unset.
- SCHEDULE_EVALUATOR_ENABLED is not on live CP env; cron live path is ops create + offline enqueue proof.

## Re-run

```bash
bash deploy/scripts/prove-mocklab-inbound-spine.sh
```
