# MemPalace CLI — install & init (session notes)

## Install (verified)

```bash
uv tool install mempalace   # installs mempalace + mempalace-mcp
mempalace --version         # e.g. 3.5.0
```

## Non-interactive Lanyard init

`mempalace init <dir>` may prompt to mine the whole tree. For CRM vaults, **skip full-vault mine**; mine per `--wing` instead.

```bash
mempalace init <VaultRoot> --yes --no-llm
```

- `--yes` — accept detected entities without prompts
- `--no-llm` — no Ollama/API for entity refinement
- Do **not** pass `--auto-mine` unless intentional bulk ingest

Creates `mempalace.yaml` at vault root; may add entries to `.gitignore`.

## Dynamic instructions (version-safe)

```bash
mempalace instructions search
mempalace instructions mine
mempalace instructions init
```

Prefer these when upstream CLI flags change between releases.

## Top-level commands (3.5.x)

`init`, `mine`, `sweep`, `sync`, `search`, `status`, `wake-up`, `split`, `palace`, `mcp`, `repair`, `daemon`

Global: `--palace PATH`, `--backend` (default chroma)

## Mine modes

| Mode | Flag | Use |
|------|------|-----|
| projects | default | Markdown, docs, code under a directory |
| convos | `--mode convos` | Claude/ChatGPT exports |
| extract | `--mode extract` | PDF/DOCX (extra) |

Lanyard clients: always `--mode projects` + explicit `--wing client-<slug>`.

## Search

```bash
mempalace search "query" --wing client-acmeco --room education --results 8
```

Empty `--wing` / `--room` means no filter (omit rather than `""`).

## Architecture choice vs Hermes Mem0 plugin

This deployment uses **skill + CLI + RECALL.md**, not `hermes memory setup` / Mem0. Authority: `clients_crm.db` + `AGENTS.md` > vault files > MemPalace hits.

Vault policy: `<VaultRoot>/AGENTS.md`