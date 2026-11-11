# 0015.26 — LA HTTP turn server

**Bead:** `lp-oop.26`  
**Epic:** `lp-oop` (plan 0015 / ADR 0012)  
**LA repo:** [LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent)

Cross-repo note: the live harness HTTP server lives in `lanyard-agent`, not Portal. This file records the LA PR + SHA so platform close evidence stays in-tree.

## Wire (lockstep with `@lanyard/shared`)

- `POST /internal/turns` → `{ turn_id }`
- `GET /internal/turns/:turnId/events` — SSE `text/event-stream`, `TurnEvent` = `RelayChatEvent`
- `POST /internal/turns/:turnId/interrupt` → `{ ok, interrupted }`
- Header `x-harness-service-token` (missing/wrong → 401)

Types: `portal/packages/shared/src/harness/turn.ts` + `http.ts`.  
Fixture (identical copy): `portal/packages/shared/src/fixtures/harness-turn-contract.v1.json`.

LA default runner is no-tools echo (`echo: <message>`). Toolbox bind is `lp-oop.27`.

## LA ship

| Field | Value |
|---|---|
| PR | https://github.com/LanyardBrain/lanyard-agent/pull/242 |
| SHA | `cc37ff4dd9119d32db32ce8110ea508b7e7a3cb0` |
| Branch | `beads/lp-oop.26-la-http-turn-server` |
| Observed 2026-08-18 | Still **OPEN**, not on `origin/main`. CI `typecheck / test` FAILURE ([run 31846868486](https://github.com/LanyardBrain/lanyard-agent/actions/runs/31846868486)). Live Fargate remains echo (`lp-oop-flip`). Residual: [`lp-oop.37.4`](./replace-echo-harness-la.md). |
| Observed 2026-08-19 | **MERGED** at `52f5e4db93e7c71b279fedb79f7cc11a9cb82d30`. Live Fargate `:3` / `la-52f5e4d` is `createHarnessTurnServer`; replies still `echo:`. Residual: [`lp-oop.37.4`](./replace-echo-harness-la.md) (non-echo runner bind). |
