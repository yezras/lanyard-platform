"""Owner-only permissions for local secret / session artifacts (lp-p37.13).

Use after writing Playwright storage_state or other credential files:

    from secure_paths import secure_secret_path

    context.storage_state(path=str(auth_path))
    secure_secret_path(auth_path)
"""

from __future__ import annotations

import os
import stat
from pathlib import Path


def secure_secret_path(path: str | Path) -> Path:
    """Ensure parent dir is 0700 and the file is 0600 when present.

    Best-effort on non-POSIX filesystems (errors ignored after chmod attempt).
    """
    p = Path(path).expanduser().resolve()
    parent = p.parent
    parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(parent, 0o700)
    except OSError:
        pass
    if p.is_file():
        try:
            os.chmod(p, 0o600)
        except OSError:
            pass
    return p


def is_owner_only_file(path: str | Path) -> bool:
    """True if path exists and has no group/other permission bits."""
    p = Path(path)
    if not p.is_file():
        return False
    mode = p.stat().st_mode
    return (mode & (stat.S_IRWXG | stat.S_IRWXO)) == 0


def is_owner_only_dir(path: str | Path) -> bool:
    p = Path(path)
    if not p.is_dir():
        return False
    mode = p.stat().st_mode
    return (mode & (stat.S_IRWXG | stat.S_IRWXO)) == 0
