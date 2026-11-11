"""Offline unit tests for the fake relay harness (lp-k7g.11.1).

Uses stdlib unittest + MockSocket — no Portal, no network, no third-party deps.
"""

from __future__ import annotations

import unittest

from .descriptor import create_lanyard_web_descriptor, is_valid_capability_descriptor
from .fake_backend import FakeBackendClient
from .frames import (
    FrameError,
    LANYARD_WEB_PLATFORM,
    make_hello,
    parse_frame,
    parse_frame_buffer,
    serialize_frame,
    validate_hello_frame,
)
from .harness import (
    FakeRelayHarness,
    HandshakeError,
    HarnessNotReady,
    run_handshake_from_buffer,
)
from .mock_socket import MockSocket


class HelloValidationTests(unittest.TestCase):
    def test_valid_hello(self) -> None:
        hello = make_hello(platform="lanyard_web", bot_id="bot-1")
        normalized = validate_hello_frame(hello)
        self.assertEqual(normalized["type"], "hello")
        self.assertEqual(normalized["platform"], "lanyard_web")
        self.assertEqual(normalized["botId"], "bot-1")

    def test_rejects_missing_platform(self) -> None:
        with self.assertRaises(FrameError):
            validate_hello_frame({"type": "hello", "botId": "bot-1"})

    def test_rejects_empty_bot_id(self) -> None:
        with self.assertRaises(FrameError):
            validate_hello_frame({"type": "hello", "platform": "x", "botId": "  "})

    def test_rejects_wrong_type(self) -> None:
        with self.assertRaises(FrameError):
            validate_hello_frame({"type": "descriptor", "platform": "x", "botId": "y"})

    def test_serialize_roundtrip(self) -> None:
        hello = make_hello()
        parsed = parse_frame(serialize_frame(hello))
        self.assertEqual(parsed, hello)


class FrameBufferTests(unittest.TestCase):
    def test_multi_frame_ndjson(self) -> None:
        transcript = (
            serialize_frame(make_hello())
            + serialize_frame({"type": "descriptor", "descriptor": create_lanyard_web_descriptor()})
        )
        frames = parse_frame_buffer(transcript)
        self.assertEqual(len(frames), 2)
        self.assertEqual(frames[0]["type"], "hello")
        self.assertEqual(frames[1]["type"], "descriptor")


class DescriptorTests(unittest.TestCase):
    def test_lanyard_web_descriptor_shape(self) -> None:
        d = create_lanyard_web_descriptor()
        self.assertTrue(is_valid_capability_descriptor(d))
        self.assertEqual(d["platform"], LANYARD_WEB_PLATFORM)
        self.assertEqual(d["contract_version"], 1)


class MockSocketTests(unittest.TestCase):
    def test_pair_send_recv(self) -> None:
        a, b = MockSocket.create_pair("a", "b")
        a.send_line('{"type":"hello"}\n')
        self.assertEqual(b.try_recv(), '{"type":"hello"}\n')
        self.assertIsNone(a.try_recv())

    def test_close_propagates(self) -> None:
        a, b = MockSocket.create_pair()
        a.close("bye")
        self.assertFalse(a.open)
        self.assertFalse(b.open)


class HarnessHelloAcceptanceTests(unittest.TestCase):
    """Acceptance: harness validates hello frame."""

    def test_accept_hello_and_reply_descriptor(self) -> None:
        relay_sock, gateway_sock = MockSocket.create_pair("relay", "gateway")
        harness = FakeRelayHarness(relay_sock)
        backend = FakeBackendClient(gateway_sock)

        backend.connect_hello()
        hello = harness.accept_hello()
        self.assertEqual(hello["platform"], LANYARD_WEB_PLATFORM)
        self.assertTrue(harness.handshake_complete)

        descriptor_frame = backend.await_descriptor()
        self.assertEqual(descriptor_frame["type"], "descriptor")
        self.assertEqual(descriptor_frame["descriptor"]["platform"], LANYARD_WEB_PLATFORM)
        self.assertTrue(is_valid_capability_descriptor(descriptor_frame["descriptor"]))

    def test_reject_invalid_hello(self) -> None:
        relay_sock, gateway_sock = MockSocket.create_pair()
        harness = FakeRelayHarness(relay_sock)
        gateway_sock.send(serialize_frame({"type": "hello", "platform": "", "botId": "x"}))
        with self.assertRaises(FrameError):
            harness.accept_hello()
        self.assertFalse(harness.handshake_complete)

    def test_handshake_helper_from_buffer(self) -> None:
        buffer = serialize_frame(make_hello(platform="telegram", bot_id="bot-9"))
        hello, descriptor = run_handshake_from_buffer(buffer)
        self.assertEqual(hello["platform"], "telegram")
        self.assertEqual(descriptor["type"], "descriptor")


class HarnessInjectChatTests(unittest.TestCase):
    """Acceptance: harness injects chat messages."""

    def _ready_pair(self) -> tuple[FakeRelayHarness, FakeBackendClient]:
        relay_sock, gateway_sock = MockSocket.create_pair("relay", "gateway")
        harness = FakeRelayHarness(relay_sock)
        backend = FakeBackendClient(gateway_sock)
        backend.connect_hello()
        harness.accept_hello()
        backend.await_descriptor()
        return harness, backend

    def test_inject_chat_delivers_inbound(self) -> None:
        harness, backend = self._ready_pair()
        frame = harness.inject_chat("hello brain", chat_id="chat-abc", message_id="msg-1")
        self.assertEqual(frame["type"], "inbound")
        self.assertEqual(frame["event"]["text"], "hello brain")

        inbound = backend.frames_of_type("inbound")
        self.assertEqual(len(inbound), 1)
        self.assertEqual(inbound[0]["event"]["text"], "hello brain")
        self.assertEqual(inbound[0]["event"]["source"]["chat_id"], "chat-abc")
        self.assertEqual(inbound[0]["event"]["source"]["platform"], LANYARD_WEB_PLATFORM)

    def test_inject_requires_handshake(self) -> None:
        relay_sock, _ = MockSocket.create_pair()
        harness = FakeRelayHarness(relay_sock)
        with self.assertRaises(HarnessNotReady):
            harness.inject_chat("too early")


class HarnessInterruptAndBrainRpcTests(unittest.TestCase):
    """Acceptance: harness sends interrupt and Brain RPC requests."""

    def _handshake(self) -> tuple[FakeRelayHarness, FakeBackendClient]:
        relay_sock, gateway_sock = MockSocket.create_pair("relay", "gateway")
        harness = FakeRelayHarness(relay_sock, instance_id="inst_test", tenant_id="ten_test")
        backend = FakeBackendClient(gateway_sock)
        backend.connect_hello()
        harness.accept_hello()
        backend.await_descriptor()
        return harness, backend

    def test_send_interrupt_inbound(self) -> None:
        harness, backend = self._handshake()
        session_key = "agent:main:lanyard_web:dm:chat-abc"
        frame = harness.send_interrupt(session_key, "chat-abc")
        self.assertEqual(frame["type"], "interrupt_inbound")
        self.assertEqual(frame["session_key"], session_key)

        interrupts = backend.frames_of_type("interrupt_inbound")
        self.assertEqual(len(interrupts), 1)
        self.assertEqual(interrupts[0]["chat_id"], "chat-abc")

    def test_send_brain_rpc_request(self) -> None:
        harness, backend = self._handshake()
        request = harness.send_brain_rpc(
            "brain.ping",
            request_id="req_ping_1",
            params={"echo": "hi"},
        )
        self.assertEqual(request["type"], "brain_rpc_request")
        self.assertEqual(request["method"], "brain.ping")
        self.assertEqual(request["auth"]["instance_id"], "inst_test")
        self.assertEqual(request["auth"]["subject"]["backend_profile"], "contributor")

        rpcs = backend.frames_of_type("brain_rpc_request")
        self.assertEqual(len(rpcs), 1)
        self.assertEqual(rpcs[0]["request_id"], "req_ping_1")
        self.assertEqual(rpcs[0]["params"]["echo"], "hi")

    def test_brain_rpc_correlated_result(self) -> None:
        harness, backend = self._handshake()
        harness.send_brain_rpc(
            "brain.ping",
            request_id="req_corr",
            params={"echo": "corr"},
        )
        self.assertEqual(backend.auto_reply_brain_rpc_ping(), 1)

        results = [f for f in harness.poll() if f.get("type") == "brain_rpc_result"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["request_id"], "req_corr")
        self.assertTrue(results[0]["ok"])
        self.assertEqual(results[0]["result"]["echo"], "corr")

    def test_brain_rpc_wait_true_with_eager_backend(self) -> None:
        """wait=True correlates when the peer replies before the wait loop finishes.

        Wire a FakeBackendClient on_frame hook that replies to brain.ping as
        soon as the request lands — models a responsive gateway under test.
        """
        relay_sock, gateway_sock = MockSocket.create_pair("relay", "gateway")
        harness = FakeRelayHarness(relay_sock)

        def on_backend_frame(frame: dict) -> None:
            if frame.get("type") == "brain_rpc_request" and frame.get("method") == "brain.ping":
                rid = frame["request_id"]
                params = frame.get("params") if isinstance(frame.get("params"), dict) else {}
                backend.reply_brain_rpc(
                    rid,
                    ok=True,
                    result={"pong": True, "echo": params.get("echo"), "contract_version": 1},
                )

        backend = FakeBackendClient(gateway_sock, on_frame=on_backend_frame)
        backend.connect_hello()
        harness.accept_hello()
        backend.await_descriptor()

        # Deliver the request into the backend inbox so on_frame can fire during poll inside wait.
        # send_brain_rpc(wait=True) only polls the harness socket; the backend must reply first.
        request = harness.send_brain_rpc(
            "brain.ping",
            request_id="req_wait",
            params={"echo": "wait"},
            wait=False,
        )
        self.assertEqual(request["request_id"], "req_wait")
        # Drain backend (triggers on_frame → reply), then wait on harness
        backend.poll()
        result = harness.wait_brain_rpc_result("req_wait")
        self.assertTrue(result["ok"])
        self.assertEqual(result["result"]["echo"], "wait")

    def test_interrupt_and_rpc_require_handshake(self) -> None:
        relay_sock, _ = MockSocket.create_pair()
        harness = FakeRelayHarness(relay_sock)
        with self.assertRaises(HarnessNotReady):
            harness.send_interrupt("sk", "chat")
        with self.assertRaises(HarnessNotReady):
            harness.send_brain_rpc("brain.ping")


class EndToEndConformanceFlowTests(unittest.TestCase):
    """Full offline flow: hello → chat inject → interrupt → brain.ping."""

    def test_full_session_script(self) -> None:
        relay_sock, gateway_sock = MockSocket.create_pair("relay", "gateway")
        harness = FakeRelayHarness(relay_sock)
        backend = FakeBackendClient(gateway_sock, platform=LANYARD_WEB_PLATFORM, bot_id="bot-e2e")

        # 1. Hello validation
        backend.connect_hello()
        hello = harness.accept_hello()
        self.assertEqual(hello["botId"], "bot-e2e")
        backend.await_descriptor()

        # 2. Chat injection
        harness.inject_chat("run conformance suite", chat_id="chat-e2e")
        self.assertEqual(backend.frames_of_type("inbound")[0]["event"]["text"], "run conformance suite")

        # 3. Interrupt
        harness.send_interrupt("agent:main:lanyard_web:dm:chat-e2e", "chat-e2e")
        self.assertEqual(len(backend.frames_of_type("interrupt_inbound")), 1)

        # 4. Brain RPC
        harness.send_brain_rpc("brain.health", request_id="req_health", params={})
        health_reqs = backend.frames_of_type("brain_rpc_request")
        self.assertEqual(health_reqs[-1]["method"], "brain.health")
        backend.reply_brain_rpc(
            "req_health",
            ok=True,
            result={"status": "ok", "version": "fake-0.0.0"},
        )
        results = [f for f in harness.poll() if f.get("type") == "brain_rpc_result"]
        self.assertEqual(results[-1]["result"]["status"], "ok")

        # Transcript is pure NDJSON the connector emitted
        transcript = harness.transcript()
        types = [f["type"] for f in parse_frame_buffer(transcript)]
        self.assertEqual(
            types,
            ["descriptor", "inbound", "interrupt_inbound", "brain_rpc_request"],
        )


class NegativeTests(unittest.TestCase):
    def test_accept_hello_without_data(self) -> None:
        relay_sock, _ = MockSocket.create_pair()
        harness = FakeRelayHarness(relay_sock)
        with self.assertRaises(HandshakeError):
            harness.accept_hello()

    def test_empty_frame_line(self) -> None:
        with self.assertRaises(FrameError):
            parse_frame("   ")


if __name__ == "__main__":
    unittest.main()
