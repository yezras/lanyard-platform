# RFP → Agent Layer implementation proposal (not a client-folder knowledge base)

Use when the user asks to **map Lanyard’s solution** to an Excel RFP, apply **Agent Layer** positioning, and produce a **client-ready implementation proposal** — especially healthcare intake (intake workflow) stacks.

**Prerequisites:** `references/rfp-xlsx-workbook-extract.md` (sheet text + diagram images + vision/OCR).

## Critical pitfall (<LanyardOperator> / Lanyard preference)

**Do NOT** scaffold `Clients/<Client>/knowledge-base/` with `00-index.md`, line-by-line Q&A files, integration maps, and workflow stubs as if that folder **is** the product.

The **knowledge base** is the **Agent Layer service** (Hermes harness + structured brain + skills/memory + integrations). The vault deliverable for discovery is:

```
Clients/<Bucket>/<ClientName>/Materials/
  YYYY-MM-DD-lanyard-knowledge-base-implementation-proposal.md   # PRIMARY — synthesize here
Materials/rfp/                                                    # source only (xlsx, extract, PNGs)
```

Internal line-by-line analysis may inform the proposal but lives **inside** the single proposal (themes + appendix table of client answers), not as a parallel KB tree.

## Positioning source

Read `Business/Business Plan/Agent Layer.md`. Frame as:

- Agent-operable workspace (index, artifacts, skills, memory, progressive discovery)
- **Not** a rigid scheduled workflow app
- Client-owned data; CRM (e.g. Salesforce) remains **system of record** when RFP states so
- Honor `notes/` + `AGENTS.md` non-negotiables (data ownership, minimal ops lift, keep phone numbers)

## Response shape (user preference: solution-first)

1. **Synthesize** problem, workflow, KPIs, and phased solution in **one proposal markdown** under `Materials/`.
2. Map RFP **by theme** (phone, web, EMR, pilot, metrics) — not forty duplicate “Lanyard answer” blocks unless <LanyardOperator> explicitly asks for workbook parity doc.
3. Preserve **client’s answers** in an appendix table (Q# | topic | Max/client answer) for proposal/HTML handoff.
4. **Definitions** in proposal when client jargon is ambiguous (e.g. **intake acronym = new client intake**, not national provider identifier; **External staffing vendor** = offshore staffing vendor / float person, not a doctor or software system).

## Workflow (order matters)

1. Parse Q&A from `Materials/rfp/sheet-text-extract.txt` (refresh from xlsx if needed).
2. **Diagrams:** `vision_analyze` each `extracted-images/image*.png` for flows, queues, CRM boundaries. **`imagine` ≠ OCR** — do not use for reading Excel embeds.
3. **Research** named systems (`references/integration-research-seeds.md`); fold into proposal architecture section, not a separate `05-integration-map.md` unless user requests annex.
4. **Telephony:** When client uses **3CX**, default pilot to **3CX only** (Call Control API + optional AI Edition/SIP). **Hermes does not dial as SIP** — it orchestrates an integration service. Do not push Twilio unless user asks.
5. **EMR:** If client reports no reliable API (e.g. legacy EMR), **Phase 1 = qualify + CRM tasks**; booking write-back **Phase 2** only.
6. **Metrics:** Prefer **weekly Hermes cron report** (email/Slack) over promising a new standalone dashboard in Phase 1.
7. Update `AGENTS.md` next steps + `PROJECTS-INDEX.md` → proposal path only.
8. `ob sync`; optional `mempalace mine` on **client folder** (proposal + notes), not a fake KB subtree.

## Handoff to HTML

**`client-proposals`**: adapt vault HTML template from proposal sections (Executive Summary, Current State, Proposed Solution, Outcomes, Next Steps). Align with deferred integrations in proposal.

## Reference client

Example Clinic (2026-06): `Materials/2026-06-26-lanyard-knowledge-base-implementation-proposal.md` — CRM-first, voice integration, legacy EMR deferred.