# Cutover dry-run: client-core import (`lp-k7g.12.2`)

Back to [phase 8](phase-8-cutover.md) · [phase 5](phase-5-client-core-migration.md) · [client-core/README.md](../../../client-core/README.md).

## Goal

Re-verify the **already-imported** monorepo `client-core/` tree against the source
repository freeze, then prove artifact generation and pack validation from the
monorepo path still match deploy bootstrap expectations.

This is a **cutover dry-run check**, not a second history import. Import landed
in phase 5 (`lp-k7g.9.2`).

## Freeze and import provenance

| Field | Value |
| --- | --- |
| Source repository | `https://github.com/LanyardBrain/client-core.git` |
| Local compare root | historical local path: `/home/operator/Lanyard-Dev/client-core` (legacy clone removed; live tree is monorepo `client-core/`) |
| Freeze SHA (pre-rewrite) | `4225110cb7549db615b01176884957d932cb2a3b` |
| Source tip at dry-run | same as freeze (`4225110…`) |
| Monorepo path | `client-core/` |
| Import method | `git filter-repo --to-subdirectory-filter client-core` → merge |
| Import merge | `0adda0b` — `import: client-core history under client-core/ (source SHA 4225110…)` |
| Phase-5 follow-ons | `lp-k7g.9.3` packs, `lp-k7g.9.4` pack-release monorepo mode, `lp-k7g.9.5` seed idempotency |

## Acceptance evidence

### 1. Seed content matches source repo

Compared monorepo `client-core/` tracked tree to freeze `4225110…` (and the local
source checkout at that SHA).

| Check | Result |
| --- | --- |
| Root seed files (`AGENTS.md`, `INDEX.md`, `index.yaml`, `mempalace.yaml`, `.gitignore`) | **Byte-identical** to source |
| Seed directories (`agents/`, `Clients/`, `Knowledge/`, `memory/`, `Projects/`, `staging/`, `.seed/`) | **Identical** |
| Tracked files at freeze present under monorepo prefix | **200/200** freeze paths present |
| Byte-identical vs freeze for paths not intentionally evolved in monorepo | **195** match |
| Content intentionally diverged (phase 5 monorepo tooling) | **5** files (see below) |
| Monorepo-only additions (phase 5) | `README.md`, `packs/*/pack.yaml` (7), `scripts/{validate-packs.py,smoke-pack-release.sh,smoke-seed-idempotency.sh,seed-vault.sh}` |
| Paths only in local source working tree | Empty untracked dirs / local `test.md` — **not in freeze git index** |

**Intentional monorepo deltas** (not seed regressions):

| Path | Why it differs |
| --- | --- |
| `scripts/pack-release.sh` | Monorepo `HEAD:client-core` packaging (`lp-k7g.9.4`) |
| `scripts/enable-pack.sh` | Pack discovery / handlers for `pack.yaml` metadata (`lp-k7g.9.3`) |
| `packs/INDEX.md` | Pack catalog sync with metadata |
| `docs/RELEASE.md` | Publish-from-subpath operator docs |
| `.github/workflows/release-artifact.yml` | Path-scoped monorepo publish workflow |

**Conclusion:** vault seed content from the freeze is present and matches source;
deltas are phase-5 monorepo packaging/validation only.

### 2. Artifact tarball shape matches current deploy

Offline dry-run from monorepo root:

```bash
OUT_DIR=/tmp/cc-dry-run ARTIFACT_BUCKET=example-artifacts-bucket \
  bash client-core/scripts/pack-release.sh --dry-run v0.0.0-dry-run-lp-k7g.12.2
```

Observed (representative dry-run on this branch):

| Contract field | Observed |
| --- | --- |
| Source mode | `monorepo` |
| Archive tree | `HEAD:client-core` |
| Tarball name | `client-core-v0.0.0-dry-run-lp-k7g.12.2.tar.gz` |
| Single top-level prefix | `client-core-v0.0.0-dry-run-lp-k7g.12.2/` |
| Bootstrap gate file | `${PREFIX}AGENTS.md` present |
| S3 object key | `client-core/<version>/client-core-<version>.tar.gz` |
| Alt key (also accepted) | `client-core/<version>/client-core.tar.gz` |
| Pin block | top-level `client_core.{version,url,sha256}` (not under `backend`) |
| Monorepo leakage | none (`portal/`, `deploy/`, `contracts/`, nested `client-core/` absent) |
| `.git` in archive | none |
| Members | ~378 (tracked seed + monorepo pack/publish tooling) |

Companion smoke (full shape + pin schema):

```bash
bash client-core/scripts/smoke-pack-release.sh
# Also scripts/validate.sh check 15
```

Smoke verifies: single prefix, `AGENTS.md`, sha256, meta.env, pins.yaml,
compatibility validator accepts `client_core` fragment, mutable version labels
rejected.

### 3. Pack validation works

```bash
python3 client-core/scripts/validate-packs.py
bash client-core/scripts/enable-pack.sh list
# Also scripts/validate.sh check 14
```

| Check | Result |
| --- | --- |
| Discoverable packs | **7**: `crm`, `excel-author`, `focr`, `granola`, `gws`, `self-improve`, `wacli` |
| `pack.yaml` metadata + unique names | **OK** |
| `enable-pack.sh` handlers | in sync with pack set |
| `index.yaml` / `packs/INDEX.md` | in sync |
| Offline monorepo gate | `bash scripts/validate.sh` — **30 checks passed** (includes checks 14–16) |

## Commands to re-run

From platform monorepo root:

```bash
# Seed compare (historical; legacy local clone removed — live tree is monorepo client-core/)
# diff -q client-core/AGENTS.md /home/operator/Lanyard-Dev/client-core/AGENTS.md

# Pack validation
python3 client-core/scripts/validate-packs.py
bash client-core/scripts/enable-pack.sh list

# Artifact dry-run + shape smoke
bash client-core/scripts/pack-release.sh --dry-run v0.0.0-local-test
bash client-core/scripts/smoke-pack-release.sh

# Full offline gate (includes client-core checks 14–16)
bash scripts/validate.sh
```

## Related docs

- [client-core/docs/RELEASE.md](../../../client-core/docs/RELEASE.md) — object contract + publish
- [client-core-path-ownership.md](../../architecture/client-core-path-ownership.md)
- [import-strategy.md](../../architecture/import-strategy.md)
- [workspace-map.md](../../architecture/workspace-map.md)
- [ADR 0004](../../adr/0004-monorepo-workspace-paths.md) · [ADR 0005](../../adr/0005-history-preserving-import-strategy.md)
