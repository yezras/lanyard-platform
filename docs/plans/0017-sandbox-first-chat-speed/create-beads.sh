#!/usr/bin/env bash
# Create the first-chat sandbox speed epic. Run from anywhere. Uses lanyard-platform bd.
# Idempotent: aborts if the epic title exists.
set -euo pipefail

BD_ROOT="/home/operator/Lanyard-Dev/lanyard-platform"
TITLE="First-chat sandbox speed: send is start-from-stopped"

if ! command -v bd >/dev/null; then
  echo "bd not found" >&2
  exit 1
fi

cd "$BD_ROOT"

if bd search "$TITLE" --json 2>/dev/null | grep -F "\"title\": \"$TITLE\"" >/dev/null 2>&1; then
  echo "Epic title already exists. Aborting." >&2
  bd search "$TITLE" || true
  exit 1
fi

create() {
  local title="$1" type="$2" labels="$3" priority="$4"
  shift 4
  bd create --title "$title" --type "$type" -l "$labels" -p "$priority" \
    --validate --silent --parent "$EPIC" "$@"
}

EPIC=$(bd create --title "$TITLE" --type epic -p 1 \
  --labels "daytona,perf,first-chat" --validate --silent \
  --description "$(cat <<'EOF'
Make first chat fast. Platform Fargate and ONLYOFFICE stay always-on.

Send on a bound stopped sandbox must be start-from-stopped (target <5s to agent_ready).
Do not cold-create or wait Mountpoint writable on the click.

Plan: docs/plans/0017-sandbox-first-chat-speed/
Related: lp-6bg (stub pool, closed), lp-puzc (Mountpoint first-write), lp-sjn9 (CF 60s clip).

Playbooks: multi-phase plan, hillclimb (time_to_agent_ready_ms), perf-issue (scheduling + elimination).

## Success Criteria
1. Frozen real harness ruler prints time_to_agent_ready_ms by path.
2. Send with bound sandbox_id never calls Daytona create (T1/T5).
3. Presence online when Relay/harness is up even if vault is not writable (T3).
4. Chat POST while waking returns in <15s with agent_starting; no CloudFront 60s hold (T4).
5. Warm pool claim works on real harness (T2). Live org enable is residual.
6. Harness no-tool turn does not ensure_online (T6).
7. Entrypoint does not block gateway on post-mount writable timeout (T8).
8. No terraform apply / no Fargate/DS sleep / ONLYOFFICE sleep in this epic.
9. Live T10 residual stays open until OPERATOR HOLD + lp-puzc allow a MockLab wall-clock proof.
EOF
)")

echo "epic $EPIC"

P_PRINC=$(create "0017 playbook: principles + scope recorded" chore "daytona,perf,playbook" 2 \
  --description "$(cat <<'EOF'
pstack first step. Not product code.

## Acceptance Criteria
- overview.md states in/out, SLO, and rejected Fargate/DS sleep
- principles named: experience-first, fix-root-causes, build-the-lever, sequence-verifiable-units, idempotent, separate-before-serializing
- architect skipped reason recorded in overview
- Prove: grep -F 'architect skipped' docs/plans/0017-sandbox-first-chat-speed/overview.md
EOF
)")

P_CHK=$(create "0017 playbook: throughput checkpoint" chore "daytona,perf,playbook" 2 \
  --description "$(cat <<'EOF'
Feature playbook four dimensions.

## Acceptance Criteria
- checkpoint.md has blocking first steps, independent workstreams, shared mutable state, smallest safe decomposition
- CP orchestrator serialized; BFF vs web vs entrypoint called out as streams
- Prove: test -f docs/plans/0017-sandbox-first-chat-speed/checkpoint.md
EOF
)")

P1=$(create "0017.1 Plan docs for first-chat speed" task "daytona,perf,docs" 1 \
  --description "$(cat <<'EOF'
Land the plan directory used by this epic.

## Acceptance Criteria
- docs/plans/0017-sandbox-first-chat-speed/{overview,testing,issue-map,checkpoint,create-beads}.md|sh exist
- SLO table and non-goals include no Fargate/DS sleep
- Prove: test -f docs/plans/0017-sandbox-first-chat-speed/overview.md && test -f docs/plans/0017-sandbox-first-chat-speed/testing.md
EOF
)")

P2=$(create "0017.2 Readiness: agent_ready vs vault_writable" feature "daytona,perf,tdd" 1 \
  --description "$(cat <<'EOF'
CP: product online is Relay (or harness) up. Vault writable is a separate field/flag.

Do not promote presence online only after Mountpoint first-write.

TDD: T3 in docs/plans/0017-sandbox-first-chat-speed/testing.md

## Acceptance Criteria
- Orchestrator/presence distinguishes agent_ready from vault_writable
- Fake test: Relay connected + vault not writable still yields presence online (or agent_ready true)
- Guest file-tool path can still wait on vault_writable
- Prove: pnpm --filter @lanyard/control-plane test covering the new field
- No terraform apply
EOF
)")

P3=$(create "0017.3 Frozen SLO harness on real harness" task "daytona,perf,tdd" 1 \
  --description "$(cat <<'EOF'
Build the hillclimb ruler before behavior changes.

## Acceptance Criteria
- Test or small script records time_to_agent_ready_ms by path: already_online, start_from_stopped, cold_create, warm_pool
- Fake clock; no live Daytona
- T9: printing the histogram is the command reviewers rerun
- Changing buckets requires updating testing.md
- Prove: pnpm --filter @lanyard/control-plane test for the harness
EOF
)")

P4=$(create "0017.4 Send never cold_create when sandbox_id bound" feature "daytona,perf,tdd" 1 \
  --description "$(cat <<'EOF'
T1/T5. If instance has sandbox_id, ensure_online on chat uses start_from_stopped (or already_online). Never create.

## Acceptance Criteria
- real harness spy: create not called on Send/ensure_online when sandbox_id set and sandbox stopped
- Path label start_from_stopped
- time_to_agent_ready_ms < 5000 on fake clock
- Prove: control-plane unit + bff ensure-online-chat if that call site is in play
- No live org
EOF
)")

P5=$(create "0017.5 Create-ahead so first visit is not a click-create" feature "daytona,perf,tdd" 1 \
  --description "$(cat <<'EOF'
Scheduling family: run cold create off the Send click.

Bind sandbox_id at provision or on /chat land (speculative create+stop+retain), so first Send is start_from_stopped.

## Acceptance Criteria
- API or orchestrator helper to ensureBoundStoppedSandbox(instance_id) that create+start+stop+retain when sandbox_id is null
- Idempotent if already bound
- Test: null sandbox_id, helper runs, subsequent ensure_online is start_from_stopped
- Prove: control-plane unit
- Do not call paid Daytona from CI
EOF
)")

P6=$(create "0017.6 Detach chat POST from wake wait (CloudFront 60s)" feature "daytona,perf,tdd,bff" 1 \
  --description "$(cat <<'EOF'
T4. Chat message POST must not hold the CloudFront origin for the full wake.

origin_read_timeout is 60s in portal-static-edge. Evening wakes were 10–17 min (lp-sjn9).

## Acceptance Criteria
- While ensure_online is in flight, POST returns or streams agent_starting without waiting wait_timeout_ms
- Client can wait on SSE agent_ready / error
- Unit: fake CP that delays wake; BFF does not sit for the delay
- Wall for the HTTP handler < 15s in the test clock
- Prove: pnpm --filter @lanyard/bff test
- Do not "fix" this by raising CloudFront timeout as the only change
EOF
)")

P7=$(create "0017.7 Speculative ensure_online when opening /chat" feature "daytona,perf,tdd,ui" 1 \
  --description "$(cat <<'EOF'
T7. Hide start-from-stopped (1–5s) before Send.

## Acceptance Criteria
- Chat route or BFF context load triggers at most one ensure_online join (singleflight)
- Second Send is already_online or start_from_stopped without create
- No extra Daytona create vs today's lazy path when instance already bound
- Prove: bff and/or web unit; Playwright only if hook is visible
- OPERATOR HOLD: no live AWS apply
EOF
)")

P8=$(create "0017.8 Warm pool claim + replenish on real harness" feature "daytona,perf,tdd" 1 \
  --description "$(cat <<'EOF'
T2. lp-6bg left DAYTONA_WARM_POOL_ENABLED as always-miss. Implement claim.

## Acceptance Criteria
- In-process pool (single CP task): pre-created stopped sandbox ids for the pin snapshot
- Claim on cold need: bind to instance_id, start, path warm_pool
- Miss still cold_create; metrics warm_pool_hits / misses increment for real
- Replenish helper refills off the ensure_online stack (async/queue/after)
- Cap documented (1–2 MockLab). Tests never hit the paid API
- Prove: pnpm --filter @lanyard/control-plane test test/warm-pool-snapshot-wake.test.ts (extended)
EOF
)")

P9=$(create "0017.9 Harness no-tool turn skips sandbox wake" feature "daytona,perf,tdd,bff" 1 \
  --description "$(cat <<'EOF'
T6. Elimination family: no-tool short-stack chat does not need Daytona.

## Acceptance Criteria
- CHAT_DELIVERY harness (or equivalent): no-tool message does not call ensure_online
- Tool turn still ensure_online
- Existing no-tool tests stay green; add one that spies ensure_online
- Prove: pnpm --filter @lanyard/bff test
EOF
)")

P10=$(create "0017.10 Entrypoint: gateway not gated on post-mount writable" task "daytona,perf,entrypoint" 1 \
  --description "$(cat <<'EOF'
T8. Fix root cause of minutes-on-Send: entrypoint waits LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC (default 120, live 1200) before exec gateway.

## Acceptance Criteria
- Gateway/exec proceeds after mount-s3 attempt without blocking on writable timeout
- Writable probe may run in background or set a flag; failure to write is not a dead sandbox
- Default POST_MOUNT wait is not 1200
- Smoke or shell test for the branch (deploy/scripts or entrypoint --self-test if present)
- Prove: grep/test showing exec is not after the writable die path
- Do not claim lp-puzc fixed
EOF
)")

P11=$(create "0017.11 Encode SLO T1–T9 in CI" task "daytona,perf,tdd" 1 \
  --description "$(cat <<'EOF'
Hillclimb freeze: tests are the ruler.

## Acceptance Criteria
- testing.md IDs T1–T9 each have a named test or an explicit n/a with reason
- CI path: control-plane + bff tests invoked from package scripts already used in PRs
- No live Daytona in CI
- Prove: pnpm --filter @lanyard/control-plane test && pnpm --filter @lanyard/bff test
EOF
)")

P12=$(create "0017.12 Live MockLab T10 residual" task "daytona,perf,live" 2 \
  --description "$(cat <<'EOF'
T10. Wall-clock Send after idle: start_from_stopped, wake_ms < 5000, no CloudFront 504.

## Acceptance Criteria
- Evidence pack under artifacts/ (no secrets)
- Path label start_from_stopped (or warm_pool)
- OPERATOR HOLD respected: no terraform apply unless human lifted
- If Mountpoint still minutes, record and leave lp-puzc open; chat must still be agent_ready without waiting writable
- Prove: evidence md + JSON timings
EOF
)")

echo "children created"

bd dep add "$P3" "$P1"
bd dep add "$P2" "$P3"
bd dep add "$P4" "$P2"
bd dep add "$P5" "$P4"
bd dep add "$P6" "$P1"
bd dep add "$P7" "$P6"
bd dep add "$P8" "$P3"
bd dep add "$P8" "$P4"
bd dep add "$P9" "$P6"
bd dep add "$P10" "$P2"
bd dep add "$P11" "$P4"
bd dep add "$P11" "$P6"
bd dep add "$P11" "$P8"
bd dep add "$P11" "$P9"
bd dep add "$P11" "$P10"
bd dep add "$P12" "$P11"
bd dep add "$P12" "lp-puzc" || true

# Playbook chores wait on plan docs only so they close in wave 1 with P1.
bd dep add "$P_PRINC" "$P1"
bd dep add "$P_CHK" "$P1"

echo "deps wired"
echo "EPIC=$EPIC"
bd children "$EPIC"
bd ready | head -40
