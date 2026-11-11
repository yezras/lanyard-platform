# Live MockLab mailbox gate — nine destination checks (`lp-v62i.4.1`)

**Bead:** `lp-v62i.4.1` (parent epic `lp-v62i.4`; do not close the epic from this leaf)  
**UAT:** `https://app.withlanyard.com/mocklab`  
**Source of truth:** `/home/operator/Lanyard-Dev/wayfinder/agent-mailbox-v1.md`  
**Doctrine pointer:** [README.md](./README.md)  
**Neighbor plan (not this):** `docs/plans/0017-sandbox-first-chat-speed/` (`lp-vqr0`)

This file is the **operator runbook + Jack checklist**. It is not a Playwright catalog. Do not call talk done on a fake local gateway.

**Honesty (2026-08-26):** protocol/UI is on `main`. Live MockLab is **not** on mailbox images. AC2 of `lp-v62i.4.1` is **not** met. Jack cannot prove the nine checks until the remaining operator steps below land.

## Product locks that still apply

- UAT gate is the live MockLab tenant, not localhost.
- Live talk needs a **real** gateway + relay. `lp-jnrj` was the image-roll bug (now **closed**). Do not treat a laptop fake-gateway as talk.
- Mailbox is transport, not a screen. No QA-only Playwright suite is the gate.
- Pattern for entitle/redeploy: `lp-8sh4.7` (entitle google/hubspot/whatsapp/github) and `lp-jzfc` (operator apply, not a mailbox fake).
- Do not reopen `lac-xsb`, `lac-bx3`, `lac-37a`, `lp-cxhb`. Do not parent under `lp-8sh4`. Do not patch `lp-8sh4.6` and call it talk. Do not restore Hermes as product runtime.

## Jack’s nine destination checks

Unchecked on purpose. Jack clicks these on live MockLab after the image roll. Details stay in the wayfinder map — do not invent a tenth check.

- [ ] 1. Speak in a channel; lead replies.
- [ ] 2. Lead (or Jack) `@` another agent; that agent replies in the chosen room.
- [ ] 3. From a 1:1, bare `@Fizz` continues in Fizz’s 1:1 with Jack. Fizz’s 1:1 shows only her reply. Bill’s 1:1 gets a text-only “A message has been sent to Fizz.”
- [ ] 4. From a 1:1, `@Fizz` plus a room continues in that channel. Bill’s 1:1 gets nothing. The channel shows Bill’s bubble.
- [ ] 5. Walk away; they continue in that room until Halt or the hidden fuse.
- [ ] 6. An agent can message another with no user message that day, if they share a channel.
- [ ] 7. A scheduled job can write Jack’s 1:1 with that sender.
- [ ] 8. An agent in a 1:1 or channel can create a schedule or workflow (no create chrome). Jack can still open, edit, pause, delete it.
- [ ] 9. `@` in composer offers agents, then provisioned connectors. File `@` is gone. Plus attaches a file or vault item.

## Surfaces that must be real (digest pins, never tag-only)

| Surface | What to pin | Notes |
| --- | --- | --- |
| Portal static web | `portal.web.{version,sha256,url}` | SPA tarball, not a web container. Must include mailbox UI (`lp-v62i.2.*` + Halt wire `lp-v62i.3.7`). |
| BFF | `portal.images.bff.repository` + `digest` (`sha256:` + 64 hex) | Roster, parser, send, halt, wake tail. |
| Control plane | `portal.images.control-plane.repository` + `digest` | Entitle path + orchestrator. |
| Relay | `portal.images.relay.repository` + `digest` | Mailbox send is existing `message_send`. Needs the `lp-jnrj` connectors COPY. |
| Daytona agent-gateway snapshot | Daytona snapshot **id/name** (ECR digest is input to snapshot create only) | Real **lanyard-agent** with merged `lac-r9w` mailbox code. **Not** `fake-gateway` stub. **Not** the committed tool-only pin. |

Deploy authority is `repository@digest`. Tags are labels. Never `:latest` alone. Do not invent digests. Pin procedure: [ci-and-release.md](../../architecture/ci-and-release.md), [agent-snapshot-bump-runbook.md](../0008-daytona-agent-sandboxes/agent-snapshot-bump-runbook.md), [agent-gateway-ecr-push.md](../0008-daytona-agent-sandboxes/agent-gateway-ecr-push.md).

## Evidence already in (do not redo)

### Platform (`lp-jnrj` + protocol/UI)

`lp-jnrj` **CLOSED**. PR https://github.com/LanyardBrain/lanyard-platform/pull/661 merged as `53cd6c2f`. Relay Dockerfile copies `packages/connectors/package.json`. Local relay docker build was green at close (`sha256:a1281245…` — **local image id, not an ECR pin**).

Same-repo protocol/UI leaves that this gate depends on are **CLOSED** on `main` (HEAD at runbook time: `bdae40d8` / #663).

### Agent sibling TASK leaves (epics stay open)

Name these in any close reason. TASK leaves are **CLOSED**. Do **not** claim epics `lac-r9w` / `lp-v62i` / `lp-v62i.4` closed.

| Leaf | PR | Merged |
| --- | --- | --- |
| `lac-r9w.2.1` send + hop-retire | https://github.com/LanyardBrain/lanyard-agent/pull/277 | 2026-08-25 |
| `lac-r9w.2.2` hidden 1:1 wake | https://github.com/LanyardBrain/lanyard-agent/pull/279 | 2026-08-26 |
| `lac-r9w.2.3` room-tail assembler | https://github.com/LanyardBrain/lanyard-agent/pull/278 | 2026-08-26 |
| `lac-r9w.3.1` fuse counters | https://github.com/LanyardBrain/lanyard-agent/pull/276 | 2026-08-25 |
| `lac-r9w.3.2` halt abort+freeze | https://github.com/LanyardBrain/lanyard-agent/pull/280 | 2026-08-26 |
| `lac-r9w.3.3` fuse trip notify | https://github.com/LanyardBrain/lanyard-agent/pull/281 | 2026-08-26 |
| `lac-r9w.4.1` schedule default room | https://github.com/LanyardBrain/lanyard-agent/pull/275 | 2026-08-25 |

A new gateway snapshot must pack **lanyard-agent `main` after those merges**. An older tarball is not mailbox.

### CI vs image-release (do not conflate)

| Workflow | What it is | Status at runbook time |
| --- | --- | --- |
| Root `ci` (`.github/workflows/ci.yml`) | PR/push tests. Offline validate is green. Portal tests on `main` are **red** on pre-existing real harness `fake-sandbox-1` reuse (not the relay COPY bug). | Latest `main` after #663: [run 32915166350](https://github.com/LanyardBrain/lanyard-platform/actions/runs/32915166350) failure = Portal tests. |
| Root `release` job **Release portal images + pin data** | The image-release path GitHub actually runs. Nested `portal/.github/workflows/release-images.yml` is historical. | Last runs **2026-08-24** (before #661), all failed `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` on relay/BFF workspace COPY. Example: [run 32791235414](https://github.com/LanyardBrain/lanyard-platform/actions/runs/32791235414) at `26f21f53`. **No successful portal-image publish after `53cd6c2f`.** |
| `Agent gateway image` | Daytona image build/push | `workflow_dispatch` **success** after #654: [run 32913650532](https://github.com/LanyardBrain/lanyard-platform/actions/runs/32913650532) at `14ac9e82`. That is bake-real-agent, **not** a mailbox-agent snapshot and **not** live proof. |

## Live MockLab pins (read-only, 2026-08-26) — still pre-mailbox

Live Fargate **is real** (not a laptop fake). It is **not** mailbox. Do not claim AC2.

| Service | Task def (read-only) | Registered | Image digest (authority) | vs mailbox |
| --- | --- | --- | --- | --- |
| BFF | `lanyard-platform-staging-bff:47` | 2026-08-25 14:13 ET | `sha256:286e67bd943ca5d754204f043162739bcc01a7e7573707498790acade9607e83` | Before first mailbox merge (15:21 ET) |
| Relay | `lanyard-platform-staging-relay:20` | 2026-08-13 16:30 ET | `sha256:e128747addc61ed4b4fdf3bfbb599d86d0bcd3b77f1026409cb65a9a65031915` | Pre-`lp-jnrj`, pre-mailbox |
| Control plane | `lanyard-platform-staging-cp:36` | 2026-08-25 06:41 ET | `sha256:92531dcf57e9eda5571f69e345eaf8380233b9a40242957956eaf9d06b0fd9f1` | Before mailbox |
| Harness | `lanyard-platform-staging-harness:14` | 2026-08-22 22:03 ET | `sha256:2753d73c824ad1303c1268c9b513960e0eceb87c8e89c4b80c969c017c1056c4` | Not mailbox; live send still harness-path residual `lp-j39s` |

Committed Daytona pin remains **tool-only** (`lanyard-tool-only-f63beffd-20260819`, no guest `lanyard-agent`) in [staging-pilot.pins.yaml](../../../deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml). `#654` merged bake-real-agent; **live snapshot proof is not closed** (`lp-na7d`).

Repos are `lanyard-platform-staging/portal/{bff,relay,control-plane,harness}` and `…/daytona/agent-gateway`. Digests above are inventory, not secrets.

## Remaining operator steps (this is the gate)

Orchestrator pause: **do not deploy from this leaf**. After pause lifts, in order:

1. **Publish portal images after `lp-jnrj` `#661`.** Re-run root `release` (immutable version; digest pins; never tag-only). Confirm the relay image build is green on post-`53cd6c2f` `main`. Do not ship a digest from the 2026-08-24 failed runs.
2. **Pin those digests** into the private MockLab pin overlay (not invented, not `:latest`). Static web tarball must include mailbox UI.
3. **Redeploy MockLab BFF / CP / relay** onto those digest pins. Pattern: `lp-8sh4.7` / `lp-jzfc` (operator apply). Prove task defs moved off `:47` / `:20` / `:36` above.
4. **Entitle MockLab connectors** (`lp-8sh4.7`, still **OPEN**): tenant entitlement + user-role grant for `google` / `hubspot` / `whatsapp` / `github`. Ops `/admin` or CP internal entitlements — [portal-connectors.md](../../architecture/portal-connectors.md). Needed for check 9 (picker second section). Do not fake connectors in the SPA.
5. **Pack + bake + pin a Daytona gateway snapshot** that includes **merged `lac-r9w` mailbox code** (table above) and **real lanyard-agent** (`LANYARD_REQUIRE_REAL_AGENT=1`, not fake-gateway). Follow [repack-notes.md](../../../deploy/daytona/agent-gateway/repack-notes.md) + [agent-snapshot-bump-runbook.md](../0008-daytona-agent-sandboxes/agent-snapshot-bump-runbook.md). `#654` is the bake gate; it is **not** live proof.
6. **Jack runs the nine checks** on `app.withlanyard.com/mocklab`. No Playwright stand-in.

## Residuals that still block Jack (out of this leaf)

Do not implement these here. Name them until they close.

| Bead | Status | Why it blocks talk |
| --- | --- | --- |
| `lp-na7d` | **IN_PROGRESS** | Snapshot shipped fake-gateway. `#654` merged bake-real-agent; live proof not closed. |
| `lp-j39s` | **IN_PROGRESS** | MockLab send swallowed (composer clears, no bubble; harness-proxy to a stopped box). |
| `lp-8sh4.7` | **OPEN** | Entitle google/hubspot/whatsapp/github after BFF/CP redeploy. Check 9. |

## What this leaf does not do

- No fake local gateway.
- No protocol implementation (BFF, relay, web mailbox, halt, fuse, parser).
- No Playwright QA suite for the nine checks.
- No deploy / ECS / Daytona apply from this docs commit.
- No invented ECR digests.
- No close of `lp-v62i.4.1` until Jack can attempt the checks on real mailbox images.

## Suggested close reason (when Jack has run the checks)

Leave this bead **OPEN** until live proof. When closing, name the agent siblings that must be in:

```text
Live MockLab nine checks attempted on app.withlanyard.com/mocklab against
digest-pinned BFF/CP/relay plus a Daytona snapshot that bakes real
lanyard-agent including lac-r9w.2.1 (#277 send+hop-retire), lac-r9w.2.2
(#279 hidden 1:1 wake), lac-r9w.2.3 (#278 room-tail), lac-r9w.3.1 (#276
fuse counters), lac-r9w.3.2 (#280 halt abort+freeze), lac-r9w.3.3 (#281
fuse trip notify), lac-r9w.4.1 (#275 schedule default room). lp-jnrj
#661 in. Not a fake gateway. Not a Playwright catalog.
```
