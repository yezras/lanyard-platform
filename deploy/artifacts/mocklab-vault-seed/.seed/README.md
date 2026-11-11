# Seed provenance (MockLab)

- Gate file: vault-root `AGENTS.md`
- Apply: `deploy/scripts/seed-mocklab-s3-vault.sh`
- Bead: `lp-zuh.9.5` (filesystem) + `lp-zuh.10.7` (host projects.db registry)
- `default-projects.json` → agent `projects.list` via
  `deploy/daytona/agent-gateway/seed-default-projects.py` /
  `deploy/scripts/seed-mocklab-agent-projects.sh`
