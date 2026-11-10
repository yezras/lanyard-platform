import { describe, expect, it } from "vitest";

import {
  BRAIN_RPC_CONTRACT_VERSION,
  BRAIN_RPC_DEFAULT_TIMEOUT_MS,
  BRAIN_RPC_MAX_TIMEOUT_MS,
  brainRpcErrorToHttpStatus,
  clampBrainRpcTimeoutMs,
  isBrainRpcRequestFrame,
  isBrainRpcResultFrame,
  type BrainRpcRequestFrame,
  type BrainRpcResultFrame,
} from "./brain-rpc.js";
import { parseFrame, serializeFrame } from "./serialize.js";

describe("brain rpc wire types", () => {
  it("serializes brain_rpc_request / brain_rpc_result on the relay wire", () => {
    const request: BrainRpcRequestFrame = {
      type: "brain_rpc_request",
      contract_version: BRAIN_RPC_CONTRACT_VERSION,
      request_id: "req_1",
      method: "brain.ping",
      timeout_ms: 10_000,
      auth: {
        tenant_id: "ten_1",
        instance_id: "inst_1",
        subject: {
          portal_user_id: "usr_1",
          hermes_profile: "contributor",
          roles: ["contributor"],
          path_prefixes: ["/Projects/Legal"],
        },
        session_id: "sess_1",
        issued_at: "2026-07-12T00:00:00.000Z",
        expires_at: "2026-07-12T00:05:00.000Z",
      },
      params: { echo: "hi" },
      idempotency_key: null,
    };

    const parsedReq = parseFrame(serializeFrame(request));
    expect(isBrainRpcRequestFrame(parsedReq)).toBe(true);
    if (isBrainRpcRequestFrame(parsedReq)) {
      expect(parsedReq.method).toBe("brain.ping");
      expect(parsedReq.auth.instance_id).toBe("inst_1");
    }

    const result: BrainRpcResultFrame = {
      type: "brain_rpc_result",
      contract_version: BRAIN_RPC_CONTRACT_VERSION,
      request_id: "req_1",
      ok: true,
      result: { pong: true, echo: "hi", contract_version: 1 },
      error: null,
      meta: { duration_ms: 2 },
    };

    const parsedRes = parseFrame(serializeFrame(result));
    expect(isBrainRpcResultFrame(parsedRes)).toBe(true);
    if (isBrainRpcResultFrame(parsedRes)) {
      expect(parsedRes.ok).toBe(true);
      expect(parsedRes.request_id).toBe("req_1");
    }
  });

  it("maps error codes to HTTP statuses (contract §5.2)", () => {
    expect(brainRpcErrorToHttpStatus("unauthenticated")).toBe(401);
    expect(brainRpcErrorToHttpStatus("forbidden")).toBe(403);
    expect(brainRpcErrorToHttpStatus("timeout")).toBe(504);
    expect(brainRpcErrorToHttpStatus("unavailable")).toBe(503);
    expect(brainRpcErrorToHttpStatus("payload_too_large")).toBe(413);
    expect(brainRpcErrorToHttpStatus("unknown_code")).toBe(500);
  });

  it("clamps timeout_ms to MVP bounds", () => {
    expect(clampBrainRpcTimeoutMs(undefined)).toBe(BRAIN_RPC_DEFAULT_TIMEOUT_MS);
    expect(clampBrainRpcTimeoutMs(0)).toBe(BRAIN_RPC_DEFAULT_TIMEOUT_MS);
    expect(clampBrainRpcTimeoutMs(5_000)).toBe(5_000);
    expect(clampBrainRpcTimeoutMs(60_000)).toBe(BRAIN_RPC_MAX_TIMEOUT_MS);
  });
});
