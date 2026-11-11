# lp-uxy.15.6 soft-archive ship-QA

Live UI proof that project Delete is soft-archive only
(shipped lp-uxy.5).

- Base: `http://demo.localhost:3010`
- Login: `dev@demo.local`
- Artifacts: this directory

Re-run:

```bash
export BASE_URL=http://demo.localhost:3010
export UI_ARTIFACTS=$(pwd)/artifacts/ui/lp-uxy-ship-qa/soft-archive
cd portal/packages/web/ui-testing
pytest -v test_lp_uxy_15_6_soft_archive.py
```
