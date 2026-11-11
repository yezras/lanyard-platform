#!/usr/bin/env python3
"""Deprecated wrapper — use deploy/scripts/archive-unused-daytona-sandboxes.py.

lp-zuh.11.7 archived every non-archived org sandbox. That can destroy the
bound MockLab (or future tenant) sandbox_id after an idle stop. lp-oop.37.7
replaces it with a dry-run-default job that keeps CP registry bindings.

This wrapper forwards to the new script. --keep-started is a no-op (started
unbound boxes are already skipped). --apply is required to mutate.
"""
from __future__ import annotations

import os
import sys

NEW = os.path.normpath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "scripts",
        "archive-unused-daytona-sandboxes.py",
    )
)


def main() -> int:
    print(
        "WARN: deploy/daytona/archive-orphan-sandboxes.py is superseded by "
        "deploy/scripts/archive-unused-daytona-sandboxes.py (lp-oop.37.7). "
        "Dry-run is the default; pass --apply to mutate. Bound sandbox_ids "
        "must come from --keep-id / --cp-instances-json / CP tenant list.",
        file=sys.stderr,
    )
    forwarded: list[str] = []
    for arg in sys.argv[1:]:
        if arg == "--keep-started":
            continue
        forwarded.append(arg)
    os.execv(sys.executable, [sys.executable, NEW, *forwarded])
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
