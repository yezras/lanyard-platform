"""Fake backend gateway client for offline harness tests.

Simulates the backend side of the egress WebSocket:

* sends ``hello``
* receives ``descriptor`` / ``inbound`` / ``interrupt_inbound`` / ``brain_rpc_request``
* can emit ``outbound`` and ``brain_rpc_result``
* optional :class:`FakeBrainRpcHost` auto-dispatch for required Brain RPC methods
"""

from __future__ import annotations

from typing import Any, Callable, Mapping

from .fake_brain_rpc import FakeBrainRpcHost
from .frames import (
    FrameError,
    LANYARD_WEB_PLATFORM,
    make_brain_rpc_result,
    make_hello,
    make_outbound_send,
    parse_frame,
    serialize_frame,
    validate_hello_frame,
)
from .mock_socket import MockSocket


class FakeBackendClient:
    """Minimal gateway client that speaks relay frames over a mock socket."""

    def __init__(
        self,
        socket: MockSocket,
        *,
        platform: str = LANYARD_WEB_PLATFORM,
        bot_id: str = "bot-fake-backend",
        on_frame: Callable[[dict[str, Any]], None] | None = None,
        brain_rpc: FakeBrainRpcHost | None = None,
        auto_brain_rpc: bool = False,
    ) -> None:
        self.socket = socket
        self.platform = platform
        self.bot_id = bot_id
        self.on_frame = on_frame
        self.brain_rpc = brain_rpc
        self.auto_brain_rpc = auto_brain_rpc or brain_rpc is not None
        self.received: list[dict[str, Any]] = []
        self.sent: list[dict[str, Any]] = []
        self.descriptor: dict[str, Any] | None = None
        self._buffer = ""
        self._replied_ids: set[str] = set()
    def _send_frame(self, frame: Mapping[str, Any]) -> None:
        line = serialize_frame(frame)
        self.socket.send(line)
        self.sent.append(dict(frame))

    def _drain(self) -> list[dict[str, Any]]:
        frames: list[dict[str, Any]] = []
        while True:
            chunk = self.socket.try_recv()
            if chunk is None:
                break
            self._buffer += chunk if isinstance(chunk, str) else chunk.decode("utf-8")
            while "\n" in self._buffer:
                line, self._buffer = self._buffer.split("\n", 1)
                if not line.strip():
                    continue
                frame = parse_frame(line)
                self.received.append(frame)
                if frame.get("type") == "descriptor" and isinstance(frame.get("descriptor"), dict):
                    self.descriptor = dict(frame["descriptor"])
                if (
                    self.auto_brain_rpc
                    and frame.get("type") == "brain_rpc_request"
                    and self.brain_rpc is not None
                ):
                    self._auto_reply_one(frame)
                if self.on_frame is not None:
                    self.on_frame(frame)
                frames.append(frame)
        return frames

    def poll(self) -> list[dict[str, Any]]:
        return self._drain()

    def connect_hello(self) -> dict[str, Any]:
        """Send a valid hello frame (gateway → connector)."""
        frame = make_hello(platform=self.platform, bot_id=self.bot_id)
        # Local validation ensures the fake backend only emits good hellos
        validate_hello_frame(frame)
        self._send_frame(frame)
        return frame

    def await_descriptor(self, *, max_polls: int = 4) -> dict[str, Any]:
        for _ in range(max_polls):
            for frame in self._drain():
                if frame.get("type") == "descriptor":
                    return frame
            if self.descriptor is not None:
                return {"type": "descriptor", "descriptor": self.descriptor}
        raise FrameError("no descriptor received after hello")

    def handshake(self) -> dict[str, Any]:
        """Send hello and wait for descriptor."""
        self.connect_hello()
        return self.await_descriptor()

    def frames_of_type(self, frame_type: str) -> list[dict[str, Any]]:
        self._drain()
        return [f for f in self.received if f.get("type") == frame_type]

    def send_outbound(self, content: str, *, request_id: str = "req-send-1") -> dict[str, Any]:
        frame = make_outbound_send(
            content,
            request_id=request_id,
            platform=self.platform,
        )
        self._send_frame(frame)
        return frame

    def reply_brain_rpc(
        self,
        request_id: str,
        *,
        ok: bool = True,
        result: Any = None,
        error: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        frame = make_brain_rpc_result(
            request_id,
            ok=ok,
            result=result,
            error=error,
            meta={"duration_ms": 1, "host": "fake-backend"},
        )
        self._send_frame(frame)
        return frame

    def auto_reply_brain_rpc_ping(self) -> int:
        """Respond to any pending brain.ping requests with a pong result.

        Returns the number of replies sent.
        """
        self._drain()
        count = 0
        for frame in self.received:
            if frame.get("type") != "brain_rpc_request":
                continue
            if frame.get("method") != "brain.ping":
                continue
            rid = frame.get("request_id")
            if not isinstance(rid, str):
                continue
            # Skip if we already replied to this id
            already = any(
                f.get("type") == "brain_rpc_result" and f.get("request_id") == rid
                for f in self.sent
            )
            if already or rid in self._replied_ids:
                continue
            if self.brain_rpc is not None:
                self._auto_reply_one(frame)
                count += 1
                continue
            params = frame.get("params") if isinstance(frame.get("params"), dict) else {}
            self.reply_brain_rpc(
                rid,
                ok=True,
                result={
                    "pong": True,
                    "echo": params.get("echo"),
                    "contract_version": 1,
                    "instance_id": "inst_conformance",
                },
            )
            count += 1
        return count

    def _auto_reply_one(self, frame: Mapping[str, Any]) -> None:
        """Dispatch one brain_rpc_request through FakeBrainRpcHost."""
        if self.brain_rpc is None:
            return
        rid = frame.get("request_id")
        if not isinstance(rid, str) or not rid:
            return
        if rid in self._replied_ids:
            return
        already = any(
            f.get("type") == "brain_rpc_result" and f.get("request_id") == rid
            for f in self.sent
        )
        if already:
            self._replied_ids.add(rid)
            return
        outcome = self.brain_rpc.handle_request_frame(frame)
        if outcome.get("ok"):
            self.reply_brain_rpc(rid, ok=True, result=outcome.get("result"))
        else:
            self.reply_brain_rpc(
                rid,
                ok=False,
                error=outcome.get("error")
                if isinstance(outcome.get("error"), dict)
                else {
                    "code": "internal",
                    "message": "fake host error",
                    "retryable": False,
                },
            )
        self._replied_ids.add(rid)

    def auto_reply_brain_rpc(self) -> int:
        """Respond to all pending brain_rpc_request frames via FakeBrainRpcHost.

        Requires ``brain_rpc`` host. Returns the number of replies sent.
        """
        if self.brain_rpc is None:
            raise RuntimeError("auto_reply_brain_rpc requires brain_rpc host")
        self._drain()
        count = 0
        for frame in list(self.received):
            if frame.get("type") != "brain_rpc_request":
                continue
            rid = frame.get("request_id")
            if not isinstance(rid, str):
                continue
            if rid in self._replied_ids:
                continue
            already = any(
                f.get("type") == "brain_rpc_result" and f.get("request_id") == rid
                for f in self.sent
            )
            if already:
                self._replied_ids.add(rid)
                continue
            self._auto_reply_one(frame)
            count += 1
        return count
