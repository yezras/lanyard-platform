# Optional packs

Packs ship **in the seed** but are **not active** until `scripts/enable-pack.sh <name>` copies/links them into the live skill/tool paths (or Hermes skill dirs per pack README in each folder).

## Discoverable catalog

Each pack directory carries machine-readable metadata in `pack.yaml` (`name`,
summary, optional `sources` / `dependencies`). The enable script lists the
catalog without enabling anything:

```bash
# From a vault root, or monorepo client-core/ checkout
./scripts/enable-pack.sh list
# or: bash client-core/scripts/enable-pack.sh list

# Offline validation (missing / duplicate metadata, handler sync)
./scripts/validate-packs.py
# monorepo root: python3 client-core/scripts/validate-packs.py
```

| Pack | When to enable | Contents |
|------|----------------|----------|
| `gws` | Google Workspace email/calendar/drive primary | Google Workspace skills |
| `wacli` | WhatsApp channel | WhatsApp CLI install + docs |
| `self-improve` | SOW enables nightly eval loop | skill + tools + init/sync scripts |
| `focr` | Local OCR ingest workers | franken_ocr install docs/scripts |
| `crm` | Customer uses Clients/ CRM scaffold workflows | CRM organization skills |
| `granola` | Granola meeting notes MCP | MCP connection package |
| `excel-author` | Spreadsheet authoring workflows | excel-author skill |
| `meadow-core` | Group agent rooms (Skip / Lev / Bana) | Three personas + shared room instructions |

## Rules

- Enabling a pack does **not** create channel secrets — channel status stays `pending` until credentials exist.
- Do not enable `self-improve` by default on cheap pilots without budget for model spend.
- Packs must remain free of live customer data and credentials.
- Every pack directory **must** include `pack.yaml` with a unique `name` matching the directory basename (enforced by `scripts/validate-packs.py` / monorepo `scripts/validate.sh` check 14).
