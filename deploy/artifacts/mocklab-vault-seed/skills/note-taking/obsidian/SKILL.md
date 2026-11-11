---
name: obsidian
description: Read, search, create, and edit notes in the company vault (Obsidian-style markdown).
platforms: [linux, macos, windows]
---

# Vault notes (Obsidian-style)

Use this skill for filesystem-first vault work under `VAULT_ROOT` (MockLab:
`/mnt/vault`).

## Vault path

Prefer `/mnt/vault` (or resolved `VAULT_ROOT`). Default project notes:

`/mnt/vault/Projects/Workspace/notes/`

Do not pass unresolved `$VAULT_ROOT` strings to file tools — resolve first.

## Read / list / search

- Read: file `read` on absolute markdown paths
- List: search files under the resolved vault path with `*.md`
- Search content: content search with `file_glob: "*.md"`

## Create / append

Write or patch under project folders. Keep synthetic lab content only on MockLab.
