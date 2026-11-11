#!/usr/bin/env bash
# Create the Portal Agents/Channels IA epic. Run from anywhere. Uses lanyard-platform bd.
# Idempotent: aborts if the epic title exists.
set -euo pipefail

BD_ROOT="/home/operator/Lanyard-Dev/lanyard-platform"
TITLE="Portal Agents/Channels IA"

if ! command -v bd >/dev/null; then
  echo "bd not found" >&2
  exit 1
fi

cd "$BD_ROOT"

if bd list --status=open --json 2>/dev/null | grep -F "$TITLE" >/dev/null 2>&1; then
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

EPIC=$(bd create --title "$TITLE" --type epic -p 2 \
  --labels "agents-channels,ui" --validate --silent \
  --description "$(cat <<'EOF'
Portal IA for durable agents, channels, and killing Projects in the UI.

Normative lock: docs/plans/0016-agents-channels-ia/decision-locked-ia.md
Plan: docs/plans/0016-agents-channels-ia/
Integration branch: integrate/lac-bx3
Sibling harness epic: lac-bx3 in lanyard-agent (session keys, hop cap, prompt layers).

v1: one human, many agents. Multi-human later.

## Success Criteria
1. Sidenav is Channels / Agents / Scheduled Tasks. No Projects UI.
2. Agents row is the durable agent; one persistent 1:1; New agent mints a person not a clone.
3. Channel requires a name and ≥2 agents; floor two after create; @ wakes only in channels; un-mentioned mail goes to lead.
4. Delete agent confirms and removes channel membership and job binds. Delete channel keeps agents.
5. Legacy interactive chats migrate 1:1 → one agent; no auto-channels.
6. I1-I16 in docs/plans/0016-agents-channels-ia/testing.md green (BFF units + Playwright).
EOF
)")

echo "epic $EPIC"

P0=$(create "P0: 0016 plan docs on integrate/lac-bx3" task "agents-channels" 1 \
  --description "$(cat <<'EOF'
## Acceptance Criteria
- docs/plans/0016-agents-channels-ia/ has overview.md, testing.md, decision-locked-ia.md, create-beads.sh
- Prove: test -f docs/plans/0016-agents-channels-ia/decision-locked-ia.md
EOF
)")

P1=$(create "P1: durable agent catalog (row is the agent)" feature "agents-channels,tdd" 1 \
  --description "$(cat <<'EOF'
BFF: interactive 1:1 thread identity is the durable agent. One 1:1 per agent. No extra threads.

TDD first: I3 (New agent = one catalog row + one 1:1).

## Acceptance Criteria
- Creating an agent persists catalog fields (id, name, avatar, objective) and exactly one chat stream.
- Second create is a different agent id.
- Prove: pnpm -C portal/packages/bff test covering catalog uniqueness.
EOF
)")

P2=$(create "P2: sidenav Channels / Agents / Scheduled Tasks; kill Projects UI" feature "agents-channels,tdd,ui" 1 \
  --description "$(cat <<'EOF'
Web: folder order Channels, Agents, Scheduled Tasks. Remove New project and project folders.

TDD first: I1/I2.

## Acceptance Criteria
- I1, I2 green on demo.localhost:3010.
- No Projects create path in the + menu.
- Prove: pytest ui-testing + ChatHistorySideNav unit tests.
EOF
)")

P3=$(create "P3: New agent = catalog + first 1:1" feature "agents-channels,tdd,ui" 1 \
  --description "$(cat <<'EOF'
+ New agent writes catalog and opens the persistent 1:1.

TDD first: I3.

## Acceptance Criteria
- I3 green. New agent never mints a second 1:1 for an existing agent.
- Prove: Playwright + BFF create handler tests.
EOF
)")

P4=$(create "P4: New channel popup, name, two members minimum" feature "agents-channels,tdd,ui" 1 \
  --description "$(cat <<'EOF'
Popup: required name, pick existing agents, Create a new agent inline. Cannot submit until two members. Empty catalog: create two then continue.

TDD first: I4.

## Acceptance Criteria
- I4, I5, I6 green.
- Prove: unit tests on the create-channel validator + Playwright.
EOF
)")

P5=$(create "P5: channel membership edit, floor of two" feature "agents-channels,tdd" 1 \
  --description "$(cat <<'EOF'
Add/remove after create. Cannot go below two. Delete channel keeps agents and 1:1s.

TDD first: I7.

## Acceptance Criteria
- I7, I8 green.
- Prove: BFF membership tests.
EOF
)")

P6=$(create "P6: channel lead + unmentioned wake stamp" feature "agents-channels,tdd" 1 \
  --description "$(cat <<'EOF'
Lead = first member at create, user-changeable. Un-mentioned channel inbound stamps target_persona_ids=[lead]. Contract field for lac-bx3.

TDD first: I9.

## Acceptance Criteria
- I9 green. group-rooms-v1 / deliver-inbound includes lead and target_persona_ids.
- Prove: BFF wake-policy or deliver tests.
EOF
)")

P7=$(create "P7: @ wake only in channels" feature "agents-channels,tdd" 1 \
  --description "$(cat <<'EOF'
@Name in a channel stamps that agent. In a 1:1, @ does not start another agent turn.

TDD first: I10.

## Acceptance Criteria
- I10, I11 green.
- Prove: BFF mention parser tests + one Playwright.
EOF
)")

P8=$(create "P8: lead succession LLM + tenure fallback + notice" feature "agents-channels,tdd" 1 \
  --description "$(cat <<'EOF'
On lead remove/delete with ≥2 remaining: LLM picks from channel log + remaining objectives. Fail/timeout: longest join time (picker order tie-break). Always post system notice Lead is now X.

TDD first: I12 (fallback path does not need a live model).

## Acceptance Criteria
- I12 green for fallback. LLM path unit-tested with a fake picker.
- Remove is never blocked on the model.
- Prove: BFF succession tests.
EOF
)")

P9=$(create "P9: delete agent confirm cascade" feature "agents-channels,tdd,ui" 1 \
  --description "$(cat <<'EOF'
Deleting the Agents row deletes the person: leave all channels, unbind jobs. Confirm required. No channel-only ghosts.

TDD first: I13.

## Acceptance Criteria
- I13 green. Channel floor-two: if delete would drop a channel below two, delete that channel or block with a clear error (document choice in the test).
- Prove: BFF delete tests + Playwright confirm.
EOF
)")

P10=$(create "P10: + New scheduled task binds one agent" feature "agents-channels,tdd,ui" 1 \
  --description "$(cat <<'EOF'
+ includes New scheduled task. Pick or create one agent. Stream under Scheduled Tasks. Job does not wake a channel.

TDD first: I14.

## Acceptance Criteria
- I14 green. scheduled_job_id bind unchanged except agent id is required.
- Prove: existing job-stream tests plus + menu Playwright.
EOF
)")

P11=$(create "P11: migrate legacy chats to durable agents" feature "agents-channels,tdd" 1 \
  --description "$(cat <<'EOF'
Each interactive chat → one agent + that history. Keep title/avatar. Duplicate titles get a suffix. Drop project folders in UI. No auto-channels. Scheduled streams stay.

TDD first: I15.

## Acceptance Criteria
- I15, I16 green on a fixture DB with two project-grouped chats and one job stream.
- Prove: BFF migration unit test (idempotent).
EOF
)")

P12=$(create "P12: Playwright catalog I1-I16 on demo.localhost" feature "agents-channels,tdd,ui" 1 \
  --description "$(cat <<'EOF'
End-to-end on the live local Portal. Artifacts under artifacts/ui/agents-channels-ia/.

TDD first: I2 (sidenav labels) against the running app.

## Acceptance Criteria
- I1-I16 exercised or explicitly N/A with pointer to the unit that already proved it.
- Prove: pytest -v path recorded in close reason; desktop plus a narrow viewport if layout changed.
EOF
)")

TMP=$(mktemp)
cat >"$TMP" <<EOF
{"from":"$P1","to":"$P0"}
{"from":"$P2","to":"$P0"}
{"from":"$P3","to":"$P1"}
{"from":"$P3","to":"$P2"}
{"from":"$P4","to":"$P1"}
{"from":"$P4","to":"$P2"}
{"from":"$P5","to":"$P4"}
{"from":"$P6","to":"$P4"}
{"from":"$P7","to":"$P6"}
{"from":"$P8","to":"$P6"}
{"from":"$P9","to":"$P5"}
{"from":"$P10","to":"$P1"}
{"from":"$P10","to":"$P2"}
{"from":"$P11","to":"$P1"}
{"from":"$P11","to":"$P2"}
{"from":"$P12","to":"$P5"}
{"from":"$P12","to":"$P7"}
{"from":"$P12","to":"$P8"}
{"from":"$P12","to":"$P9"}
{"from":"$P12","to":"$P10"}
{"from":"$P12","to":"$P11"}
EOF
bd dep add --file "$TMP"
rm -f "$TMP"

echo
echo "Created epic $EPIC"
echo "P0 $P0"
echo "P1 $P1"
echo "P2 $P2"
echo "P3 $P3"
echo "P4 $P4"
echo "P5 $P5"
echo "P6 $P6"
echo "P7 $P7"
echo "P8 $P8"
echo "P9 $P9"
echo "P10 $P10"
echo "P11 $P11"
echo "P12 $P12"
bd ready
