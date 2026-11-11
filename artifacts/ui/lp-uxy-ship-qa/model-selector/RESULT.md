# lp-uxy.15.9 — model intelligence Auto/Simple/Moderate/Complex ship QA

**Shipped features:** lp-uxy.8 + lp-uxy.12
**Base URL:** `http://demo.localhost:3010`
**Login:** `dev@demo.local`
**When:** 2026-08-05T14:37:38.918489+00:00
**Verdict:** **PASS_UI_FAIL_LITELLM_CATALOG**

## Acceptance mapping

- [x] login: logged in as dev@demo.local
- [x] brain-rpc-context: status=200 brain_rpc_enabled=True kind=lanyard_agent model_selector=unsupported
- [x] settings-snapshot-models: status=200 count=1 ids=['grok-4.5'] active={'provider': 'litellm', 'model': 'grok-4.5', 'is_active': True, 'connected': True}
- [ ] catalog-has-litellm-intelligence-pins: expected=['lanyard-auto', 'lanyard-simple', 'lanyard-moderate', 'lanyard-complex'] catalog=['grok-4.5'] has_auto=False
- [x] composer-selector-visible: data-testid=model-intelligence-selector visible=True selection=auto model=grok-4.5
- [x] tier-menu-four-options: menu_labels=['Auto', 'Simple', 'Moderate', 'Complex'] expected=['Auto', 'Simple', 'Moderate', 'Complex']
- [x] select-tier-auto: selection=auto model='grok-4.5' label='Auto' litellm_match=False
- [ ] tier-auto-maps-to-litellm-pin: model='grok-4.5' expected='lanyard-auto'
- [x] select-tier-simple: selection=simple model='grok-4.5' label='Simple' litellm_match=False
- [ ] tier-simple-maps-to-litellm-pin: model='grok-4.5' expected='lanyard-simple'
- [x] select-tier-moderate: selection=moderate model='grok-4.5' label='Moderate' litellm_match=False
- [ ] tier-moderate-maps-to-litellm-pin: model='grok-4.5' expected='lanyard-moderate'
- [x] select-tier-complex: selection=complex model='grok-4.5' label='Complex' litellm_match=False
- [ ] tier-complex-maps-to-litellm-pin: model='grok-4.5' expected='lanyard-complex'
- [ ] routing-source-litellm-not-client-only: routing_source=client_fallback catalog_pins=False resolutions={'auto': 'grok-4.5', 'simple': 'grok-4.5', 'moderate': 'grok-4.5', 'complex': 'grok-4.5'}
- [x] send-simple-set-active: selection=simple model=grok-4.5 patch_calls=0 litellm_in_patch=False calls=[]
- [x] settings-models-lists-intelligence-pins: litellm_ids_listed=[] body_has_models_section=True

## Catalog / routing

- settings.snapshot models: `['grok-4.5']`
- has LiteLLM intelligence pins: `False`
- routing_source (inferred): `client_fallback`
- tier → data-model: `{"auto": {"effective_tier": "auto", "expected_litellm_model": "lanyard-auto", "label": "Auto", "matches_litellm_pin": false, "model": "grok-4.5", "selection": "auto", "title": "Auto routing \u2192 grok-4.5"}, "complex": {"effective_tier": "complex", "expected_litellm_model": "lanyard-complex", "label": "Complex", "matches_litellm_pin": false, "model": "grok-4.5", "selection": "complex", "title": "Complex \u2192 grok-4.5"}, "moderate": {"effective_tier": "moderate", "expected_litellm_model": "lanyard-moderate", "label": "Moderate", "matches_litellm_pin": false, "model": "grok-4.5", "selection": "moderate", "title": "Moderate \u2192 grok-4.5"}, "simple": {"effective_tier": "simple", "expected_litellm_model": "lanyard-simple", "label": "Simple", "matches_litellm_pin": false, "model": "grok-4.5", "selection": "simple", "title": "Simple \u2192 grok-4.5"}}`

## Screenshots

- `01-post-login.png`
- `02-composer-model-selector.png`
- `03-tier-menu-open.png`
- `04-tier-auto.png`
- `05-tier-simple.png`
- `06-tier-moderate.png`
- `07-tier-complex.png`
- `08-after-send-simple.png`
- `09-settings-models.png`

## Fix bead

Filed: **lp-uxy.19**

See `REPORT.json` for machine-readable results.
