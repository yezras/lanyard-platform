# Portal document pane and ONLYOFFICE integration

**Status:** Free-track product path shipped on lab/localhost; production edit blocked  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**As of:** main (2026-07-26 residual rewrite)  
**Index:** [README.md](README.md)

This plan is the durable shipped-vs-residual record for Office work under **$0 AWS spend**. It does not wait on full-chain localhost E2E (`lp-5q6.38`).

## Product goal

- Chat stays usable while a right-side **document pane** opens for the vault document under discussion.
- DOCX, XLSX, PPTX, and PDF **render** in the pane (existing client previews).
- Humans **edit** Office files through ONLYOFFICE only where license and topology allow (lab/localhost free track today).
- Agent work appears as **progress and refreshed checkpoints**. Agents do not live-type inside Document Server and do not use Automation API.

## Current state (short)

| Area | State | Notes |
| --- | --- | --- |
| Chat document pane + previews | **Shipped** | Reducer, shell, citations/tools routing, a11y, agent progress/checkpoints |
| Contracts + domain model | **Shipped** | Artifact events, session types, binary vault transfer, typed `vault.write` |
| BFF Office bridge | **Shipped** | Session store, signed download, callback writeback, key invalidation, editor JWT mint |
| Lab Document Server | **Shipped / GO** | `lab-shared-compose-ds`; live round-trip proof (`lp-5q6.28`) |
| Editor behind feature flag | **Shipped** | `onlyoffice_editor` host, vault entry, chat pane integration |
| Free-track license | **Accepted** | Community / Development Server only; see [decision-license-path.md](decision-license-path.md) |
| Staging DS AWS | **Deferred** | Module **infra_ready** (`lp-5q6.34`); live apply parked (`lp-5q6.40`) |
| Localhost full-chain E2E | **Residual** | Chat → agent write → pane refresh → human save (`lp-5q6.38`) |
| Customer production edit | **Blocked** | Needs paid Developer (or counsel Community) + prod topology + security claim |

## Shipped (free track)

| Surface | Beads (closed) | Where to look |
| --- | --- | --- |
| Chat document pane | `lp-5q6.12`–`lp-5q6.16` | `portal/packages/web` document pane |
| Artifact event protocol + parse | `lp-5q6.10`, `lp-5q6.11` | [portal-chat-artifact-event-protocol.md](../../architecture/portal-chat-artifact-event-protocol.md) |
| Host artifact emit | `lp-5q6.31` | [portal-host-artifact-event-emission.md](../../architecture/portal-host-artifact-event-emission.md) |
| Binary vault + revision + `vault.write` | `lp-5q6.17`–`lp-5q6.20` | [portal-binary-vault-transfer-and-revision.md](../../architecture/portal-binary-vault-transfer-and-revision.md), [hermes-lanyard-vault-write.md](../../architecture/hermes-lanyard-vault-write.md) |
| BFF Office bridge | `lp-5q6.21`–`lp-5q6.24`, `lp-5q6.26` | `portal/packages/bff/src/office/*` |
| Lab DS + round-trip GO | `lp-5q6.25`, `lp-5q6.28` | [lab runbook](../../../deploy/references/runbooks/lab-onlyoffice-document-server.md), [go/no-go](../../architecture/portal-office-lab-roundtrip-go-no-go.md) |
| Editor flag path | `lp-5q6.27`, `lp-5q6.29`, `lp-5q6.30` | `onlyOfficeFeatureFlag`, `OnlyOfficeEditorHost` |
| Dirty-human vs agent write | `lp-5q6.32` | [portal-active-human-edit-agent-write-policy.md](../../architecture/portal-active-human-edit-agent-write-policy.md) |
| Security threat notes + review | `lp-5q6.9`, `lp-5q6.35` | Review verdict: **PASS WITH RESIDUALS** (not prod sign-off) |
| Observability + ops | `lp-5q6.33`, `lp-5q6.36` | [operate runbook](../../../deploy/references/runbooks/operate-onlyoffice-document-server.md) |
| Browser QA (lab editor) | `lp-5q6.37` | UI artifacts under `portal/artifacts/ui/` |
| Staging module (compose only) | `lp-5q6.34` | `deploy/modules/staging-document-server/` (**infra_ready**, not a live AWS claim) |

Checkpoint, HOW, ARCH, license, and topology design beads (`lp-5q6.1`–`lp-5q6.8`) are closed and remain the design spine.

## License (free track)

**Decision:** [decision-license-path.md](decision-license-path.md) (`lp-5q6.7`). **Accepted**.

| Rule | Detail |
| --- | --- |
| Allowed now | Free **Community** and/or free **Developer Development Server** (1 server / 20 connections) for lab and internal proof |
| Not purchased | Paid Developer Single/Cluster, Enterprise, white label, Automation API |
| Production customer edit | **Blocked** until paid Developer purchase **or** counsel-approved Community for a named deployment class |
| Automation API | **Not** MVP and **not** the agent path |

Feature flags and deploy roots must not advertise production ONLYOFFICE edit on this track.

## Topology

**Decision:** [ADR 0006](../../adr/0006-document-server-topology-and-data-residency.md), detail [portal-document-server-topology.md](../../architecture/portal-document-server-topology.md) (`lp-5q6.8`).

| Environment | Named topology | Runtime status |
| --- | --- | --- |
| Lab / localhost | `lab-shared-compose-ds` | **Current** dogfood path (compose DS + local Portal/BFF/host) |
| Staging AWS | `staging-platform-shared-ds` | Module **infra_ready** on main (`lp-5q6.34`). Live apply **deferred** under $0 spend (`lp-5q6.40`) |
| Production | `prod-per-tenant-ds` (default) | **Future.** License + security + deploy; not free-track ship |
| Production shared | `prod-shared-ds-opt-in` | Opt-in only; not default |

Do not treat a past partial staging apply as current environment of record. Localhost + lab DS is.

## Agent write stance

| Rule | Detail |
| --- | --- |
| Authoring | Headless skills + `vault.write` (CAS / checkpoint modes) |
| Pane | Progress + checkpoint refresh via `artifact.*` events |
| Dirty human session | Default agent action is `write_checkpoint` or refuse (`human_edit_active`); no silent overwrite of canonical path |
| Not in MVP | ONLYOFFICE **Automation API**, live co-typing / co-author cursor inside Document Server |

Policy record: [portal-active-human-edit-agent-write-policy.md](../../architecture/portal-active-human-edit-agent-write-policy.md).

## Security posture

| Layer | Status |
| --- | --- |
| Threat notes | [portal-office-document-bridge-threat-notes.md](../../architecture/portal-office-document-bridge-threat-notes.md) (`lp-5q6.9`) |
| Implementation review | **PASS WITH RESIDUALS.** [portal-office-signed-download-callback-security-review.md](../../architecture/portal-office-signed-download-callback-security-review.md) (`lp-5q6.35`) |
| Boundary | Document Server talks only to BFF Office endpoints (signed download + callback). No Brain RPC, no direct `VAULT_ROOT` |
| Production claim | **Not authorized.** Review is not pen-test or production security sign-off |

## Residual work

| Item | Bead | Priority |
| --- | --- | --- |
| Localhost mocklab full chain: chat → agent write → pane refresh → human ONLYOFFICE save → reopen from vault | `lp-5q6.38` | **P1.** Free-track go/no-go |
| Re-apply AWS staging Document Server + Office API | `lp-5q6.40` | Deferred; only if spend returns |
| Paid Developer license (or counsel Community) for customer edit | Superseding `lp-5q6.7` decision | Non-MVP backlog |
| Production `prod-per-tenant-ds` deploy + purge SLO claim | Future under `lp-5q6` / deploy | Non-MVP backlog |

Docs ship with these residuals named. Closing `lp-5q6.39` does **not** require `lp-5q6.38` green.

## Non-goals (unchanged)

- ONLYOFFICE Cloud as the production default.
- Automation API as the primary agent authoring path.
- Replacing lightweight client previews for ordinary read-only viewing.
- Agents overwriting a file while a human has an active dirty edit session.
- Production Community Edition without written counsel sign-off.
- Resuming AWS staging apply without an explicit spend re-enable.

## Design stance (still binding)

1. Preview pane UX does not require Document Server.
2. ONLYOFFICE is the **human** editor; agent authoring stays headless.
3. BFF Office endpoints are the only storage boundary Document Server may call.
4. Do not route production Office files through size-capped `vault.read` / `/api/vault/content` JSON/base64.

## Key children of `lp-5q6`

| Id | Role | Status |
| --- | --- | --- |
| `lp-5q6.1`–`lp-5q6.6` | Checkpoints, HOW, ARCH | Closed |
| `lp-5q6.7` | License free track | Closed (accepted) |
| `lp-5q6.8` | Topology ADR | Closed (accepted) |
| `lp-5q6.9`, `lp-5q6.35` | Threat notes + security review | Closed |
| `lp-5q6.10`–`lp-5q6.16` | Pane + artifact events | Closed |
| `lp-5q6.17`–`lp-5q6.24`, `lp-5q6.26` | Write path + BFF Office | Closed |
| `lp-5q6.25`, `lp-5q6.28` | Lab DS + GO | Closed |
| `lp-5q6.27`, `lp-5q6.29`, `lp-5q6.30` | Editor flag path | Closed |
| `lp-5q6.31`–`lp-5q6.33`, `lp-5q6.36`, `lp-5q6.37` | Emit, policy, metrics, ops, browser QA | Closed |
| `lp-5q6.34` | Staging module infra_ready | Closed (module only) |
| `lp-5q6.38` | Localhost full-chain E2E | **Open residual** |
| `lp-5q6.39` | This plan honesty pass | This bead |
| `lp-5q6.40` | AWS staging re-apply | **Deferred** |

Full list: `bd children lp-5q6`.

## Related plan files

| Doc | Role |
| --- | --- |
| [README.md](README.md) | Plan index + architecture links |
| [decision-license-path.md](decision-license-path.md) | Free-track license decision |
| [checkpoint-blocking-first-steps.md](checkpoint-blocking-first-steps.md) | Historical P0 gates |
| [independent-workstreams.md](independent-workstreams.md) | Parallelization map (see residual note) |
| [checkpoint-smallest-safe-decomposition.md](checkpoint-smallest-safe-decomposition.md) | Slice order (see residual note) |
| [how-source-grounding.md](how-source-grounding.md) | Source path grounding |
