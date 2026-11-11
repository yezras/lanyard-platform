"""Fake relay harness for backend-runtime-v1 conformance (lp-k7g.11.1 / .11.3).

Speaks relay NDJSON frames without Portal infrastructure. Offline tests use
:class:`MockSocket`, :class:`FakeBackendClient`, and :class:`FakeBrainRpcHost`.
"""

from .descriptor import create_lanyard_web_descriptor, is_valid_capability_descriptor
from .fake_backend import FakeBackendClient
from .fake_brain_rpc import (
    REQUIRED_BRAIN_RPC_METHODS,
    FakeBrainRpcHost,
    FakeBrainRpcOptions,
    FakeVaultFile,
)
from .frames import (
    BRAIN_RPC_CONTRACT_VERSION,
    LANYARD_WEB_PLATFORM,
    RELAY_CONTRACT_VERSION,
    FrameError,
    make_brain_rpc_request,
    make_hello,
    make_inbound,
    make_interrupt_inbound,
    parse_frame,
    serialize_frame,
    validate_hello_frame,
)
from .harness import FakeRelayHarness, HandshakeError, HarnessNotReady
from .mock_socket import MockSocket

__all__ = [
    "BRAIN_RPC_CONTRACT_VERSION",
    "LANYARD_WEB_PLATFORM",
    "RELAY_CONTRACT_VERSION",
    "REQUIRED_BRAIN_RPC_METHODS",
    "FakeBackendClient",
    "FakeBrainRpcHost",
    "FakeBrainRpcOptions",
    "FakeRelayHarness",
    "FakeVaultFile",
    "FrameError",
    "HandshakeError",
    "HarnessNotReady",
    "MockSocket",
    "create_lanyard_web_descriptor",
    "is_valid_capability_descriptor",
    "make_brain_rpc_request",
    "make_hello",
    "make_inbound",
    "make_interrupt_inbound",
    "parse_frame",
    "serialize_frame",
    "validate_hello_frame",
]
