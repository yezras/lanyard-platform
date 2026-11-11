# Portal documentation

Product and operator docs owned by the Portal monorepo. Deploy/infrastructure runbooks live in [company-brain-deploy](https://github.com/LanyardBrain/company-brain-deploy).

## Index

| Doc | Gate / topic |
|-----|----------------|
| [image-release.md](./image-release.md) | G7 — ECR image digests for bff / relay / control-plane |
| [adr/g5-bff-shared-state.md](./adr/g5-bff-shared-state.md) | **G5.1** — BFF shared session store ADR (Redis, model, failover) |
| [policies/log-retention-and-access.md](./policies/log-retention-and-access.md) | **G2b.1** — Log class TTLs and access; data-handling alignment |
| [local-secret-hygiene.md](../../docs/runbooks/local-secret-hygiene.md) | **lp-p37.13** — Local `.data` / auth-state modes, chat retention, export redaction |
| [runbooks/relay-credential-lifecycle.md](./runbooks/relay-credential-lifecycle.md) | **G2.4** — Production register / rotate / revoke; lab-only labeled |
| [operator-enablement-training-export-runbook.md](../../docs/plans/0011-tenant-chat-corpus/operator-enablement-training-export-runbook.md) | **lp-gkh.10** / plan **0011** — Enable tenant L10 chat corpus, verify writes, training export, disable (privacy gate before prod) |
| [adr/g2a-relay-replay-resistance.md](./adr/g2a-relay-replay-resistance.md) | **G2a.1** — Relay upgrade-token replay resistance (jti + session exclusivity) |
| [adr/g6-relay-routing-bus.md](./adr/g6-relay-routing-bus.md) | **G6.1** — Multi-relay routing bus, owner registry, shared revocation |
| [control-plane-db-migration.md](./control-plane-db-migration.md) | **G4.2** — SQLite→Postgres data migration and rollback |
| [control-plane-schema-boundary.md](./control-plane-schema-boundary.md) | **cbd-mta.3.1** — Tenant-scoped CP schema inventory, FKs, RLS deferral, Brain RPC boundary |
| [brain-rpc.md](./brain-rpc.md) | **G3.3** — Portal Brain RPC call path (contract authority in company-brain-deploy) |

## Package-level docs

| Package | Doc |
|---------|-----|
| control-plane | [`packages/control-plane/README.md`](../packages/control-plane/README.md) |
| relay | [`packages/relay/README.md`](../packages/relay/README.md) |
| web release | [`apps/web/RELEASE.md`](../apps/web/RELEASE.md) |

## Deploy cross-links

- [Relay secret lifecycle (SSM/SM)](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/runbooks/relay-secret-lifecycle.md)
- [Provision runbook](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/provision-runbook.md)
- [Client data-handling policy template](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/templates/client-data-handling-policy.md)
- [Readiness matrix](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/readiness-matrix.md)
