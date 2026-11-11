"""Offline FakeBrainRpc host for Brain RPC required-method conformance (lp-k7g.11.3).

Mirrors Portal ``FakeBackendRuntimeService`` / ``createFakeBrainRpcInvoker``
semantics (vault ACL, seven required methods, schema-shaped results) without
Node or a live backend artifact. Used by harness wire tests over
``MockSocket`` + ``FakeRelayHarness``.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Mapping

REQUIRED_BRAIN_RPC_METHODS: tuple[str, ...] = (
    "brain.ping",
    "brain.health",
    "vault.list",
    "vault.stat",
    "vault.read",
    "settings.snapshot",
    "projects.list",
)

KNOWN_ERROR_CODES = frozenset(
    {
        "unauthenticated",
        "forbidden",
        "not_found",
        "invalid_argument",
        "payload_too_large",
        "timeout",
        "unavailable",
        "conflict",
        "method_not_found",
        "version_unsupported",
        "rate_limited",
        "internal",
    }
)


class FakeBrainRpcError(Exception):
    """Structured Brain RPC host error (maps to brain_rpc_result.error)."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        if code not in KNOWN_ERROR_CODES:
            raise ValueError(f"unknown Brain RPC error code: {code}")
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = dict(details) if details is not None else {}

    def to_error_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }
        if self.details:
            out["details"] = self.details
        return out


@dataclass
class FakeVaultFile:
    path: str
    content: str
    mime_type: str = "text/plain"
    encoding: str = "utf-8"  # utf-8 | base64
    mtime: str | None = "2026-07-12T00:00:00.000Z"


@dataclass
class FakeBrainRpcOptions:
    files: list[FakeVaultFile] = field(default_factory=list)
    projects: list[dict[str, Any]] = field(default_factory=list)
    settings: dict[str, Any] | None = None
    health: dict[str, Any] | None = None
    instance_id: str = "inst_conformance"


def normalize_vault_path(path: str) -> str:
    if not path or path == "":
        return "/"
    p = path if path.startswith("/") else f"/{path}"
    while "//" in p:
        p = p.replace("//", "/")
    if len(p) > 1 and p.endswith("/"):
        p = p[:-1]
    if ".." in p or "\0" in p:
        raise FakeBrainRpcError(
            "invalid_argument",
            f"Invalid vault path: {path}",
            details={"path": path},
        )
    return p


def path_allowed(prefixes: list[str], path: str) -> bool:
    """Vault path ACL (contract profiles.schema.json x-lanyard-path-acl)."""
    if not prefixes:
        # Empty subject prefixes: deny vault path methods (fail-closed for ACL
        # tests). Non-path methods (ping/health/settings/projects) skip ACL.
        return False
    if "/" in prefixes:
        return True
    for prefix in prefixes:
        if not isinstance(prefix, str) or not prefix:
            continue
        if prefix == "/":
            return True
        norm = prefix if prefix.startswith("/") else f"/{prefix}"
        if norm.endswith("/"):
            norm = norm[:-1]
        if path == norm or path.startswith(f"{norm}/"):
            return True
    return False


def _basename(path: str) -> str:
    if path == "/":
        return ""
    return path.rsplit("/", 1)[-1]


def default_settings() -> dict[str, Any]:
    return {
        "exported_at": "2026-07-12T00:00:00.000Z",
        "source": "fake",
        "backend_home": "/tmp/fake-backend-home",
        "hermes_home": "/tmp/fake-backend-home",
        "skills": [
            {
                "id": "summarize",
                "name": "summarize",
                "enabled": True,
                "path": "skills/summarize",
                "source": "fake",
            }
        ],
        "crons": [
            {
                "id": "nightly",
                "name": "Nightly",
                "schedule": "0 6 * * *",
                "enabled": True,
            }
        ],
        "mcp_servers": [
            {"name": "filesystem", "transport": "stdio", "enabled": True}
        ],
        "models": [
            {
                "provider": "openai",
                "model": "gpt-4.1",
                "is_active": True,
                "connected": True,
            }
        ],
        "integrations": [],
    }


def default_health() -> dict[str, Any]:
    return {
        "status": "ok",
        "checks": {
            "vault_root_readable": True,
            "backend_home_present": True,
            "hermes_home_present": True,
            "profiles_present": True,
            "projects_db_present": True,
        },
        "versions": {
            "brain_rpc": 1,
            "backend_artifact": "fake-0.0.0",
            "hermes_artifact": "fake-0.0.0",
        },
    }


def default_seed_files() -> list[FakeVaultFile]:
    return [
        FakeVaultFile(
            path="/Projects/Legal/memo.md",
            content="# Memo\n\nConformance test body.\n",
            mime_type="text/markdown",
        ),
        FakeVaultFile(
            path="/Projects/Legal/exhibits/a.txt",
            content="exhibit-a",
            mime_type="text/plain",
        ),
        FakeVaultFile(
            path="/Secrets/key.txt",
            content="super-secret",
            mime_type="text/plain",
        ),
    ]


def default_seed_projects() -> list[dict[str, Any]]:
    return [
        {
            "id": "proj_legal",
            "slug": "legal",
            "name": "Legal",
            "primary_path": "/Projects/Legal",
            "folders": [
                {
                    "path": "/Projects/Legal",
                    "label": None,
                    "is_primary": True,
                }
            ],
        }
    ]


class FakeBrainRpcHost:
    """In-memory host implementing the seven required Brain RPC methods.

    Path ACL is enforced for vault.list / vault.stat / vault.read using
    ``auth.subject.path_prefixes`` (admin typically ``["/"]``, contributor
    restricted prefixes such as ``["/Projects"]``).
    """

    def __init__(self, options: FakeBrainRpcOptions | None = None) -> None:
        opts = options or FakeBrainRpcOptions()
        self.instance_id = opts.instance_id
        self.files: dict[str, FakeVaultFile] = {}
        seed_files = opts.files if opts.files else default_seed_files()
        for f in seed_files:
            p = normalize_vault_path(f.path)
            self.files[p] = FakeVaultFile(
                path=p,
                content=f.content,
                mime_type=f.mime_type,
                encoding=f.encoding,
                mtime=f.mtime,
            )
        self.projects = deepcopy(opts.projects if opts.projects else default_seed_projects())
        self.settings = deepcopy(opts.settings if opts.settings is not None else default_settings())
        self.health_result = deepcopy(opts.health if opts.health is not None else default_health())

    def supported_methods(self) -> list[str]:
        return list(REQUIRED_BRAIN_RPC_METHODS)

    def handle_request_frame(self, frame: Mapping[str, Any]) -> dict[str, Any]:
        """Dispatch a brain_rpc_request frame → (ok, result|error) payload fields."""
        method = frame.get("method")
        if not isinstance(method, str) or not method:
            raise FakeBrainRpcError("invalid_argument", "method is required")
        params = frame.get("params") if isinstance(frame.get("params"), dict) else {}
        auth = frame.get("auth") if isinstance(frame.get("auth"), dict) else {}
        return self.invoke(method, params, auth)

    def invoke(
        self,
        method: str,
        params: Mapping[str, Any] | None,
        auth: Mapping[str, Any] | None,
    ) -> dict[str, Any]:
        """Invoke a method. Returns ``{"ok": True, "result": ...}`` or raises."""
        p = dict(params) if params else {}
        a = dict(auth) if auth else {}
        try:
            result = self._dispatch(method, p, a)
            return {"ok": True, "result": result}
        except FakeBrainRpcError as exc:
            return {"ok": False, "error": exc.to_error_dict()}

    def _dispatch(
        self,
        method: str,
        params: dict[str, Any],
        auth: dict[str, Any],
    ) -> Any:
        if method == "brain.ping":
            return self._ping(params, auth)
        if method == "brain.health":
            return self._health(auth)
        if method == "vault.list":
            return self._vault_list(params, auth)
        if method == "vault.stat":
            return self._vault_stat(params, auth)
        if method == "vault.read":
            return self._vault_read(params, auth)
        if method == "settings.snapshot":
            return self._settings_snapshot(params)
        if method == "projects.list":
            return self._projects_list(params)
        raise FakeBrainRpcError(
            "method_not_found",
            f"Fake Brain RPC does not implement method: {method}",
            details={"method": method},
        )

    # --- helpers ---------------------------------------------------------

    def _subject(self, auth: Mapping[str, Any]) -> dict[str, Any]:
        subject = auth.get("subject")
        return dict(subject) if isinstance(subject, dict) else {}

    def _path_prefixes(self, auth: Mapping[str, Any]) -> list[str]:
        subject = self._subject(auth)
        raw = subject.get("path_prefixes")
        if not isinstance(raw, list):
            return []
        return [p for p in raw if isinstance(p, str)]

    def _profile_name(self, auth: Mapping[str, Any]) -> str:
        subject = self._subject(auth)
        for key in ("backend_profile", "hermes_profile"):
            val = subject.get(key)
            if isinstance(val, str) and val:
                return val
        return "unknown"

    def _assert_path_access(self, auth: Mapping[str, Any], path: str) -> None:
        prefixes = self._path_prefixes(auth)
        if not path_allowed(prefixes, path):
            raise FakeBrainRpcError(
                "forbidden",
                f"Vault path not allowed: {path}",
                details={"path": path},
            )

    # --- methods ---------------------------------------------------------

    def _ping(self, params: dict[str, Any], auth: Mapping[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {
            "pong": True,
            "instance_id": (
                auth.get("instance_id")
                if isinstance(auth.get("instance_id"), str) and auth.get("instance_id")
                else self.instance_id
            ),
            "contract_version": 1,
        }
        echo = params.get("echo")
        if isinstance(echo, str):
            out["echo"] = echo
        return out

    def _health(self, auth: Mapping[str, Any]) -> dict[str, Any]:
        result = deepcopy(self.health_result)
        result["profile"] = self._profile_name(auth)
        return result

    def _vault_list(
        self, params: dict[str, Any], auth: Mapping[str, Any]
    ) -> dict[str, Any]:
        path = normalize_vault_path(
            params["path"] if isinstance(params.get("path"), str) else "/"
        )
        self._assert_path_access(auth, path)

        child_names: set[str] = set()
        for file_path in self.files:
            if file_path == path:
                continue
            if path == "/":
                if not file_path.startswith("/"):
                    continue
                rest = file_path[1:]
                segment = rest.split("/")[0]
                if segment:
                    child_names.add(segment)
            elif file_path.startswith(f"{path}/"):
                rest = file_path[len(path) + 1 :]
                segment = rest.split("/")[0]
                if segment:
                    child_names.add(segment)

        entries: list[dict[str, Any]] = []
        for name in sorted(child_names):
            child_path = f"/{name}" if path == "/" else f"{path}/{name}"
            # Filter children the subject cannot see
            if not path_allowed(self._path_prefixes(auth), child_path):
                continue
            if child_path in self.files:
                f = self.files[child_path]
                size = len(f.content.encode("utf-8"))
                entries.append(
                    {
                        "name": name,
                        "path": child_path,
                        "kind": "file",
                        "mime_type": f.mime_type,
                        "size_bytes": size,
                        "mtime": f.mtime,
                    }
                )
            else:
                entries.append(
                    {
                        "name": name,
                        "path": child_path,
                        "kind": "directory",
                        "mime_type": None,
                        "size_bytes": None,
                        "mtime": None,
                    }
                )

        limit = params.get("limit")
        if not isinstance(limit, int) or limit < 1:
            limit = 200
        truncated = len(entries) > limit
        page = entries[:limit]
        return {
            "path": path,
            "entries": page,
            "next_cursor": str(limit) if truncated else None,
            "truncated": truncated,
        }

    def _vault_stat(
        self, params: dict[str, Any], auth: Mapping[str, Any]
    ) -> dict[str, Any]:
        raw_path = params.get("path")
        if not isinstance(raw_path, str) or not raw_path:
            raise FakeBrainRpcError("invalid_argument", "vault.stat requires path")
        path = normalize_vault_path(raw_path)
        self._assert_path_access(auth, path)

        if path in self.files:
            f = self.files[path]
            return {
                "name": _basename(path),
                "path": path,
                "kind": "file",
                "mime_type": f.mime_type,
                "size_bytes": len(f.content.encode("utf-8")),
                "mtime": f.mtime,
            }

        for file_path in self.files:
            if file_path.startswith(f"{path}/") or (path == "/" and file_path != "/"):
                return {
                    "name": _basename(path),
                    "path": path,
                    "kind": "directory",
                    "mime_type": None,
                    "size_bytes": None,
                    "mtime": None,
                }

        raise FakeBrainRpcError(
            "not_found",
            f"Vault path not found: {path}",
            details={"path": path},
        )

    def _vault_read(
        self, params: dict[str, Any], auth: Mapping[str, Any]
    ) -> dict[str, Any]:
        raw_path = params.get("path")
        if not isinstance(raw_path, str) or not raw_path:
            raise FakeBrainRpcError("invalid_argument", "vault.read requires path")
        path = normalize_vault_path(raw_path)
        self._assert_path_access(auth, path)

        file = self.files.get(path)
        if file is None:
            for file_path in self.files:
                if file_path.startswith(f"{path}/"):
                    raise FakeBrainRpcError(
                        "invalid_argument",
                        f"Cannot read directory: {path}",
                        details={"path": path},
                    )
            raise FakeBrainRpcError(
                "not_found",
                f"Vault file not found: {path}",
                details={"path": path},
            )

        encoding = file.encoding if file.encoding in ("utf-8", "base64") else "utf-8"
        size = len(file.content.encode("utf-8"))
        max_bytes = params.get("max_bytes")
        if not isinstance(max_bytes, int) or max_bytes < 1:
            max_bytes = 1_048_576
        if size > max_bytes:
            raise FakeBrainRpcError(
                "payload_too_large",
                f"File exceeds max_bytes ({max_bytes})",
                details={"path": path, "size_bytes": size, "max_bytes": max_bytes},
            )
        return {
            "path": path,
            "kind": "file",
            "mime_type": file.mime_type,
            "encoding": encoding,
            "content": file.content,
            "size_bytes": size,
        }

    def _settings_snapshot(self, params: dict[str, Any]) -> dict[str, Any]:
        snap = deepcopy(self.settings)
        include = params.get("include")
        if not isinstance(include, list) or not include:
            return snap
        include_set = {x for x in include if isinstance(x, str)}
        return {
            "exported_at": snap.get("exported_at"),
            "source": snap.get("source"),
            "backend_home": snap.get("backend_home"),
            "hermes_home": snap.get("hermes_home"),
            "skills": snap.get("skills") if "skills" in include_set else None,
            "crons": snap.get("crons") if "crons" in include_set else None,
            "mcp_servers": snap.get("mcp_servers") if "mcp_servers" in include_set else None,
            "models": snap.get("models") if "models" in include_set else None,
            "integrations": snap.get("integrations") if "integrations" in include_set else None,
        }

    def _projects_list(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {
            "projects": deepcopy(self.projects),
            "source": "fake",
        }


# ---------------------------------------------------------------------------
# Lightweight schema-shape validators (stdlib; no jsonschema required)
# ---------------------------------------------------------------------------


def assert_ping_result(result: Mapping[str, Any]) -> None:
    if result.get("pong") is not True:
        raise AssertionError(f"brain.ping: expected pong=true, got {result!r}")
    if not isinstance(result.get("instance_id"), str) or not result["instance_id"]:
        raise AssertionError("brain.ping: instance_id required")
    if result.get("contract_version") != 1:
        raise AssertionError("brain.ping: contract_version must be 1")


def assert_health_result(result: Mapping[str, Any]) -> None:
    if result.get("status") not in ("ok", "degraded", "unavailable"):
        raise AssertionError(f"brain.health: invalid status {result.get('status')!r}")
    if not isinstance(result.get("checks"), dict):
        raise AssertionError("brain.health: checks object required")
    if not isinstance(result.get("versions"), dict):
        raise AssertionError("brain.health: versions object required")


def assert_settings_snapshot_result(result: Mapping[str, Any]) -> None:
    if not isinstance(result.get("exported_at"), str) or not result["exported_at"]:
        raise AssertionError("settings.snapshot: exported_at required")
    # Redaction: no obvious secret-shaped keys in the payload
    blob = str(result).lower()
    for needle in ("api_key", "apikey", "password", "secret_key", "private_key"):
        if needle in blob and "super-secret" not in blob:
            # only flag structured key names; content may mention "secret" paths
            pass
    for key in result.keys():
        kl = str(key).lower()
        if kl in ("api_key", "password", "secret", "token", "private_key"):
            raise AssertionError(f"settings.snapshot: secret-shaped key present: {key}")
    # At least one of the home fields
    if not (
        isinstance(result.get("backend_home"), str)
        or isinstance(result.get("hermes_home"), str)
    ):
        raise AssertionError("settings.snapshot: backend_home or hermes_home required")


def assert_projects_list_result(result: Mapping[str, Any]) -> None:
    projects = result.get("projects")
    if not isinstance(projects, list):
        raise AssertionError("projects.list: projects array required")
    if not isinstance(result.get("source"), str):
        raise AssertionError("projects.list: source string required")
    for p in projects:
        if not isinstance(p, dict):
            raise AssertionError("projects.list: project entries must be objects")
        if not isinstance(p.get("id"), str) or not p["id"]:
            raise AssertionError("projects.list: project.id required")
        if not isinstance(p.get("name"), str) or not p["name"]:
            raise AssertionError("projects.list: project.name required")


def assert_vault_list_result(result: Mapping[str, Any]) -> None:
    if not isinstance(result.get("path"), str):
        raise AssertionError("vault.list: path required")
    if not isinstance(result.get("entries"), list):
        raise AssertionError("vault.list: entries array required")
    if not isinstance(result.get("truncated"), bool):
        raise AssertionError("vault.list: truncated bool required")


def assert_vault_stat_result(result: Mapping[str, Any]) -> None:
    if result.get("kind") not in ("file", "directory"):
        raise AssertionError(f"vault.stat: invalid kind {result.get('kind')!r}")
    if not isinstance(result.get("path"), str):
        raise AssertionError("vault.stat: path required")
    if not isinstance(result.get("name"), str):
        raise AssertionError("vault.stat: name required")


def assert_vault_read_result(result: Mapping[str, Any]) -> None:
    if result.get("kind") != "file":
        raise AssertionError("vault.read: kind must be file")
    if result.get("encoding") not in ("utf-8", "base64"):
        raise AssertionError("vault.read: encoding must be utf-8 or base64")
    if not isinstance(result.get("content"), str):
        raise AssertionError("vault.read: content string required")
    if not isinstance(result.get("size_bytes"), int):
        raise AssertionError("vault.read: size_bytes int required")
    if not isinstance(result.get("path"), str):
        raise AssertionError("vault.read: path required")


def assert_vault_write_result(result: Mapping[str, Any]) -> None:
    """Shape assertion for typed vault.write success (lp-5q6.18)."""
    if not isinstance(result.get("path"), str) or not str(result.get("path")).startswith(
        "/"
    ):
        raise AssertionError("vault.write: path required and must start with /")
    rev = result.get("revision")
    if not isinstance(rev, dict):
        raise AssertionError("vault.write: revision object required")
    if not isinstance(rev.get("token"), str) or not rev.get("token"):
        raise AssertionError("vault.write: revision.token required")
    if rev.get("kind") not in (
        "etag",
        "content_hash",
        "host_revision",
        "mtime_size_fallback",
    ):
        raise AssertionError(f"vault.write: invalid revision.kind {rev.get('kind')!r}")
    if not isinstance(result.get("size_bytes"), int) or result["size_bytes"] < 0:
        raise AssertionError("vault.write: size_bytes int >= 0 required")
    if not isinstance(result.get("mime_type"), str) or not result.get("mime_type"):
        raise AssertionError("vault.write: mime_type required")
    if not isinstance(result.get("written_at"), str) or not result.get("written_at"):
        raise AssertionError("vault.write: written_at required")
