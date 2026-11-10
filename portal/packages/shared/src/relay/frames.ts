/**
 * Newline-delimited JSON relay frames (gateway ↔ connector).
 *
 * @see https://github.com/NousResearch/hermes-agent/blob/main/docs/relay-connector-contract.md
 * @see https://github.com/NousResearch/hermes-agent/blob/main/gateway/relay/ws_transport.py
 * @see company-brain-deploy references/brain-rpc-contract.md (brain_rpc_* frames)
 *
 * Direction:
 *   gateway → connector: hello, outbound, interrupt, going_idle, inbound_ack, brain_rpc_result
 *   connector → gateway: descriptor, inbound, outbound_result, interrupt_inbound, going_idle_ack, brain_rpc_request
 */

import type {
  BrainRpcRequestFrame,
  BrainRpcResultFrame,
} from "./brain-rpc.js";
import type { CapabilityDescriptor } from "./descriptor.js";
import type { MessageEvent } from "./message-event.js";

export type {
  BrainRpcAuth,
  BrainRpcError,
  BrainRpcErrorCode,
  BrainRpcMethod,
  BrainRpcRequestFrame,
  BrainRpcResultFrame,
  BrainRpcResultMeta,
  BrainRpcSubject,
} from "./brain-rpc.js";
export {
  BRAIN_RPC_AUTH_TTL_MS,
  BRAIN_RPC_CONTRACT_VERSION,
  BRAIN_RPC_DEFAULT_TIMEOUT_MS,
  BRAIN_RPC_MAX_TIMEOUT_MS,
  brainRpcErrorToHttpStatus,
  clampBrainRpcTimeoutMs,
  isBrainRpcRequestFrame,
  isBrainRpcResultFrame,
} from "./brain-rpc.js";

export type OutboundOp =
  | "send"
  | "edit"
  | "typing"
  | "follow_up"
  | "get_chat_info";

export interface OutboundAction {
  op: OutboundOp;
  chat_id?: string;
  content?: string;
  message_id?: string;
  reply_to?: string;
  session_key?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
}

export interface OutboundResult {
  success: boolean;
  message_id?: string;
  error?: string;
  chat_info?: { name: string; type: string };
}

export interface HelloFrame {
  type: "hello";
  platform: string;
  botId: string;
}

export interface DescriptorFrame {
  type: "descriptor";
  descriptor: CapabilityDescriptor;
}

export interface InboundFrame {
  type: "inbound";
  event: MessageEvent;
  bufferId?: string;
}

export interface OutboundFrame {
  type: "outbound";
  requestId: string;
  action: OutboundAction;
  platform?: string;
}

export interface OutboundResultFrame {
  type: "outbound_result";
  requestId: string;
  result: OutboundResult;
}

export interface InterruptFrame {
  type: "interrupt";
  session_key: string;
  reason?: string;
}

export interface InterruptInboundFrame {
  type: "interrupt_inbound";
  session_key: string;
  chat_id: string;
}

export interface GoingIdleFrame {
  type: "going_idle";
}

export interface GoingIdleAckFrame {
  type: "going_idle_ack";
}

export interface InboundAckFrame {
  type: "inbound_ack";
  bufferId: string;
}

export type ConnectorToGatewayFrame =
  | DescriptorFrame
  | InboundFrame
  | OutboundResultFrame
  | InterruptInboundFrame
  | GoingIdleAckFrame
  | BrainRpcRequestFrame;

export type GatewayToConnectorFrame =
  | HelloFrame
  | OutboundFrame
  | InterruptFrame
  | GoingIdleFrame
  | InboundAckFrame
  | BrainRpcResultFrame;

export type RelayFrame = ConnectorToGatewayFrame | GatewayToConnectorFrame;