#!/usr/bin/env python3
"""Run offline fake-relay-harness unit tests (stdlib unittest).

Usage (from repository root or this directory):

  python3 contracts/backend-runtime-v1/harness/run_tests.py
  python3 -m contracts.backend-runtime-v1.harness.run_tests   # not a valid package path
  cd contracts/backend-runtime-v1 && python3 -m harness.run_tests

Exit 0 on success; non-zero on failure. No network.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path


def main() -> int:
    # Ensure parent of `harness/` is on sys.path so `import harness` works
    # whether we are invoked as a script or via -m from backend-runtime-v1.
    here = Path(__file__).resolve().parent
    parent = here.parent
    if str(parent) not in sys.path:
        sys.path.insert(0, str(parent))

    # Import after path setup so relative package imports resolve.
    from harness import test_harness  # noqa: WPS433 — runtime path bootstrap

    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(test_harness)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
