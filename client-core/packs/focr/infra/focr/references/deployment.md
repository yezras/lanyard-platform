# focr deployment checklist and update policy

Use this on **OCR workers** and in customer runbooks. Hermes/gateway hosts do not need `focr` unless they also run ingest OCR locally.

## One-time setup (OCR worker)

| Step | Command / requirement |
|------|------------------------|
| 1. Host sizing | ≥ **8 GB RAM**, **4+ vCPUs**, **~5 GB free disk** (binary + model cache) |
| 2. OS packages | **`curl`** (install), **`poppler-utils`** (`pdftotext` for digital PDFs in `focr.sh`) |
| 3. Core clone | Customer vault/Core checkout at a known path; doctrine in `infra/focr/`, wrapper `infra/focr/focr.sh` |
| 4. Install binary | `chmod +x infra/focr/*.sh && infra/focr/install-focr.sh` |
| 5. PATH | Ensure `~/.local/bin` (or `PREFIX/bin`) is on PATH; or use installer's `--easy-mode` via `VERSION=… bash -s -- --easy-mode` when piping upstream `install.sh` |
| 6. Pull models | `focr pull` (~3.9 GB → `~/.cache/franken_ocr/models`) |
| 7. Health checks | `focr robot selftest` (CPU kernel), `focr doctor` (cache/manifest repair hints) |
| 8. Smoke test | `infra/focr/focr.sh /path/to/sample-scan.pdf` → `.parse.md` |
| 9. Ingest wire-up | Cron/bead workers call `focr.sh` before chunk/MemPalace; keep escalation API keys only on workers that need them |

Optional tuning: `FOCR_THREADS`, `FOCR_MIN_TEXT_CHARS` (wrapper), `HTTPS_PROXY` / `HTTP_PROXY` for installs and pulls.

### Not required on the worker

- Python, CUDA, GPU
- Committing model weights or client `.parse.md` into Core git

## Staying current: two different “masters”

### A. Lanyard **Core** repo (`main`)

Core is the starter brain; default branch is **`main`** (not `master`).

**Developers / EC2 brain hosts that track Lanyard:**

```bash
cd /path/to/Core
git fetch origin
git pull --rebase origin main
```

**Policy (from root `AGENTS.md`):** after agent edits, commit and **push** so `origin/main` stays the shared source of truth. Before substantive work: `git pull --rebase` to avoid drift.

`scripts/setup-local.sh` only verifies folders; it does **not** auto-pull Core. Use git (or your IDE sync) on a schedule you control.

### B. **franken_ocr** upstream (binary + models)

The Core wrapper does **not** vendor the `focr` binary. `install-focr.sh` runs upstream `install.sh`, which defaults to the **latest GitHub release** (fallback `v0.4.0`).

**Recommended for production OCR workers — pin a version:**

```bash
export VERSION=v0.4.0   # or FOCR_VERSION if using Core install wrapper
curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/franken_ocr/main/install.sh | bash -s -- --force --verify
focr pull
```

**When to upgrade franken_ocr**

1. Lanyard bumps the pinned version in `infra/focr/install-focr.sh` / this doc (review upstream release notes).
2. On each OCR worker: re-run install with `--force`, then `focr pull`, then `focr robot selftest` and one vault smoke PDF.
3. Record the deployed version in deployment notes (not in Core): `focr --version`.

**Staying “current” without surprise upgrades**

| Approach | Behavior |
|----------|----------|
| **Pinned (default for customer brains)** | Set `FOCR_VERSION` in `install-focr.sh`; upgrade only when Core/docs change the pin |
| **Floating latest** | Re-run `install-focr.sh` periodically; upstream resolves latest release |

Models follow the binary manifest; after a binary upgrade, always run `focr pull` again.

### C. Customer **vault** (`<VaultRoot>`)

Vault data is **not** in Core git. Staying current means backup/S3/obsidian sync per `multi-user-ec2.md`, not `git pull` on client documents.

## Quick verification script (operator)

```bash
command -v focr && focr --version
command -v pdftotext && pdftotext -v 2>&1 | head -1
test -d "$HOME/.cache/franken_ocr/models" && echo "model cache: present" || echo "model cache: missing — run focr pull"
focr doctor 2>/dev/null || true
```

## Troubleshooting

| Symptom | Likely fix |
|---------|------------|
| Exit 137 / OOM | Move OCR to ≥ 8 GB RAM worker; do not run `focr` on 4 GB Hermes-only box |
| `focr: not found` | Add `~/.local/bin` to PATH or reinstall with `--easy-mode` |
| Digital PDF works, scan fails | Expected on tiny RAM; check worker size |
| `pdftotext` missing | `apt install poppler-utils` (Debian/Ubuntu) or equivalent |
| Stale parse pipeline | `git pull` Core for `focr.sh` changes; separately upgrade `focr` binary |