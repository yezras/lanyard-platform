# ADR 0007: Composer model intelligence routing

- Status: Accepted (amended)
- Date: 2026-08-04
- Amended: 2026-08-04 (`lp-uxy.12`)
- Beads: `lp-uxy.8`, `lp-uxy.12`

## Context

Users want model intelligence control always visible in the chat composer
bottom-right next to send: **Auto | Simple | Moderate | Complex**. Settings →
Models remains the place that lists concrete models and the global active model.

Host Brain RPC / settings surfaces expose **global** active model mutation
(`settings.patch` op `model.set_active` or `models.set_active`). There is no
stable per-request model field on portal inbound chat delivery today.

**lp-uxy.8** shipped the composer UX with a **client-side** complexity
heuristic (`classifyMessageComplexity`) and catalog name matching as the
routing source of truth. That duplicated what LiteLLM already provides as
**Auto Routing** (`auto_router/complexity_router`): tier groups
SIMPLE/MEDIUM/COMPLEX/REASONING, free heuristic scorer or optional LLM
classifier, and a single call-side model id.

**lp-uxy.12** makes LiteLLM the routing source of truth. Portal keeps the same
composer UX and only selects which LiteLLM `model_name` is active for the turn.

## Decision

### Routing mode (preferred — LiteLLM-native)

1. **Deploy seed** (`deploy/litellm/config.yaml`) defines:
   - Tier pins: `lanyard-simple`, `lanyard-moderate`, `lanyard-complex`
     (optional `lanyard-reasoning` for auto_router REASONING only)
   - Router: `lanyard-auto` with `litellm_params.model: auto_router/complexity_router`
     and `complexity_router_config.tiers` mapped SIMPLE→simple pin, MEDIUM→moderate,
     COMPLEX→complex, REASONING→reasoning
2. **Portal selection → LiteLLM model_name** (stable ids; operators re-pin
   underlying `litellm_params.model` without changing Portal):

   | Composer | LiteLLM `model_name` |
   | --- | --- |
   | Auto | `lanyard-auto` |
   | Simple | `lanyard-simple` |
   | Moderate | `lanyard-moderate` |
   | Complex | `lanyard-complex` |

3. **Global active model** remains the host execution selector until per-request
   model exists. Before a send that needs a different model than the current
   active one, Portal calls `patchSettingsActiveModel` to the LiteLLM model id
   above (provider typically `litellm` when the host catalogs proxy models).
4. **User message stamp** records that model id for display + inheritance when
   the host omits model metadata.
5. **Per-request model on inbound** stays preferred when the host/relay contract
   gains an optional model field; only then drop global `set_active` for
   intelligence routing. This ADR still does not require host contract changes.

### Client heuristic (fallback only)

When the settings catalog **does not** expose the LiteLLM intelligence models
(e.g. host not on the multi-slot LiteLLM seed, offline mock without pins):

1. **Auto:** `classifyMessageComplexity` on the user turn text → effective tier
   → catalog name-heuristic model pick.
2. **Manual tiers:** name-heuristic / override map against the catalog.
3. Never block send; on failure or empty text, fall back to **moderate** (or
   active model if mapping empty).
4. Fallback is labeled `routingSource: "client_fallback"` in Portal code; the
   preferred path is `routingSource: "litellm"`.

Do **not** use the client heuristic to pick a tier model when `lanyard-auto` is
available — that would bypass LiteLLM auto_router and reintroduce dual SoT.

### Auto indicator

- LiteLLM path: composer shows **Auto** (no client-side “Auto · Simple”
  prediction). Server-side classifier owns SIMPLE/MEDIUM/COMPLEX/REASONING.
- Fallback path: may show **Auto · {tier}** from the client heuristic for
  operator feedback only.

### Classifier cost

- Default LiteLLM config uses the **free heuristic** scorer (sub-millisecond).
- Optional `classifier_type: llm` on `lanyard-auto` is an operator cost choice;
  document in `deploy/litellm/README.md`. Do not couple to self-improve judges.

### Persistence & capability

- Persist last selection (and last known Auto effective tier **only on client
  fallback**) per user in `localStorage`, with optional per-thread overrides.
- Capability-gate: when `model_selector` is unsupported and no
  `models.set_active` / settings patch path exists, the control is hidden or
  disabled with a clear disabled reason (same honesty model as Settings).

## Consequences

- Manual tier selection and Auto both change the global active model for
  subsequent turns (including other clients on the same host profile) until
  changed again — accepted until per-request model lands.
- Concurrent chats that want different models may race on global active.
- Operators control which real backends back each tier by editing
  `deploy/litellm/config.yaml` pin `litellm_params.model` values (env keys only;
  no secrets in git).
- Hosts must surface LiteLLM intelligence `model_name`s in the settings model
  catalog for Portal to prefer the LiteLLM path; otherwise client fallback
  remains.
- Unit tests prove LiteLLM model id mapping + fallback; smoke validates config
  slots; browser QA still recommended for selector layout next to send.

## Alternatives considered

| Option | Verdict |
| --- | --- |
| Client heuristic as permanent SoT (lp-uxy.8 v1) | Superseded for routing — keep only as offline fallback |
| Per-message model only (no set_active) | Rejected until host inbound gains field |
| Settings-only active model (no composer control) | Rejected — product wants always-visible tiers |
| Blocking LLM judge in Portal before every send | Rejected — latency/failure must not block chat; LiteLLM optional LLM classifier is non-blocking with heuristic fallback |
| Reuse self-improve judge pipeline | Rejected — different purpose |

## Related

- Settings Brain RPC: `docs/architecture/portal-settings-brain-rpc.md`
- model_selector affordance: `@lanyard/web-settings-schema`
- LiteLLM catalog + auto_router seed: `deploy/litellm/config.yaml`, `deploy/litellm/README.md`
- LiteLLM docs: https://docs.litellm.ai/docs/proxy/auto_routing
- Portal mapping: `portal/packages/web/src/features/chat/modelIntelligence.ts`
