# Localhost echo harness

Stand-in for a signed-in chat turn when `pnpm dev:mock-gateway` is absent and Lanyard Agent is not checked out.

```bash
HARNESS_SERVICE_TOKEN=placeholder-harness-service-token node deploy/dev/localhost-echo-harness/serve.mjs
```

Point the BFF at it with `HARNESS_URL=http://127.0.0.1:4310` and the same service token. Leave `CHAT_DELIVERY` unset so the process default stays `relay`. Wiring `HARNESS_URL` selects the harness hop.

The same token is also accepted as `Authorization: Bearer` for `AGENT_BACKEND_PROTOCOL=lanyard_harness` (`lp-bhcg.2`).

`POST /internal/turns` returns `{ turn_id }`. `GET /internal/turns/:id/events` sends one `message_send` whose `content` is `Echo harness: ` plus the user text, then closes. `GET /internal/settings/snapshot` returns `exported_at` and `crons: []`.
