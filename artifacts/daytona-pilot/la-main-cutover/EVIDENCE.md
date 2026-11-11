# lp-zuh.2 — Live MockLab LA snapshot cutover (2026-08-13)

## Done

| Step | Result |
|------|--------|
| Pack LA main | `0.0.0-main.508b0b736ad5` / `508b0b736ad5` |
| Local image bake | `lanyard/agent-gateway:la-main-508b0b736ad5` |
| ECR push | `la-main-508b0b736ad5-20260813` digest `sha256:e492d47ff6cc116587505b535334b85ff635bd93fc666d5b1fd0ef7aec4ecc9d` |
| Daytona registry ECR token | refreshed (was expired) |
| Daytona snapshot | **active** `86d85356-78eb-4318-b885-93f80c435464` name `lanyard-la-main-508b0b736ad5-20260813c` |
| SM `lanyard/staging/portal/daytona` | `DAYTONA_DEFAULT_SNAPSHOT` → snapshot id |

## Residual (not this bead)

- Portal BFF/CP/Relay/web **image redeploy** to ECS/CF still operator step if services pin old digests.
- Existing **running sandboxes** keep old image until destroy + cold create with new default pin.
- Chat cold-wake live UI proof: run after CP reload picks up SM pin (restart CP task if needed).
- Vault live proof residual: `lp-kng.6.7`.

## Operator verify

1. Confirm CP env/SM has new snapshot id (restart CP if SM injected at boot only).
2. Stop orphan MockLab sandboxes for the pilot instance.
3. Chat on MockLab → cold ensure_online → expect LA health from new snapshot.
