# Local development (monorepo + localhost mocklab)

**Bead:** `lp-k7g.12.7` · **Audience:** agents and humans doing day-to-day platform work

## Canonical workspace

| Role | Path |
| --- | --- |
| Platform monorepo (SoT) | `lanyard-platform/` (`portal/`, `client-core/`, `deploy/`, contracts, docs, beads) |
| External backend products | `hermes-lanyard/`, `lanyard-agent/` (do **not** delete; stay outside monorepo) |

Day-to-day work is **this monorepo** plus **localhost mocklab**. Do not open or `cd` into legacy sibling clones:

- ~~`/home/operator/Lanyard-Dev/portal`~~
- ~~`/home/operator/Lanyard-Dev/client-core`~~
- ~~`/home/operator/Lanyard-Dev/company-brain-deploy`~~

Those trees were local checkouts of GitHub repos that are now **ARCHIVED**. Live trees are monorepo subpaths only:

| Archived GitHub repo | Live monorepo path |
| --- | --- |
| `LanyardBrain/Portal` | `portal/` |
| `LanyardBrain/client-core` | `client-core/` |
| `LanyardBrain/company-brain-deploy` | `deploy/` |

## Localhost mocklab first

- Prefer local Portal + Hermes/agent + vault seed on **localhost** for QA and proofs.
- See `portal/testing.md` for the Portal tmux dev stack (`pnpm -C portal dev:tmux` from monorepo root).
- AWS staging applies are **deferred** unless an operator explicitly re-enables them for a named bead. Do not treat staging URL reachability as a day-to-day gate.

## Local secret hygiene (lp-p37.13)

Local env/session files under `portal/.data/`, `artifacts/ui/.auth/`, and `.env.mocklab*` must be **owner-only** (`chmod 600` files / `700` dirs). Seed and BFF set this by default; fix or audit anytime:

```bash
bash portal/scripts/secure-local-secrets.sh          # fix modes
bash portal/scripts/secure-local-secrets.sh --check  # fail if too open
bash portal/scripts/secure-local-secrets.sh --scan   # inventory
```

Never commit those paths. Full cleanup, chat retention/encryption expectations, and secret-scan notes: [local-secret-hygiene.md](./local-secret-hygiene.md).

## Local Muse Spark (LiteLLM provider, lp-k5c4.17)

Local harness model replies use `createEnvLiteLlmTurnRunner` / `LiteLlmClient`,
not a Meta `complete()` wrapper and not a Portal BFF fetch.

```bash
# ~/.lanyard-agent/meta.env  (chmod 600; never commit)
# LITELLM_BASE_URL=https://api.meta.ai    # no trailing /v1
# LITELLM_API_KEY=…                      # Meta Model API key
# HARNESS_MODEL=muse-spark-1.2-contributor

export LANYARD_AGENT_ROOT=/path/to/lanyard-agent
set -a && source ~/.lanyard-agent/meta.env && set +a
node deploy/dev/localhost-muse-spark/serve-la.mjs
# HARNESS_URL=http://127.0.0.1:4310
```

`LiteLlmClient` already POSTs `{baseUrl}/v1/chat/completions`. Do **not** set
`LITELLM_BASE_URL=https://api.meta.ai/v1` (that 404s `/v1/v1/chat/completions`).
Offline: `bash deploy/scripts/smoke-localhost-muse-spark-provider.sh`.
Details: [localhost-muse-spark/README.md](../../deploy/dev/localhost-muse-spark/README.md).

## Commands (from monorepo root)

```bash
# Portal workspace
pnpm -C portal install
pnpm -C portal build
pnpm -C portal test
pnpm -C portal dev:tmux

# Offline monorepo validation
bash scripts/validate.sh

# Deploy scripts (live under deploy/, not company-brain-deploy)
cd deploy && bash scripts/validate-staging-roots.sh
```

## Related

- [Root README — repository boundary](../../README.md#repository-boundary)
- [ADR 0001 — platform monorepo boundary](../adr/0001-platform-monorepo-boundary.md)
- [ADR 0004 — monorepo workspace paths](../adr/0004-monorepo-workspace-paths.md)
- [Staging Hermes-Lanyard backend pins](staging-hermes-lanyard-backend-pins.md) (operator staging path when AWS is re-enabled)
