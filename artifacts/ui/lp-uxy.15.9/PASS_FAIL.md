# lp-uxy.15.9 — pass/fail

**Result: PASS_UI_FAIL_LITELLM_CATALOG**

- Base: `http://demo.localhost:3010`
- Shipped: lp-uxy.8 + lp-uxy.12
- Login: `dev@demo.local`
- selector_visible: True
- tiers: ['Auto', 'Simple', 'Moderate', 'Complex']
- catalog_models: ['grok-4.5']
- has_litellm_pins: False
- routing_source: client_fallback
- portal_ui_ok: True
- litellm_routing_ok: False

Fix bead: lp-uxy.19

Portal UI selector PASS (lp-uxy.8). LiteLLM routing FAIL (lp-uxy.12): settings.snapshot models=['grok-4.5'] — missing lanyard-auto/simple/moderate/complex pins so Portal stays on client_fallback (resolved models=['grok-4.5', 'grok-4.5', 'grok-4.5', 'grok-4.5']). LiteLLM proxy itself may still list pins; host catalog must advertise them.
