# lp-oop.37.5 — live tool-only Daytona snapshot

**Decision:** yes — pin tool-only. Fat guest is no longer the live snapshot.  
**When:** 2026-08-19  
**Bead:** `lp-oop.37.5`

## Pin

| Field | Value |
|-------|--------|
| Snapshot id | `b13c2b8d-fcab-480b-aaea-5bc57c64f054` |
| Snapshot name | `lanyard-tool-only-f63beffd-20260819c` |
| Previous (fat) | `f4d947f3-bd03-4f6c-b8a2-b2034872feba` / `lanyard-la-main-9bcada6780d2-seed-zuh111-20260814` |
| ECR tag | `tool-only-f63beffd-20260819` |
| Digest | `sha256:738dc450cb05c877496a3280dd7462a059fe79f93c0396e93f2327e256c0a3f9` |
| Image kind | Dockerfile `--target tool-only` |
| Isolation | container |

SM `lanyard/staging/portal/daytona`: `DAYTONA_DEFAULT_SNAPSHOT` + `DAYTONA_SNAPSHOT_NAME` updated; previous id in `DAYTONA_PREVIOUS_DEFAULT_SNAPSHOT`. CP force-new-deployment requested so injected default matches.

MockLab instance `452b1348-772a-49d0-8038-a410eda8accf` `agent_snapshot_id` = new snapshot. Old fat sandbox `9c523b48-…` archived.

## Live create proof

`POST /internal/instances/…/ensure-online` `{sandbox_create_profile: tool_only}` → **200**

```
already_online: false
sandbox_id: bd3216ae-4cd4-4f36-a4a5-c41bb9b1e54a
presence: online
snapshot: lanyard-tool-only-f63beffd-20260819c
```

Toolbox `process/execute`:

```
KIND=tool-only
TREE_ABSENT
NO_GATEWAY_BIN
```

Create env keys: `AWS_*` STS + `LANYARD_VAULT_BUCKET` + `S3_VAULT_PREFIX` + `VAULT_ROOT`.  
Denied absent: `GATEWAY_RELAY_SECRET`, `XAI_API_KEY`, other provider keys.

Rollback: re-pin `f4d947f3-bd03-4f6c-b8a2-b2034872feba` on instance + SM, then cold recreate.
