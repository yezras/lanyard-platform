"""lp-hdzm.29: FakeOps selector map keys exist and match hyphenated testids."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from conftest import load_selector_table

WEB_SRC = Path(__file__).resolve().parents[1] / "src"
ADMIN_SOURCE_PATHS = [
    WEB_SRC / "layout" / "OpsConsole.tsx",
    *(WEB_SRC / "features" / "admin").glob("*.tsx"),
    *(WEB_SRC / "features" / "admin").glob("*.ts"),
]

# testing.md minimum + prefix keys for dynamic slug/id rows.
REQUIRED_FAKEOPS_KEYS = frozenset(
    {
        "admin_nav_tenants",
        "admin_nav_registry",
        "admin_nav_connectors",
        "admin_nav_users",
        "admin_nav_instances",
        "admin_nav_roles",
        "admin_nav_audit",
        "admin_nav_secrets",
        "admin_tenant_row",
        "admin_tenant_row_mocklab",
        "admin_tenant_chip",
        "admin_tenant_switcher",
        "ops_add_user",
        "ops_user_row",
        "ops_connector_row",
        "ops_connector_onboard",
        "ops_surface_mcp",
        "ops_surface_cli",
        "ops_surface_api",
        "ops_surface_graphql",
        "ops_connector_grant",
        "ops_registry_search",
        "ops_registry_promote",
    }
)

# Source already ships these (shell + registry/onboard/users).
SOURCE_REQUIRED_TESTIDS = frozenset(
    {
        "admin-nav-tenants",
        "admin-nav-registry",
        "admin-nav-connectors",
        "admin-nav-users",
        "admin-nav-instances",
        "admin-nav-roles",
        "admin-nav-audit",
        "admin-nav-secrets",
        "admin-tenant-chip",
        "admin-tenant-switcher",
        "ops-tenant-row-mocklab",
        "ops-add-user",
        "ops-connector-onboard",
        "ops-registry-search",
    }
)
SOURCE_REQUIRED_PREFIXES = frozenset(
    {
        "admin-nav-",
        "ops-tenant-row-",
        "ops-connector-grant-",
        "ops-user-row-",
        "ops-connector-row-",
        "ops-surface-",
        "ops-registry-promote-",
    }
)

# GraphQL is not a selectable surface; promote is a domain-suffixed testid.
FORWARD_TESTIDS = frozenset(
    {
        "ops-surface-graphql",
        "ops-registry-promote",
    }
)
FORWARD_PREFIXES = frozenset()

# Keys whose testid is not key.replace("_", "-") because source named them first.
KEY_TESTID_OVERRIDES = {
    "admin_tenant_row": "ops-tenant-row-",
    "admin_tenant_row_mocklab": "ops-tenant-row-mocklab",
}

_LITERAL_RE = re.compile(r'data-testid="([^"]+)"')
_TEMPLATE_RE = re.compile(r"data-testid=\{`([^`$]+)")
_CSS_PREFIX_RE = re.compile(r'\[data-testid\^="([^"]+)"\]')
_HYPHEN_TESTID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*-?$")


def collect_source_testids(paths: list[Path] | None = None) -> tuple[set[str], set[str]]:
    """Return (literals, template-prefixes) from admin TS/TSX data-testid attrs."""
    literals: set[str] = set()
    prefixes: set[str] = set()
    for path in paths or ADMIN_SOURCE_PATHS:
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        literals.update(_LITERAL_RE.findall(text))
        prefixes.update(_TEMPLATE_RE.findall(text))
    return literals, prefixes


def source_covers(testid: str, literals: set[str], prefixes: set[str]) -> bool:
    if testid in literals:
        return True
    return any(testid.startswith(prefix) for prefix in prefixes if prefix)


def yaml_testid_or_prefix(entry: object) -> tuple[str | None, str | None]:
    """Return (testid, css-prefix) for a selector map entry."""
    if not isinstance(entry, dict):
        return None, None
    testid = entry.get("testid")
    if isinstance(testid, str):
        return testid, None
    css = entry.get("css")
    if isinstance(css, str):
        match = _CSS_PREFIX_RE.fullmatch(css.strip())
        if match:
            return None, match.group(1)
    return None, None


def expected_testid_for_key(key: str) -> str:
    if key in KEY_TESTID_OVERRIDES:
        return KEY_TESTID_OVERRIDES[key]
    hyphen = key.replace("_", "-")
    if key.endswith("_row") or key.endswith("_grant"):
        return f"{hyphen}-"
    return hyphen


def test_fakeops_selector_keys_exist(selectors: dict) -> None:
    missing = sorted(REQUIRED_FAKEOPS_KEYS - set(selectors))
    assert not missing, f"selectors.yaml missing FakeOps keys: {missing}"


def test_fakeops_selector_testids_use_hyphens(selectors: dict) -> None:
    bad: list[str] = []
    for key in sorted(REQUIRED_FAKEOPS_KEYS):
        testid, prefix = yaml_testid_or_prefix(selectors[key])
        value = testid or prefix
        assert value, f"{key} must be a testid or [data-testid^=...] prefix"
        if "_" in value or not _HYPHEN_TESTID_RE.fullmatch(value):
            bad.append(f"{key}={value!r}")
    assert not bad, f"FakeOps testids must be hyphenated, not underscored: {bad}"


def test_fakeops_selector_keys_match_hyphen_testids(selectors: dict) -> None:
    mismatches: list[str] = []
    for key in sorted(REQUIRED_FAKEOPS_KEYS):
        expected = expected_testid_for_key(key)
        testid, prefix = yaml_testid_or_prefix(selectors[key])
        actual = testid or prefix
        if actual != expected:
            mismatches.append(f"{key}: expected {expected!r}, got {actual!r}")
    assert not mismatches, "FakeOps keys must map to hyphenated testids: " + "; ".join(
        mismatches
    )


def test_fakeops_selectors_match_source_testids(selectors: dict) -> None:
    literals, prefixes = collect_source_testids()
    assert literals or prefixes, "admin source has no data-testid attributes"

    missing_source: list[str] = []
    for key in sorted(REQUIRED_FAKEOPS_KEYS):
        testid, prefix = yaml_testid_or_prefix(selectors[key])
        if testid:
            if testid in FORWARD_TESTIDS:
                continue
            if not source_covers(testid, literals, prefixes):
                missing_source.append(f"{key} testid={testid}")
        elif prefix:
            if prefix in FORWARD_PREFIXES:
                continue
            if prefix not in prefixes and not any(
                lit.startswith(prefix) for lit in literals
            ):
                missing_source.append(f"{key} prefix={prefix}")
    assert not missing_source, (
        "selectors.yaml testids missing from admin source: " + ", ".join(missing_source)
    )

    uncovered = [
        testid
        for testid in sorted(SOURCE_REQUIRED_TESTIDS)
        if not source_covers(testid, literals, prefixes)
    ]
    assert not uncovered, f"required source testids missing from TSX: {uncovered}"

    missing_prefixes = sorted(SOURCE_REQUIRED_PREFIXES - prefixes)
    # Literals can satisfy a prefix (admin-nav-tenants covers admin-nav-).
    missing_prefixes = [
        prefix
        for prefix in missing_prefixes
        if not any(lit.startswith(prefix) for lit in literals)
        and prefix not in prefixes
    ]
    assert not missing_prefixes, (
        f"required source testid prefixes missing: {missing_prefixes}"
    )


def test_collect_source_testids_reads_ops_console() -> None:
    literals, prefixes = collect_source_testids()
    assert "admin-tenant-chip" in literals
    assert "admin-nav-" in prefixes
    assert "ops-tenant-row-" in prefixes
    assert "ops-connector-grant-" in prefixes


@pytest.mark.parametrize("key", sorted(REQUIRED_FAKEOPS_KEYS))
def test_fakeops_key_resolves_in_selector_table(key: str) -> None:
    table = load_selector_table()
    assert key in table
    testid, prefix = yaml_testid_or_prefix(table[key])
    assert testid or prefix
