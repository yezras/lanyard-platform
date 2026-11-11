# lp-uxy.15.9 — pass/fail

**Result: PASS**

- Base: `http://demo.localhost:3010`
- Shipped: lp-uxy.8 + lp-uxy.12
- Login: `dev@demo.local`
- selector_visible: True
- tiers: ['Auto', 'Simple', 'Moderate', 'Complex']
- catalog_models: ['grok-4.5', 'lanyard-simple', 'lanyard-moderate', 'lanyard-complex', 'lanyard-reasoning', 'lanyard-auto']
- has_litellm_pins: True
- routing_source: litellm
- portal_ui_ok: True
- litellm_routing_ok: True

No fix bead.

Composer intelligence selector shows Auto/Simple/Moderate/Complex and resolves to LiteLLM lanyard-* pins (not client-only heuristic).
