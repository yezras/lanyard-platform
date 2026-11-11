# lp-oop.31 — Live no-tool turn

**Result:** PASS  
**Stamp:** 20260817T155317Z  
**Bead:** `lp-oop.31`  
**Prove log:** `prove-20260817T155316Z.log`

## Hop

```
BFF  ─HTTP + SSE─►  Harness (LA createHarnessTurnServer)
```

Relay was **not** on the hop (`deliverInbound` / `interruptInbound` / `openChatEventStream` / `fetchChatHistory` = 0).

## Turn

| Field | Value |
|-------|--------|
| Delivery | `harness` |
| Probe | `lp-oop.31 no-tool ping` |
| Echo | `echo: lp-oop.31 no-tool ping` |
| Turn id | `turn_1` |
| Tool events | `[]` |

LA: [https://github.com/LanyardBrain/lanyard-agent/pull/242](https://github.com/LanyardBrain/lanyard-agent/pull/242) observed SHA `cc37ff4dd9119d32db32ce8110ea508b7e7a3cb0` (pin `cc37ff4dd9119d32db32ce8110ea508b7e7a3cb0`).

## Honesty

- real-harness was **not** used (`topology.fake_harness_http=false`).
- Live AWS MockLab `chat_delivery` is **not** flipped. Guest/Relay stays default until an operator follows the [harness runbook](../../../deploy/references/runbooks/mocklab-short-stack-harness.md) §4 and `lp-oop.29`.
- OPERATOR HOLD still forbids re-applying torn-down staging AWS.
- No secrets in this file or the evidence JSON.
- Browser Playwright is `lp-oop.33` (flipped MockLab) / `lp-oop.36` (local harness hop).

## Re-run

```bash
LANYARD_AGENT_ROOT=/path/to/lanyard-agent \
  bash deploy/scripts/prove-mocklab-short-stack-no-tool-turn.sh
```

---

# lp-oop.32 — Live tool + invariant script

**Result:** PASS  
**Stamp:** 20260817T162412Z  
**Bead:** `lp-oop.32`  
**Prove log:** `prove-invariants-20260817T162412Z.log`

## Honesty

| Claim | Truth |
|-------|--------|
| Overview invariants scripted (fail-closed) | Yes |
| Live MockLab snapshot flipped to tool-only | **No** — no human pin decision |
| `DAYTONA_DEFAULT_SNAPSHOT` written | **No** |
| MockLab `agent_snapshot_id` written | **No** |
| Live Daytona toolbox exec | **No** — FakeToolbox + lab pin |
| Live AWS apply / SM write | **No** |
| Secrets in evidence | **No** |

Live tool turn on the tool-only snapshot stays **HELD** until a human says to flip the live pin (`lp-oop.23` lab inventory is not live). This script refuses `FLIP_LIVE_SNAPSHOT=1`.

## Invariants

| Check | Result |
|-------|--------|
| Toolbox cannot see `/opt/company-brain-backend/current/lanyard-agent` | PASS (`smoke-no-lanyard-agent-tree.sh`; FakeToolbox `test ! -e`) |
| Daytona create env has no provider keys / `GATEWAY_RELAY_SECRET` | PASS |
| Two chats from the same user share one `sandbox_id` | PASS |
| Second user falls back to tenant primary (do not fake 0010) | PASS |
| Tenant A cannot exec on tenant B | PASS (bind forces `sandbox_id`) |
| Browser never holds harness or Daytona tokens | PASS |
| `GET /api/vault/tree` when `VaultPlane=cp_s3` does not call `ensure_online` | PASS |
| Live snapshot unchanged | PASS (`f4d947f3-bd03-4f6c-b8a2-b2034872feba`, sha `64798c27484063f39519b6541b0d7f6e90be8ba7ae7bff6991ae18e964465778`) |

Image inspect: `skipped`. Vitest: `pass`. Human pin gate: `held`.

## Re-run

```bash
bash deploy/scripts/prove-mocklab-short-stack-invariants.sh
bash deploy/scripts/smoke-mocklab-short-stack-invariants.sh
```

Optional local image (still not a live MockLab flip):

```bash
IMAGE_TAG=lanyard/agent-gateway:tool-only-local \
  bash deploy/scripts/prove-mocklab-short-stack-invariants.sh
```

---

# lp-oop.34 — Kitchen-sink re-QA gate

**Result:** GO_WITH_WAIVERS
**Stamp:** 20260817T175439Z
**Bead:** `lp-oop.34`

Full matrix: [kitchen-sink/RESULT.md](./kitchen-sink/RESULT.md).
Guest path still default Relay. Live AWS not flipped. Waivers named.

## Re-run

```bash
bash deploy/scripts/prove-mocklab-short-stack-kitchen-sink.sh
```
