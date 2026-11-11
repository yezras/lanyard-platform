# lp-k5c4.10 — MockLab inbound-spine evidence pack

Landing zone for Phase 9 live proof. **No secrets.** Never commit `.env.mocklab-agent-dev`.

HOLD is lifted **for this bead only**: Taste send, toolbox turn, cron fire (ops fire if the evaluator is still off). Do **not** `terraform apply` or restage torn-down staging.

## Re-run

```bash
# Offline gate (no AWS apply). Fails closed on evidence shape + HOLD fields.
bash deploy/scripts/smoke-mocklab-inbound-spine.sh

# Live proof against the existing MockLab stack (uses gitignored env).
bash deploy/scripts/prove-mocklab-inbound-spine.sh
```

Live credentials: `MOCKLAB_AGENT_EMAIL` / `MOCKLAB_AGENT_PASSWORD` from process env or `.env.mocklab-agent-dev`.

## Files

| File | Purpose |
|------|---------|
| `RESULT.md` | Human verdict + HOLD honesty |
| `live-proof-evidence-latest.json` | Latest machine evidence (typed pack) |
| `live-proof-evidence-<stamp>.json` | Timestamped copy |
| `run_live_probe.py` | HTTP Taste / toolbox / cron / CloudWatch lever |
