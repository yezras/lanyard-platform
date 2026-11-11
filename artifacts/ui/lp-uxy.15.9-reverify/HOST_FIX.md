# lp-uxy.21.6 — host residual re-QA

## Residual

Ship-QA **lp-uxy.15.9** failed LiteLLM catalog: `settings.snapshot.models` only
advertised `grok-4.5` → Portal `client_fallback` (all tiers → grok-4.5).

## Host fix (lp-uxy.21.4)

- Repo: LanyardBrain/lanyard-agent
- Branch: `beads/lp-uxy.21.4-fix-la-settings-snapshot-models-advertis`
- Commit: `603b68c773784d878aa75f6031818c865eb88d64`
- PR: https://github.com/LanyardBrain/lanyard-agent/pull/227
- Change: `collectModels` merges live LiteLLM `/v1/models` as `provider: litellm`
  so pins `lanyard-auto|simple|moderate|complex` appear in the host catalog.

## Live ops this session

1. Built gateway from `/tmp/la-bead-lp-uxy.21.4` @ 603b68c
2. Replaced pilot gateway process (was 21.2 cron residual build)
3. `collectModels` LIVE_SMOKE_OK — pins present
4. Re-ran `test_lp_uxy_15_9_model_intelligence.py` against
   `http://demo.localhost:3010` with `BRAIN_RPC_ENABLED=1`

## Re-QA result

- **Verdict: PASS**
- `litellm_routing_ok=true`
- `routing_source=litellm`
- Tier → data-model: auto→lanyard-auto, simple→lanyard-simple,
  moderate→lanyard-moderate, complex→lanyard-complex
- Artifacts: this directory (01–09 png, REPORT.json, PASS_FAIL.md, RESULT.md)

## Supersedes

lp-uxy.15.13 (closed path via this fix bead)
