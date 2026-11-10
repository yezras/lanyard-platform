import { describe, expect, it } from "vitest";

import {
  buildBrainRpcRequest,
  stampBrainRpcAuth,
  BRAIN_RPC_CONTRACT_VERSION,
} from "../src/brain-rpc.js";
import { parseEnvFlag } from "../src/config.js";

describe("brain rpc helpers", () => {
  it("stamps auth subject from control-plane RBAC (not browser elevation)", () => {
    const now = new Date("2026-07-12T00:00:00.000Z");
    const auth = stampBrainRpcAuth({
      tenantId: "ten_1",
      instanceId: "inst_1",
      userId: "usr_1",
      sessionId: "sess_1",
      rbac: {
        hermes_profile: "contributor",
        role_names: ["contributor", "legal"],
        allowed_path_prefixes: ["/Projects/Legal"],
      },
      now,
      ttlMs: 60_000,
    });

    expect(auth.tenant_id).toBe("ten_1");
    expect(auth.instance_id).toBe("inst_1");
    expect(auth.subject.portal_user_id).toBe("usr_1");
    expect(auth.subject.hermes_profile).toBe("contributor");
    expect(auth.subject.roles).toEqual(["contributor", "legal"]);
    expect(auth.subject.path_prefixes).toEqual(["/Projects/Legal"]);
    expect(auth.issued_at).toBe("2026-07-12T00:00:00.000Z");
    expect(auth.expires_at).toBe("2026-07-12T00:01:00.000Z");
  });

  it("builds a brain.ping request frame", () => {
    const auth = stampBrainRpcAuth({
      tenantId: "ten_1",
      instanceId: "inst_1",
      userId: "usr_1",
      sessionId: "sess_1",
      rbac: {
        hermes_profile: "admin",
        role_names: ["admin"],
        allowed_path_prefixes: [],
      },
    });
    const req = buildBrainRpcRequest({
      method: "brain.ping",
      auth,
      params: { echo: "hi" },
      requestId: "req_fixed",
      timeoutMs: 5_000,
    });
    expect(req.type).toBe("brain_rpc_request");
    expect(req.contract_version).toBe(BRAIN_RPC_CONTRACT_VERSION);
    expect(req.request_id).toBe("req_fixed");
    expect(req.method).toBe("brain.ping");
    expect(req.timeout_ms).toBe(5_000);
    expect(req.params).toEqual({ echo: "hi" });
  });
});

describe("BRAIN_RPC_ENABLED flag parsing", () => {
  it("defaults fail-closed (false) when unset", () => {
    expect(parseEnvFlag(undefined)).toBe(false);
    expect(parseEnvFlag("")).toBe(false);
    expect(parseEnvFlag("0")).toBe(false);
    expect(parseEnvFlag("false")).toBe(false);
  });

  it("accepts common truthy forms", () => {
    expect(parseEnvFlag("1")).toBe(true);
    expect(parseEnvFlag("true")).toBe(true);
    expect(parseEnvFlag("YES")).toBe(true);
    expect(parseEnvFlag("on")).toBe(true);
  });
});
