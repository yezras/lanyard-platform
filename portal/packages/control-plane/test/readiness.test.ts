/**
 * lp-vqr0.4 / T3 — agent_ready vs vault_writable.
 *
 * Presence online is agent_ready. Vault writable is a separate flag.
 * File-tool wait uses the probe; chat / ensure_online must not.
 */
import { describe, expect, it } from "vitest";

import {
  agentReadyFromPresence,
  FakeVaultWritableProbe,
  instanceReadiness,
  parseVaultWritable,
  waitUntilVaultWritable,
} from "../src/readiness.js";
import type { InstancePresence } from "../src/types.js";

describe("instanceReadiness (lp-vqr0.4)", () => {
  it("agent_ready follows presence online only", () => {
    const states: InstancePresence[] = ["offline", "waking", "online", "error"];
    for (const presence of states) {
      const ready = instanceReadiness(presence, true);
      expect(ready.agent_ready).toBe(presence === "online");
      expect(agentReadyFromPresence(presence)).toBe(presence === "online");
    }
  });

  it("vault_writable is independent of presence", () => {
    expect(instanceReadiness("online", false)).toEqual({
      agent_ready: true,
      vault_writable: false,
    });
    expect(instanceReadiness("waking", true)).toEqual({
      agent_ready: false,
      vault_writable: true,
    });
    expect(instanceReadiness("offline", false)).toEqual({
      agent_ready: false,
      vault_writable: false,
    });
  });

  it("parseVaultWritable treats only explicit true as writable", () => {
    expect(parseVaultWritable(true)).toBe(true);
    expect(parseVaultWritable(1)).toBe(true);
    expect(parseVaultWritable("true")).toBe(true);
    expect(parseVaultWritable("t")).toBe(true);
    expect(parseVaultWritable(false)).toBe(false);
    expect(parseVaultWritable(0)).toBe(false);
    expect(parseVaultWritable(null)).toBe(false);
    expect(parseVaultWritable(undefined)).toBe(false);
    expect(parseVaultWritable("false")).toBe(false);
  });
});

describe("waitUntilVaultWritable (file-tool path)", () => {
  it("returns false while the probe is not writable", async () => {
    const probe = new FakeVaultWritableProbe();
    const ok = await waitUntilVaultWritable(probe, "inst-1", {
      timeoutMs: 30,
      pollIntervalMs: 5,
    });
    expect(ok).toBe(false);
    expect(probe.getPollCount()).toBeGreaterThanOrEqual(1);
  });

  it("returns true after the probe becomes writable", async () => {
    const probe = new FakeVaultWritableProbe();
    probe.writableAfterPolls("inst-1", 2);
    const ok = await waitUntilVaultWritable(probe, "inst-1", {
      timeoutMs: 200,
      pollIntervalMs: 5,
    });
    expect(ok).toBe(true);
  });

  it("already-writable short-circuits", async () => {
    const probe = new FakeVaultWritableProbe({
      initiallyWritable: ["inst-1"],
    });
    const ok = await waitUntilVaultWritable(probe, "inst-1", {
      timeoutMs: 50,
      pollIntervalMs: 10,
    });
    expect(ok).toBe(true);
    expect(probe.getPollCount()).toBeGreaterThanOrEqual(1);
  });
});
