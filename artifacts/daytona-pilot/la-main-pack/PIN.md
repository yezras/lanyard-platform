# Lanyard Agent main pack pin

**Bead:** lp-zuh.11.1 (seed+mount+ENOSYS bake; prior lp-zuh.10.10 workflow ENOSYS)  
**Product:** Lanyard Agent only (not Hermes)

| Field | Value |
|-------|--------|
| Version | `0.0.0-main.9bcada6780d2` |
| Git commit | `9bcada6780d2c32471aaf2e9bfa6dc17a1966b1b` |
| SHA-256 | `6acbc8aa8825165d0f86ddbf3b7ac0511d36b5184e2eef63c2df380539a7e8b8` |
| Filename | `lanyard-agent-0.0.0-main.9bcada6780d2.tar.gz` |
| LA PR | https://github.com/LanyardBrain/lanyard-agent/pull/241 |
| Prior | lp-zuh.10.10 / workflow ENOSYS; platform seed lp-zuh.10.7 |

Pack via `scripts/release-artifact.sh` from `lanyard-agent` `origin/main`. Tarball is **not** committed (gitignored under `agent-release/`).
Operator: copy tarball into `deploy/daytona/agent-gateway/agent-release/` (gitignored) before image build.
See `deploy/daytona/agent-gateway/repack-notes.md`.
