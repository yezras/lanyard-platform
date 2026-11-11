"""In-memory duplex NDJSON socket pair for offline harness tests.

Simulates the WebSocket byte/text stream the Portal relay and backend
gateway use, without opening ports or using the ``ws`` / ``websockets``
libraries.
"""

from __future__ import annotations

from collections import deque
from typing import Deque, Iterable


class MockSocketClosed(RuntimeError):
    """Raised when reading/writing a closed mock socket."""


class MockSocket:
    """One end of a linked in-memory text duplex.

    Writes append NDJSON (or raw strings) into the peer's receive queue.
    ``recv`` / ``recv_all`` read from this end's queue.
    """

    def __init__(self, name: str = "socket") -> None:
        self.name = name
        self._inbox: Deque[str] = deque()
        self._peer: MockSocket | None = None
        self._open = True
        self.sent: list[str] = []
        self.closed_reason: str | None = None

    # --- pairing ---------------------------------------------------------

    def pair_with(self, peer: "MockSocket") -> None:
        self._peer = peer
        peer._peer = self

    @classmethod
    def create_pair(
        cls,
        left_name: str = "relay",
        right_name: str = "gateway",
    ) -> tuple["MockSocket", "MockSocket"]:
        left = cls(left_name)
        right = cls(right_name)
        left.pair_with(right)
        return left, right

    # --- state -----------------------------------------------------------

    @property
    def open(self) -> bool:
        return self._open

    def close(self, reason: str | None = None) -> None:
        if not self._open:
            return
        self._open = False
        self.closed_reason = reason
        if self._peer is not None and self._peer._open:
            self._peer._open = False
            self._peer.closed_reason = reason or "peer_closed"

    # --- I/O -------------------------------------------------------------

    def send(self, data: str | bytes) -> None:
        if not self._open:
            raise MockSocketClosed(f"{self.name} is closed")
        if self._peer is None:
            raise MockSocketClosed(f"{self.name} has no peer")
        if not self._peer._open:
            raise MockSocketClosed(f"{self.name} peer is closed")
        text = data.decode("utf-8") if isinstance(data, (bytes, bytearray)) else str(data)
        self.sent.append(text)
        self._peer._inbox.append(text)

    def send_line(self, line: str) -> None:
        """Send one NDJSON line, ensuring a trailing newline."""
        if not line.endswith("\n"):
            line = line + "\n"
        self.send(line)

    def _ensure_readable(self) -> None:
        if not self._open and not self._inbox:
            raise MockSocketClosed(f"{self.name} is closed and empty")

    def recv(self) -> str:
        """Pop the next raw chunk written by the peer (may contain multiple frames)."""
        self._ensure_readable()
        if not self._inbox:
            raise MockSocketClosed(f"{self.name} inbox empty (no message available)")
        return self._inbox.popleft()

    def try_recv(self) -> str | None:
        if not self._inbox:
            return None
        return self._inbox.popleft()

    def recv_all(self) -> list[str]:
        """Drain all pending raw chunks."""
        items = list(self._inbox)
        self._inbox.clear()
        return items

    def pending_count(self) -> int:
        return len(self._inbox)

    def inject_local(self, data: str) -> None:
        """Test helper: put data into this socket's inbox without a peer send."""
        self._inbox.append(data)

    def __repr__(self) -> str:
        state = "open" if self._open else "closed"
        return f"MockSocket(name={self.name!r}, {state}, pending={len(self._inbox)})"


def join_chunks(chunks: Iterable[str]) -> str:
    return "".join(chunks)
