# Debugging Cron Job Failures

## Common Silent Failure Patterns

### 1. Terminal Timeout (60s default)
**Log signature**: `Tool terminal returned error (60.28s)`
**Cause**: Long gws/wacli command exceeded foreground timeout
**Fix**: Pin cron model to Grok via xai-oauth, increase terminal `timeout` in prompt where needed (e.g. 300–600)

### 2. Blocked execute_code in Cron
**Log signature**: `BLOCKED: execute_code runs arbitrary local Python... Cron jobs run without a user present to approve`
**Cause**: Cron context blocks execute_code for security
**Fix**: Don't use execute_code in cron jobs. Use terminal tool directly instead.

### 3. Wrong or missing model pin
**Symptom**: Job runs on a weak/local model and skips tool-heavy steps
**Fix**: Set `model.provider=xai-oauth` and `model.model=grok-composer-2.5-fast` on the job (matches `~/.hermes/config.yaml` default)

## Debugging Commands

```bash
# Check job status and configuration
hermes cron list

# View detailed logs for a specific job
grep "cron_JOBID" ~/.hermes/logs/agent.log

# Check for timeout errors
grep "Tool terminal returned error.*60\." ~/.hermes/logs/agent.log

# Check for execution errors  
grep "BLOCKED\|cannot be used" ~/.hermes/logs/agent.log
```

## Verification Checklist

After fixing a job:
- [ ] Skills include the main CRM skill + `client-crm-organization` + relevant `gws-*` / `wacli` (no `codex` unless pure coding)
- [ ] Model pinned to `grok-composer-2.5-fast` with provider `xai-oauth`
- [ ] Prompt is self-contained (cron has no chat context)
- [ ] Delivery target set (e.g. `<SlackTarget>`)