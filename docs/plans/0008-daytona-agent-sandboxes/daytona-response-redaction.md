# Daytona create/GET response env redaction

**Bead:** `lp-pec.1`  
**Parent:** `lp-pec` (Phase 4 Instance Orchestrator)  
**Discovered-from:** `lp-ctu` / `lp-4l5`  
**Code:** `portal/packages/control-plane/src/daytona-env-redact.ts`

## Problem

Managed Daytona **POST /sandbox** create responses include the full process
`env` map **with secret values** (including `GATEWAY_RELAY_SECRET`). GET may
also expose env depending on API version. Orchestrator HTTP clients, structured
logs, and CI dumps must never retain raw values.

Evidence: [spike-4l5-gateway-secret-inject.md](./spike-4l5-gateway-secret-inject.md) §6,
[spike-ctu-go-no-go.md](./spike-ctu-go-no-go.md) condition 3.

## Logging policy (normative)

| Allowed | Forbidden |
|---------|-----------|
| Env **key names** present | Raw secret values |
| Secret **length** | Authorization / Bearer header values |
| Optional **fingerprint** (`sha256:` + 12 hex of value) | Full unredacted create/GET env dumps |
| Non-secret env values when intentionally summarized (ids, URLs, paths) | Prod / SM secrets in fixtures, PRs, or bead notes |

Guest proof scripts in Phase 0 spikes already log only `secret_present`,
`secret_len`, and `secret_fp=sha256:…` — orchestrator parity uses the same
shape via `daytonaEnvLogSummary`.

## Implementation (offline-ready)

| Export | Role |
|--------|------|
| `isDaytonaSecretEnvKey` | Classify secret-shaped env keys (`GATEWAY_RELAY_SECRET`, `*_API_KEY`, …) |
| `redactDaytonaEnvMap` | Copy env map with secret values → `[REDACTED]` |
| `daytonaEnvLogSummary` | Structured event: keys + secret length/fingerprint |
| `redactDaytonaApiResponseForLog` | Deep-redact create/GET JSON before dump/log |
| `parseDaytonaSandboxApiBody` | **Parse path** for real SDK (`lp-012`): memory env + log-safe views |
| `withDaytonaResponseRedaction` | Optional middleware: parse + log only safe fields |

`real Daytona client (via harness-local)` already keeps inject env off the public `DaytonaSandbox`
record (test helper only). Live SDK wrapper (`lp-012`) should call
`parseDaytonaSandboxApiBody` immediately after JSON parse and log only
`envSummary` / `bodyForLog`.

Defense-in-depth: shared G2b.2 `redactForLog` still treats a top-level `env`
key as secret-shaped for whole-object sinks; this module is the intentional
env-aware path.

## Tests

```bash
pnpm --filter @lanyard/control-plane test -- daytona-env-redact
```

Fixtures use throwaway tokens only (e.g. `test-throwaway-relay-secret-not-for-prod`).

## Live client (`lp-012`)

`DaytonaSdkClient` (`portal/packages/control-plane/src/daytona-sdk-client.ts`)
calls `parseDaytonaSandboxApiBody` on create/GET responses and emits only
`envSummary` / `bodyForLog` via optional `logSafe`. Public `DaytonaSandbox`
records never include `env`.

## Non-goals

- Does not change guest inject policy (still Bucket C wake inject).
- Does not request write-only env from Daytona (product residual / vendor).
