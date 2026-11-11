# MockLab short-stack evidence (`lp-oop` phase 8)

Landing zone for live proof. **No secrets.**

| Bead | What belongs here |
|------|-------------------|
| `lp-oop.30` | Deploy runbook only — [deploy/references/runbooks/mocklab-short-stack-harness.md](../../../deploy/references/runbooks/mocklab-short-stack-harness.md). |
| `lp-oop.31` | Live no-tool turn (Relay not on the hop). Re-run: `bash deploy/scripts/prove-mocklab-short-stack-no-tool-turn.sh`. Offline: `bash deploy/scripts/smoke-mocklab-short-stack-no-tool-turn.sh`. |
| `lp-oop.36` | Browser proof of `.31` on a **local** harness-path BFF. `bash deploy/scripts/prove-mocklab-short-stack-no-tool-ui.sh`. Screenshots `artifacts/ui/lp-oop.36/`. |
| `lp-oop.32` | Live tool + invariant script. Re-run: `bash deploy/scripts/prove-mocklab-short-stack-invariants.sh`. Offline: `bash deploy/scripts/smoke-mocklab-short-stack-invariants.sh`. Live snapshot stays the agent-gateway pin until a human says to flip. |
| `lp-oop.33` | Playwright send/stream/vault-tree on the **local** harness path (`VaultPlane=cp_s3`, no 502 wake). `bash deploy/scripts/prove-mocklab-short-stack-harness-ui.sh`. Screenshots `artifacts/ui/lp-oop.33/`. Live AWS not flipped. |
| `lp-oop.34` | Kitchen-sink re-QA gate (set `needs_ui_qa`). |
| `lp-oop.35` | Retire Relay from the Daytona harness hop. Offline: `bash deploy/scripts/smoke-mocklab-short-stack-relay-retire.sh`. Evidence: `relay-retire/RESULT.md`. Live AWS not flipped. EC2/guest stay Relay. |
| `lp-oop.37.4` | Replace live echo harness with LA `createHarnessTurnServer`. Live now `:3` / `la-52f5e4d` (PR 242 MERGED). Reply still `echo:` until runner bind + image roll. Pin: [la-harness.pins.yaml](./la-harness.pins.yaml). Evidence: [la-harness-cutover/RESULT.md](./la-harness-cutover/RESULT.md) (**BLOCKED** — live reply still echo). Offline: `bash deploy/scripts/smoke-mocklab-replace-echo-harness-la.sh`. Guest snapshot unchanged. |

Guest path stays default Relay until an operator flips MockLab `chat_delivery`. Live Fargate is `createHarnessTurnServer` (`:3` / `la-52f5e4d`) but replies are still echo until `lp-oop.37.4` runner bind + operator roll.

## lp-oop.34 files

| File | Purpose |
|------|---------|
| `kitchen-sink/RESULT.md` | Kitchen-sink re-QA gate (`GO` / `GO_WITH_WAIVERS`; waivers named) |
| `kitchen-sink/REPORT.json` | Machine-readable matrix |
| `artifacts/ui/lp-oop.34/` | Playwright screenshots + runner |
| Re-run | `bash deploy/scripts/prove-mocklab-short-stack-kitchen-sink.sh` |

## lp-oop.31 files

| File | Purpose |
|------|---------|
| `RESULT.md` | Human hop + invariant honesty record (see sections) |
| `no-tool-turn-evidence-latest.json` | Latest PASS (Relay call counts, echo, no tools) |
| `no-tool-turn-evidence-<stamp>.json` | Timestamped copy |
| `prove-<stamp>.log` | Prove script log (no secrets) |

## lp-oop.32 files

| File | Purpose |
|------|---------|
| `RESULT.md` | Invariant + live-snapshot honesty record |
| `invariants-evidence-latest.json` | Latest PASS (all overview checks; live tool held) |
| `invariants-evidence-<stamp>.json` | Timestamped copy |
| `prove-invariants-<stamp>.log` | Prove script log (no secrets) |
