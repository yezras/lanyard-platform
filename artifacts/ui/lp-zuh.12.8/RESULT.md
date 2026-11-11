# lp-zuh.12.8 — MockLab SPA Not Found / hydration #418 UI QA

**When:** 2026-08-18T14:25:04.897579+00:00
**Base:** `https://app.withlanyard.com/mocklab`
**Login:** `agent-dev@mocklab.example.com`
**passed:** `True`
**skipped:** `False`

## Acceptance

- /mocklab/chat shell (not Not Found): `True`
- live pin promoted beyond `index-DzazbXcP.js`: `True`
- live js: `/assets/index-yB4LmRb5.js`

## Checks

- [x] api-login: {"email": "agent-dev@mocklab.example.com", "user_id_present": true, "cookie_names": ["lanyard_session", "lanyard_csrf"]}
- [x] live-pin-identity: {"js_path": "/assets/index-yB4LmRb5.js", "is_pre_fix_pin_DzazbXcP": false, "note": "630a91d7 / f162f4e7 rewrite fix requires new pack/promote beyond index-DzazbXcP.js", "pin": {"status": 200, "js_path": "/assets/index-yB4LmRb5.js", "html_le
- [x] mocklab-shell-not-not-found: {"url": "https://app.withlanyard.com/mocklab/chat", "shell_buttons": 3, "shell_nav": 7, "not_found": false, "hydration_418": false, "body_snip": "Skip to content\nLanyard Portal\nAgents\nVault\nTools\nA\nagent-dev@mocklab.example.com\nD
- [x] auth-me: {"status": 200, "email": "agent-dev@mocklab.example.com", "ct": "application/json"}
- [x] mocklab-route-vault: {"url": "https://app.withlanyard.com/mocklab/vault", "not_found": false, "body_snip": "Skip to content\nLanyard Portal\nAgents\nVault\nTools\nA\nagent-dev@mocklab.example.com\nSearch\nSelect a file"}
- [ ] mocklab-route-agents: {"url": "https://app.withlanyard.com/mocklab/agents", "not_found": true, "body_snip": "Not Found"}
- [x] root-chat-contrast: {"url": "https://app.withlanyard.com/chat", "password_inputs": 1, "not_found": false}

## Residuals

- (none)

## Screenshots

- `01-mocklab-chat-shell.png`
- `02-shell-evidence-overlay.png`
- `03-mocklab-vault.png`
- `04-mocklab-agents.png`
- `05-root-chat.png`

## Summary

PASS_MOCKLAB_SPA_SHELL: shell_ok=True not_found=False js=/assets/index-yB4LmRb5.js api_ok=True me_ok=True residuals=[] shots=5 passed=True

error: ``

## Promote (operator evidence, no secrets)

```text
portal.web.version=v0.1.6-mocklab-oo-zuh128-202608181423
portal.web.sha256=fdabe6fbbba86507aca7d9c46b76b94fcad7fa49d900f0e8e486abb14dca905b
live_js=/assets/index-yB4LmRb5.js
cloudfront_invalidation=I4HTYHYGSUL2S926VII3Q0BHVU
git_sha=630a91d7e37dd83b1ddaa24c5d800b4a0eb9d2e8
```

Code: `tenantUiLocationRewrite` in `portal/apps/web` (rewrite instead of basepath; Start hydrateStart clobber fix).
OO Vite bake retained from lp-zuh.12.1 recipe (`pack-web-mocklab-oo.sh`).

Note: `/mocklab/agents` path soft-check remains Not Found (Agents is shell chrome on `/chat`, not a dedicated route). Vault + Agents/Vault/Tools shell buttons verified on `/mocklab/chat`.
