#!/usr/bin/env python3
"""Offline OAuthStore provider → LiteLLM model mapping (lp-645.8.5).

Mirrors the platform contract for Lanyard Agent + LiteLLM without live keys,
network, or encryption. Product runtime mapping lives in external lanyard-agent
(packages/providers OAuthStore + request-time clientside auth). This tool is
the monorepo smoke/docs surface for the same table.

Usage:
  python3 deploy/scripts/map-oauth-to-litellm.py --self-test
  python3 deploy/scripts/map-oauth-to-litellm.py --from-envelope PATH
  python3 deploy/scripts/map-oauth-to-litellm.py --providers xai-grok,openai-codex
  python3 deploy/scripts/map-oauth-to-litellm.py --list-table

Never logs token values. Placeholders are allowed and expected in fixtures.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Normative mapping (Agent OAuthStore provider id → LiteLLM model_list slots)
# Keep in sync with deploy/litellm/config.yaml model_info.lanyard_oauth_provider
# ---------------------------------------------------------------------------

OAUTH_PROVIDER_MAP: dict[str, dict[str, Any]] = {
    "xai-grok": {
        "litellm_model_names": [
            "xai/grok-3-oauth",
            "xai/grok-build-oauth",
        ],
        "upstream_models": {
            "xai/grok-3-oauth": "xai/grok-3",
            "xai/grok-build-oauth": "xai/grok-build-0.1",
        },
        "configurable_clientside_auth_params": ["api_key", "api_base"],
        "default_api_base": "https://api.x.ai/v1",
        "token_field": "access_token",
        "store_path": "oauth.enc",
        "env_decrypt_key": "LANYARD_OAUTH_KEY",
        "hermes_peer_provider": "xai-oauth",
        "description": (
            "xAI Super Heavy / SuperGrok OAuth. Agent injects access_token as "
            "clientside api_key for *-oauth model names."
        ),
    },
    "openai-codex": {
        "litellm_model_names": [
            "openai/codex-oauth",
        ],
        "upstream_models": {
            "openai/codex-oauth": "openai/gpt-4.1",
        },
        "configurable_clientside_auth_params": ["api_key", "api_base"],
        "default_api_base": "https://api.openai.com/v1",
        "token_field": "access_token",
        "store_path": "oauth.enc",
        "env_decrypt_key": "LANYARD_OAUTH_KEY",
        "metadata_headers": {
            "chatgpt_account_id": "ChatGPT-Account-Id",
        },
        "hermes_peer_provider": "openai-codex",
        "description": (
            "OpenAI Codex device-code OAuth. Optional metadata.chatgpt_account_id "
            "becomes ChatGPT-Account-Id on upstream calls."
        ),
    },
}

# Env keys expected for full multi-slot agent + LiteLLM (placeholders in git)
FULL_ENV_SLOT_KEYS: tuple[str, ...] = (
    "OPENAI_API_KEY",
    "XAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "LITELLM_MASTER_KEY",
    "LANYARD_OAUTH_KEY",
    "META_API_KEY",
    "CORP_LLM_API_KEY",
    "OPENROUTER_API_KEY",
    "GATEWAY_RELAY_SECRET",
)

# model_list names that must appear in deploy/litellm/config.yaml
REQUIRED_MODEL_SLOTS: tuple[str, ...] = (
    "openai/*",
    "xai/*",
    "anthropic/*",
    "xai/grok-3-oauth",
    "xai/grok-build-oauth",
    "openai/codex-oauth",
    "meta/llama-3.1-405b",
    "corp/proxy-default",
)

CUSTOM_PROVIDER_TO_MODELS: dict[str, list[str]] = {
    "meta": ["meta/llama-3.1-405b", "meta/llama-3.1-70b"],
    "corp-proxy": ["corp/proxy-default"],
}


def map_provider(provider_id: str) -> dict[str, Any]:
    """Return mapping record for one OAuthStore provider id."""
    if provider_id not in OAUTH_PROVIDER_MAP:
        raise KeyError(
            f"unknown OAuth provider id {provider_id!r}; "
            f"known: {sorted(OAUTH_PROVIDER_MAP)}"
        )
    base = dict(OAUTH_PROVIDER_MAP[provider_id])
    base["provider_id"] = provider_id
    return base


def map_providers(provider_ids: list[str]) -> list[dict[str, Any]]:
    return [map_provider(p) for p in provider_ids]


def clientside_auth_shape(
    provider_id: str,
    *,
    access_token_present: bool,
    api_base: str | None = None,
    chatgpt_account_id: str | None = None,
) -> dict[str, Any]:
    """Describe what Agent would send clientside for a *-oauth completion.

    Does **not** include token values — only presence flags and param names.
    """
    rec = map_provider(provider_id)
    params: dict[str, Any] = {
        "provider_id": provider_id,
        "litellm_model_names": list(rec["litellm_model_names"]),
        "configurable_clientside_auth_params": list(
            rec["configurable_clientside_auth_params"]
        ),
        "api_key_source": (
            "oauth.enc access_token" if access_token_present else "missing"
        ),
        "api_key_present": bool(access_token_present),
        "api_base": api_base or rec["default_api_base"],
        "api_base_source": (
            "clientside_override" if api_base else "default_api_base"
        ),
    }
    meta_headers = rec.get("metadata_headers") or {}
    if "chatgpt_account_id" in meta_headers:
        params["extra_headers"] = {
            meta_headers["chatgpt_account_id"]: (
                "present" if chatgpt_account_id else "absent"
            )
        }
    return params


def map_envelope_oauth(envelope: dict[str, Any]) -> dict[str, Any]:
    """Map structured envelope.oauth to LiteLLM clientside shapes (no secrets)."""
    oauth = envelope.get("oauth") or {}
    if not isinstance(oauth, dict):
        raise ValueError("envelope.oauth must be an object when present")

    mapped: list[dict[str, Any]] = []
    unknown: list[str] = []
    for provider_id, material in sorted(oauth.items()):
        if provider_id not in OAUTH_PROVIDER_MAP:
            # Hermes-only ids (e.g. xai-oauth) are not Agent OAuthStore ids
            unknown.append(provider_id)
            continue
        if not isinstance(material, dict):
            raise ValueError(f"oauth[{provider_id!r}] must be an object")
        token = material.get("access_token")
        meta = material.get("metadata") if isinstance(material.get("metadata"), dict) else {}
        mapped.append(
            clientside_auth_shape(
                provider_id,
                access_token_present=isinstance(token, str) and bool(token),
                chatgpt_account_id=(
                    meta.get("chatgpt_account_id")
                    if isinstance(meta.get("chatgpt_account_id"), str)
                    else None
                ),
            )
        )

    files = envelope.get("files") or []
    has_oauth_enc = False
    if isinstance(files, list):
        for f in files:
            if isinstance(f, dict) and f.get("path_relative") == "oauth.enc":
                has_oauth_enc = True
                break

    env = envelope.get("env") if isinstance(envelope.get("env"), dict) else {}
    return {
        "kind_hint": envelope.get("kind_hint"),
        "oauth_enc_via_files": has_oauth_enc,
        "lanyard_oauth_key_in_env": "LANYARD_OAUTH_KEY" in env,
        "litellm_master_key_in_env": "LITELLM_MASTER_KEY" in env,
        "mapped_providers": mapped,
        "skipped_non_agent_providers": unknown,
        "custom_providers": _map_custom_providers(envelope),
        "env_keys_present": sorted(str(k) for k in env.keys()),
    }


def _map_custom_providers(envelope: dict[str, Any]) -> list[dict[str, Any]]:
    cps = envelope.get("custom_providers") or []
    out: list[dict[str, Any]] = []
    if not isinstance(cps, list):
        return out
    for entry in cps:
        if not isinstance(entry, dict):
            continue
        pid = entry.get("id") or entry.get("name")
        if not isinstance(pid, str):
            continue
        key_env = (
            entry.get("api_key_env")
            or entry.get("key_env")
            or entry.get("api_key_env_name")
        )
        models = CUSTOM_PROVIDER_TO_MODELS.get(
            pid,
            [f"{pid}/default"],
        )
        out.append(
            {
                "id": pid,
                "base_url": entry.get("base_url"),
                "api_key_env": key_env,
                "litellm_model_names": models,
                "litellm_params_shape": {
                    "api_base": entry.get("base_url"),
                    "api_key": f"os.environ/{key_env}" if key_env else None,
                },
            }
        )
    return out


def render_table() -> str:
    lines = [
        "provider_id\tlitellm_models\tclientside_params\tstore\tdecrypt_env",
    ]
    for pid, rec in sorted(OAUTH_PROVIDER_MAP.items()):
        lines.append(
            "\t".join(
                [
                    pid,
                    ",".join(rec["litellm_model_names"]),
                    ",".join(rec["configurable_clientside_auth_params"]),
                    rec["store_path"],
                    rec["env_decrypt_key"],
                ]
            )
        )
    return "\n".join(lines) + "\n"


def run_self_test() -> int:
    errors: list[str] = []

    # All known providers map cleanly
    for pid in OAUTH_PROVIDER_MAP:
        try:
            rec = map_provider(pid)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"map_provider({pid}): {exc}")
            continue
        if not rec["litellm_model_names"]:
            errors.append(f"{pid}: empty litellm_model_names")
        params = rec["configurable_clientside_auth_params"]
        if "api_key" not in params:
            errors.append(f"{pid}: clientside params must include api_key")

    # clientside shape never embeds raw tokens
    shape = clientside_auth_shape(
        "xai-grok",
        access_token_present=True,
        api_base="https://api.x.ai/v1",
    )
    blob = json.dumps(shape)
    for forbidden in ("oauth-placeholder", "sk-", "Bearer ", "eyJ"):
        if forbidden in blob:
            errors.append(f"clientside shape leaked pattern {forbidden!r}")

    # envelope fixture style
    sample = {
        "schema_version": 1,
        "kind_hint": "lanyard_agent",
        "env": {
            "LITELLM_MASTER_KEY": "sk-placeholder-litellm-master",
            "LANYARD_OAUTH_KEY": "REPLACE_ME_oauth_encryption_key_32B_min",
            "META_API_KEY": "sk-placeholder-meta-replace-me",
        },
        "oauth": {
            "xai-grok": {
                "access_token": "oauth-placeholder-xai-grok-access",
                "refresh_token": "oauth-placeholder-xai-grok-refresh",
            },
            "openai-codex": {
                "access_token": "oauth-placeholder-openai-codex-access",
                "metadata": {"chatgpt_account_id": "REPLACE_ME_chatgpt_account_id"},
            },
            "xai-oauth": {
                "access_token": "oauth-placeholder-hermes-only",
            },
        },
        "custom_providers": [
            {
                "id": "meta",
                "base_url": "https://api.llama.com/compat/v1",
                "api_key_env": "META_API_KEY",
            }
        ],
        "files": [
            {
                "path_relative": "oauth.enc",
                "encoding": "base64",
                "content_base64": "REPLACE_ME_base64_oauth_enc_blob",
            }
        ],
    }
    result = map_envelope_oauth(sample)
    ids = {m["provider_id"] for m in result["mapped_providers"]}
    if ids != {"xai-grok", "openai-codex"}:
        errors.append(f"expected agent providers mapped, got {ids}")
    if "xai-oauth" not in result["skipped_non_agent_providers"]:
        errors.append("hermes xai-oauth should be skipped for agent map")
    if not result["oauth_enc_via_files"]:
        errors.append("oauth.enc files[] not detected")
    if not result["lanyard_oauth_key_in_env"] or not result["litellm_master_key_in_env"]:
        errors.append("required env keys not detected")
    cps = result["custom_providers"]
    if not any(c.get("id") == "meta" for c in cps):
        errors.append("meta custom provider not mapped")
    # no secret values in JSON dump
    dumped = json.dumps(result)
    for needle in (
        "oauth-placeholder-xai-grok-access",
        "oauth-placeholder-openai-codex-access",
        "sk-placeholder-litellm-master",
        "REPLACE_ME_oauth_encryption_key_32B_min",
        "REPLACE_ME_base64_oauth_enc_blob",
        "oauth-placeholder-hermes-only",
    ):
        if needle in dumped:
            errors.append(f"map_envelope_oauth leaked {needle[:24]!r}…")

    # unknown provider fails closed
    try:
        map_provider("not-a-real-provider")
        errors.append("unknown provider should raise KeyError")
    except KeyError:
        pass

    if errors:
        for e in errors:
            print(f"FAIL  {e}", file=sys.stderr)
        print(f"self-test: {len(errors)} failure(s)", file=sys.stderr)
        return 1
    print("OK  map-oauth-to-litellm self-test passed")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Map Agent OAuthStore provider ids to LiteLLM model_list slots "
            "(offline; no live keys)."
        )
    )
    p.add_argument(
        "--self-test",
        action="store_true",
        help="Run offline unit assertions and exit",
    )
    p.add_argument(
        "--list-table",
        action="store_true",
        help="Print provider → model_name table (TSV)",
    )
    p.add_argument(
        "--providers",
        metavar="IDS",
        help="Comma-separated OAuthStore provider ids to map",
    )
    p.add_argument(
        "--from-envelope",
        type=Path,
        metavar="PATH",
        help="Map structured oauth + custom_providers from envelope JSON",
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="Emit JSON (default for --from-envelope / --providers)",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.self_test:
        return run_self_test()

    if args.list_table:
        sys.stdout.write(render_table())
        return 0

    if args.from_envelope is not None:
        raw = args.from_envelope.read_text(encoding="utf-8")
        envelope = json.loads(raw)
        if not isinstance(envelope, dict):
            print("envelope root must be object", file=sys.stderr)
            return 2
        result = map_envelope_oauth(envelope)
        json.dump(result, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
        return 0

    if args.providers:
        ids = [p.strip() for p in args.providers.split(",") if p.strip()]
        try:
            mapped = map_providers(ids)
        except KeyError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        # Strip nothing secret — table has no secrets
        if args.json or True:
            json.dump(mapped, sys.stdout, indent=2, sort_keys=True)
            sys.stdout.write("\n")
        return 0

    build_parser().print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
