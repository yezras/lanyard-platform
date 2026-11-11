# Runbook: relay jti dual-accept (stock Hermes pin WSS)

**Bead:** `lp-t7q.9` (migrated `cbd-wx4.6`) · **Parent:** `lp-t7q`

Durable fix for staging residual: stock Hermes-Lanyard pins (`v0.1.0-g7h3+`) mint
**G2a jti** upgrade tokens; an older portal-relay image accepted **legacy only**
and returned **HTTP 401** on jti. Host venv `legacy=True` patches under
`/opt/hermes-lanyard/.venv/...` are **ephemeral** (wiped on re-bootstrap).

| Concern | Durable product path |
|---------|----------------------|
| Stock pin WSS | Relay verifies **v1j** (`gatewayId:exp:jti:sig`) under production |
| Migration dual-accept | Optional legacy (`gatewayId:exp:sig`) via env — not a host patch |
| Replay resistance | jti still single-use even when legacy is also allowed |

No secrets, account IDs, or live tokens in this document.

---

## Token claim shapes

| Format | Wire (UTF-8 then base64url) | Who mints |
|--------|-----------------------------|-----------|
| **v1j (jti)** | `gatewayId:exp:jti:sig` | Stock g7h3+ (`make_upgrade_token` default) |
| **v1 legacy** | `gatewayId:exp:sig` | Pre-jti pins / temporary host `legacy=True` patch |

`sig = HMAC_SHA256(signed_material, GATEWAY_RELAY_SECRET).hex`.

Code: `portal/packages/relay/src/auth.ts`, `relay-auth-policy.ts`,
`relay-session-server.ts`, `jti-store.ts`. ADR:
[portal/docs/adr/g2a-relay-replay-resistance.md](../../portal/docs/adr/g2a-relay-replay-resistance.md).

---

## Env knobs (relay task)

| Env | Production default | Dual-accept / lab |
|-----|--------------------|-------------------|
| `NODE_ENV` / `RELAY_AUTH_MODE` | `production` | `development` for lab |
| `RELAY_ALLOW_LEGACY_UPGRADE_TOKEN` | off (jti required) | `1` to also accept legacy |
| `RELAY_REQUIRE_UPGRADE_JTI` | (derived: on in prod) | `1` forces jti even if legacy allow is set |
| `RELAY_MAX_UPGRADE_TTL_SECONDS` | `300` | same |

**Recommended staging after redeploying jti-capable relay:** leave production
defaults (jti required). Stock pins connect without host patch.

**Optional migration window** (mixed fleet still minting legacy): set
`RELAY_ALLOW_LEGACY_UPGRADE_TOKEN=1` on the relay task, redeploy, then remove
host patches and clear the env once all hosts mint jti.

Startup logs (metadata only): `auth_mode`, `require_jti`, `reject_non_expiring`,
`max_ttl_seconds` — no token/secret material.

---

## Acceptance probes

### A. Unit / CI (always available)

```bash
cd portal
pnpm --filter @lanyard/relay test
```

Covered cases include:

- production: jti connects, legacy 401, exp=0 401
- dual-accept (`RELAY_ALLOW_LEGACY_UPGRADE_TOKEN=1`): **both** jti and legacy connect
- jti replay still 401 under dual-accept

### B. Staging live probe (operator; residual if no live access)

From a host or laptop that can reach the relay WSS URL, with the **same**
shared secret and gateway id as the instance (from SSM/host env — do not paste
secrets into tickets):

```bash
# Requires: python3, websockets (or equivalent). Run on mocklab host preferred.
# Inputs from env only — never commit values.
python3 - <<'PY'
import asyncio, base64, hashlib, hmac, os, time
try:
    import websockets
except ImportError:
    raise SystemExit("pip install websockets")

secret = os.environ["GATEWAY_RELAY_SECRET"]
gw = os.environ["GATEWAY_RELAY_ID"]
url = os.environ.get("GATEWAY_RELAY_URL", "wss://relay.example.invalid").rstrip("/")
if not url.endswith("/relay"):
    url = url + "/relay"

def mint(*, legacy: bool) -> str:
    exp = int(time.time()) + 60
    if legacy:
        signed = f"{gw}:{exp}"
    else:
        jti = base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip("=")
        signed = f"{gw}:{exp}:{jti}"
    sig = hmac.new(secret.encode(), signed.encode(), hashlib.sha256).hexdigest()
    raw = f"{signed}:{sig}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")

async def probe(label: str, token: str) -> str:
    try:
        async with websockets.connect(
            url,
            additional_headers={"Authorization": f"Bearer {token}"},
            open_timeout=10,
        ) as ws:
            await ws.close()
            return f"{label} CONNECTED"
    except Exception as e:
        return f"{label} FAIL {type(e).__name__}: {e}"

async def main():
    print(await probe("jti_default", mint(legacy=False)))
    print(await probe("legacy", mint(legacy=True)))
    print(await probe("noauth", ""))  # expect 401

asyncio.run(main())
PY
```

**Pass criteria (stock pin path):**

| Probe | Expected after jti-capable relay |
|-------|----------------------------------|
| `jti_default` | **CONNECTED** |
| `legacy` | **FAIL** (prod default) or **CONNECTED** if `RELAY_ALLOW_LEGACY_UPGRADE_TOKEN=1` |
| `noauth` | **FAIL** 401 |

On the gateway host, after stock pin restart (no venv patch): unit active,
`ss` shows ESTAB to relay ALB, journal without `server rejected WebSocket connection: HTTP 401`.

**CI / implementer without staging credentials:** criterion **code-ready**; attach
live probe output as operator residual evidence when credentials exist.

---

## Deploy steps (durable)

1. Build/push portal-relay image from monorepo that includes G2a dual-accept
   (`portal/packages/relay`).
2. Deploy relay task/service with `NODE_ENV=production` (image default).
3. Confirm task logs show `require_jti=true` (or dual-accept env if intentional).
4. On mocklab/customer host: **remove** temporary `legacy=True` patches
   (`*.bak-pre-phase4` restore or re-bootstrap clean pin).
5. Restart gateway unit; run [§ Staging live probe](#b-staging-live-probe-operator-residual-if-no-live-access).
6. Optional: clear `RELAY_ALLOW_LEGACY_UPGRADE_TOKEN` if it was set for migration.

---

## Rollback

| Goal | Action |
|------|--------|
| Accept legacy hosts again (without host patch) | Set relay env `RELAY_ALLOW_LEGACY_UPGRADE_TOKEN=1`, redeploy relay task, re-probe |
| Force jti-only again | Unset `RELAY_ALLOW_LEGACY_UPGRADE_TOKEN` (or `=0`), set `RELAY_REQUIRE_UPGRADE_JTI=1` if needed, redeploy |
| Previous relay image | Redeploy prior ECR digest; expect stock jti 401 if image pre-G2a — re-apply **temporary** host `legacy=True` only as last resort |
| Hermes mint legacy via product flag | Only if product ships `GATEWAY_RELAY_LEGACY_UPGRADE_TOKEN` (or equivalent) in the pin; prefer relay dual-accept over host edits |

Capture prior image digest and env before change (same discipline as
[backend-upgrade-rollback.md](backend-upgrade-rollback.md)).

---

## Related

- Relay package README: [portal/packages/relay/README.md](../../portal/packages/relay/README.md)
- Phase-4 root-cause notes: [deploy/references/plans/lanyard-hermes-gateway-and-mocklab-vault/phase-4-prove-gateway.md](../../deploy/references/plans/lanyard-hermes-gateway-and-mocklab-vault/phase-4-prove-gateway.md)
- Credential lifecycle: [portal/docs/runbooks/relay-credential-lifecycle.md](../../portal/docs/runbooks/relay-credential-lifecycle.md)
