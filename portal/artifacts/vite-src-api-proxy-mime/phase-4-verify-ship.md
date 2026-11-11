# Phase 4: Prove with web-ui-testing and ship

Back: [overview.md](./overview.md)

## Goal

Prove the original browser failure is gone on a **real headless browser** via the **web-ui-testing** skill (`/web-ui-testing`), then open a PR.

## Changes

- No new feature code beyond what phases 2–3 already shipped.
- Load and follow `~/.grok/skills/web-ui-testing/SKILL.md`.
- Do **not** treat curl-only or unit tests as sufficient proof for this phase.

## web-ui-testing proof (required)

Skill modes to use:

1. **`doctor`** if the host Playwright env is unknown  
   `bash "$HOME/.grok/skills/web-ui-testing/scripts/doctor.sh"`
2. **Confirm app up** on project port **3010** (not the skill default 3000):  
   `BASE_URL=http://127.0.0.1:3010` or `http://localhost:3010`
3. **`shot` / small Playwright flow** against the live Vite app:
   - Navigate to the portal root
   - Assert the UI loads past the broken-module state (login/AuthView or shell paints)
   - Assert no failed loads for `/src/api/client.ts`, `/src/api/tenantBase.ts`, `/src/api/auth.ts` (network or console: no “disallowed MIME type” / module load failure for those URLs)
   - Write screenshots to `artifacts/ui/vite-src-api-proxy-mime/` (e.g. `load.png`)
4. **`run`** a durable pytest smoke if a project `ui-testing/` harness exists or is cheap to init for this one assertion; otherwise a one-off `run_flow.py` / short script using the skill’s patterns is enough for this bug
5. Optional **`vision`** on the PNG only if the page looks wrong after load

Ignore MetaMask `ObjectMultiplex` console noise.

**Secondary (not a substitute):** curl green for `/src/api/*.ts` as in [testing.md](./testing.md).

## Data structures

None.

## Verification

**Static**

```bash
pnpm --filter @lanyard/web test
pnpm --filter @lanyard/web build   # if usual gate
```

**Runtime (required — web-ui-testing)**

| Check | Pass |
|-------|------|
| doctor (if needed) | exit 0 |
| Headless goto BASE_URL :3010 | page renders Auth/shell |
| Module MIME failure | absent for `/src/api/*.ts` |
| Screenshot | non-empty PNG under `artifacts/ui/vite-src-api-proxy-mime/` |
| Close reason | cites skill steps + artifact paths + red→green curl optional |

Ship: open PR via opening-a-pr; mention epic `portal-mnn` and plan path.

## Bead

`portal-mnn.7`
