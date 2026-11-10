import { describe, expect, it } from "vitest";

import {
  OPS_OAUTH_SLOT_IDS,
  PROVIDER_WAKE_ENV_KEYS,
  opsSecretSlotId,
  parseOpsSecretSlot,
} from "./ops-secrets.js";

describe("ops secrets slot allowlist (lp-2qs.4)", () => {
  it("keeps POOLSIDE/XAI wake env slots in the closed allowlist", () => {
    expect(PROVIDER_WAKE_ENV_KEYS).toContain("POOLSIDE_API_KEY");
    expect(PROVIDER_WAKE_ENV_KEYS).toContain("XAI_API_KEY");
    expect(OPS_OAUTH_SLOT_IDS).toContain("xai-grok");
    expect(OPS_OAUTH_SLOT_IDS).toContain("openai-codex");
  });

  it("parses env-key and oauth slots and rejects unknown ids", () => {
    expect(parseOpsSecretSlot("POOLSIDE_API_KEY")).toEqual({
      kind: "env_key",
      env_name: "POOLSIDE_API_KEY",
    });
    expect(parseOpsSecretSlot(" xai-grok ")).toEqual({
      kind: "oauth_slot",
      provider_id: "xai-grok",
    });
    expect(parseOpsSecretSlot("SOME_RANDOM_KEY")).toBeNull();
    expect(parseOpsSecretSlot("")).toBeNull();
  });

  it("round-trips slot ids", () => {
    for (const id of [...PROVIDER_WAKE_ENV_KEYS, ...OPS_OAUTH_SLOT_IDS]) {
      const slot = parseOpsSecretSlot(id);
      expect(slot).not.toBeNull();
      expect(opsSecretSlotId(slot as NonNullable<typeof slot>)).toBe(id);
    }
  });
});
