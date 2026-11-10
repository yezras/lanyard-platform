/**
 * lp-vqr0.6 — bound sandbox wake is a closed decision, not fall-through create.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DAYTONA_SANDBOX_STATES } from "../src/daytona-client.js";
import {
  decideBoundSandboxWake,
  decideSandboxCreateGuard,
  pickReusableLabeledSandbox,
  type BoundSandboxWakeInput,
} from "../src/sandbox-wake-path.js";

const here = dirname(fileURLToPath(import.meta.url));

function input(
  overrides: Partial<BoundSandboxWakeInput> &
    Pick<BoundSandboxWakeInput, "state">,
): BoundSandboxWakeInput {
  return {
    envExpiryGuardActive: false,
    envIsStale: false,
    archiveRestoreOnWake: false,
    ...overrides,
  };
}

describe("decideBoundSandboxWake (lp-vqr0.6)", () => {
  it("bound stopped is start_from_stopped and forbids create", () => {
    const d = decideBoundSandboxWake(input({ state: "stopped" }));
    expect(d).toEqual({
      action: "start",
      path: "start_from_stopped",
      allows_create: false,
    });
  });

  it("bound started is use_running (already_online at ensure_online) and forbids create", () => {
    const d = decideBoundSandboxWake(input({ state: "started" }));
    expect(d.action).toBe("use_running");
    expect(d.path).toBe("start_from_stopped");
    expect(d.allows_create).toBe(false);
  });

  it("stale baked env on stopped still allows cold_create_env_expired (lp-180p)", () => {
    const d = decideBoundSandboxWake(
      input({
        state: "stopped",
        envExpiryGuardActive: true,
        envIsStale: true,
      }),
    );
    expect(d).toEqual({
      action: "force_cold",
      path: "cold_create_env_expired",
      allows_create: true,
      reason: "stale_baked_env",
    });
  });

  it("stopped + expiry guard off never force-colds even if timestamp is old", () => {
    const d = decideBoundSandboxWake(
      input({
        state: "stopped",
        envExpiryGuardActive: false,
        envIsStale: true,
      }),
    );
    expect(d.allows_create).toBe(false);
    expect(d.action).toBe("start");
  });

  it("archived with restore on is archive_restore, not create", () => {
    const d = decideBoundSandboxWake(
      input({ state: "archived", archiveRestoreOnWake: true }),
    );
    expect(d).toEqual({
      action: "restore",
      path: "archive_restore",
      allows_create: false,
    });
  });

  it("archived without restore is unusable (caller may cold_create)", () => {
    const d = decideBoundSandboxWake(input({ state: "archived" }));
    expect(d).toEqual({
      action: "unusable",
      allows_create: true,
      reason: "not_restorable",
    });
  });

  it("missing sandbox is unusable/missing", () => {
    const d = decideBoundSandboxWake(input({ state: null }));
    expect(d).toEqual({
      action: "unusable",
      allows_create: true,
      reason: "missing",
    });
  });

  it("creating waits on the bound box and forbids create", () => {
    const d = decideBoundSandboxWake(input({ state: "creating" }));
    expect(d).toEqual({
      action: "wait",
      path: "start_from_stopped",
      allows_create: false,
    });
  });

  it("error on a bound box forbids create", () => {
    const d = decideBoundSandboxWake(input({ state: "error" }));
    expect(d).toEqual({
      action: "unusable",
      allows_create: false,
      reason: "error",
    });
  });

  it("every Daytona state is classified", () => {
    for (const state of [...DAYTONA_SANDBOX_STATES, null]) {
      const d = decideBoundSandboxWake(input({ state }));
      expect(d.action).toMatch(
        /^(use_running|start|wait|restore|force_cold|unusable)$/,
      );
    }
  });

  it("exports decideBoundSandboxWake from the package index", () => {
    const indexSrc = readFileSync(join(here, "../src/index.ts"), "utf8");
    expect(indexSrc).toContain("decideBoundSandboxWake");
    expect(indexSrc).toContain("decideSandboxCreateGuard");
    expect(indexSrc).toContain("./sandbox-wake-path.js");
  });
});

describe("decideSandboxCreateGuard (lp-vqr0.15)", () => {
  it("bound id never allows create", () => {
    expect(
      decideSandboxCreateGuard({
        bound_sandbox_id: "sbx-bound",
        labeled: [],
      }),
    ).toEqual({
      allows_create: false,
      reuse_sandbox_id: "sbx-bound",
      source: "bound",
    });
  });

  it("unbound reuses a labeled started/stopped box", () => {
    expect(
      decideSandboxCreateGuard({
        bound_sandbox_id: null,
        labeled: [
          { sandboxId: "sbx-old", state: "stopped" },
          { sandboxId: "sbx-run", state: "started" },
        ],
      }),
    ).toEqual({
      allows_create: false,
      reuse_sandbox_id: "sbx-run",
      source: "labeled",
    });
  });

  it("unbound with no labeled box may create", () => {
    expect(
      decideSandboxCreateGuard({ bound_sandbox_id: null, labeled: [] }),
    ).toEqual({ allows_create: true });
  });

  it("pickReusableLabeledSandbox prefers started over stopped", () => {
    const picked = pickReusableLabeledSandbox([
      { sandboxId: "stopped", state: "stopped" },
      { sandboxId: "started", state: "started" },
    ]);
    expect(picked?.sandboxId).toBe("started");
  });
});
