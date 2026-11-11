---
name: mempalace
description: Operate the MemPalace CLI for local semantic recall over the Lanyard vault — install, init, mine, search, status; integrate with per-folder RECALL.md playbooks.
version: 1.1.0
author: Hermes Agent
tags: [mempalace, memory, chroma, obsidian, lanyard, cli, recall]
category: note-taking
platforms: [linux, macos]
metadata:
  hermes:
    tags: [mempalace, memory, chroma, obsidian, lanyard, cli, recall]
---

# MemPalace CLI (Lanyard)

Local-first verbatim memory with semantic search (ChromaDB default). Use for **episodic recall** — not for CRM truth (that stays in `clients_crm.db` + `AGENTS.md`).

Official docs: https://mempalaceofficial.com/reference/cli.html  
Upstream skill pattern: run `mempalace instructions <command>` for version-correct steps (`init`, `mine`, `search`, `status`, `help`). Condensed install/init notes: `references/cli-and-init.md`.

**Related:** `client-crm-organization` (RECALL.md templates), `obsidian` (vault paths), `context-compaction-routing` (filter/score results against the downstream task via a cheap model before handing off, when a search returns >8 chunks — mandated by SOUL.md for all Lanyard vault/MemPalace searches at that size), vault `<VaultRoot>/AGENTS.md`.

## When to use

- User asks to search past client conversations, workshop notes, or vault context filed in MemPalace
- Working in a Lanyard folder that has `RECALL.md` — run playbook searches **before** substantive answers
- After creating/updating client `notes/*.md` — mine into the palace (or remind user / cron)
- Cross-client questions (“how do we usually pitch agent layer?”) — search `lanyard` wings

## Install (once per machine)

Prefer isolated install (PEP 668 safe):

```bash
uv tool install mempalace
mempalace --version
```

Alternatives: `pipx install mempalace` or `pip install mempalace` inside a venv.

Requires Python 3.9+. First run downloads ~300MB embedding model (offline after setup). No API key for core search.

Verify on PATH:

```bash
which mempalace
```

## Lanyard single-palace model

**One Chroma palace** for the vault. **One MemPalace wing per client** — wing name = client slug (not a separate collection per folder).

| Wing | Mined from | Purpose |
|------|------------|---------|
| `<slug>` | `Clients/<Bucket>/<ClientName>/` | That client only (`AcmeCo` → wing `acmeco`) |
| `lanyard-company` | `Education/`, methodology decks | Cross-client: what Lanyard builds/sells |

**Slug:** client folder name lowercased, `_` → `-` (`AcmePartners` → wing `acme-partners`). Same client in two buckets (e.g. Discovery + Prospect) should use the **same wing** when mining both paths.

**Mine all clients:** `~/.hermes/scripts/mempalace-mine-all-clients.sh` (one `mempalace mine` per client root).

Palace location: default `~/.mempalace/palace` after init, or pass `--palace` on every command.

### First-time Lanyard setup

```bash
mempalace init <VaultRoot> --yes --no-llm
```

Use `--no-llm` for heuristics-only entity detection (no Ollama/API). **Do not** `--auto-mine` the whole Lanyard vault in init — mine per client wing (see below). Init may still prompt for full-vault mine; decline and use targeted `mine` commands.

### Mine client folder

```bash
CLIENT_DIR="<VaultRoot>/Clients/Prospect/AcmeCo"
SLUG="acmeco"
mempalace mine "$CLIENT_DIR" --wing "${SLUG}" --mode projects
```

Re-run after new notes; idempotent for unchanged files. Use `mempalace mine ... --dry-run` to preview.

### Mine Lanyard company knowledge

```bash
mempalace mine <VaultRoot>/Education --wing lanyard-company --mode projects
```

### Search

```bash
# Client-scoped (preferred when in a client folder)
mempalace search "Outlook integration security on-prem" --wing acmeco --results 8

# Cross-client product/methodology
mempalace search "agent layer knowledge base compounding context" --wing lanyard-company --results 8

# Portfolio-wide (use sparingly — noisier)
mempalace search "workshop action items" --results 10
```

Optional room scoping if `mempalace init` detected subfolders: `--room <name>`.

### Status / taxonomy

```bash
mempalace status
mempalace wake-up --wing acmeco
```

## RECALL.md integration (required workflow)

1. If cwd is under `<VaultRoot>`, walk up to the nearest folder containing `RECALL.md` (client root, project subfolder, or `Education/`).
2. Read `RECALL.md` and run **every query listed** for the matching intent (touchpoint, draft email, workshop prep, etc.).
3. Prefer `--wing` from the playbook’s **Wing** line — do not search globally if a wing is specified.
4. Summarize answers citing MemPalace hits; if empty, say so and fall back to `read_file` on vault markdown + `clients_crm.db` per `AGENTS.md`.
5. **Authority order:** DB + `AGENTS.md` > vault notes > MemPalace (hints only).

Load vault-wide rules from `<VaultRoot>/AGENTS.md` when doing cross-cutting work.

## Ingest discipline

After filing new markdown under `Clients/.../notes/`:

1. `cd <VaultRoot> && ob sync` (vault rule)
2. `mempalace mine <client-root> --wing <slug> --mode projects`

## MCP (optional)

`uv tool install mempalace` also installs `mempalace-mcp`. Hermes can use MCP tools (`mempalace_search`, etc.) if configured in `hermes mcp add`. **This skill defaults to CLI** via `terminal` for consistency with cron and logs.

## Pitfalls

- **Fresh wing search:** After bulk mine, wing-scoped search can fail for ~30–60s while Chroma flushes; retry or use unscoped search once.
- **Impostor sites:** Only GitHub, PyPI `mempalace`, and mempalaceofficial.com are official.
- **Do not store secrets** in mined paths; respect `.gitignore` (default on mine).
- **Windows ONNX:** Lower `MEMPALACE_MAX_CHUNKS_PER_FILE` if mine crashes on huge dirs.

## Verification

```bash
mempalace --version
mempalace status
mempalace search "test" --wing acmeco --results 3
```