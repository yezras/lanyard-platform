---
name: client-crm-organization
description: "Standardized client folder structure, notes organization, AGENTS.md profiles, and new client onboarding workflows for brokerage / service-based client management in Obsidian."
version: 1.7.0
author: Hermes Agent
tags: [obsidian, crm, clients, real-estate, notes, onboarding]
category: crm
---

# Client CRM Organization

Standardized way to set up and maintain client folders under an Obsidian vault's `Clients/` directory.

## Directory of Actions

This skill exposes the following modular actions. Each action has its own reference file with detailed procedures, templates, and rules.

**Extension pattern (v1.2+):** When adding new client-facing procedures, create a dedicated `references/<action>.md` file and list it in this table. The New Client Onboarding action follows this pattern.

| Action | Description | Reference File |
|--------|-------------|----------------|
| New Client Onboarding / Setup | Create bucket folder, client directory + `notes/` subdir, populate `AGENTS.md`, collect client details from user, incorporate meeting notes (via native mcp_granola tools), insert into `clients_crm.db`, update indexes, enforce `ob sync` | `references/new-client-onboarding.md` |
| Note Formatting & Filing | Strict filename convention (`YYYY-MM-DD-kebab-case`), required frontmatter, placement rules inside client `notes/` | `references/note-format.md` |
| AGENTS.md Template Usage | Standard client profile fields (business type, pipeline stage, contacts, next steps, agent instructions) | `references/AGENTS.md.template` |
| RECALL.md (MemPalace) | Per-client semantic search playbook + wing `<slug>`; link from AGENTS.md | `references/RECALL.md.template`, `references/recall-playbook.md` |
| Client-Specific Preference Recording | Store per-client rules (tone, workflow, communication cadence) directly in the client's `AGENTS.md` | `references/client-preferences.md` |
| Mandatory Sync Rule | Run `ob sync` after **any** Markdown creation/modification in the Lanyard vault | `references/ob-sync-rule.md` |
| Platform access (Granola/gws/wacli) | Native tools only; no Grok/Codex delegation for connectors | `references/native-tools-policy.md` |
| CRM cron + model defaults | Pin xai-oauth Grok on crons; job skill lists; layout under `crm/` | `references/crm-cron-and-model-defaults.md` |
| Pipeline hygiene (DB ↔ buckets) | Align `pipeline_stage`, folder moves, INDEX, native Granola AGENTS sweep | `references/crm-pipeline-hygiene.md`, `scripts/bulk-fix-granola-agents-md.py` |
| RFP xlsx + diagram OCR | Materials/rfp layout, sheet extract, embedded PNGs, EasyOCR fallback, MemPalace mine | `references/rfp-xlsx-workbook-extract.md` |
| RFP → Agent Layer proposal | Single Materials proposal (not client `knowledge-base/` scaffold); xlsx + vision workflow | `references/rfp-agent-layer-proposal.md`, `references/integration-research-seeds.md` |
| Client proposal HTML | Adapt polished HTML templates (OKLCH design system) for external-facing pitches; align with RFP markdown first | `references/client-proposals.md`, `references/client-proposals-references/` |

## Core Structure

Clients/ uses category buckets (Active/, Discovery/, Intro/, Prospect/, Graveyard/) containing the individual client folders.

Every client gets:
- `Clients/<Bucket>/<ClientName>/`
- `Clients/<Bucket>/<ClientName>/notes/`
- `Clients/<Bucket>/<ClientName>/AGENTS.md` (required profile file at client root, not inside notes/)
- `Clients/<Bucket>/<ClientName>/RECALL.md` (MemPalace search playbook; create from template if missing)

INDEX.md and root AGENTS.md stay at Clients/ level and document the bucket structure. Vault-wide MemPalace policy: `<VaultRoot>/AGENTS.md`.

## Pipeline Stages

Use one of: `Active | Discovery | Intro | Prospect | Graveyard`

Clients are now grouped under these category buckets directly under `Clients/` (e.g. `Clients/Active/AcmeCo/`). `INDEX.md` and `AGENTS.md` remain at the `Clients/` root level.

## Note Naming

Always use `YYYY-MM-DD-kebab-case-title.md` for easy chronological and search querying.

## When to Use

- Creating new client folders (see New Client Onboarding action)
- Adding AGENTS.md to existing client notes directories
- Organizing emails, meetings, or documents into client notes
- Onboarding a new client from initial meetings or discovery
- Backfilling `RECALL.md` for legacy client folders (copy template, tailor queries, run `mempalace mine` — skill `mempalace`)
- Applying **weekly-crm-refresh** hygiene after user **YES** (see `references/crm-pipeline-hygiene.md`)
- **Splitting a second company** from an existing client when a shared principal's other venture is identified — see `references/new-client-onboarding.md` → *Splitting a Second Company from an Existing Client*

## References

- `references/RECALL.md.template` — MemPalace recall playbook per client
- `references/recall-playbook.md` — when/how to create RECALL.md and mine wings
- `references/ob-sync-rule.md` — mandatory sync step after any markdown change in the Lanyard vault
- `references/new-client-onboarding.md` — full new-client workflow (bucket creation, user data collection, CRM DB insert)
- `references/native-tools-policy.md` — Granola/gws/wacli access without external delegation
- `references/crm-cron-and-model-defaults.md` — scheduled job model pin and skill lists
- `references/crm-pipeline-hygiene.md` — DB ↔ vault bucket alignment after weekly refresh YES
- `scripts/bulk-fix-granola-agents-md.py` — sweep bucket-level `AGENTS.md` for native Granola policy
- `references/rfp-agent-layer-proposal.md` — Excel RFP → one Materials implementation proposal (Agent Layer); **do not** build `knowledge-base/` under client folder as the deliverable
- `references/integration-research-seeds.md` — starting points for RFP stack integration research

## Pitfalls

- **Core doc names:** For Lanyard vault project trees (including `Education/`, client folders, and non-repo content areas), document agent workflows in `AGENTS.md`, location maps and setup notes in `INDEX.md`, and recall playbooks in `RECALL.md`. Do not add `README.md` files.
- Do not attach `codex`, `grok`, or `escalate-to-grok` to CRM cron `skills` for Granola or pipeline refresh — use native tools on the pinned Grok runner.
- Do not list `mcp_granola` as a cron skill name; Granola is a built-in tool family.
- CRM skills directory is `crm/`; keep `Clients/AGENTS.md` aligned with `references/native-tools-policy.md` (root vault file at `<VaultRoot>/Clients/AGENTS.md`).
- **Contact email before new folder:** Query `contacts` by attendee email before proposing a new `Clients/<Bucket>/<Name>/` folder; file under the matched client (e.g. `<Email>` → **ExampleBilling**).
- **Implicit onboarding approval:** When the user instructs you to merge meeting notes into a client folder and supplies contact fields (name, role, phone, email), treat that as approval to create/update the folder, note, `AGENTS.md`, `INDEX.md`, and `clients_crm.db` without a separate review-list round—unless they ask for review first.
- **Cron review YES / “make the proposed updates”:** When the user replies **YES** (or equivalent) to a **post-meeting-triage** cron deliverable’s proposed CRM writes, execute the full write list immediately in the interactive session—note, `clients_crm.db`, `AGENTS.md`, optional RFP pipeline per `references/rfp-xlsx-workbook-extract.md`, then `ob sync` and `mempalace mine` for that client wing. Before DB writes, verify the canonical DB is `<VaultRoot>/Clients/clients_crm.db` (the vault root may contain an empty placeholder), verify contact IDs by email/name because cron output can be stale, and respect the `communications.method` enum (`whatsapp|gmail|zoom|in_person|other`; use `other` for phone calls). See `references/crm-cron-and-model-defaults.md` → *Applying approved post-meeting-triage writes*.
- **Weekly hygiene YES:** When the user replies **YES** to **weekly-crm-refresh** *CRM hygiene notes* (stage alignment, AGENTS.md Codex cleanup, INDEX gaps, folder moves), run **`references/crm-pipeline-hygiene.md`** end-to-end in the interactive session—do not re-ask for approval item-by-item.
- **Legacy `Lead` in DB:** `pipeline_stage='Lead'` is obsolete for Lanyard reporting; map to folder bucket (`Active|Discovery|Prospect|Graveyard`) or an explicitly approved engagement bump, then verify `SELECT COUNT(*) ... WHERE pipeline_stage='Lead'` is 0.
- **Folder move checklist:** After `mv` between buckets, update client `AGENTS.md`, `RECALL.md` **Ingest** path, and `Clients/INDEX.md` in the same pass.
- **RECALL backfill:** Existing clients without `RECALL.md` should get one on next CRM touch (not only net-new onboarding). Wing must match folder slug only (e.g. `exampleclinic`), not a `client-` prefix — see vault `AGENTS.md` and `mempalace mine --wing`.
- **MemPalace vs CRM truth:** Never store pipeline stage or sole contact record only in MemPalace; DB + `AGENTS.md` remain authoritative. RECALL holds search phrases only.
- **RFP deliverable ≠ client-folder KB:** Do not create `knowledge-base/` with index, line-by-line, and integration-map files as the primary output. Synthesize into `Materials/*-lanyard-knowledge-base-implementation-proposal.md`; keep `Materials/rfp/` as source. See `references/rfp-agent-layer-proposal.md`.
- **Shared principal / multi-company clients:** When a contact (e.g. a CEO) runs multiple companies tracked as separate CRM clients, **duplicate the contact row** in `contacts` for each `client_id` (FK is per-client — do not reuse one row). Cross-reference both clients' AGENTS.md files and RECALL.md files so any agent working on either company knows about the sibling. Update the original client's next-step and AGENTS.md to resolve any "name TBD" placeholder. Keep the original meeting note filed under the original client; reference it by path from the new client. See `references/new-client-onboarding.md` → *Splitting a Second Company from an Existing Client*.

## Using Client Folder Structure for Agent Layer Explanations

When explaining how Lanyard structures knowledge for a client (especially during Agent Layer rollout), use the client's own folder structure as the teaching artifact. Show the ASCII tree of `Clients/<Bucket>/<ClientName>/` (with notes/, AGENTS.md, Materials/, Projects/, Workshop/) to illustrate progressive discovery, memory boundaries, and agent navigation. This makes the abstract Agent Layer concrete by grounding it in the exact structure the client will inhabit.

## Client proposal HTML (external deliverables)

When adapting an existing **client HTML template** (hero, TOC, OKLCH tokens, Lanyard logo):

1. If engagement started from Excel RFP, finalize **`Materials/*-lanyard-knowledge-base-implementation-proposal.md`** first (`references/rfp-agent-layer-proposal.md`).
2. Swap content only (title, hero, sections, modules) — preserve CSS/JS/logo/print styles.
3. Run `cd <VaultRoot> && ob sync` after `write_file`.
4. External tone — no Hermes/Grok jargon unless asked.

Full steps + email case-study brevity rules: `references/client-proposals.md`

## Mandatory Post-Edit Sync Rule

After creating or modifying ANY markdown file in the Lanyard vault:
1. Run `cd <VaultRoot> && ob sync`
2. Only skip if a git repo exists in the target folder AND you are not on the master branch.
3. This rule is non-negotiable for vault consistency and agent memory integrity.

## Note Management Rules (absorbed from client-note-management)

### Note Format

- Filename: `YYYY-MM-DD-descriptive-kebab-case-title.md`
- Always include frontmatter with at minimum: `date`, `from`, `subject`, `client` (optionally `email_id`)
- Place every note inside the correct client’s `notes/` directory: `<VaultRoot>/Clients/<ClientName>/notes/`

### Granola / Meeting Notes

Use native `mcp_granola_*` tools directly for retrieving and processing meeting notes and transcripts. These are available natively in Hermes.

### Obsidian Sync Discipline (detailed)

After creating or modifying Markdown files:
1. Check branch: `git -C "Clients/AcmeCo/Projects/Building Pages/build" branch --show-current` (or equivalent client project)
2. Only run `ob sync --path /Lanyard` when on `main`

See also the per-client `AGENTS.md` for business type, pipeline stage, key contacts.

## Scheduled / cron execution

See **`references/crm-cron-and-model-defaults.md`** for model pin, job skill lists, and the runner-vs-delegation pitfall. Summary: pin `grok-composer-2.5-fast` + `xai-oauth` on the job; use native connectors on that runner.
