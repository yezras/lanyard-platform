# lp-p37.11 — Hermes plugin import, image fetch, env perms, tirith install

**Status:** implemented in hermes-lanyard (external runtime)  
**Bead:** `lp-p37.11` (parent epic `lp-p37`)  
**Priority:** P1 security (July 2026 audit)

## Problem

Hermes had four follow-up supply-chain / SSRF / secret-hygiene gaps:

1. **Model-provider plugins** under `$HERMES_HOME/plugins/model-providers/**` were auto-imported on discovery without the `plugins.enabled` allow-list used by the general plugin manager. A prompt-injected agent write into that tree could become importable code on the next provider lookup.
2. **Image URL caching** (`save_url_image`) used raw `requests.get` on provider-returned URLs with no SSRF validation, redirect policy, Content-Length gate, or magic-byte check.
3. **`.env` updates** preserved whatever mode the existing file had — including world-writable `0o666` — when rewriting secrets.
4. **tirith auto-install** fetched GitHub `latest` with cosign optional (SHA-256-only fallback when cosign was missing).

## Fix (hermes-lanyard)

Implementation lives in **LanyardBrain/hermes-lanyard** (backend runtime is external to this monorepo by design):

| Item | Value |
|------|--------|
| Branch | `beads/lp-p37.11-p1-security-harden-hermes-plugin-import` |
| Commit | `30f3a9915e03d696d5e8f703f0031e0246600c44` |
| PR | https://github.com/LanyardBrain/hermes-lanyard/pull/24 |

### Policy

| Surface | Policy |
|---------|--------|
| User model-provider plugins | Require `plugins.enabled` (path key `model-providers/<name>`, bare name, or manifest name). Honor `plugins.disabled`. Bundled plugins still always load. |
| Agent writes to `HERMES_HOME/plugins/**` | Hard-denied via `is_write_denied`. Opt-in: `HERMES_ALLOW_PLUGIN_WRITES=1`. Install plugins via Hermes CLI / operator, not the agent. |
| `save_url_image` | http(s) only; `is_safe_url` pre-flight; no redirects; Content-Length + stream byte cap; image magic bytes required. Blocks private / loopback / link-local / metadata. |
| `.env` chmod after secret write | Outside managed/container modes, clamp to safe max `0o640` (owner rw, optional group r). Documented `0o600` / `0o640` modes preserved; world and group-write stripped. |
| tirith auto-install | **Opt-in** (`security.tirith_auto_install` / `TIRITH_AUTO_INSTALL`). Cosign **required by default** when auto-install is on. Optional pin via `security.tirith_version` / `TIRITH_VERSION`. |

### Key code

- `providers/__init__.py` — `_user_model_provider_allowed()`
- `agent/file_safety.py` — plugins tree in `is_write_denied`
- `agent/image_gen_provider.py` — hardened `save_url_image`
- `hermes_cli/config.py` — `_clamp_env_file_mode`, default tirith keys
- `tools/tirith_security.py` — auto-install gate + cosign + pin
- `website/docs/user-guide/security.md`, `configuration.md`

### Verification

```text
pytest tests/providers/test_plugin_discovery.py \
       tests/agent/test_file_safety_plugins_write.py \
       tests/agent/test_save_url_image.py \
       tests/hermes_cli/test_env_mode_clamp.py \
       tests/tools/test_tirith_auto_install_policy.py \
       tests/tools/test_tirith_security.py \
       tests/tools/test_file_write_safety.py -q
# 162 passed
```

## Platform follow-ups

- Pin / ship a hermes-lanyard runtime artifact that includes commit `30f3a9915` (or later) before declaring staging/production remediated.
- Operators who relied on silent tirith auto-install must either install tirith on PATH or set `security.tirith_auto_install: true` (and preferably pin `tirith_version` + keep cosign).
- Operators who drop custom model-provider plugins under `HERMES_HOME` must `hermes plugins enable model-providers/<name>` (or list the name under `plugins.enabled`).
