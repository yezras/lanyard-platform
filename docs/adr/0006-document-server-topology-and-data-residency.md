# ADR 0006: Document Server topology and data residency

- Status: **Accepted** (2026-07-24 human gate; lab/staging shapes unblocked; production DS still blocked by free-track license + security)
- Date: 2026-07-24
- Bead: `lp-5q6.8`
- Epic: `lp-5q6` — Portal document pane and ONLYOFFICE editing
- Detailed record: [portal-document-server-topology.md](../architecture/portal-document-server-topology.md)

## Context

Portal will embed ONLYOFFICE Document Server for human editing of Office-family vault files. Document Server must:

1. Be reachable from the **browser** (load `api.js` / editor session).
2. **HTTP GET** BFF signed download URLs and **HTTP POST** BFF callbacks.

A JWT does not create network reachability. Vault content is a critical asset on private Company Brain hosts ([threat-model-private-by-default](../../deploy/references/threat-model-private-by-default.md)). Tenant isolation for production is account- or VPC-partitioned ([tenant-isolation-decision](../../deploy/references/tenant-isolation-decision.md)).

Document Server holds a **transient working copy** of document bytes (and may retain forgotten files until purged). Placement therefore decides data residency and cross-tenant residual risk. Preview-only chat panes do not need Document Server.

## Decision

Name three environment topologies and one production opt-in:

| Environment | Named topology | Default? |
| --- | --- | --- |
| Lab | **`lab-shared-compose-ds`** — single Docker Compose Document Server; fixture vault only | Yes for lab spike (`lp-5q6.25`) |
| Staging | **`staging-platform-shared-ds`** — one platform Document Server in the staging account/VPC | Yes for staging proof (`lp-5q6.34`) |
| Production | **`prod-per-tenant-ds`** — Document Server **per tenant** inside that tenant’s isolation boundary (on or beside the Company Brain host / same account-VPC partition) | **Yes — production default** |
| Production shared | **`prod-shared-ds-opt-in`** — multi-tenant shared platform DS | **No** — explicit commercial/security opt-in only |
| Cloud | ONLYOFFICE Cloud / third-party hosted Docs | **Not** the private-by-default default; demo or contracted opt-in only |

### Data residency (binding)

- **Production default:** customer vault bytes must **not** leave the tenant isolation boundary to a multi-tenant or third-party Document Server. Transient copies may exist only on **that tenant’s** Document Server after BFF-mediated transfer.
- **Staging:** staging vault bytes may leave staging tenant hosts into the **shared staging** Document Server (non-production data only).
- **Lab:** fixture/lab data only; never production tenant vault.

### Reachability (binding)

- **Browser → Document Server** must be an explicit URL edge per environment (lab localhost/hostname; staging Docs edge; production **tenant-scoped** Docs edge that reverse-proxies editor traffic only).
- **Document Server → BFF** download and callback URLs must be network-reachable from the DS process (compose/host networking in lab; staging HTTPS; production HTTPS to product BFF). Design deploy automation around this path first.

### Purge and cross-tenant (binding)

- Document keys include **tenant**, path identity, and content **revision**.
- Forgotten-file / cache purge is required before production claim. Operator procedure: [operate-onlyoffice-document-server.md](../../deploy/references/runbooks/operate-onlyoffice-document-server.md) (`lp-5q6.36`).
- Production default eliminates shared-disk cross-tenant residual; staging accepts shared residual with JWT/key isolation; production shared DS requires purge evidence and written opt-in.

### Boundary discipline

Document Server talks **only** to Portal BFF Office endpoints for storage. No Brain RPC, no direct `VAULT_ROOT`, no relay.

## Consequences

- Lab and staging may use **shared** Document Server; production private-by-default tenants pay **per-tenant** ops cost (CPU/RAM, editor edge).
- Deploy must not treat successful staging shared DS as automatic production topology.
- BFF Office signed download/callback design is shared across topologies; only placement and edge URLs differ.
- Security threat notes (`lp-5q6.9` → [portal-office-document-bridge-threat-notes.md](../architecture/portal-office-document-bridge-threat-notes.md)) and review (`lp-5q6.35`) must cover both shared staging residual and per-tenant production edges.
- License decision (`lp-5q6.7`) is **Accepted free track** (no paid plans). Production Document Server enablement still requires a future paid (or counsel Community) license path plus security review — topology alone does not unlock production edit.
- Preview-only pane delivery remains unblocked.
- Lab (`lab-shared-compose-ds`) and staging (`staging-platform-shared-ds`) shapes are implementation-ready for free-track work.

## Human gate

| Date | Owner | Verdict | Notes |
| --- | --- | --- | --- |
| 2026-07-24 | Product owner (`beads-wave-drain-2` HumanGate) | **Accept** named topologies | Lab shared compose, staging shared platform DS, production default per-tenant DS, shared prod opt-in only. Free-track license means production DS deploy remains blocked until license re-open + security. |

## Linked sources

- ONLYOFFICE Docs API basic concepts (integrator storage URL + callback; server-side fetch)
- Epic/plan design stance in `docs/plans/0004-portal-onlyoffice-integration/` and bead `lp-5q6.8` design notes
- [portal-document-server-topology.md](../architecture/portal-document-server-topology.md) (full matrices)
- [portal-document-shared-state-conflict-policy.md](../architecture/portal-document-shared-state-conflict-policy.md)
- `deploy/references/threat-model-private-by-default.md`
- `deploy/references/tenant-isolation-decision.md`
- [portal-office-document-bridge-threat-notes.md](../architecture/portal-office-document-bridge-threat-notes.md) (`lp-5q6.9`)
