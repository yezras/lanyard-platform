# client-core — Company Brain runtime seed

Private seed repo for **customer** Company Brains. Derived from Lanyard Core with Lanyard-specific business, sales, and infra modules stripped.

## Purpose

- **One-shot** content dropped onto a dedicated EC2 (Lanyard-hosted or customer-hosted).
- After bootstrap: **git-free** operation; durability = EBS snapshots (and optional Obsidian Sync).
- Optional **packs** enabled per SOW via `scripts/enable-pack.sh`.

## Quick start (operator)

```bash
# From a provisioned host vault path (example)
# 1) Unpack this seed at VAULT_ROOT (bootstrap from pinned S3 tarball client-core/<version>/)
# 2) Run local scaffold
./scripts/setup-local.sh

# 3) Enable packs as needed (examples)
./scripts/enable-pack.sh gws
./scripts/enable-pack.sh wacli
./scripts/enable-pack.sh self-improve   # only if SOW enables

# 4) Optional CRM empty DB
./scripts/init-crm-db.sh

# 5) Hermes profiles admin/contributor + Beads + relay env are applied by the
#    host bootstrap (deploy kit / company-brain-ec2 setup), not this seed alone.
```

## Layout

| Path | Role |
|------|------|
| `AGENTS.md` | Agent entrypoint / operating rules |
| `index.yaml` | Structure map |
| `mempalace.yaml` | Semantic recall room template |
| `agents/` | vault-writer, researcher; meadow-core personas after pack enable |
| `skills/` | Always-on (note-taking, context-compaction) |
| `packs/` | Optional skill/tool packs |
| `templates/` | Artifact + client folder templates |
| `Clients/` | Empty CRM scaffold + `schema.sql` |
| `Knowledge/`, `Projects/`, `staging/` | Empty org spine (filled after Discover) |
| `scripts/` | setup, pack enable, CRM init, **release pack** |
| `scripts/pack-release.sh` | Build immutable seed tarball + SHA-256 (`dist/`) |
| `.github/workflows/release-artifact.yml` | Tag/release → pack → OIDC → S3 `client-core/<version>/` |
| `docs/STRIP-LIST.md` | What was included vs excluded from Core |
| `docs/RELEASE.md` | How to cut a tag, required Actions vars, deploy pin fields |

## Data boundary

Never commit: live customer data, credentials, tfvars, tfstate, embeddings, local DBs (except schema SQL).

## Documentation policy

No `README.md`. Use `AGENTS.md`, `INDEX.md`, `RECALL.md`, and `docs/`.

## Versioning

Tag releases (`v0.1.0`, …). **Deploy pins a versioned S3 artifact** (URL + version + SHA-256), not a live git branch. Customers do not collaborate on this git remote as day-to-day workflow.

```bash
# Local pack (no upload)
./scripts/pack-release.sh v0.1.0

# Publish: push an immutable tag (CI → s3://$ARTIFACT_BUCKET/client-core/<tag>/)
git tag -a v0.1.0 -m "client-core v0.1.0"
git push origin v0.1.0
```

Operator details: [`docs/RELEASE.md`](docs/RELEASE.md).
