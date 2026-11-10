/**
 * lp-oop.28 — bind ensure_online(tenant, user) then FakeToolbox.
 * Offline only. No Daytona.
 */
import { describe, expect, it, vi } from "vitest";

import { bindEnsureOnlineToolbox, ToolboxBindError } from "./bind.js";
import { FakeToolbox } from "./fake.js";

const TENANT = "tenant-a";
const USER = "user-ada";
const INSTANCE = "inst-ada";
const SANDBOX = "sbx-ada";

function online(
  overrides: Partial<{
    instance_id: string;
    tenant_id: string;
    sandbox_id: string | null;
    presence: string;
    already_online: boolean;
  }> = {},
) {
  return {
    instance_id: INSTANCE,
    tenant_id: TENANT,
    sandbox_id: SANDBOX,
    presence: "online",
    already_online: false,
    ...overrides,
  };
}

describe("bindEnsureOnlineToolbox (lp-oop.28)", () => {
  it("calls ensure_online(tenant, user) with tool_only create profile", async () => {
    const toolbox = new FakeToolbox();
    toolbox.enqueue({
      stdout: "ok\n",
      stderr: "",
      exit_code: 0,
    });
    const ensureOnlineByUser = vi.fn(async () => online());

    const bound = await bindEnsureOnlineToolbox({
      tenantId: TENANT,
      userId: USER,
      ensureOnlineByUser,
      toolbox,
    });

    expect(ensureOnlineByUser).toHaveBeenCalledOnce();
    expect(ensureOnlineByUser).toHaveBeenCalledWith(TENANT, USER, {
      sandbox_create_profile: "tool_only",
    });
    expect(bound.sandbox_id).toBe(SANDBOX);
    expect(bound.instance_id).toBe(INSTANCE);
    expect(bound.tenant_id).toBe(TENANT);
    expect(bound.user_id).toBe(USER);
    expect(bound.already_online).toBe(false);
  });

  it("forwards wait_timeout_ms on the wake", async () => {
    const ensureOnlineByUser = vi.fn(async () => online());
    await bindEnsureOnlineToolbox({
      tenantId: TENANT,
      userId: USER,
      ensureOnlineByUser,
      toolbox: new FakeToolbox(),
      waitTimeoutMs: 12_000,
    });
    expect(ensureOnlineByUser).toHaveBeenCalledWith(TENANT, USER, {
      sandbox_create_profile: "tool_only",
      wait_timeout_ms: 12_000,
    });
  });

  it("execs on the resolved sandbox_id, not a caller-supplied box", async () => {
    const toolbox = new FakeToolbox();
    toolbox.enqueue({
      stdout: "vault\n",
      stderr: "",
      exit_code: 0,
    });
    const bound = await bindEnsureOnlineToolbox({
      tenantId: TENANT,
      userId: USER,
      ensureOnlineByUser: async () => online(),
      toolbox,
    });

    const result = await bound.execute({
      argv: ["ls", "-la", "/mnt/vault"],
      cwd: "/mnt/vault",
      timeout_ms: 10_000,
    });

    expect(result).toEqual({ stdout: "vault\n", stderr: "", exit_code: 0 });
    expect(toolbox.execCount()).toBe(1);
    expect(toolbox.lastExec()).toEqual({
      sandbox_id: SANDBOX,
      argv: ["ls", "-la", "/mnt/vault"],
      cwd: "/mnt/vault",
      timeout_ms: 10_000,
    });
  });

  it("fails closed when ensure_online returns no sandbox_id", async () => {
    const toolbox = new FakeToolbox();
    await expect(
      bindEnsureOnlineToolbox({
        tenantId: TENANT,
        userId: USER,
        ensureOnlineByUser: async () => online({ sandbox_id: null }),
        toolbox,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof ToolboxBindError && err.code === "NO_SANDBOX";
    });
    expect(toolbox.execCount()).toBe(0);
  });

  it("fails closed on empty tenant/user", async () => {
    const toolbox = new FakeToolbox();
    await expect(
      bindEnsureOnlineToolbox({
        tenantId: "  ",
        userId: USER,
        ensureOnlineByUser: async () => online(),
        toolbox,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof ToolboxBindError && err.code === "INVALID_KEY";
    });
    expect(toolbox.execCount()).toBe(0);
  });

  it("does not exec when ensure_online throws", async () => {
    const toolbox = new FakeToolbox();
    await expect(
      bindEnsureOnlineToolbox({
        tenantId: TENANT,
        userId: USER,
        ensureOnlineByUser: async () => {
          throw new Error("wake failed");
        },
        toolbox,
      }),
    ).rejects.toThrow(/wake failed/);
    expect(toolbox.execCount()).toBe(0);
  });
});
