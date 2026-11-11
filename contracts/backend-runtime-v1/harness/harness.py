"""Fake relay harness — connector side without Portal infrastructure.

Acts as the Portal relay session for backend conformance:

1. Accepts a gateway connection over a duplex socket (real WS later; mock for tests)
2. Validates the gateway ``hello`` frame and replies with a ``descriptor``
3. Injects chat ``inbound`` frames (Portal → backend)
4. Sends ``interrupt_inbound`` (mid-turn stop)
5. Sends ``brain_rpc_request`` and correlates ``brain_rpc_result`` by request_id

Offline by design: works with :class:`MockSocket` or any object implementing
``send(str)`` / ``recv()`` / ``try_recv()`` / ``open``.
"""

from __future__ import annotations

import uuid
from typing import Any, Callable, Mapping, Protocol

from .descriptor import create_lanyard_web_descriptor, is_valid_capability_descriptor
from .frames import (
    FrameError,
    is_brain_rpc_result,
    make_brain_rpc_request,
    make_inbound,
    make_interrupt_inbound,
    parse_frame,
    parse_frame_buffer,
    serialize_frame,
    validate_hello_frame,
)


class SocketLike(Protocol):
    def send(self, data: str | bytes) -> None: ...

    def try_recv(self) -> str | None: ...

    @property
    def open(self) -> bool: ...


class HandshakeError(FrameError):
    """Hello / descriptor handshake failed."""


class HarnessNotReady(RuntimeError):
    """Operation requires a completed hello handshake."""


class BrainRpcTimeout(TimeoutError):
    """No matching brain_rpc_result arrived before the wait budget."""


class FakeRelayHarness:
    """Minimal connector-side relay for backend conformance tests."""

    def __init__(
        self,
        socket: SocketLike,
        *,
        descriptor: Mapping[str, Any] | None = None,
        instance_id: str = "inst_conformance",
        tenant_id: str = "ten_conformance",
        on_frame: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.socket = socket
        self.descriptor = dict(descriptor) if descriptor is not None else create_lanyard_web_descriptor()
        if not is_valid_capability_descriptor(self.descriptor):
            raise ValueError("invalid CapabilityDescriptor for harness")
        self.instance_id = instance_id
        self.tenant_id = tenant_id
        self.on_frame = on_frame

        self.handshake_complete = False
        self.hello: dict[str, str] | None = None
        self.received: list[dict[str, Any]] = []
        self.sent: list[dict[str, Any]] = []
        self._buffer = ""

    # --- low-level I/O ---------------------------------------------------

    def _send_frame(self, frame: Mapping[str, Any]) -> None:
        if not self.socket.open:
            raise HarnessNotReady("socket is closed")
        line = serialize_frame(frame)
        self.socket.send(line)
        as_dict = dict(frame)
        self.sent.append(as_dict)

    def _drain_incoming(self) -> list[dict[str, Any]]:
        """Read any pending peer data and parse NDJSON frames."""
        frames: list[dict[str, Any]] = []
        while True:
            chunk = self.socket.try_recv()
            if chunk is None:
                break
            self._buffer += chunk if isinstance(chunk, str) else chunk.decode("utf-8")
            # Process complete lines; keep remainder for partial frames
            while "\n" in self._buffer:
                line, self._buffer = self._buffer.split("\n", 1)
                if not line.strip():
                    continue
                frame = parse_frame(line)
                self.received.append(frame)
                if self.on_frame is not None:
                    self.on_frame(frame)
                frames.append(frame)
        return frames

    def poll(self) -> list[dict[str, Any]]:
        """Drain and return newly received frames (does not drive handshake)."""
        return self._drain_incoming()

    # --- handshake -------------------------------------------------------

    def accept_hello(self, frame: Mapping[str, Any] | None = None) -> dict[str, str]:
        """Validate a hello frame and complete the handshake.

        If *frame* is None, drain the socket and take the first ``hello``.
        On success, sends the harness ``descriptor`` reply and marks the
        session ready for inject/interrupt/Brain RPC.
        """
        if frame is None:
            pending = self._drain_incoming()
            hellos = [f for f in pending if f.get("type") == "hello"]
            if not hellos:
                # Also accept a hello that arrived earlier in self.received
                hellos = [f for f in self.received if f.get("type") == "hello"]
            if not hellos:
                raise HandshakeError("no hello frame received from gateway")
            frame = hellos[-1]

        hello = validate_hello_frame(frame)
        self.hello = hello
        # Reply with descriptor (Portal relay behaviour)
        self._send_frame({"type": "descriptor", "descriptor": self.descriptor})
        self.handshake_complete = True
        return hello

    def require_ready(self) -> None:
        if not self.handshake_complete:
            raise HarnessNotReady(
                "handshake incomplete: call accept_hello() after the gateway sends hello"
            )
        if not self.socket.open:
            raise HarnessNotReady("socket is closed")

    # --- portal → gateway operations -------------------------------------

    def inject_chat(
        self,
        text: str,
        *,
        chat_id: str = "chat-conformance",
        user_id: str = "user-conformance",
        message_id: str | None = None,
        buffer_id: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Inject a chat message as an ``inbound`` frame (acceptance criterion)."""
        self.require_ready()
        frame = make_inbound(
            text,
            chat_id=chat_id,
            user_id=user_id,
            platform=str(self.descriptor.get("platform", "lanyard_web")),
            message_id=message_id or f"msg-{uuid.uuid4().hex[:12]}",
            buffer_id=buffer_id,
            metadata=metadata,
        )
        self._send_frame(frame)
        return frame

    def send_interrupt(
        self,
        session_key: str,
        chat_id: str,
    ) -> dict[str, Any]:
        """Send ``interrupt_inbound`` mid-turn stop (acceptance criterion)."""
        self.require_ready()
        frame = make_interrupt_inbound(session_key, chat_id)
        self._send_frame(frame)
        return frame

    def send_brain_rpc(
        self,
        method: str,
        *,
        request_id: str | None = None,
        params: Mapping[str, Any] | None = None,
        timeout_ms: int | None = None,
        backend_profile: str = "contributor",
        path_prefixes: list[str] | None = None,
        wait: bool = False,
        max_polls: int = 8,
    ) -> dict[str, Any]:
        """Send a ``brain_rpc_request`` frame (acceptance criterion).

        When *wait* is True, poll for a matching ``brain_rpc_result`` and
        return that result frame (the peer must already have written the
        result, or will write it as we poll). Otherwise return the request.
        """
        self.require_ready()
        rid = request_id or f"req_{uuid.uuid4().hex[:16]}"
        request = make_brain_rpc_request(
            method,
            request_id=rid,
            params=params,
            tenant_id=self.tenant_id,
            instance_id=self.instance_id,
            backend_profile=backend_profile,
            path_prefixes=path_prefixes,
            timeout_ms=timeout_ms,
        )
        self._send_frame(request)
        if not wait:
            return request
        return self.wait_brain_rpc_result(rid, max_polls=max_polls)

    def wait_brain_rpc_result(
        self,
        request_id: str,
        *,
        max_polls: int = 8,
    ) -> dict[str, Any]:
        """Poll until a ``brain_rpc_result`` with *request_id* arrives."""
        rid = request_id
        for _ in range(max_polls):
            for frame in self._drain_incoming():
                if is_brain_rpc_result(frame) and frame.get("request_id") == rid:
                    return frame
            for frame in reversed(self.received):
                if is_brain_rpc_result(frame) and frame.get("request_id") == rid:
                    return frame
        raise BrainRpcTimeout(f"no brain_rpc_result for request_id={rid!r}")

    # --- helpers for tests / transcripts ---------------------------------

    def frames_of_type(self, frame_type: str, *, direction: str = "received") -> list[dict[str, Any]]:
        bucket = self.received if direction == "received" else self.sent
        return [f for f in bucket if f.get("type") == frame_type]

    def transcript(self) -> str:
        """NDJSON of all frames the harness has sent (connector → gateway)."""
        return "".join(serialize_frame(f) for f in self.sent)


def run_handshake_from_buffer(buffer: str) -> tuple[dict[str, str], dict[str, Any]]:
    """Utility: validate hello from an NDJSON transcript without a live socket.

    Returns ``(hello, descriptor_frame)``.
    """
    frames = parse_frame_buffer(buffer)
    hello_frames = [f for f in frames if f.get("type") == "hello"]
    if not hello_frames:
        raise HandshakeError("transcript has no hello frame")
    hello = validate_hello_frame(hello_frames[0])
    descriptor_frame = {
        "type": "descriptor",
        "descriptor": create_lanyard_web_descriptor(),
    }
    return hello, descriptor_frame
