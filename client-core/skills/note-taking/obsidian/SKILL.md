---
name: obsidian
description: Read, search, create, and edit notes in the Obsidian vault.
platforms: [linux, macos, windows]
---

# Obsidian Vault

Use this skill for filesystem-first Obsidian vault work: reading notes, listing notes, searching note files, creating notes, appending content, and adding wikilinks.

## Vault path

Use a known or resolved vault path before calling file tools.

The documented vault-path convention is the `OBSIDIAN_VAULT_PATH` environment variable, for example from `${HERMES_HOME:-~/.hermes}/.env`. If it is unset, use `~/Documents/Obsidian Vault`.

**Lanyard CRM vault (this user):** `<VaultRoot>` — read `<VaultRoot>/AGENTS.md` for vault-wide rules; client work under `Clients/` uses per-folder `AGENTS.md` and `RECALL.md` (see `client-crm-organization` and `mempalace` skills).

File tools do not expand shell variables. Do not pass paths containing `$OBSIDIAN_VAULT_PATH` to `read_file`, `write_file`, `patch`, or `search_files`; resolve the vault path first and pass a concrete absolute path. Vault paths may contain spaces, which is another reason to prefer file tools over shell commands.

If the vault path is unknown, `terminal` is acceptable for resolving `OBSIDIAN_VAULT_PATH` or checking whether the fallback path exists. Once the path is known, switch back to file tools.

## Read a note

Use `read_file` with the resolved absolute path to the note. Prefer this over `cat` because it provides line numbers and pagination.

## List notes

Use `search_files` with `target: "files"` and the resolved vault path. Prefer this over `find` or `ls`.

- To list all markdown notes, use `pattern: "*.md"` under the vault path.
- To list a subfolder, search under that subfolder's absolute path.

## Search

Use `search_files` for both filename and content searches. Prefer this over `grep`, `find`, or `ls`.

- For filenames, use `search_files` with `target: "files"` and a filename `pattern`.
- For note contents, use `search_files` with `target: "content"`, the content regex as `pattern`, and `file_glob: "*.md"` when you want to restrict matches to markdown notes.

## Create a note

Use `write_file` with the resolved absolute path and the full markdown content. Prefer this over shell heredocs or `echo` because it avoids shell quoting issues and returns structured results.

## Append to a note

Prefer a native file-tool workflow when it is not awkward:

- Read the target note with `read_file`.
- Use `patch` for an anchored append when there is stable context, such as adding a section after an existing heading or appending before a known trailing block.
- Use `write_file` when rewriting the whole note is clearer than constructing a fragile patch.

For an anchored append with `patch`, replace the anchor with the anchor plus the new content.

For a simple append with no stable context, `terminal` is acceptable if it is the clearest safe option.

## Targeted edits

Use `patch` for focused note changes when the current content gives you stable context. Prefer this over shell text rewriting.

## Wikilinks

Obsidian links notes with `[[Note Name]]` syntax. When creating notes, use these to link related content.

## Lanyard post-edit sync

After creating or modifying markdown under `<VaultRoot>`:

```bash
cd <VaultRoot> && ob sync
```

(Skip only per `client-crm-organization` / vault `AGENTS.md` git-branch rule.) Then re-mine the affected client folder into MemPalace if episodic recall should include the new content (`mempalace` skill).

When deleting obsolete markdown from the vault, run the same sync and verify the sync output includes the expected remote deletion; if useful, verify the file is absent locally before reporting completion.

Client RFP assessments often live under `Clients/<Bucket>/<Client>/knowledge-base/` (not only `notes/`); see **`client-crm-organization`** → `references/rfp-line-by-line-agent-layer-response.md`.

## Lanyard business plan / pricing edits

For updates to `<VaultRoot>/Business/Business Plan/businessPlan.md` based on `pricing.md`, keep the business plan strategic rather than duplicating the pricing sheet. Read both files, replace the obsolete pricing/revenue/projection sections, point to `[[pricing]]` as the canonical sheet, reconcile revenue/opex tables, and sync the vault. See `references/lanyard-business-plan-pricing-updates.md` for the detailed pattern.
