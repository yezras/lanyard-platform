import type {
  BrainRpcRequestFrame,
  BrainRpcResultFrame,
  CapabilityDescriptor,
  GatewayToConnectorFrame,
  InboundFrame,
  MessageEvent,
  OutboundFrame,
  OutboundResultFrame,
} from "@lanyard/shared";
import {
  clampBrainRpcTimeoutMs,
  isBrainRpcResultFrame,
  LANYARD_WEB_DESCRIPTOR,
} from "@lanyard/shared";
import type { WebSocket } from "ws";
import type { SecretRecord } from "./secret-store.js";
import type { WebPlatformAdapter } from "./web-platform-adapter.js";

export interface RelaySessionInfo {
  gatewayId: string;
  instanceId: string;
  tenantId?: string;
  handshakeComplete: boolean;
}

export type BrainRpcDeliveryResult =
  | { ok: true; result: BrainRpcResultFrame }
  | {
      ok: false;
      reason: "not_connected" | "timeout" | "socket_closed";
      message: string;
    };

export interface RelaySession {
  readonly info: RelaySessionInfo;
  deliverInbound(event: MessageEvent, bufferId?: string): void;
  /**
   * Send interrupt_inbound to the connected Hermes gateway (mid-turn stop).
   * session_key must match Hermes DM key (e.g. agent:main:lanyard_web:dm:<chat_id>).
   */
  deliverInterruptInbound(sessionKey: string, chatId: string): void;
  /** Halt freeze notice. Agent SessionMap.abort is lac-r9w.3.2. */
  deliverMailboxHalt(chatId: string): void;
  /** Human message in the room: unfreeze. */
  deliverMailboxThaw(chatId: string): void;
  /**
   * G3.3: deliver brain_rpc_request and wait for matching brain_rpc_result.
   * Fail-closed when the gateway is not connected or the host exceeds timeout.
   */
  deliverBrainRpc(request: BrainRpcRequestFrame): Promise<BrainRpcDeliveryResult>;
  close(code?: number, reason?: string): void;
}

interface Identity {
  platform: string;
  botId: string;
}

export type RelaySessionHooks = {
  /** Fired once when hello handshake completes (G6 owner claim). */
  onHandshakeComplete?: (session: RelaySessionImpl) => void;
};

type PendingBrainRpc = {
  resolve: (value: BrainRpcDeliveryResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class RelaySessionImpl implements RelaySession {
  readonly info: RelaySessionInfo;
  private readonly socket: WebSocket;
  private readonly descriptor: CapabilityDescriptor;
  private readonly hooks: RelaySessionHooks;
  private identities: Identity[] = [];
  private handshakeComplete = false;
  private buffer = "";
  private readonly pendingBrainRpc = new Map<string, PendingBrainRpc>();

  constructor(
    socket: WebSocket,
    record: SecretRecord,
    private readonly webAdapter: WebPlatformAdapter,
    descriptor: CapabilityDescriptor = LANYARD_WEB_DESCRIPTOR,
    hooks: RelaySessionHooks = {},
  ) {
    this.socket = socket;
    this.descriptor = descriptor;
    this.hooks = hooks;
    this.info = {
      gatewayId: record.gatewayId,
      instanceId: record.instanceId,
      tenantId: record.tenantId,
      handshakeComplete: false,
    };

    socket.on("message", (data) => this.onMessage(data));
    socket.on("close", () => this.onClose());
  }

  deliverInbound(event: MessageEvent, bufferId?: string): void {
    if (!this.handshakeComplete || this.socket.readyState !== this.socket.OPEN) {
      return;
    }
    const frame: InboundFrame = { type: "inbound", event, ...(bufferId ? { bufferId } : {}) };
    this.sendFrame(frame);
  }

  deliverInterruptInbound(sessionKey: string, chatId: string): void {
    if (!this.handshakeComplete || this.socket.readyState !== this.socket.OPEN) {
      return;
    }
    this.sendFrame({
      type: "interrupt_inbound",
      session_key: sessionKey,
      chat_id: chatId,
    });
  }

  deliverMailboxHalt(chatId: string): void {
    if (!this.handshakeComplete || this.socket.readyState !== this.socket.OPEN) {
      return;
    }
    this.sendFrame({
      type: "mailbox_halt",
      chat_id: chatId,
    });
  }

  deliverMailboxThaw(chatId: string): void {
    if (!this.handshakeComplete || this.socket.readyState !== this.socket.OPEN) {
      return;
    }
    this.sendFrame({
      type: "mailbox_thaw",
      chat_id: chatId,
    });
  }

  deliverBrainRpc(request: BrainRpcRequestFrame): Promise<BrainRpcDeliveryResult> {
    if (!this.handshakeComplete || this.socket.readyState !== this.socket.OPEN) {
      return Promise.resolve({
        ok: false,
        reason: "not_connected",
        message: "Gateway not connected or handshake incomplete",
      });
    }

    const requestId = request.request_id?.trim();
    if (!requestId) {
      return Promise.resolve({
        ok: false,
        reason: "not_connected",
        message: "brain_rpc_request.request_id is required",
      });
    }

    if (this.pendingBrainRpc.has(requestId)) {
      return Promise.resolve({
        ok: false,
        reason: "not_connected",
        message: "duplicate brain rpc request_id already in flight",
      });
    }

    const timeoutMs = clampBrainRpcTimeoutMs(request.timeout_ms);
    const frame: BrainRpcRequestFrame = {
      ...request,
      type: "brain_rpc_request",
      timeout_ms: timeoutMs,
    };

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingBrainRpc.delete(requestId);
        resolve({
          ok: false,
          reason: "timeout",
          message: `brain rpc timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);

      this.pendingBrainRpc.set(requestId, { resolve, timer });
      this.sendFrame(frame);
    });
  }

  close(code?: number, reason?: string): void {
    if (this.socket.readyState === this.socket.OPEN) {
      this.socket.close(code, reason);
    }
  }

  private onClose(): void {
    this.handshakeComplete = false;
    this.info.handshakeComplete = false;
    for (const [requestId, pending] of this.pendingBrainRpc) {
      clearTimeout(pending.timer);
      pending.resolve({
        ok: false,
        reason: "socket_closed",
        message: "Gateway session closed before brain rpc result",
      });
      this.pendingBrainRpc.delete(requestId);
    }
  }

  private onMessage(data: WebSocket.RawData): void {
    const chunk = typeof data === "string" ? data : data.toString("utf8");
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let frame: GatewayToConnectorFrame;
    try {
      frame = JSON.parse(line) as GatewayToConnectorFrame;
    } catch {
      return;
    }

    switch (frame.type) {
      case "hello":
        this.handleHello(frame.platform, frame.botId);
        break;
      case "outbound":
        this.handleOutbound(frame);
        break;
      case "brain_rpc_result":
        this.handleBrainRpcResult(frame);
        break;
      default:
        break;
    }
  }

  private handleHello(platform: string, botId: string): void {
    this.identities.push({ platform, botId });
    if (!this.handshakeComplete) {
      this.handshakeComplete = true;
      this.info.handshakeComplete = true;
      this.sendFrame({
        type: "descriptor",
        descriptor: this.descriptor,
      });
      this.hooks.onHandshakeComplete?.(this);
    }
  }

  private handleOutbound(frame: OutboundFrame): void {
    const result = this.webAdapter.handleOutbound(frame.action);
    const response: OutboundResultFrame = {
      type: "outbound_result",
      requestId: frame.requestId,
      result,
    };
    this.sendFrame(response);
  }

  private handleBrainRpcResult(frame: BrainRpcResultFrame): void {
    if (!isBrainRpcResultFrame(frame)) return;
    const requestId = frame.request_id?.trim();
    if (!requestId) return;
    const pending = this.pendingBrainRpc.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingBrainRpc.delete(requestId);
    pending.resolve({ ok: true, result: frame });
  }

  private sendFrame(frame: object): void {
    if (this.socket.readyState !== this.socket.OPEN) return;
    this.socket.send(JSON.stringify(frame) + "\n");
  }
}