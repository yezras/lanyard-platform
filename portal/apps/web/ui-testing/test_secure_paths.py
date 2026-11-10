"""lp-p37.13: owner-only helpers for auth-state files."""

from __future__ import annotations

import os
import stat
from pathlib import Path

from secure_paths import is_owner_only_dir, is_owner_only_file, secure_secret_path


def test_secure_secret_path_sets_owner_only(tmp_path: Path) -> None:
    auth_dir = tmp_path / ".auth"
    target = auth_dir / "mocklab-agent.json"
    # Create overly open first (matches historical 664 findings).
    auth_dir.mkdir(mode=0o775)
    target.write_text('{"cookies":[]}\n', encoding="utf-8")
    os.chmod(target, 0o664)
    os.chmod(auth_dir, 0o775)

    secure_secret_path(target)

    assert is_owner_only_file(target)
    assert is_owner_only_dir(auth_dir)
    assert (target.stat().st_mode & 0o777) in (0o600, 0o400)
    assert (auth_dir.stat().st_mode & 0o777) in (0o700, 0o500)
