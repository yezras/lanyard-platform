# Docker mocklab topology — agent-backend parity joint GO

**Bead:** `lp-rt5.8` (platform) + sister `lac-yt3.6` (lanyard-agent)  
**Plan:** [phase-6-mocklab-joint-go.md](../plans/0005-portal-agent-backend-parity/phase-6-mocklab-joint-go.md)  
**Prove:** `bash deploy/scripts/prove-mocklab-agent-parity.sh`  
**Evidence:** `artifacts/mocklab/lp-rt5/joint-go-evidence-*.json`

## Purpose

Falsifiable joint proof that Portal settings / projects / composer / Office
preview work against a **real Lanyard Agent** host (`backend.kind=lanyard_agent`)
on a Docker-shaped mocklab topology — **not** AWS staging, **not** a
Portal-only fixture backend.

## Stack components

| Component | Role | Local default |
| --- | --- | --- |
| **Postgres** | Control-plane DB | `portal` compose `postgres` `:5432` |
| **Control plane (CP)** | Tenants, users, gateway instance registry | `:3100` (loopback host bind) |
| **Relay** | WS dial-in for host + Brain RPC deliver-inbound | `:8787` |
| **BFF** | Public API edge; Brain RPC client; preferred `/api/agent/*` | `:4000` (`BRAIN_RPC_ENABLED=1`) |
| **Web** | Portal UI (settings, Directory, composer, Office pane) | `:3010` |
| **Lanyard Agent (LA)** | Brain host: Brain RPC + projects.db + settings + sandbox | health `:9100`; dials relay `/relay` |
| **Vault seed** | Office samples + project trees for Directory | host path or volume (`VAULT_ROOT`) |
| **Lab Document Server (optional)** | OnlyOffice **Edit** only — not required for open/preview GO | `:8080` (`deploy/dev/lab-shared-compose-ds`) |

Compose sketch (portal services + optional DS):
[`deploy/dev/mocklab-agent-parity/`](../../deploy/dev/mocklab-agent-parity/).

**Hybrid deployment is normal:** operators may run CP/relay/BFF/web/LA as
host processes while postgres (and optional lab Document Server) run in
Docker. Joint evidence must report only components **actually probed**
(`topology.components` + `topology.live_probe` / `components_probed`) — never
claim a service that was not healthy at prove time.

LA is **not** vendored into this monorepo (ADR 0002). Pin a published LA image
or run the host process from the `lanyard-agent` checkout with matching
`GATEWAY_RELAY_*` secrets and `BACKEND_HOME`.

## Credential / instance alignment (pilot lessons)

Three-sided triple must match or Brain RPC and chat 502:

1. **CP primary gateway `instance_id`** (BFF routes deliver-inbound here)
2. **Relay `RELAY_DEV_SECRETS`** entry for that instance (gatewayId + secret)
3. **LA env** `GATEWAY_RELAY_INSTANCE_ID` / `GATEWAY_RELAY_SECRET` / `GATEWAY_RELAY_ID`

Also set `BRAIN_RPC_ENABLED=1` on BFF and leave LA Brain RPC enabled (default on).

Demo local tenant (seeded by `portal/scripts/seed-demo-tenant.sh`):

- Host: `demo.localhost:3010` or `DEV_TENANT_SLUG=demo`
- Dev user: `dev@demo.local` / `local-dev-password` (lab only — never production)
- Member role `hermes_profile` must be **`admin`** or **`contributor`** (LA Brain RPC
  rejects unknown profiles such as `default` with HTTP 403)

## Required joint checks

See [testing.md](../plans/0005-portal-agent-backend-parity/testing.md). Summary:

1. `backend.kind == lanyard_agent` (**live** LA health + brain.ping)
2. `settings.sections_match_capabilities` (**live** non-fixture snapshot with section keys)
3. `projects.list_nonempty` (**live**, seed ≥1)
4. `chat.working_directory_stamped` (**live** thread create stamps `project_vault_path`; unit residual alone is not enough)
5. `composer.skills_from_host` (**live** host skills inventory)
6. `composer.no_default_agent_stubs` (**unit** vitest exit 0)
7. `office.preview_inline_docx` (+ xlsx/pptx) (**unit** `vaultPreviewKind` vitest — not source grep)
8. `office.no_unsupported_placeholder` (**unit** same suite)
9. `host.sandbox_enforced` (**unit** agent-core `tools-sandbox` vitest exit 0 — not `ProjectPathEscapeError` source residual). **Honesty residual (lp-uxy.6):** file tools deny project/vault escape; LA **bash** still allows absolute/`..` host reads when shell is available. Full blocked-vs-escapable table + Omnibox Mode A status: [docs/security/lp-uxy.6-agent-sandbox-path-acl-omnibox.md](../security/lp-uxy.6-agent-sandbox-path-acl-omnibox.md); prove: `bash deploy/scripts/prove-sandbox-path-acl.sh`
10. `hermes_lanyard.regression` (**unit** hermes-projects + settings-snapshot fixture path)

### Fail-closed residual policy

`prove-mocklab-agent-parity.sh` records `check_provenance` per required check
(`live` | `unit` | `missing`). **Source greps alone never set a required
check true.** `REQUIRE_LIVE=0` forces `joint_go=NO-GO`.

## Evidence schema (minimum)

```json
{
  "bead_id": "lp-rt5.8",
  "sister_bead_id": "lac-yt3.6",
  "timestamp_utc": "…",
  "topology": {
    "name": "docker_mocklab_agent_parity",
    "components": ["postgres", "control-plane", "relay", "bff", "web", "lanyard_agent"]
  },
  "backend": {
    "kind": "lanyard_agent",
    "health_service": "lanyard-agent-gateway",
    "version": "…"
  },
  "joint_go": "GO",
  "checks": { "…": true },
  "non_claims": [
    "Not AWS staging",
    "Not production customer OnlyOffice",
    "Not third harness (Codex/OpenCode/Pi)",
    "Not CP vault project store unification"
  ]
}
```

## Non-claims

- Not AWS staging Document Server / spend
- Not production customer open-with-Edit as default
- Not Hermes-only path as joint GO host
- Not independent ship of either epic without this evidence (grill Q7)

## Operator run

```bash
# From monorepo root (stack already up or script will probe):
bash deploy/scripts/prove-mocklab-agent-parity.sh

# Force live-only (default): REQUIRE_LIVE=1
# Offline residual only (cannot GO): REQUIRE_LIVE=0
```

Sister agent track documents image pin / readiness the script waits on
(`lanyard-agent` `docs/plans/08-portal-backend-runtime-parity/phase-6-mocklab-joint-go.md`).
