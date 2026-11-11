# 0015 issue map (`lp-oop`)

| Id | Title | Depends on |
|---|---|---|
| `lp-oop` | Epic | — |
| `lp-oop.1` | Land plan 0015 + ADR 0012 | — |
| `lp-oop.2` | Harness turn contract types | `.1` |
| `lp-oop.3` | ChatDelivery flag parse (default relay) | `.1` |
| `lp-oop.4` | VaultObjectStore list/get types | `.1` |
| `lp-oop.5` | Fake harness HTTP | `.2` |
| `lp-oop.6` | FakeS3 list/get | `.4` |
| `lp-oop.7` | Harness contract tests | `.5` |
| `lp-oop.8` | Vault store tests on fake | `.6` |
| `lp-oop.9` | CP HTTP vault list/stat/get | `.8` |
| `lp-oop.10` | BFF CpS3 vault provider | `.9` |
| `lp-oop.11` | VaultPlane flag wiring | `.3` `.10` |
| `lp-oop.12` | Office binary via CP getObject | `.10` |
| `lp-oop.13` | Vault + Office tests on cp_s3 | `.11` `.12` |
| `lp-oop.14` | BFF harness client | `.5` |
| `lp-oop.15` | POST message routes to harness when flagged | `.14` `.3` |
| `lp-oop.16` | SSE + interrupt pass-through | `.15` |
| `lp-oop.17` | Offline chat integration vs fake harness | `.16` |
| `lp-oop.18` | Resolver tenant+user → instance_id | `.1` |
| `lp-oop.19` | CP HTTP ensure-online by user | `.18` |
| `lp-oop.20` | Harness path uses user resolver | `.19` `.15` |
| `lp-oop.21` | Tool-only Dockerfile target | `.1` |
| `lp-oop.22` | Smoke: no lanyard-agent tree | `.21` |
| `lp-oop.23` | Lab pin artifact (not live MockLab) | `.22` |
| `lp-oop.24` | Toolbox client + log redact | `.1` |
| `lp-oop.25` | Fake toolbox + tests | `.24` |
| `lp-oop.26` | LA HTTP turn server (lanyard-agent PR) | `.2` |
| `lp-oop.27` | LA file/bash toolbox adapter | `.26` `.25` |
| `lp-oop.28` | Bind ensure_online + toolbox; create-env invariants | `.20` `.25` `.27` |
| `lp-oop.29` | Dual-run chat_delivery on tenant/instance | `.15` `.11` |
| `lp-oop.30` | MockLab harness deploy (existing ECS) | `.29` `.26` — runbook [mocklab-harness-deploy.md](./mocklab-harness-deploy.md) |
| `lp-oop.31` | Live no-tool turn proof | `.30` `.17` |
| `lp-oop.32` | Live tool + invariant script | `.31` `.28` `.23` |
| `lp-oop.33` | Playwright UI QA on harness path | `.32` `.13` |
| `lp-oop.34` | Kitchen-sink re-QA gate | `.33` |
| `lp-oop.35` | Retire Relay from Daytona chat path (P3). Phase: [phase-9-relay-retire.md](./phase-9-relay-retire.md). ADR 0013. | `.34` |
| `lp-oop.37` | Short-stack live residuals + first real tenant | parent epic after MockLab flip |
| `lp-oop.37.4` | Replace live echo harness with LA runner. Pin + runbook: [replace-echo-harness-la.md](./replace-echo-harness-la.md). [LA PR 242](https://github.com/LanyardBrain/lanyard-agent/pull/242) **MERGED** (`52f5e4d`); live `:3` / `la-52f5e4d`. Real-reply cutover **BLOCKED** on non-echo runner bind + operator roll. | `.26` `.30` |
| `lp-oop.38.14` | Enable spawn_subagent on the harness runner (isolation none). Track: [la-harness-subagents.md](./la-harness-subagents.md). [LA PR 253](https://github.com/LanyardBrain/lanyard-agent/pull/253). | `.38.7` `.38.11` |
