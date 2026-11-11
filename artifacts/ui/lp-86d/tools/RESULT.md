# lp-86d.3 — ChatToolCalls lifecycle UI (tool calls QA)

**Base URL:** `http://demo.localhost:3010`  
**Login:** `dev@demo.local` / `local-dev-password`  
**Verdict:** `PASS`  
**Unblocked by:** `lp-cav` (LA mid-turn + dual-emit `tool_progress`; LA PR #218)  
**Stack:** Portal CP/relay/BFF/web + Lanyard Agent gateway `:9100` portal channel connected  

## Acceptance

| Criterion | Result |
|-----------|--------|
| Prompt agent to use a builtin tool (list/read vault) | **PASS** — marker `lp86d3-tool-ui-marker` |
| `tool_progress` → ChatToolCalls rows | **PASS** — `.astryx-chat-tool-calls` roots=3, toolish_count=5 |
| running→complete (or equivalent) | **PASS** — complete rows + duration marker; story also shows running spinner |
| Screenshot tool rows | **PASS** — `tools-after-prompt.png` |
| Stricter (not user text `'tool'`) | **PASS** — roots/buttons, not body text match |

## Story fixture (`?story=activity-plane&phase=tools`)

Deterministic ChatToolCalls proof (auth-free):

- Group: **3 tool calls**
- **Reading documents** `/Business/Contracts/MSA.docx` complete `0.4s`
- **Searching files** `indemnification clause` complete `1.1s`
- **Running a command** running (spinner)
- No raw `read_file` / `vault_search` labels

Shot: `00-story-phase-tools.png`

## Live LA chat

Prompt asked for `read_file` / `list_dir` / `ls` over vault/workspace.

ChatToolCalls group **4 tool calls** after the prompt:

| Row | Status |
|-----|--------|
| Error in ls | error (✗) |
| Error in read | error (✗) |
| Finished ls | complete (✓) |
| Finished read | complete (✓) |

Scan:

```json
{
  "chat_tool_calls_roots": 3,
  "humanized_button_count": 2,
  "duration_markers": 1,
  "collapsed_tool_pill": 0,
  "toolish_count": 5
}
```

Notes:

- Host emitted tool labels (`Error in ls` / `Finished ls`) rather than friendly `Listing files` verbs; rows still use Astryx ChatToolCalls lifecycle (status icons + group chrome).
- Some tool executions errored (sandbox/cwd), but **UI lifecycle still rendered** — that is the bead acceptance.
- Mid-turn `running` spinner was not sampled (tools completed quickly); complete/error terminal states + story running row cover the lifecycle.

## Screenshots

| File | What |
|------|------|
| `00-story-phase-tools.png` | Story ChatToolCalls complete + running |
| `01-live-home.png` | Logged-in shell |
| `02-live-prompt-sent.png` | Builtin-tool prompt sent |
| `tools-after-prompt.png` | Live ChatToolCalls after tool use |
| `03-live-tools-lifecycle.png` | Lifecycle capture |
| `04-live-tools-expanded.png` | Expanded tool rows |

## Re-run

```bash
# Requires Portal stack + LA gateway (lp-86d.1). GPU/headless hosts need swiftshader flags.
export BASE_URL=http://demo.localhost:3010
python3 artifacts/ui/lp-86d/tools/run_tool_calls_qa.py

# or pytest (story + live):
cd portal/packages/web/ui-testing
export UI_ARTIFACTS=../../../../artifacts/ui/lp-86d/tools
pytest -v test_lp_86d_3_tool_calls_ui.py --browser chromium
```

## Gaps / fix beads

None required for ChatToolCalls lifecycle UI. Optional product follow-ups (not blocking this QA):

- Host tool error messages as humanized activity labels (lp-vnz.9 style) for `ls`/`read` failures.
- Builtin list/read sandbox path defaults when agent uses bare `ls` without vault root.
