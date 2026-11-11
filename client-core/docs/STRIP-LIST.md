# Strip list — Core → client-core (v0.1.0)

Executed 2026-07-09 from Lanyard Core per `client-core-and-serving.md`.

## Included (always-on)

| From Core | In client-core |
|-----------|----------------|
| `agents/vault-writer.md`, `researcher.md`, `template.md`, `INDEX.md` | `agents/` |
| `templates/` | `templates/` |
| `memory/` conventions | `memory/` |
| `skills/note-taking/` | `skills/note-taking/` |
| `skills/productivity/context-compaction-routing/` | `skills/productivity/context-compaction-routing/` |
| `Clients/` empty buckets + `schema.sql` + scaffold AGENTS/INDEX | `Clients/` |
| `scripts/init-crm-db.sh` | `scripts/init-crm-db.sh` |
| New generic root docs | `AGENTS.md`, `INDEX.md`, `index.yaml`, `mempalace.yaml` |

## Included as optional packs (`packs/`)

| Pack | Source |
|------|--------|
| `gws` | `skills/gws/`, `skills/productivity/gws` |
| `crm` | `skills/crm/` |
| `self-improve` | `skills/self-improve/`, `tools/self-improve/`, evals scripts |
| `wacli` | `tools/wacli/` |
| `focr` | `infra/focr/` (docs/scripts; no model weights) |
| `granola` | `mcp/granola-hermes/` |
| `excel-author` | `skills/finance/excel-author/` |

## Excluded (stay in Core or other repos)

| Path / area | Reason |
|-------------|--------|
| `Business/` | Lanyard business plan, employment, portal doctrine, pricing |
| `Education/`, `Goals/`, `dev/` | Lanyard internal |
| `docs/prd/` Portal PRD | Portal monorepo + Core doctrine |
| `infra/company-brain-ec2/`, `infra/portal/` | Deploy kit / Core modules (not seed) |
| `skills/productivity/company-brain-proposal-pipeline/` | Lanyard sales |
| `skills/finance/lanyard-financial-models/` | Lanyard internal |
| `skills/grill-me/`, `to-prd/`, `to-issues/` | Lanyard delivery tooling |
| `agents/crm-operator.md` | Lanyard CRM operator; customer CRM via pack skills |
| Live CRM DBs, embeddings, credentials, tfvars | Data boundary |
| Portal application code | `LanyardBrain/Portal` |

## Empty spine added (not from Core)

- `Knowledge/`, `Projects/`, `staging/uploads/` — filled after Discover
