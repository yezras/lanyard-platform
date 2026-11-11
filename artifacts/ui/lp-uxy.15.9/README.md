# lp-uxy.15.9 — model intelligence ship QA

Live web-ui-testing against `http://demo.localhost:3010` for shipped
**lp-uxy.8** (composer Auto/Simple/Moderate/Complex) + **lp-uxy.12**
(LiteLLM auto_router pins).

## Run

```bash
export BASE_URL=http://demo.localhost:3010
export UI_ARTIFACTS=../../../../artifacts/ui/lp-uxy-ship-qa/model-selector
cd portal/packages/web/ui-testing
pytest -v test_lp_uxy_15_9_model_intelligence.py
```

## Verdict

See `PASS_FAIL.md` / `REPORT.json`. Portal UI selector is proven here;
LiteLLM routing requires host catalog pins (fix bead **lp-uxy.19** when residual).
