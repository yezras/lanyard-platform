# Decision: ONLYOFFICE license path for Lanyard Portal

**Bead:** `lp-5q6.7`  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Status:** Accepted (free-only track; no commercial purchase planned)  
**Date:** 2026-07-24  
**Accepted by:** Product owner (session human gate, 2026-07-24)  
**Needs human:** resolved for planning — commercial purchase remains a future re-open, not a current blocker for free-track work  
**Related:** topology decision `lp-5q6.8`; lab DS `lp-5q6.25`; staging DS `lp-5q6.34`

## Context

Lanyard Portal will embed ONLYOFFICE Docs so human users can edit vault Office files (DOCX, XLSX, PPTX, PDF) beside chat. The product is a proprietary, multi-tenant SaaS surface (Portal) over private company vaults. Agents author Office content headless through vault writes and pane refresh. They do not live-type inside Document Server.

**Commercial stance (2026-07-24):** Lanyard is **not purchasing** ONLYOFFICE paid plans (Developer Single Server, Cluster, Enterprise, white label, or Automation API) at this time. Delivery proceeds on **free packages only**. Customer-facing production Office edit remains **out of scope** until a future commercial decision re-opens paid Developer or counsel accepts another production interpretation.

ONLYOFFICE ships a dual-license model:

| Product | License | Intended use (vendor positioning) |
| --- | --- | --- |
| Docs **Community** | AGPL v.3 (plus vendor additional terms) | Free self-host; open source; limited commercial/enterprise packaging |
| Docs **Enterprise** | Commercial | Org-internal enterprise editing at scale |
| Docs **Developer** | Commercial (except free Development Server SKU for eval/integration) | Integrate editors into *your* product and provide them to *your* end users under your brand |

Developer Edition further splits into license types:

| Type | Servers | Simultaneous connections | End-user production? | Cost (indicative) |
| --- | --- | --- | --- | --- |
| **Development Server** | 1 | 20 | **No.** Evaluate and integrate only. | Free developer / integration SKU (vendor registration) |
| **Single Server** | 1 | 250 / 500 / 1000 (plan-dependent) | **Yes.** One location. | Paid — **not purchased** |
| **Cluster** | Unlimited (licensed) | Custom | **Yes.** Multi-location / multi-server. | Paid — **not purchased** |

A 30-day **Developer trial** exists with full editor functions for evaluation only. Trial may not be used to serve end users.

**Automation API** (`createConnector`) is Developer-only, sold as a premium add-on. It is not part of Community and is **not purchased**.

## Decision

1. **No commercial ONLYOFFICE purchase is planned.** Paid Docs Developer Single Server / Cluster, Enterprise, white label, and Automation API are out of scope until product re-opens a commercial decision.
2. **Active free track (what we build and run against):**
   - **Preferred lab path:** Docs **Community** (AGPL) for fixture compose stacks when AGPL compliance for the lab is acceptable.
   - **Preferred Developer-shaped free path:** **Developer Development Server** (free registration SKU, 1 server / 20 connections) for integration that needs Developer binaries, JWT/admin behavior closer to a future paid SKU, or Community is undesirable for a given lab.
   - **Optional:** 30-day Developer trial for short internal eval only.
3. **Development Server and Developer trial must not serve production end users** and must not be cited as a production license. Vendor FAQ forbids providing integrated editors to end users under Development Server or trial.
4. **Community Edition is not the production customer-facing path by default.** AGPL + dual-license risk for proprietary multi-tenant Portal embedding remains unresolved without counsel. Community is **allowed** for lab and internal-only staging; it is **not** an accepted production customer path under this decision.
5. **Enterprise Edition is not used.** Wrong product class for embedding into a product sold to customers; also paid.
6. **Automation API is not required for MVP** and is not the agent authoring path (and is not purchased).
7. **ONLYOFFICE Cloud is not the production default** (epic non-goal). Self-hosted Document Server under the topology decision (`lp-5q6.8`) remains the design center for any future edit path.
8. **Customer-facing production Office edit stays blocked** under the free track. Feature flags and deploy roots must not advertise production ONLYOFFICE edit until a superseding decision accepts either (a) paid Developer Single/Cluster purchase and install, or (b) written counsel acceptance of Community (or another path) for a named deployment class.
9. **The rest of epic `lp-5q6` proceeds** on the free track: preview-only chat document pane, contracts, domain model, BFF Office design, lab Document Server proof, internal staging bridge QA, security notes, and agent checkpoint UX. None of those require a paid key.

## Environment matrix

Each environment lists which edition/type is **allowed**, **conditional**, or **forbidden** under the free track.

### Lab (local / compose / fixture vault)

**Purpose:** Prove open, edit, save, and callback mechanically (`lp-5q6.25`, `lp-5q6.28`). No production vault. No customer end users.

| Path | Status | Notes |
| --- | --- | --- |
| Community Edition | **Allowed / preferred free default** | Fixture lab when AGPL for the lab stack is acceptable. Not production precedent. |
| Developer trial (30-day) | **Allowed** | Short internal eval. No end users. |
| Developer Development Server | **Allowed / preferred free Developer-shaped path** | Free registration SKU: one server, 20 connections. Integration and JWT/admin shape. Not for end users. |
| Developer Single Server | **Forbidden (not purchased)** | Revisit only if commercial decision re-opens. |
| Developer Cluster | **Forbidden (not purchased)** | Same. |
| Enterprise | **Forbidden (not purchased)** | Wrong class; paid. |

**Lab rule:** Document Server JWT secret and any free license key stay in operator secrets (never git). Lab success does not unlock production ship.

### Staging (internal Lanyard staging / pre-production)

**Purpose:** Topology, secrets, and full bridge QA for internal proof (`lp-5q6.34`). Free packages only.

| Path | Status | Notes |
| --- | --- | --- |
| Community Edition | **Allowed** for *internal-only* staging | No customer tenants claiming production editing readiness. |
| Developer trial | **Allowed** (time-boxed, internal) | Must not outlive trial for semi-production use. |
| Developer Development Server | **Allowed / preferred free Developer-shaped staging** | Internal Lanyard staff QA only. 20-connection cap. **Not** for customer end users. |
| Developer Single Server | **Forbidden (not purchased)** | Prefer re-open commercial decision if staging must mirror paid production. |
| Developer Cluster | **Forbidden (not purchased)** | Same. |
| Enterprise | **Forbidden (not purchased)** | Same. |

**Staging rule:** Staging proves the **bridge** (open/edit/callback, topology, secrets) under free packages. It must not market “production editing ready” to customers. Customer-facing staging demos of Office edit remain **out of scope** on the free track.

### Production (customer tenants)

**Purpose:** Humans edit real vault Office files inside Portal — **deferred**.

| Path | Status | Notes |
| --- | --- | --- |
| Community Edition | **Forbidden (default)** | Not accepted for customer-facing production without written counsel sign-off (separate superseding decision). |
| Developer trial | **Forbidden** | Vendor forbids end users under trial. |
| Developer Development Server | **Forbidden** | Vendor forbids providing integrated editors to end users. Free SKU is not a production license. |
| Developer Single Server | **Forbidden until purchased** | Only production-class path for embedding under vendor Developer positioning. Not purchased. |
| Developer Cluster | **Forbidden until purchased** | Same; needed if multi-location / multi-server topology. |
| Enterprise | **Forbidden** | Wrong class; not purchased. |

**Production rule:** Ship of customer-facing ONLYOFFICE editing remains **blocked** until a superseding decision records either paid Developer procurement or counsel-approved Community (or other) for a named deployment class. Preview-only chat pane does not require any Document Server license and is **not** blocked.

## Explicit non-requirements for MVP (free track)

### Paid production Office edit

**Not required for current MVP scope.** MVP on this track is:

- Chat document **preview** pane (existing vault previews).
- Agent progress + checkpoint refresh in the pane.
- Contracts, domain model, BFF design, security notes.
- Lab (and internal staging) Document Server open/edit/save/callback **proof** on free packages.

### Automation API

**Not required and not purchased.** Agent path is headless skills + vault write + pane checkpoint refresh.

### White label / Document Builder / Conversion API as license drivers

Not purchased. Do not depend on paid options for the free-track lab writeback path.

## Why free track still works for the plan

| Workstream | Needs paid DS? | Free-track status |
| --- | --- | --- |
| Preview-only document pane | No | **Unblocked** |
| Artifact events / domain model / contracts | No | **Unblocked** |
| Lab compose + open/edit/callback proof | No (Community or Development Server) | **Unblocked** |
| Internal staging bridge QA | No (free packages, internal only) | **Unblocked** |
| Security threat notes / signed URL design | No (design) | **Unblocked** |
| Customer-facing production Office edit | Yes (or counsel Community) | **Blocked** by design |

Topology decision `lp-5q6.8` still applies: lab shared compose and staging shared DS for proof; production per-tenant DS remains the **future** residency default if/when production edit is re-opened with a paid (or counsel-approved) license.

## Purchase follow-ups (deferred — do not block free-track delivery)

If product later wants customer-facing production edit:

1. Re-open this decision (or supersede) with commercial owner.
2. Quote ONLYOFFICE for Developer Single Server vs Cluster given accepted topology (`lp-5q6.8`).
3. Install production-class key via secrets runbooks; flip feature flags only after license + security + contracts gates.

Until then: **do not** open sales PO as a dependency of epic delivery.

## What this decision does *not* choose

- Document Server placement, tenancy, or data residency (owned by `lp-5q6.8`).
- Binary vault transfer and `vault.write` schema (owned by `lp-5q6.17` / `lp-5q6.18`).
- Threat model details for JWT, signed download, callback, and forgotten-file purge (owned by `lp-5q6.9` / `lp-5q6.35` / ops docs).
- Preview-only chat pane UX (does not require any ONLYOFFICE license).

## Consequences

- Lab and internal integration use **Community** and/or free **Development Server** only.
- Staging internal bridge QA uses the same free packages; 20-connection Development Server cap is acceptable for staff QA.
- Production edit feature flags stay off; deploy must not claim production Office edit readiness.
- Agents and PRs must not introduce paid SKU requirements or Automation API as MVP dependencies.
- Closing this bead records the free-track accept; it does **not** authorize production customer edit.

## Official sources

Linked at decision time (2026-07-24). Prefer these over secondary blogs when auditing compliance.

1. [Developer Edition license FAQ](https://helpcenter.onlyoffice.com/docs/faq/developer.aspx) — Development Server vs Single Server vs Cluster; trial limits; end-user production rules.
2. [Docs Developer product page](https://www.onlyoffice.com/developer-edition.aspx) — embedding for SaaS/on-prem under integrator brand.
3. [Docs Developer pricing](https://www.onlyoffice.com/developer-edition-prices.aspx) — public SKU/options (Development vs Production, connections, white label, Automation API).
4. [Compare editions](https://www.onlyoffice.com/compare-editions.aspx) — Community vs Enterprise vs Developer.
5. [License FAQ](https://www.onlyoffice.com/license-faq.aspx) — AGPL for Community; commercial contact path.
6. [License and trademark policy (blog, 2026-05)](https://www.onlyoffice.com/blog/2026/05/onlyoffice-license-and-trademark-policy) — dual license overview.
7. [Automation API docs](https://api.onlyoffice.com/docs/docs-api/usage-api/automation-api/) — Developer-only; premium extra cost.
8. [Document Server LICENSE (GitHub)](https://github.com/ONLYOFFICE/DocumentServer/blob/master/LICENSE) — Community AGPL v.3.
9. [GNU AGPL v.3](https://www.gnu.org/licenses/agpl.html) — network copyleft baseline for Community interpretation.

## Acceptance mapping (`lp-5q6.7`)

| Criterion | Where satisfied |
| --- | --- |
| Official ONLYOFFICE sources linked | § Official sources |
| Lab, staging, production paths written separately | § Environment matrix |
| Community / trial / Development Server / Single Server / Cluster allowed-or-not per env | § Environment matrix tables (free track) |
| Automation API not required for MVP | § Explicit non-requirements |
| Production remains blocked until paid path or counsel Community | § Decision items 3, 4, 8; production rule |
| Free track accepted without commercial PO | § Status; Decision item 1; commercial stance |

## Human acceptance log

| Date | Owner | Verdict | Notes |
| --- | --- | --- | --- |
| 2026-07-24 | Product owner (human gate on `beads-wave-drain-2`) | **Accept free track** | No paid ONLYOFFICE plans. Use free Community + Developer Development Server for lab/internal. Customer-facing production Office edit remains blocked. Epic continues on free track. |

When a commercial purchase or counsel Community path is later accepted, set **Status** to a superseding decision (or amend with a new dated Accept row) and link the PO or counsel memo. Do not silently treat Development Server as production.
