# MockLab vault seed (deploy-only)

Durable content for the MockLab Daytona S3 vault prefix after Mountpoint is R/W.

- **Not** the production client-core release tarball (that remains a separate pin).
- Apply with `deploy/scripts/seed-mocklab-s3-vault.sh` (local dir or `s3://…/vault/`).
- Marker: files may include `<!-- mocklab-vault-seed:lp-zuh.9.5 -->`.
- Gate: vault-root `AGENTS.md` — existing files are preserved; **missing** kitchen-sink files (`config.yaml`, skills, workflows, `mcp/vault_fs_server.py`) are filled in. `--force` overwrites managed files.
- Harness `BACKEND_HOME` is this same document (`config.yaml` + `skills/` + `workflows/`). Do not restore a fat guest snapshot.
- `mcp/vault_fs_server.py` is fill-missing-put even when the gate skips (`lp-oop.38.19`).

Bead: `lp-zuh.9.5` / `lp-oop.38.18`. Related: empty-vault residual from `lp-zuh.7.6`; mount proof `lp-zuh.9.4`.
