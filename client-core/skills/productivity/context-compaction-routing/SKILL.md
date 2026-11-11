---
name: context-compaction-routing
description: "Filter/score retrieved context against a downstream task using a cheap non-primary model before handing it to the main agent, with provider-aware model routing. Use when a pipeline stage hands >8 retrieved chunks to another stage/agent."
version: 2.0.0
author: User + Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [compaction, context-handoff, multi-agent, model-routing, sub-agent]
    related_skills: [hermes-agent, escalate-to-grok, mempalace, company-brain-proposal-pipeline]
---

# Context Compaction Routing

Delegates context relevance-filtering to a small, cheap model (NOT the primary
model) before a compacted result reaches the primary agent or next pipeline
stage. `delegate_task` can't do this per-call (only a global config override
exists) — this skill uses a pinned-model `hermes chat -q` subprocess instead.

**Load these in order:**
1. `references/agents-md-template.md` — the copy-paste AGENTS.md trigger block
2. `references/wide-cast-retrieval.md` — MemPalace mine/search/query before compacting
3. `references/compaction-invocation.md` — the actual sub-agent call + prompt + parsing
4. `references/model-routing-table.md` — which small model per provider, dated
5. `templates/candidate-chunk-list.md` — copy-paste candidate format for the compaction prompt
6. `scripts/verify-compaction-model.sh` — confirm the sub-agent call actually landed on the intended model

**Enforcement:** `~/.hermes/SOUL.md` mandates this skill for every Lanyard vault
/ MemPalace search returning >8 candidate chunks — not opt-in on that surface.
