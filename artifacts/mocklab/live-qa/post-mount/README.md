# Post-mount durable surfaces re-QA (`lp-zuh.9.6`)

Focused re-QA after MockLab vault mount (`lp-zuh.9.4`) + seed (`lp-zuh.9.5`):

1. Vault write under `/mnt/vault`
2. Workflow state dir under vault (no EACCES)
3. Cron state dir under vault
4. Kitchen-sink config vault-only durable paths

- **RESULT:** [RESULT.md](./RESULT.md) (verdict PASS)
- **Machine report:** [REPORT.json](./REPORT.json)
- **Logs:** [logs/](./logs/)
- **Re-run:** [scripts/run_post_mount_re_qa.sh](./scripts/run_post_mount_re_qa.sh)

Requires operator `DAYTONA_*` + optional `AWS_PROFILE`. Never commit secrets.
