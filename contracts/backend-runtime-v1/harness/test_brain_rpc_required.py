"""Conformance: Brain RPC required methods (lp-k7g.11.3).

Offline suite using FakeBrainRpcHost + FakeRelayHarness + FakeBackendClient.

Acceptance:
  - brain.ping returns success
  - brain.health returns status
  - vault.list / vault.stat / vault.read enforce ACLs (contributor vs admin)
  - settings.snapshot and projects.list return schema-valid responses

No network, no Portal, no live backend artifact.
Artifact job (fixture + fake relay orchestration): lp-k7g.11.4
(`scripts/run-hermes-lanyard-conformance.py`).
"""

from __future__ import annotations

import unittest

from .fake_backend import FakeBackendClient
from .fake_brain_rpc import (
    REQUIRED_BRAIN_RPC_METHODS,
    FakeBrainRpcHost,
    assert_health_result,
    assert_ping_result,
    assert_projects_list_result,
    assert_settings_snapshot_result,
    assert_vault_list_result,
    assert_vault_read_result,
    assert_vault_stat_result,
    assert_vault_write_result,
)
from .harness import FakeRelayHarness
from .mock_socket import MockSocket

# Profile path ACL fixtures (mirror contracts examples + runtime subject stamps).
# admin seed uses path_prefixes ["/"]; contributor seed leaves empty for Portal
# to stamp — for ACL tests we stamp restricted prefixes explicitly.
ADMIN_PREFIXES = ["/"]
CONTRIBUTOR_PREFIXES = ["/Projects"]


class _Session:
    """Handshake + FakeBrainRpcHost wired over MockSocket."""

    def __init__(self) -> None:
        relay_sock, gateway_sock = MockSocket.create_pair("relay", "gateway")
        self.host = FakeBrainRpcHost()
        self.harness = FakeRelayHarness(
            relay_sock,
            instance_id="inst_conformance",
            tenant_id="ten_conformance",
        )
        self.backend = FakeBackendClient(
            gateway_sock,
            brain_rpc=self.host,
            auto_brain_rpc=True,
        )
        self.backend.connect_hello()
        self.harness.accept_hello()
        self.backend.await_descriptor()

    def call(
        self,
        method: str,
        *,
        params: dict | None = None,
        backend_profile: str = "contributor",
        path_prefixes: list[str] | None = None,
        request_id: str | None = None,
    ) -> dict:
        rid = request_id or f"req_{method.replace('.', '_')}"
        self.harness.send_brain_rpc(
            method,
            request_id=rid,
            params=params or {},
            backend_profile=backend_profile,
            path_prefixes=path_prefixes
            if path_prefixes is not None
            else (
                ADMIN_PREFIXES if backend_profile == "admin" else CONTRIBUTOR_PREFIXES
            ),
            wait=False,
        )
        # Drain backend (auto-dispatch via FakeBrainRpcHost) then wait on harness.
        self.backend.poll()
        return self.harness.wait_brain_rpc_result(rid)


class RequiredMethodCatalogTests(unittest.TestCase):
    def test_required_seven_methods(self) -> None:
        self.assertEqual(
            sorted(REQUIRED_BRAIN_RPC_METHODS),
            sorted(
                [
                    "brain.ping",
                    "brain.health",
                    "vault.list",
                    "vault.stat",
                    "vault.read",
                    "settings.snapshot",
                    "projects.list",
                ]
            ),
        )
        host = FakeBrainRpcHost()
        for m in REQUIRED_BRAIN_RPC_METHODS:
            self.assertIn(m, host.supported_methods())


class BrainPingTests(unittest.TestCase):
    """Acceptance: brain.ping returns success."""

    def test_ping_success(self) -> None:
        s = _Session()
        result_frame = s.call(
            "brain.ping",
            params={"echo": "hello"},
            request_id="req_ping_1",
        )
        self.assertTrue(result_frame["ok"])
        result = result_frame["result"]
        assert_ping_result(result)
        self.assertEqual(result["echo"], "hello")
        self.assertEqual(result["instance_id"], "inst_conformance")
        self.assertEqual(result["contract_version"], 1)

    def test_ping_without_echo(self) -> None:
        s = _Session()
        result_frame = s.call("brain.ping", params={}, request_id="req_ping_2")
        self.assertTrue(result_frame["ok"])
        assert_ping_result(result_frame["result"])
        self.assertNotIn("echo", result_frame["result"])


class BrainHealthTests(unittest.TestCase):
    """Acceptance: brain.health returns status."""

    def test_health_status(self) -> None:
        s = _Session()
        result_frame = s.call(
            "brain.health",
            params={},
            backend_profile="admin",
            path_prefixes=ADMIN_PREFIXES,
            request_id="req_health_1",
        )
        self.assertTrue(result_frame["ok"])
        result = result_frame["result"]
        assert_health_result(result)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["profile"], "admin")
        self.assertTrue(result["checks"].get("vault_root_readable"))
        self.assertEqual(result["versions"].get("brain_rpc"), 1)


class VaultAclTests(unittest.TestCase):
    """Acceptance: vault.list/stat/read enforce ACLs (contributor vs admin)."""

    def test_contributor_can_list_allowed_prefix(self) -> None:
        s = _Session()
        frame = s.call(
            "vault.list",
            params={"path": "/Projects/Legal"},
            backend_profile="contributor",
            path_prefixes=CONTRIBUTOR_PREFIXES,
            request_id="req_vlist_ok",
        )
        self.assertTrue(frame["ok"])
        result = frame["result"]
        assert_vault_list_result(result)
        self.assertEqual(result["path"], "/Projects/Legal")
        names = {e["name"] for e in result["entries"]}
        self.assertIn("memo.md", names)
        self.assertIn("exhibits", names)

    def test_contributor_forbidden_outside_prefix_list(self) -> None:
        s = _Session()
        frame = s.call(
            "vault.list",
            params={"path": "/Secrets"},
            backend_profile="contributor",
            path_prefixes=CONTRIBUTOR_PREFIXES,
            request_id="req_vlist_deny",
        )
        self.assertFalse(frame["ok"])
        self.assertEqual(frame["error"]["code"], "forbidden")
        self.assertFalse(frame["error"].get("retryable", True))

    def test_contributor_stat_and_read_allowed(self) -> None:
        s = _Session()
        path = "/Projects/Legal/memo.md"
        stat_frame = s.call(
            "vault.stat",
            params={"path": path},
            backend_profile="contributor",
            path_prefixes=CONTRIBUTOR_PREFIXES,
            request_id="req_vstat_ok",
        )
        self.assertTrue(stat_frame["ok"])
        assert_vault_stat_result(stat_frame["result"])
        self.assertEqual(stat_frame["result"]["kind"], "file")
        self.assertEqual(stat_frame["result"]["name"], "memo.md")

        read_frame = s.call(
            "vault.read",
            params={"path": path, "max_bytes": 1_048_576},
            backend_profile="contributor",
            path_prefixes=CONTRIBUTOR_PREFIXES,
            request_id="req_vread_ok",
        )
        self.assertTrue(read_frame["ok"])
        assert_vault_read_result(read_frame["result"])
        self.assertIn("Conformance test body", read_frame["result"]["content"])

    def test_contributor_stat_and_read_forbidden_secrets(self) -> None:
        s = _Session()
        for method, rid in (
            ("vault.stat", "req_vstat_deny"),
            ("vault.read", "req_vread_deny"),
        ):
            frame = s.call(
                method,
                params={"path": "/Secrets/key.txt"},
                backend_profile="contributor",
                path_prefixes=CONTRIBUTOR_PREFIXES,
                request_id=rid,
            )
            self.assertFalse(frame["ok"], msg=f"{method} should deny secrets")
            self.assertEqual(frame["error"]["code"], "forbidden")
            self.assertEqual(frame["error"]["details"]["path"], "/Secrets/key.txt")

    def test_admin_can_access_secrets_and_projects(self) -> None:
        s = _Session()
        # list root sees both trees
        listed = s.call(
            "vault.list",
            params={"path": "/"},
            backend_profile="admin",
            path_prefixes=ADMIN_PREFIXES,
            request_id="req_admin_list",
        )
        self.assertTrue(listed["ok"])
        names = {e["name"] for e in listed["result"]["entries"]}
        self.assertIn("Projects", names)
        self.assertIn("Secrets", names)

        # read secret
        body = s.call(
            "vault.read",
            params={"path": "/Secrets/key.txt"},
            backend_profile="admin",
            path_prefixes=ADMIN_PREFIXES,
            request_id="req_admin_read",
        )
        self.assertTrue(body["ok"])
        self.assertEqual(body["result"]["content"], "super-secret")

        # stat projects
        stat = s.call(
            "vault.stat",
            params={"path": "/Projects/Legal/memo.md"},
            backend_profile="admin",
            path_prefixes=ADMIN_PREFIXES,
            request_id="req_admin_stat",
        )
        self.assertTrue(stat["ok"])
        self.assertEqual(stat["result"]["kind"], "file")

    def test_admin_vs_contributor_same_path(self) -> None:
        """Same vault path: admin ok, contributor forbidden when outside ACL."""
        s = _Session()
        secret = "/Secrets/key.txt"
        admin = s.call(
            "vault.stat",
            params={"path": secret},
            backend_profile="admin",
            path_prefixes=ADMIN_PREFIXES,
            request_id="req_cmp_admin",
        )
        contrib = s.call(
            "vault.stat",
            params={"path": secret},
            backend_profile="contributor",
            path_prefixes=CONTRIBUTOR_PREFIXES,
            request_id="req_cmp_contrib",
        )
        self.assertTrue(admin["ok"])
        self.assertFalse(contrib["ok"])
        self.assertEqual(contrib["error"]["code"], "forbidden")


class SettingsAndProjectsSchemaTests(unittest.TestCase):
    """Acceptance: settings.snapshot and projects.list return schema-valid responses."""

    def test_settings_snapshot_schema_valid(self) -> None:
        s = _Session()
        frame = s.call(
            "settings.snapshot",
            params={},
            backend_profile="contributor",
            path_prefixes=CONTRIBUTOR_PREFIXES,
            request_id="req_settings",
        )
        self.assertTrue(frame["ok"])
        result = frame["result"]
        assert_settings_snapshot_result(result)
        self.assertEqual(result["source"], "fake")
        self.assertIsInstance(result.get("skills"), list)
        self.assertEqual(result["skills"][0]["id"], "summarize")
        # redaction smoke: no secret file content leaked into settings
        blob = str(result)
        self.assertNotIn("super-secret", blob)

    def test_projects_list_schema_valid(self) -> None:
        s = _Session()
        frame = s.call(
            "projects.list",
            params={"include_archived": False},
            backend_profile="contributor",
            path_prefixes=CONTRIBUTOR_PREFIXES,
            request_id="req_projects",
        )
        self.assertTrue(frame["ok"])
        result = frame["result"]
        assert_projects_list_result(result)
        self.assertEqual(result["source"], "fake")
        self.assertEqual(len(result["projects"]), 1)
        self.assertEqual(result["projects"][0]["id"], "proj_legal")
        self.assertEqual(result["projects"][0]["name"], "Legal")


class AllRequiredMethodsWireTests(unittest.TestCase):
    """Every required method succeeds for an admin subject on seeded data."""

    def test_all_required_methods_ok_for_admin(self) -> None:
        s = _Session()
        cases: list[tuple[str, dict]] = [
            ("brain.ping", {"echo": "all"}),
            ("brain.health", {}),
            ("vault.list", {"path": "/Projects/Legal"}),
            ("vault.stat", {"path": "/Projects/Legal/memo.md"}),
            ("vault.read", {"path": "/Projects/Legal/memo.md"}),
            ("settings.snapshot", {}),
            ("projects.list", {}),
        ]
        self.assertEqual(
            {m for m, _ in cases},
            set(REQUIRED_BRAIN_RPC_METHODS),
        )
        for method, params in cases:
            with self.subTest(method=method):
                frame = s.call(
                    method,
                    params=params,
                    backend_profile="admin",
                    path_prefixes=ADMIN_PREFIXES,
                    request_id=f"req_all_{method.replace('.', '_')}",
                )
                self.assertTrue(
                    frame["ok"],
                    msg=f"{method} failed: {frame.get('error')}",
                )

    def test_unimplemented_returns_method_not_found(self) -> None:
        s = _Session()
        # Typed vault.write params (lp-5q6.18). Fake host still returns
        # method_not_found until a backend implements the expansion.
        frame = s.call(
            "vault.write",
            params={
                "path": "/Projects/Legal/memo.md",
                "mode": "replace_if_match",
                "expected_revision": {
                    "token": "sha256:deadbeef",
                    "kind": "content_hash",
                },
                "encoding": "utf-8",
                "content": "updated",
                "mime_type": "text/markdown",
                "size_bytes": 7,
                "idempotency_key": "test-unimpl-write-1",
            },
            backend_profile="admin",
            path_prefixes=ADMIN_PREFIXES,
            request_id="req_unimpl",
        )
        self.assertFalse(frame["ok"])
        self.assertEqual(frame["error"]["code"], "method_not_found")
        self.assertFalse(frame["error"]["retryable"])

    def test_vault_write_result_shape_assertion(self) -> None:
        """Harness shape helper accepts a typed vault.write success payload."""
        assert_vault_write_result(
            {
                "path": "/Projects/Legal/memo.md",
                "revision": {
                    "token": "sha256:abc",
                    "kind": "content_hash",
                    "size_bytes": 7,
                },
                "size_bytes": 7,
                "mime_type": "text/markdown",
                "written_at": "2026-07-12T00:00:01.000Z",
            }
        )


class DirectHostUnitTests(unittest.TestCase):
    """Host-level unit checks (no socket) for shape helpers."""

    def test_direct_invoke_ping_and_acl(self) -> None:
        host = FakeBrainRpcHost()
        auth_contrib = {
            "instance_id": "inst_x",
            "subject": {
                "backend_profile": "contributor",
                "path_prefixes": CONTRIBUTOR_PREFIXES,
            },
        }
        ok = host.invoke("brain.ping", {"echo": "d"}, auth_contrib)
        self.assertTrue(ok["ok"])
        assert_ping_result(ok["result"])

        denied = host.invoke(
            "vault.read",
            {"path": "/Secrets/key.txt"},
            auth_contrib,
        )
        self.assertFalse(denied["ok"])
        self.assertEqual(denied["error"]["code"], "forbidden")

        auth_admin = {
            "instance_id": "inst_x",
            "subject": {
                "backend_profile": "admin",
                "path_prefixes": ADMIN_PREFIXES,
            },
        }
        allowed = host.invoke(
            "vault.read",
            {"path": "/Secrets/key.txt"},
            auth_admin,
        )
        self.assertTrue(allowed["ok"])
        self.assertEqual(allowed["result"]["content"], "super-secret")


if __name__ == "__main__":
    unittest.main()
