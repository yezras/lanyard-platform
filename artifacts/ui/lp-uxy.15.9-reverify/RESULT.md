# lp-uxy.15.9 — model intelligence Auto/Simple/Moderate/Complex ship QA

**Shipped features:** lp-uxy.8 + lp-uxy.12
**Base URL:** `http://demo.localhost:3010`
**Login:** `dev@demo.local`
**When:** 2026-08-05T19:51:44.461155+00:00
**Verdict:** **PASS**

## Acceptance mapping

- [x] login: logged in as dev@demo.local
- [x] brain-rpc-context: status=200 brain_rpc_enabled=True kind=lanyard_agent model_selector=unsupported
- [x] settings-snapshot-models: status=200 count=6 ids=['grok-4.5', 'lanyard-simple', 'lanyard-moderate', 'lanyard-complex', 'lanyard-reasoning', 'lanyard-auto'] active={'provider': 'litellm', 'model': 'grok-4.5', 'is_active': True, 'connected': True}
- [x] catalog-has-litellm-intelligence-pins: expected=['lanyard-auto', 'lanyard-simple', 'lanyard-moderate', 'lanyard-complex'] catalog=['grok-4.5', 'lanyard-simple', 'lanyard-moderate', 'lanyard-complex', 'lanyard-reasoning', 'lanyard-auto'] has_auto=True
- [x] composer-selector-visible: data-testid=model-intelligence-selector visible=True selection=auto model=lanyard-auto
- [x] tier-menu-four-options: menu_labels=['Auto', 'Simple', 'Moderate', 'Complex'] expected=['Auto', 'Simple', 'Moderate', 'Complex']
- [x] select-tier-auto: selection=auto model='lanyard-auto' label='Auto' litellm_match=True
- [x] tier-auto-maps-to-litellm-pin: model='lanyard-auto' expected='lanyard-auto'
- [x] select-tier-simple: selection=simple model='lanyard-simple' label='Simple' litellm_match=True
- [x] tier-simple-maps-to-litellm-pin: model='lanyard-simple' expected='lanyard-simple'
- [x] select-tier-moderate: selection=moderate model='lanyard-moderate' label='Moderate' litellm_match=True
- [x] tier-moderate-maps-to-litellm-pin: model='lanyard-moderate' expected='lanyard-moderate'
- [x] select-tier-complex: selection=complex model='lanyard-complex' label='Complex' litellm_match=True
- [x] tier-complex-maps-to-litellm-pin: model='lanyard-complex' expected='lanyard-complex'
- [x] routing-source-litellm-not-client-only: routing_source=litellm catalog_pins=True resolutions={'auto': 'lanyard-auto', 'simple': 'lanyard-simple', 'moderate': 'lanyard-moderate', 'complex': 'lanyard-complex'}
- [x] send-simple-set-active: selection=simple model=lanyard-simple patch_calls=1 litellm_in_patch=True calls=[{'method': 'PATCH', 'url': 'http://demo.localhost:3010/api/settings/models/active', 'post': '{"provider":"litellm","model":"lanyard-simple"}'}]
- [x] settings-models-lists-intelligence-pins: litellm_ids_listed=['lanyard-auto', 'lanyard-simple', 'lanyard-moderate', 'lanyard-complex'] body_has_models_section=True

## Catalog / routing

- settings.snapshot models: `['grok-4.5', 'lanyard-simple', 'lanyard-moderate', 'lanyard-complex', 'lanyard-reasoning', 'lanyard-auto']`
- has LiteLLM intelligence pins: `True`
- routing_source (inferred): `litellm`
- tier → data-model: `{"auto": {"effective_tier": "auto", "expected_litellm_model": "lanyard-auto", "label": "Auto", "matches_litellm_pin": true, "model": "lanyard-auto", "selection": "auto", "title": "Auto routing \u2192 lanyard-auto"}, "complex": {"effective_tier": "complex", "expected_litellm_model": "lanyard-complex", "label": "Complex", "matches_litellm_pin": true, "model": "lanyard-complex", "selection": "complex", "title": "Complex \u2192 lanyard-complex"}, "moderate": {"effective_tier": "moderate", "expected_litellm_model": "lanyard-moderate", "label": "Moderate", "matches_litellm_pin": true, "model": "lanyard-moderate", "selection": "moderate", "title": "Moderate \u2192 lanyard-moderate"}, "simple": {"effective_tier": "simple", "expected_litellm_model": "lanyard-simple", "label": "Simple", "matches_litellm_pin": true, "model": "lanyard-simple", "selection": "simple", "title": "Simple \u2192 lanyard-simple"}}`

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

None (all checks green).

See `REPORT.json` for machine-readable results.
