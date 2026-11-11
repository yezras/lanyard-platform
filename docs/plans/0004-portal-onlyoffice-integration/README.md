# Portal Office integration (ONLYOFFICE) — plan index

**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Status:** Free-track shipped on lab/localhost; production edit blocked; AWS staging apply deferred  
**Canonical status:** [overview.md](overview.md) (shipped vs residual as of main)

## Read first

| Question | Answer | Doc |
| --- | --- | --- |
| What shipped vs what is residual? | Lab product path mostly closed; localhost full-chain E2E open; AWS apply deferred | [overview.md](overview.md) |
| Which license? | Free Community / Development Server only; production customer edit blocked | [decision-license-path.md](decision-license-path.md) |
| Which topology is live? | `lab-shared-compose-ds` current; `staging-platform-shared-ds` module infra_ready only; `prod-per-tenant-ds` future | [ADR 0006](../../adr/0006-document-server-topology-and-data-residency.md) |
| Agent write stance? | Headless vault writes + pane checkpoints; no Automation API; no live co-typing | [overview.md](overview.md) § Agent write stance |
| Security claim? | Threat notes + PASS WITH RESIDUALS review; not production sign-off | Links below |

## Residual backlog (non-MVP and open)

| Item | Bead | Notes |
| --- | --- | --- |
| Localhost mocklab full-chain E2E | `lp-5q6.38` | Chat → agent write → pane refresh → human save; free-track go/no-go |
| AWS staging DS re-apply | `lp-5q6.40` | Only after explicit spend re-enable; module already on main |
| Paid Developer (or counsel Community) | Supersede `lp-5q6.7` | Required before customer-facing production edit |
| Production per-tenant Document Server | Future | `prod-per-tenant-ds` under topology ADR |

## Durable architecture notes (main)

| Doc | Bead | Role |
| --- | --- | --- |
| [portal-document-shared-state-conflict-policy.md](../../architecture/portal-document-shared-state-conflict-policy.md) | `lp-5q6.3` | Shared mutable state inventory, ownership, dirty-human vs agent write policy, document key composition |
| [portal-document-session-domain-model.md](../../architecture/portal-document-session-domain-model.md) | `lp-5q6.6` | Typed domain: `VaultArtifactRef`, `ArtifactEvent`, `ArtifactPanelState`, `OfficeDocumentSession`, `DocumentRevision`, `SaveCallback`, `ConflictState` |
| [portal-chat-artifact-event-protocol.md](../../architecture/portal-chat-artifact-event-protocol.md) | `lp-5q6.10` | Wire contract: `artifact.open\|progress\|updated\|error\|close` |
| [portal-host-artifact-event-emission.md](../../architecture/portal-host-artifact-event-emission.md) | `lp-5q6.31` | Host/gateway emit planners; revision-gated `updated`; error sanitize |
| [decision-license-path.md](decision-license-path.md) | `lp-5q6.7` | Free-track license; Automation API not required for MVP; production edit blocked |
| [portal-office-lab-roundtrip-go-no-go.md](../../architecture/portal-office-lab-roundtrip-go-no-go.md) | `lp-5q6.28` | Lab GO: DOCX+XLSX mint → download → callback writeback |
| [portal-document-server-topology.md](../../architecture/portal-document-server-topology.md) | `lp-5q6.8` | Named lab/staging/production topologies |
| [ADR 0006](../../adr/0006-document-server-topology-and-data-residency.md) | `lp-5q6.8` | Binding short form (**Accepted**; prod DS still license+security gated) |
| [portal-office-document-bridge-threat-notes.md](../../architecture/portal-office-document-bridge-threat-notes.md) | `lp-5q6.9` | Threat notes for signed download, callback, JWT, CSRF, ACL, purge |
| [portal-office-signed-download-callback-security-review.md](../../architecture/portal-office-signed-download-callback-security-review.md) | `lp-5q6.35` | Implementation review: PASS WITH RESIDUALS |
| [operate-onlyoffice-document-server.md](../../../deploy/references/runbooks/operate-onlyoffice-document-server.md) | `lp-5q6.36` | Day-2 ops: start/stop/upgrade, JWT rotate, forgotten-file purge |
| [lab-onlyoffice-document-server.md](../../../deploy/references/runbooks/lab-onlyoffice-document-server.md) | `lp-5q6.25` | Lab compose runbook (`lab-shared-compose-ds`) |
| [staging-document-server.md](../../../deploy/references/runbooks/staging-document-server.md) | `lp-5q6.34` | Staging module runbook (infra_ready; AWS apply deferred) |
| [portal-document-key-invalidation.md](../../architecture/portal-document-key-invalidation.md) | `lp-5q6.24` | Document key mint and dirty-vs-reload invalidation |
| [portal-binary-vault-transfer-and-revision.md](../../architecture/portal-binary-vault-transfer-and-revision.md) | `lp-5q6.17` | Binary transfer, revision identity, CAS; forbids production Office via `/api/vault/content` |
| [hermes-lanyard-vault-write.md](../../architecture/hermes-lanyard-vault-write.md) | `lp-5q6.20` | Host `vault.write` on Hermes-Lanyard pin |
| [portal-active-human-edit-agent-write-policy.md](../../architecture/portal-active-human-edit-agent-write-policy.md) | `lp-5q6.32` | Dirty human vs agent write: checkpoint default; no live co-author |

## Checkpoint series (historical Feature playbook)

| Bead | Topic | Status |
| --- | --- | --- |
| `lp-5q6.1` | Blocking first steps | Closed |
| `lp-5q6.2` | Independent workstreams | Closed |
| `lp-5q6.3` | Shared mutable state and conflict policy | Closed |
| `lp-5q6.4` | Smallest safe decomposition | Closed |
| `lp-5q6.5` | HOW: ground document paths in source | Closed |
| `lp-5q6.6` | ARCH: document session + artifact domain model | Closed |
| `lp-5q6.7` | Decision: ONLYOFFICE license path | Closed (free track) |
| `lp-5q6.8` | Decision: Document Server topology / data residency | Closed |
| `lp-5q6.9` | Security: Office document bridge threat notes | Closed |

Checkpoint prose below may still describe pre-fan-out sequencing. Prefer [overview.md](overview.md) for current shipped/residual truth.

## Related branches

- Older draft feasibility text lived on `docs/onlyoffice-portal-office-integration`. Prefer live epic `lp-5q6` children in Beads over draft issue-map IDs.
