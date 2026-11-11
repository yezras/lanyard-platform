#!/usr/bin/env python3
"""Offline validation for backend capability descriptors (backend-runtime-v1).

Validates:
  - contracts/backend-runtime-v1/capabilities.schema.json is loadable
  - discovery path is selected (brain_rpc) with rationale extensions
  - feature catalog maps to UI affordances
  - unsupported error states are documented
  - example descriptors under examples/capabilities.*.json conform
  - brain.capabilities request/result frame examples exist and look valid
  - negative fixtures are rejected

Uses jsonschema when installed; otherwise a stdlib subset checker.
No network calls.

Usage (from repository root):
  python3 scripts/validate-backend-capabilities.py
  python3 scripts/validate-backend-capabilities.py --root /path/to/repo

Exit 0 on success; non-zero on failure.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from pathlib import Path
from typing import Any

METHOD_RE = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")
NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")
KINDS = frozenset({"hermes_upstream", "hermes_lanyard", "lanyard_agent"})
SOURCES = frozenset({"brain_rpc", "artifact_manifest", "combined"})
AFFORDANCE_STATES = frozenset({"supported", "unsupported", "degraded"})

REQUIRED_DESCRIPTOR_TOP = ("schema_version", "brain_rpc_methods", "features")
REQUIRED_V1_METHODS = (
    "brain.ping",
    "brain.health",
    "vault.list",
    "vault.stat",
    "vault.read",
    "settings.snapshot",
    "projects.list",
)
CATALOG_FEATURES = (
    "chat",
    "health",
    "capabilities_discovery",
    "vault_read",
    "vault_write",
    "settings_snapshot",
    "settings_patch",
    "projects_list",
    "projects_create",
    "models",
    "cron",
    "history_read",
    "heads_read",
)
CATALOG_AFFORDANCES = (
    "chat_panel",
    "vault_browser",
    "vault_editor",
    "settings_page",
    "settings_editor",
    "project_picker",
    "project_create",
    "model_selector",
    "cron_manager",
    "host_health",
)
EXAMPLE_DESCRIPTORS = (
    "capabilities.hermes-lanyard.json",
    "capabilities.lanyard-agent.json",
    # lp-uxy.3 aspirational pin when dedicated cron.list/cron.patch are real
    "capabilities.lanyard-agent.cron.json",
    "capabilities.manifest-fallback.json",
)


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def has_jsonschema() -> bool:
    try:
        import jsonschema  # noqa: F401

        return True
    except ImportError:
        return False


def validate_descriptor_jsonschema(
    schema: dict[str, Any], instance: Any
) -> list[str]:
    from jsonschema import Draft202012Validator

    root = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$defs": schema.get("$defs", {}),
        "allOf": [{"$ref": "#/$defs/capabilityDescriptor"}],
    }
    v = Draft202012Validator(root)
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '$'}: {e.message}"
        for e in v.iter_errors(instance)
    ]


def stdlib_validate_descriptor(instance: Any, path: str = "$") -> list[str]:
    errors: list[str] = []

    def err(msg: str) -> None:
        errors.append(f"{path}: {msg}")

    if not isinstance(instance, dict):
        err(f"must be object, got {type(instance).__name__}")
        return errors

    for key in REQUIRED_DESCRIPTOR_TOP:
        if key not in instance:
            err(f"missing required property '{key}'")

    if instance.get("schema_version") != 1:
        err("schema_version must be 1")

    source = instance.get("source")
    if source is not None and source not in SOURCES:
        err(f"source must be one of {sorted(SOURCES)}, got {source!r}")

    kind = instance.get("kind")
    if kind is not None and kind not in KINDS:
        err(f"kind must be one of {sorted(KINDS)}, got {kind!r}")

    methods = instance.get("brain_rpc_methods")
    if methods is not None:
        if not isinstance(methods, list) or len(methods) < 1:
            err("brain_rpc_methods must be a non-empty array")
        else:
            seen: set[str] = set()
            for i, m in enumerate(methods):
                if not isinstance(m, str) or not METHOD_RE.match(m):
                    err(f"brain_rpc_methods[{i}] invalid method name {m!r}")
                elif m in seen:
                    err(f"brain_rpc_methods[{i}] duplicate {m!r}")
                else:
                    seen.add(m)

    features = instance.get("features")
    if features is not None:
        if not isinstance(features, dict):
            err("features must be object")
        else:
            for k, v in features.items():
                if not isinstance(k, str) or not NAME_RE.match(k):
                    err(f"features key invalid: {k!r}")
                if not isinstance(v, bool):
                    err(f"features.{k} must be boolean")

    profiles = instance.get("profiles")
    if profiles is not None:
        if not isinstance(profiles, list) or len(profiles) < 1:
            err("profiles must be a non-empty array when present")
        else:
            for i, p in enumerate(profiles):
                if not isinstance(p, str) or not NAME_RE.match(p):
                    err(f"profiles[{i}] invalid {p!r}")

    ui = instance.get("ui_affordances")
    if ui is not None:
        if not isinstance(ui, dict):
            err("ui_affordances must be object")
        else:
            for k, v in ui.items():
                if not isinstance(k, str) or not NAME_RE.match(k):
                    err(f"ui_affordances key invalid: {k!r}")
                if v not in AFFORDANCE_STATES:
                    err(f"ui_affordances.{k} invalid state {v!r}")

    contract = instance.get("contract")
    if contract is not None:
        if not isinstance(contract, dict):
            err("contract must be object")
        else:
            for key in ("runtime_layout", "relay", "brain_rpc"):
                if key not in contract:
                    err(f"contract missing '{key}'")
                elif not isinstance(contract[key], int) or contract[key] < 1:
                    err(f"contract.{key} must be integer >= 1")

    return errors


def validate_descriptor(
    schema: dict[str, Any], instance: Any, prefer_jsonschema: bool
) -> list[str]:
    if prefer_jsonschema and has_jsonschema():
        try:
            return validate_descriptor_jsonschema(schema, instance)
        except Exception:  # noqa: BLE001
            return stdlib_validate_descriptor(instance)
    return stdlib_validate_descriptor(instance)


def derive_affordance(
    name: str,
    features: dict[str, bool],
    methods: set[str],
    catalog: dict[str, Any],
) -> str:
    entry = catalog.get(name) or {}
    for f in entry.get("requires_features_all_of") or []:
        if not features.get(f, False):
            return "unsupported"
    for m in entry.get("requires_methods_all_of") or []:
        if m not in methods:
            return "unsupported"
    any_of = entry.get("requires_methods_any_of") or []
    if any_of and not any(m in methods for m in any_of):
        return "unsupported"
    return "supported"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="Repository root (default: parent of scripts/)",
    )
    args = parser.parse_args()

    if args.root is not None:
        root = args.root.resolve()
    else:
        root = Path(__file__).resolve().parent.parent

    contract_dir = root / "contracts" / "backend-runtime-v1"
    schema_path = contract_dir / "capabilities.schema.json"
    examples_dir = contract_dir / "examples"

    failed = 0
    passed = 0

    def pass_(msg: str) -> None:
        nonlocal passed
        passed += 1
        print(f"  PASS  {msg}")

    def fail(msg: str) -> None:
        nonlocal failed
        failed += 1
        print(f"  FAIL  {msg}")

    print("==> Backend capability descriptor validation (offline)")
    print(f"    root: {root}")
    print()

    if not schema_path.is_file():
        fail(f"missing schema: {schema_path.relative_to(root)}")
        print()
        print(f"FAILED  {failed} failure(s), {passed} pass(es).")
        return 1

    try:
        schema = load_json(schema_path)
    except (OSError, json.JSONDecodeError) as e:
        fail(f"schema not loadable: {e}")
        print()
        print(f"FAILED  {failed} failure(s), {passed} pass(es).")
        return 1

    # --- schema structural requirements ---
    defs = schema.get("$defs") or {}
    if "capabilityDescriptor" not in defs:
        fail("schema $defs.capabilityDescriptor missing")
    else:
        pass_("$defs.capabilityDescriptor present")

    for name in (
        "params_brain_capabilities",
        "result_brain_capabilities",
        "featureFlags",
        "uiAffordances",
    ):
        if name not in defs:
            fail(f"schema $defs.{name} missing")
        else:
            pass_(f"$defs.{name} present")

    discovery = schema.get("x-lanyard-discovery") or {}
    if discovery.get("selected_path") != "brain_rpc":
        fail(
            "x-lanyard-discovery.selected_path must be 'brain_rpc' "
            f"(got {discovery.get('selected_path')!r})"
        )
    else:
        pass_("discovery path selected: brain_rpc")

    if discovery.get("method") != "brain.capabilities":
        fail(
            "x-lanyard-discovery.method must be 'brain.capabilities' "
            f"(got {discovery.get('method')!r})"
        )
    else:
        pass_("discovery method: brain.capabilities")

    if not discovery.get("rationale"):
        fail("x-lanyard-discovery.rationale must be non-empty")
    else:
        pass_(f"discovery rationale has {len(discovery['rationale'])} point(s)")

    rejected = discovery.get("rejected_path") or {}
    if rejected.get("name") != "relay_hello":
        fail("x-lanyard-discovery.rejected_path.name must be relay_hello")
    else:
        pass_("relay hello explicitly rejected for backend ops capabilities")

    feature_cat = (schema.get("x-lanyard-feature-catalog") or {}).get("features") or {}
    missing_features = [f for f in CATALOG_FEATURES if f not in feature_cat]
    if missing_features:
        fail(f"feature catalog missing: {missing_features}")
    else:
        pass_(f"feature catalog has {len(CATALOG_FEATURES)} v1 features")

    ui_cat = (schema.get("x-lanyard-ui-affordance-catalog") or {}).get(
        "affordances"
    ) or {}
    missing_ui = [a for a in CATALOG_AFFORDANCES if a not in ui_cat]
    if missing_ui:
        fail(f"UI affordance catalog missing: {missing_ui}")
    else:
        pass_(f"UI affordance catalog has {len(CATALOG_AFFORDANCES)} surfaces")

    # Every feature that lists ui_affordances must map to catalog entries
    mapped_ok = True
    for fname, fentry in feature_cat.items():
        for aff in fentry.get("ui_affordances") or []:
            if aff not in ui_cat:
                mapped_ok = False
                fail(f"feature {fname} maps to unknown UI affordance {aff!r}")
    if mapped_ok:
        pass_("feature → UI affordance mappings resolve in catalog")

    unsup = schema.get("x-lanyard-unsupported-error-states") or {}
    layers = unsup.get("layers") or {}
    for layer in ("portal_ui", "portal_bff_guard", "brain_rpc_host"):
        if layer not in layers:
            fail(f"unsupported error states missing layer '{layer}'")
        else:
            pass_(f"unsupported error state layer: {layer}")

    host_layer = layers.get("brain_rpc_host") or {}
    impl = host_layer.get("unimplemented_method") or {}
    # Schema uses dotted JSON keys like "error.code" for documentation.
    impl_code = impl.get("error.code")
    if isinstance(impl.get("error"), dict):
        impl_code = impl_code or impl["error"].get("code")
    if impl_code != "method_not_found":
        fail(
            "brain_rpc_host.unimplemented_method must document "
            "error.code method_not_found"
        )
    else:
        pass_("unimplemented method → method_not_found")

    blob = json.dumps(unsup)
    if "method_not_found" not in blob:
        fail("unsupported error states must mention method_not_found")
    elif "forbidden" not in blob:
        fail("unsupported error states must distinguish forbidden")
    else:
        pass_("error matrix documents method_not_found vs forbidden")

    separation = schema.get("x-lanyard-separation") or {}
    for key in (
        "backend_runtime_capabilities",
        "profile_capabilities",
        "connector_platform_capabilities",
    ):
        if key not in separation:
            fail(f"x-lanyard-separation missing '{key}'")
        else:
            pass_(f"separation documents {key}")

    prefer_js = has_jsonschema()
    engine = "jsonschema" if prefer_js else "stdlib-subset"
    print(f"    validator engine: {engine}")
    print()

    # --- example descriptors ---
    if not examples_dir.is_dir():
        fail(f"missing examples directory: {examples_dir.relative_to(root)}")
    else:
        for name in EXAMPLE_DESCRIPTORS:
            ex = examples_dir / name
            rel = ex.relative_to(root)
            if not ex.is_file():
                fail(f"missing example: {rel}")
                continue
            try:
                data = load_json(ex)
            except (OSError, json.JSONDecodeError) as e:
                fail(f"{rel}: cannot parse JSON: {e}")
                continue
            errors = validate_descriptor(schema, data, prefer_js)
            if errors:
                for e in errors:
                    fail(f"{rel}: {e}")
            else:
                pass_(f"{rel} validates (source={data.get('source')})")

        # hermes-lanyard should support more expansion affordances than agent
        hl = examples_dir / "capabilities.hermes-lanyard.json"
        la = examples_dir / "capabilities.lanyard-agent.json"
        if hl.is_file() and la.is_file():
            h = load_json(hl)
            a = load_json(la)
            h_ui = h.get("ui_affordances") or {}
            a_ui = a.get("ui_affordances") or {}
            expansion = (
                "vault_editor",
                "settings_editor",
                "project_create",
                "model_selector",
                "cron_manager",
            )
            if not all(h_ui.get(k) == "supported" for k in expansion):
                fail(
                    "capabilities.hermes-lanyard.json should support expansion "
                    f"affordances {expansion}"
                )
            else:
                pass_("hermes-lanyard example supports expansion UI affordances")
            if not all(a_ui.get(k) == "unsupported" for k in expansion):
                fail(
                    "capabilities.lanyard-agent.json should mark expansion "
                    f"affordances unsupported: {expansion}"
                )
            else:
                pass_("lanyard-agent example marks expansion UI as unsupported")

            # lp-uxy.3: cron-capable LA pin only when dedicated cron RPCs listed
            la_cron = examples_dir / "capabilities.lanyard-agent.cron.json"
            if la_cron.is_file():
                ac = load_json(la_cron)
                ac_methods = set(ac.get("brain_rpc_methods") or [])
                ac_feats = ac.get("features") or {}
                ac_ui = ac.get("ui_affordances") or {}
                if ac_feats.get("cron") is not True:
                    fail("capabilities.lanyard-agent.cron.json must set features.cron=true")
                elif "cron.list" not in ac_methods and "cron.patch" not in ac_methods:
                    fail(
                        "capabilities.lanyard-agent.cron.json must list "
                        "cron.list and/or cron.patch"
                    )
                elif ac_ui.get("cron_manager") != "supported":
                    fail(
                        "capabilities.lanyard-agent.cron.json cron_manager "
                        "must be supported when features.cron=true"
                    )
                else:
                    pass_(
                        "lanyard-agent.cron pin: features.cron + methods + "
                        "cron_manager supported"
                    )

            # vault_write → vault_editor only when vault.write is advertised
            h_methods = set(h.get("brain_rpc_methods") or [])
            a_methods = set(a.get("brain_rpc_methods") or [])
            h_feats = h.get("features") or {}
            a_feats = a.get("features") or {}
            if h_feats.get("vault_write") is not True or "vault.write" not in h_methods:
                fail(
                    "hermes-lanyard must advertise vault_write feature and vault.write "
                    "method together for vault_editor support"
                )
            elif h_ui.get("vault_editor") != "supported":
                fail("hermes-lanyard vault_editor must be supported when vault.write advertised")
            else:
                pass_("hermes-lanyard maps vault_write + vault.write → vault_editor supported")
            if a_feats.get("vault_write") is not False or "vault.write" in a_methods:
                fail(
                    "lanyard-agent must not advertise vault_write / vault.write when "
                    "vault_editor is unsupported"
                )
            elif a_ui.get("vault_editor") != "unsupported":
                fail("lanyard-agent vault_editor must be unsupported without vault.write")
            else:
                pass_("lanyard-agent keeps vault_editor unsupported without vault.write")

            # Required methods present on both live examples
            for label, doc in (("hermes-lanyard", h), ("lanyard-agent", a)):
                methods = set(doc.get("brain_rpc_methods") or [])
                missing = [m for m in REQUIRED_V1_METHODS if m not in methods]
                if missing:
                    fail(f"{label}: missing required v1 methods {missing}")
                else:
                    pass_(f"{label}: includes required v1 Brain RPC methods")

            # Manifest fallback must set source=artifact_manifest and
            # capabilities_discovery false
            fb = examples_dir / "capabilities.manifest-fallback.json"
            if fb.is_file():
                fbd = load_json(fb)
                if fbd.get("source") != "artifact_manifest":
                    fail("manifest-fallback source must be artifact_manifest")
                else:
                    pass_("manifest-fallback source=artifact_manifest")
                feats = fbd.get("features") or {}
                if feats.get("capabilities_discovery") is not False:
                    fail(
                        "manifest-fallback capabilities_discovery must be false"
                    )
                else:
                    pass_(
                        "manifest-fallback marks capabilities_discovery false"
                    )

                # Derive model_selector: models true but methods absent →
                # derivation should be unsupported (matches explicit map)
                methods = set(fbd.get("brain_rpc_methods") or [])
                derived = derive_affordance(
                    "model_selector",
                    feats,
                    methods,
                    ui_cat,
                )
                explicit = (fbd.get("ui_affordances") or {}).get("model_selector")
                if derived != "unsupported":
                    fail(
                        "derivation for model_selector on manifest-fallback "
                        f"expected unsupported, got {derived}"
                    )
                elif explicit != "unsupported":
                    fail(
                        "manifest-fallback model_selector must be unsupported "
                        f"(got {explicit})"
                    )
                else:
                    pass_(
                        "manifest-fallback model_selector unsupported "
                        "(flag true but methods not listed)"
                    )

        # discovery wire examples
        req_path = examples_dir / "brain-rpc.capabilities.request.json"
        res_path = examples_dir / "brain-rpc.capabilities.result.json"
        if not req_path.is_file():
            fail("missing brain-rpc.capabilities.request.json")
        else:
            req = load_json(req_path)
            if req.get("method") != "brain.capabilities":
                fail("capabilities request method must be brain.capabilities")
            elif req.get("type") != "brain_rpc_request":
                fail("capabilities request type must be brain_rpc_request")
            elif "auth" not in req or "params" not in req:
                fail("capabilities request missing auth or params")
            else:
                pass_("brain-rpc.capabilities.request.json shape OK")

        if not res_path.is_file():
            fail("missing brain-rpc.capabilities.result.json")
        else:
            res = load_json(res_path)
            if res.get("type") != "brain_rpc_result" or res.get("ok") is not True:
                fail("capabilities result must be ok brain_rpc_result")
            else:
                result = res.get("result")
                errors = validate_descriptor(schema, result, prefer_js)
                if errors:
                    for e in errors:
                        fail(f"brain-rpc.capabilities.result.json result: {e}")
                elif (result or {}).get("source") != "brain_rpc":
                    fail("capabilities result.source must be brain_rpc")
                else:
                    pass_("brain-rpc.capabilities.result.json validates")

    # --- negative cases ---
    print()
    print("  negative cases (must reject)")
    base_path = examples_dir / "capabilities.hermes-lanyard.json"
    if base_path.is_file():
        base = load_json(base_path)

        missing_methods = copy.deepcopy(base)
        del missing_methods["brain_rpc_methods"]
        errs = validate_descriptor(schema, missing_methods, prefer_js)
        if not errs:
            fail("missing brain_rpc_methods: expected rejection")
        else:
            pass_(f"missing brain_rpc_methods: rejected ({len(errs)} error(s))")

        missing_features = copy.deepcopy(base)
        del missing_features["features"]
        errs = validate_descriptor(schema, missing_features, prefer_js)
        if not errs:
            fail("missing features: expected rejection")
        else:
            pass_(f"missing features: rejected ({len(errs)} error(s))")

        bad_method = copy.deepcopy(base)
        bad_method["brain_rpc_methods"] = ["NotAMethod"]
        errs = validate_descriptor(schema, bad_method, prefer_js)
        if not errs:
            fail("invalid method name: expected rejection")
        else:
            pass_(f"invalid method name: rejected ({len(errs)} error(s))")

        bad_state = copy.deepcopy(base)
        bad_state["ui_affordances"] = {"vault_browser": "enabled"}
        errs = validate_descriptor(schema, bad_state, prefer_js)
        if not errs:
            fail("invalid ui affordance state: expected rejection")
        else:
            pass_(f"invalid ui affordance state: rejected ({len(errs)} error(s))")

        bad_source = copy.deepcopy(base)
        bad_source["source"] = "relay_hello"
        errs = validate_descriptor(schema, bad_source, prefer_js)
        if not errs:
            fail("source=relay_hello: expected rejection")
        else:
            pass_(f"source=relay_hello: rejected ({len(errs)} error(s))")
    else:
        fail("cannot run negative cases: hermes-lanyard capabilities example missing")

    print()
    if failed:
        print(f"FAILED  {failed} failure(s), {passed} pass(es).")
        return 1
    print(f"OK  {passed} check(s) passed (offline, no network).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
