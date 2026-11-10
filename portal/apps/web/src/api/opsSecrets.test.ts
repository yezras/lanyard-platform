import { describe, expect, it } from "vitest";

import { PROVIDER_WAKE_ENV_KEYS } from "./opsSecrets.js";
import { parseOpsSecretRows } from "./opsSecrets.js";

describe("parseOpsSecretRows (lp-2qs.4)", () => {
  it("merges CP statuses onto the closed allowlist and drops unknown slots", () => {
    const rows = parseOpsSecretRows({
      slots: [
        {
          slot: { kind: "env_key", env_name: "XAI_API_KEY" },
          present: true,
          fingerprint: "sha256:abc123def456",
          rotated_at: "2026-08-23T00:00:00.000Z",
        },
        {
          slot: { kind: "env_key", env_name: "EVIL_KEY" },
          present: true,
          fingerprint: "sha256:badbadbadba",
          rotated_at: null,
        },
      ],
    });

    expect(rows).toHaveLength(PROVIDER_WAKE_ENV_KEYS.length + 3);
    const xai = rows.find((row) => row.slot_id === "XAI_API_KEY");
    expect(xai).toMatchObject({
      present: true,
      fingerprint: "sha256:abc123def456",
    });
    expect(rows.find((row) => row.slot_id === "EVIL_KEY")).toBeUndefined();
    expect(
      rows.find((row) => row.slot_id === "POOLSIDE_API_KEY"),
    ).toMatchObject({ present: false, fingerprint: null });
    // OAuth slots ride along.
    expect(
      rows.filter((row) => row.slot.kind === "oauth_slot").map((r) => r.slot_id),
    ).toEqual(["xai-grok", "xai-oauth", "openai-codex"]);
  });

  it("returns all-absent rows for a malformed body", () => {
    const rows = parseOpsSecretRows({ nope: true });
    expect(rows.every((row) => row.present === false)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });
});
