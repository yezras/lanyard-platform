---
name: client-proposals
description: Workflow for creating external-facing client proposals in HTML by adapting existing polished templates (e.g. litigation technical spec) while preserving design system, then syncing to the Lanyard vault.
---

# Client Proposal HTML Templating

When the user provides or references an existing HTML template from prior client work and asks to adapt it for a new client:

**RFP / discovery first:** If the engagement started from an Excel RFP, produce or use **`Materials/*-lanyard-knowledge-base-implementation-proposal.md`** per **`client-crm-organization`** → `references/rfp-agent-layer-proposal.md` before swapping HTML content. Do **not** treat a client-folder `knowledge-base/` tree as the source of truth. Proposal sections (Current State, Proposed Solution, Outcomes) should align with that markdown, including deferred integrations (e.g. EMR Phase 2) and 3CX-only telephony when specified.

1. Locate the template file in the vault (usually under the new client's projects/ folder as proposal.html or similar).
2. Read the full HTML to understand structure: head with CSS/OKLCH design tokens, topbar with Lanyard logo + print button, sidebar TOC with section links, hero with title/meta, content sections using .module grids, h2/h3, lists, and closing script for TOC active state + print.
3. Update only the changeable content:
   - <title>
   - Hero: eyebrow, h1, meta fields (Client/Project, Date, Status)
   - TOC nav links and ids to match the new 5-8 section structure
   - All <section id="..."> blocks with new professional client-level content (Executive Summary, Current State, Proposed Solution, Capabilities as .module cards, Technical Approach, Outcomes, Next Steps)
   - Remove any prior-client-specific references (names, internal tools, litigation details)
4. Keep 100% of the CSS, embedded logo SVG, responsive rules, print styles, and JS intact.
5. After writing the file with write_file, immediately run `cd <VaultRoot> && ob sync`.
6. The resulting document must be suitable to send directly to the client (external pitch tone, no internal agent names like Hermes/Grok, benefit-focused language).

## References
- `references/bxgroup-proposal-example.html` (session-specific adapted output)
- Use the same OKLCH color system, font stack, and spacing tokens as the source template.

This skill ensures visual and structural consistency across client proposals while allowing rapid content swaps.

## Concise Email Case Studies for Use-Case Alignment
When the user asks for a brief case study paragraph or email reply that demonstrates capability against a prospect's listed use cases (e.g., document Q&A, report generation, preliminary analysis):

- Keep the entire response to 150-200 words max.
- Open with a direct mapping sentence linking the delivered system to 1-2 of the prospect's exact use cases.
- Focus 60% of the content on the document search / query interpretation capability: how simple natural-language questions are interpreted, how the agent searches and connects information across thousands of sources, and how repeatable queries become automated workflows.
- Use the prospect's own phrasing and examples (leases, loans, treaties, critical dates, responsibility analysis) rather than generic litigation language.
- End with a clear next-step question about scheduling.
- Tone: professional, benefit-oriented, and confident without internal jargon or excessive setup explanation.
- Never include technical implementation details (vector stores, cron jobs, Hermes skills, etc.) unless explicitly requested.