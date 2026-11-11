# AGENTS.md — Company Brain seed (client-core)

This repository is the **generic runtime seed** for a customer Company Brain. It is applied **once** onto a dedicated EC2 (or customer host), then operated **git-free**. Durability is the host disk (EBS + automated snapshots), not ongoing `git pull`.

It must not contain Lanyard-internal sales doctrine, live customer data, credentials, or generated embeddings.

## Do this first

1. Read `index.yaml` before substantive work.
2. Progressive discovery: nearest folder `AGENTS.md`, `INDEX.md`, or `RECALL.md` before editing that area.
3. Prefer templates under `templates/`.
4. Keep `index.yaml` and folder indexes current when structure changes.
5. After **Discover**, replace skeleton layout with the real org bucket map; do not invent department trees without an approved layout.

## Runtime posture (locked)

| Concern | Rule |
|---------|------|
| Authorship | **Agent-primary** vault — humans use Portal / connected channels; optional Obsidian Sync is not multi-writer merge training |
| Work queue | **Beads** (`bd`) front door, git-free (`bd init --stealth` / no GitHub Issues) |
| Canonical markdown | **vault-writer** only (+ `flock` on shared spine files) |
| Profiles | Hermes **role profiles**: `admin`, `contributor` (1:1 with control-plane roles) |
| Channels | Portal + Email + Slack + Teams + WhatsApp as **capabilities**; stay `pending` until secrets exist |
| Models | Default xAI Enterprise + ZDR when provisioned; BYO by SOW |
| Recall | Local MemPalace (`mempalace.yaml`); indexes are local runtime state |
| Sync of this seed | **One-shot** at provision — do not treat `origin` as day-to-day ops |

## Data rules

- Do not commit live CRM rows, transcripts, proposals, credentials, tokens, Drive IDs, private emails, or embeddings.
- Use placeholders in examples: `<OrgName>`, `<ContactName>`, `<Email>`, `<VaultRoot>`, `<ProjectName>`.
- `Clients/schema.sql` is schema-only; `Clients/clients_crm.db` is local runtime and ignored.
- `evals.db` (self-improve pack) is local runtime and ignored.

## Agent operating rules

- Use `agents/vault-writer.md` for canonical vault mutations and index updates.
- Use `agents/researcher.md` for research and artifact creation.
- No canonical vault write without a **claimed** bead when Beads is initialized.
- Beads claim **tasks**, not files — still use vault-writer + flock for shared paths.
- Do not create `README.md`. Use `AGENTS.md`, `INDEX.md`, and `RECALL.md`.
- Optional skill packs live under `packs/` until enabled (see `packs/INDEX.md` and `scripts/enable-pack.sh`).

## Folder spine (skeleton)

| Path | Purpose |
|------|---------|
| `Knowledge/` | Org knowledge after Discover (empty at seed) |
| `Projects/` | Project workspaces (empty at seed) |
| `staging/uploads/` | Inbound uploads (Portal / ingest) |
| `Clients/` | Optional account/CRM scaffold (empty buckets) |
| `memory/deep/` | Cross-brain durable memory |
| `skills/` | Always-on skills |
| `packs/` | Optional packs (gws, wacli, self-improve, focr, crm, granola, excel-author, meadow-core) |
| `agents/` | Agent definitions |
| `templates/` | Artifact and entity templates |

## Document parsing (optional pack: focr)

When the **focr** pack is enabled: local OCR to `.parse.md` on workers with enough RAM. Escalate to cloud document APIs only for handwriting/schema/Office paths as documented in the pack.

## Self-improve (optional pack)

When enabled: `packs/self-improve/scripts/init-evals-db.sh <VaultRoot>` and Hermes sync script; nightly eval loop is SOW/deploy-flag driven, not silent always-on.

## Seed vs Lanyard Core

| This repo (`client-core`) | Lanyard Core |
|---------------------------|--------------|
| Customer runtime seed | Lanyard employee brain + infra modules + sales doctrine |
| No Terraform modules | `infra/company-brain-ec2`, `infra/portal` |
| No Portal app | Portal monorepo |
| No Lanyard Business Plan | Business / pricing / proposals |

Doctrine: Lanyard Core `Business/Business Plan/SecondBrain/client-core-and-serving.md`.
