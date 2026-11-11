---
name: <agent-name>
description: <short responsibility>
harnesses: [codex, hermes-agent]
allowed_paths:
  - <relative/path>
forbidden_paths:
  - <relative/path>
required_skills:
  - <skill-name>
---

# <Agent Name>

## Mission

Describe the repeatable job this agent performs.

## Inputs

- User request or task ticket.
- Relevant index entries.
- Relevant memory or recall files.

## Operating Rules

- Read `AGENTS.md` and `index.yaml` first.
- Read folder-level instructions before editing.
- Use templates for new artifacts.
- Update indexes when structure changes.
- Do not commit private client data or credentials.

## Outputs

- List the expected artifact, patch, report, or decision output.

## Verification

- List the checks this agent must run before handoff.

