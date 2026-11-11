# lp-uxy.15.10 ship-QA — parse_document / AnyDoc

Live Web UI QA for shipped feature **lp-uxy.10**.

```bash
export BASE_URL=http://demo.localhost:3010
export UI_ARTIFACTS=../../../../artifacts/ui/lp-uxy-ship-qa/parse-doc
# Story pytest
cd portal/packages/web/ui-testing
pytest -v test_lp_uxy_15_10_parse_document.py
# Full story+live driver (from repo root worktree)
python3 /tmp/lp-uxy.15.10-parse-doc-qa.py   # or copy into scripts if desired
```

Login: `dev@demo.local` / `local-dev-password`
