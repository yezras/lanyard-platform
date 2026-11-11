#!/usr/bin/env python3
"""Run offline Brain RPC required-method conformance tests (lp-k7g.11.3).

Usage (from repository root or this directory):

  python3 contracts/backend-runtime-v1/harness/run_brain_rpc_conformance.py

Exit 0 on success; non-zero on failure. No network.
Uses FakeBrainRpcHost + FakeRelayHarness (mirrors Portal FakeBrainRpcInvoker).
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path


def main() -> int:
    here = Path(__file__).resolve().parent
    parent = here.parent
    if str(parent) not in sys.path:
        sys.path.insert(0, str(parent))

    from harness import test_brain_rpc_required  # noqa: WPS433 — runtime path bootstrap

    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(test_brain_rpc_required)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
