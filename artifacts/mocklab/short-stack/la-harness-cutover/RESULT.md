# lp-oop.37.4 — Replace live echo harness with LA runner

**Result:** **BLOCKED** (live reply still echo)  
**Stamp:** 20260819T074500Z  
**Bead:** `lp-oop.37.4`  
**Pin:** [../la-harness.pins.yaml](../la-harness.pins.yaml)  
**Machine status:** [pr-242-status.json](./pr-242-status.json)

## Hop (live now)

```
Browser  ─HTTP + SSE─►  BFF (MockLab chat_delivery=harness)
                     ─HTTP + SSE─►  LA createHarnessTurnServer
                                    default runner = createEchoTurnRunner
                                    reply = "echo: <message>"
```

| Field | Live now | Target (blocked) |
|-------|----------|------------------|
| Process | LA `createHarnessTurnServer` | same + non-echo `runner` |
| Task | `lanyard-platform-staging-harness:3` | same family, new revision after roll |
| ECR tag | `la-52f5e4d` | `la-fb70865` after operator roll (digest not invented here) |
| Reply | `echo: <message>` | real LA / LiteLLM completion |
| Cluster | `lanyard-platform-staging-portal-cp` | same |
| ALB | internal CP ALB `:8080` | same |
| Auth | `x-harness-service-token` | same |
| Turn body | `tenant_id`, `user_id`, `instance_id`, `thread_id`, `message` | same + optional `sandbox_id` from ensure-online |
| Guest snapshot | no agent-core tree required | still not required |

Flip-era stand-in `lanyard-platform-staging-harness:2` / `lp-oop-flip` (stdlib echo contract) was replaced by `:3` / `la-52f5e4d`. That cutover landed the HTTP server, not a model loop.

## LA PR 242 (observed 2026-08-19)

| Field | Value |
|-------|--------|
| URL | https://github.com/LanyardBrain/lanyard-agent/pull/242 |
| State | **MERGED** |
| Draft | no |
| SHA | `52f5e4db93e7c71b279fedb79f7cc11a9cb82d30` (`52f5e4d`) |
| Branch | `beads/lp-oop.26-la-http-turn-server` |
| On `origin/main` | **Yes** |
| Merged at | 2026-08-19T02:27:46Z |
| Default runner | `createEchoTurnRunner` → `echo: <message>` |

Sibling toolbox PR 243 is OPEN draft at `6bfd52210c194380041bc8581d836f078ed76378`. Not a model runner.

## LA PR 244 (observed 2026-08-19)

| Field | Value |
|-------|--------|
| URL | https://github.com/LanyardBrain/lanyard-agent/pull/244 |
| State | **MERGED** |
| SHA | `fb70865bf8c74a6eb980095fa404e5b7e9327f13` (`fb70865`) |
| Branch | `beads/lp-oop.37.4-non-echo-runner` |
| On `origin/main` | **Yes** |
| Merged at | 2026-08-19T12:38:35Z |
| Factory | `createEnvLiteLlmTurnRunner` (null without LiteLLM env) |

## Why live AC is not met

Acceptance wants a live MockLab no-tool turn that is a **real LA reply**, not `echo: <message>`.

1. Live `:3` / `la-52f5e4d` is still PR 242 echo default.
2. PR 244 **did** merge at `fb70865` and exports `createEnvLiteLlmTurnRunner`.
3. Remaining gap is the operator image roll of this start wrapper + `fb70865` with LiteLLM env.

In-repo path (pin, Dockerfile, start wrapper, runbook, smoke) **is** landed. Live replacement of the echo **reply** is **not** until the roll. `apply_to_live` stays false until a live no-tool turn is not `echo:`.

## Honesty

- Live Fargate is `createHarnessTurnServer` on `:3` / `la-52f5e4d`. Replies are still echo.
- Guest snapshot is not rewritten. `smoke-no-lanyard-agent-tree.sh` still applies. Harness image (`lp-oop.38.1`) COPYs agent-core + required workspace packages so `import '@lanyard-agent/agent-core'` resolves; Daytona guest still has no lanyard-agent tree. createEnvLiteLlmTurnRunner still uses `@lanyard-agent/providers`.
- Start wrapper (`lp-oop.38.2`) prefers `createEnvToolsTurnRunner` / `createAgentCoreTurnRunner` and logs `runner=tools` when the factory returns `{ run }`. Missing/null/throw stays litellm/echo. Live image is not rolled (`apply_to_live: false`).
- No secrets in this file or the pin.
- OPERATOR HOLD still forbids re-applying torn-down staging AWS.
- No new ECS cluster / public ALB / OpenSearch / Lambda.
- Do not claim live echo reply replaced until a no-tool turn is a real LA completion.

## Re-run (offline)

```bash
bash deploy/scripts/smoke-mocklab-replace-echo-harness-la.sh
```

Optional local image (still not a live cutover):

```bash
LANYARD_AGENT_ROOT=/path/to/lanyard-agent \
  bash deploy/scripts/build-la-harness-image.sh
```
