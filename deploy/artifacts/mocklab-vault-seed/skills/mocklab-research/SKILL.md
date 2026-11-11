---
name: mocklab-research
description: >
  MockLab kitchen-sink research helper. Use when the user asks for a short
  lab research outline, GPU capacity notes, or vault-seed smoke checks.
version: 1.0.0
platforms: [linux]
metadata:
  lanyard:
    tags: [mocklab, research, kitchen-sink]
---

# MockLab research

## When to use

- Kitchen-sink QA needs a skill id visible in Settings / inventory
- User asks for a short research outline on a technical topic
- Verifying `skills_roots: [/mnt/vault/skills]` discovery after vault seed

## How to work

1. Prefer reading vault files under `/mnt/vault` with file tools.
2. Start from `Projects/Workspace/welcome.md` when checking seed health.
3. Keep outputs short; write durable notes under
   `Projects/Workspace/notes/` when the user asks to save.

## Seed check

If `AGENTS.md` at vault root and this `SKILL.md` are readable, MockLab vault
seed (`lp-zuh.9.5`) is applied.
