# lp-uxy.15.12 brain-rpc-live ship-QA

Live UI proof that Brain RPC host ops work via Lanyard Agent:
projects list, settings snapshot, vault browser; ping green.

- Base: `http://demo.localhost:3010`
- Login: `dev@demo.local`
- Artifacts: this directory

Re-run:

```bash
export BASE_URL=http://demo.localhost:3010
export UI_ARTIFACTS=$(pwd)/artifacts/ui/lp-uxy-ship-qa/brain-rpc-live
cd portal/packages/web/ui-testing
pytest -v test_lp_uxy_15_12_brain_rpc_host_ops.py
```
