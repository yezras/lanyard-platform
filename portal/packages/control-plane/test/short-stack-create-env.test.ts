/**
 * lp-oop.28 / lp-oop.38.12 — tool-only create-env denylist.
 * Provider keys, GATEWAY_RELAY_SECRET, and harness HTTP search keys
 * must not land on the guest.
 */
import { describe, expect, it } from "vitest";

import type { CreateSandboxParams } from "../src/daytona-client.js";
import { GATEWAY_ENV_RELAY_SECRET } from "../src/gateway-relay-env.js";
import { PROVIDER_WAKE_ENV_KEYS } from "../src/provider-wake-env.js";
import {
  DEFAULT_SANDBOX_CREATE_PROFILE,
  SANDBOX_CREATE_PROFILES,
  SHORT_STACK_CREATE_ENV_DENYLIST,
  SHORT_STACK_CREATE_ENV_HTTP_KEYS,
  ShortStackCreateEnvError,
  applyShortStackCreateEnvInvariants,
  assertShortStackCreateEnv,
  isMcpSecretCreateEnvKey,
  isSandboxCreateProfile,
  isShortStackDeniedCreateEnvKey,
  listShortStackDeniedCreateEnvKeys,
  parseSandboxCreateProfile,
  stripShortStackDeniedCreateEnv,
} from "../src/short-stack-create-env.js";

const HTTP_LEAK_ENV = {
  TAVILY_API_KEY: "tvly-test-not-prod",
  BRAVE_API_KEY: "brave-test-not-prod",
  BRAVE_SEARCH_API_KEY: "bsa-test-not-prod",
  FIRECRAWL_API_KEY: "fc-test-not-prod",
  X_BEARER_TOKEN: "x-bearer-test-not-prod",
} as const;

describe("sandbox create profile (lp-oop.28)", () => {
  it("defaults omitted/empty to guest_gateway", () => {
    expect(DEFAULT_SANDBOX_CREATE_PROFILE).toBe("guest_gateway");
    expect(parseSandboxCreateProfile(undefined)).toBe("guest_gateway");
    expect(parseSandboxCreateProfile("")).toBe("guest_gateway");
    expect(parseSandboxCreateProfile("   ")).toBe("guest_gateway");
  });

  it("accepts the two profiles", () => {
    expect(SANDBOX_CREATE_PROFILES).toEqual(["guest_gateway", "tool_only"]);
    expect(isSandboxCreateProfile("tool_only")).toBe(true);
    expect(parseSandboxCreateProfile("tool_only")).toBe("tool_only");
    expect(parseSandboxCreateProfile("guest_gateway")).toBe("guest_gateway");
  });

  it("fails closed on unknown profile", () => {
    expect(isSandboxCreateProfile("harness")).toBe(false);
    expect(() => parseSandboxCreateProfile("harness")).toThrow(/tool_only/);
  });
});

describe("create-env denylist (lp-oop.28)", () => {
  it("denies every provider wake key and GATEWAY_RELAY_SECRET", () => {
    expect(SHORT_STACK_CREATE_ENV_DENYLIST).toContain(GATEWAY_ENV_RELAY_SECRET);
    for (const key of PROVIDER_WAKE_ENV_KEYS) {
      expect(isShortStackDeniedCreateEnvKey(key)).toBe(true);
    }
    expect(isShortStackDeniedCreateEnvKey("VAULT_ROOT")).toBe(false);
    expect(isShortStackDeniedCreateEnvKey("GATEWAY_RELAY_URL")).toBe(false);
    const providerWake = new Set<string>(PROVIDER_WAKE_ENV_KEYS);
    for (const key of SHORT_STACK_CREATE_ENV_HTTP_KEYS) {
      expect(isShortStackDeniedCreateEnvKey(key)).toBe(true);
      expect(providerWake.has(key)).toBe(false);
    }
    expect(SHORT_STACK_CREATE_ENV_HTTP_KEYS).toEqual([
      "TAVILY_API_KEY",
      "BRAVE_API_KEY",
      "BRAVE_SEARCH_API_KEY",
      "FIRECRAWL_API_KEY",
      "X_BEARER_TOKEN",
    ]);
    expect(isShortStackDeniedCreateEnvKey("XAI_API_KEY")).toBe(true);
    expect(PROVIDER_WAKE_ENV_KEYS).toContain("XAI_API_KEY");
  });

  it("denies MCP secrets (harness-only; not dumped into the sandbox)", () => {
    expect(isMcpSecretCreateEnvKey("MCP_AUTH_TOKEN")).toBe(true);
    expect(isMcpSecretCreateEnvKey("VAULT_ROOT")).toBe(false);
    expect(isShortStackDeniedCreateEnvKey("MCP_AUTH_TOKEN")).toBe(true);
    expect(isShortStackDeniedCreateEnvKey("LAB_ECHO_MCP_API_KEY")).toBe(true);
    expect(isShortStackDeniedCreateEnvKey("mcp_servers_env")).toBe(true);
    expect(isShortStackDeniedCreateEnvKey("VAULT_ROOT")).toBe(false);
    expect(
      stripShortStackDeniedCreateEnv({
        VAULT_ROOT: "/mnt/vault",
        MCP_AUTH_TOKEN: "mcp-test-not-prod",
        GITHUB_MCP_TOKEN: "gh-test-not-prod",
      }),
    ).toEqual({ VAULT_ROOT: "/mnt/vault" });
  });

  it("lists denied keys present in env", () => {
    expect(
      listShortStackDeniedCreateEnvKeys({
        VAULT_ROOT: "/mnt/vault",
        XAI_API_KEY: "xai-test-not-prod",
        GATEWAY_RELAY_SECRET: "relay-test-not-prod",
        OPENAI_API_KEY: "sk-test-not-prod",
        ...HTTP_LEAK_ENV,
      }),
    ).toEqual([
      "BRAVE_API_KEY",
      "BRAVE_SEARCH_API_KEY",
      "FIRECRAWL_API_KEY",
      "GATEWAY_RELAY_SECRET",
      "OPENAI_API_KEY",
      "TAVILY_API_KEY",
      "XAI_API_KEY",
      "X_BEARER_TOKEN",
    ]);
  });

  it("assert throws ShortStackCreateEnvError naming the keys", () => {
    expect(() =>
      assertShortStackCreateEnv({
        XAI_API_KEY: "xai-test-not-prod",
        GATEWAY_RELAY_SECRET: "relay-test-not-prod",
      }),
    ).toThrow(ShortStackCreateEnvError);
    try {
      assertShortStackCreateEnv({
        XAI_API_KEY: "xai-test-not-prod",
        GATEWAY_RELAY_SECRET: "relay-test-not-prod",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(ShortStackCreateEnvError);
      const denied = err as ShortStackCreateEnvError;
      expect(denied.keys).toEqual(["GATEWAY_RELAY_SECRET", "XAI_API_KEY"]);
      expect(denied.message).toMatch(/GATEWAY_RELAY_SECRET/);
    }
  });

  it("assert passes vault-only env", () => {
    expect(() =>
      assertShortStackCreateEnv({
        VAULT_ROOT: "/mnt/vault",
        S3_VAULT_PREFIX: "tenants/t/vault/",
      }),
    ).not.toThrow();
    expect(() => assertShortStackCreateEnv(undefined)).not.toThrow();
  });

  it("strip removes denylist keys and keeps vault", () => {
    expect(
      stripShortStackDeniedCreateEnv({
        VAULT_ROOT: "/mnt/vault",
        XAI_API_KEY: "xai-test-not-prod",
        GATEWAY_RELAY_SECRET: "relay-test-not-prod",
        LITELLM_MASTER_KEY: "litellm-test-not-prod",
        ...HTTP_LEAK_ENV,
      }),
    ).toEqual({ VAULT_ROOT: "/mnt/vault" });
  });

  it("denies MCP-named keys (lp-oop.38.19)", () => {
    expect(isMcpSecretCreateEnvKey("MCP_API_KEY")).toBe(true);
    expect(isMcpSecretCreateEnvKey("GMAIL_MCP_TOKEN")).toBe(true);
    expect(isMcpSecretCreateEnvKey("mcp_servers")).toBe(true);
    expect(isMcpSecretCreateEnvKey("VAULT_ROOT")).toBe(false);
    expect(isShortStackDeniedCreateEnvKey("MCP_API_KEY")).toBe(true);
    expect(
      stripShortStackDeniedCreateEnv({
        VAULT_ROOT: "/mnt/vault",
        MCP_API_KEY: "mcp-test-not-prod",
        GMAIL_MCP_TOKEN: "gmail-mcp-test-not-prod",
      }),
    ).toEqual({ VAULT_ROOT: "/mnt/vault" });
    expect(() =>
      assertShortStackCreateEnv({ MCP_API_KEY: "mcp-test-not-prod" }),
    ).toThrow(/MCP/);
  });

  it("apply invariants rewrites create params env", () => {
    const params: CreateSandboxParams = {
      snapshotId: "snap-tool-only",
      env: {
        VAULT_ROOT: "/mnt/vault",
        XAI_API_KEY: "xai-test-not-prod",
        GATEWAY_RELAY_SECRET: "relay-test-not-prod",
        MCP_AUTH_TOKEN: "mcp-test-not-prod",
        ...HTTP_LEAK_ENV,
      },
    };
    const next = applyShortStackCreateEnvInvariants(params);
    expect(next.env).toEqual({ VAULT_ROOT: "/mnt/vault" });
    expect(() => assertShortStackCreateEnv(next.env)).not.toThrow();
    // original untouched
    expect(params.env).toHaveProperty("XAI_API_KEY");
    expect(params.env).toHaveProperty("MCP_AUTH_TOKEN");
    expect(params.env).toHaveProperty("TAVILY_API_KEY");
  });
});
