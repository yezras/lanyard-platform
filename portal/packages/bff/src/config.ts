import {
  DEFAULT_STAGING_MAX_UPLOAD_BYTES,
  mergeAppHosts,
  stripHostPort,
} from "@lanyard/shared";

import {
  loadSessionStoreConfig,
  type SessionStoreConfig,
} from "./session-factory.js";
import { defaultSettingsSnapshotPath } from "./settings-snapshot.js";
import { DEFAULT_HARNESS_TURN_STALL_TIMEOUT_MS } from "./chat-delivery-events.js";

/** Local/dev placeholder — rejected when NODE_ENV=production. */
export const DEV_CONTROL_PLANE_SERVICE_TOKEN =
  "placeholder-control-plane-service-token";

/** Local/dev placeholder for BFF↔relay — rejected when NODE_ENV=production. */
export const DEV_RELAY_INTERNAL_TOKEN = "placeholder-relay-internal-token";

/** Local/dev placeholder for session/OAuth HMAC — rejected when NODE_ENV=production. */
export const DEV_SESSION_SECRET = "dev-session-secret-change-me";

/**
 * Dual-run chat path (plan 0015 / lp-oop.3 + lp-oop.15). Default `relay`
 * keeps today's BFF → Relay deliver-inbound. `harness` starts a turn on
 * the harness HTTP client and does not call deliverInbound.
 */
export type ChatDelivery = "relay" | "harness";

export const DEFAULT_CHAT_DELIVERY: ChatDelivery = "relay";

/**
 * Vault UI plane (plan 0015 / lp-oop.11). `fs` is today's local fixture /
 * VAULT_ROOT / Hermes multi-root path. `brain_rpc` is today's host vault
 * when `BRAIN_RPC_ENABLED`. `cp_s3` is BFF → CP → S3 (no sandbox wake).
 */
export type VaultPlane = "fs" | "brain_rpc" | "cp_s3";

/**
 * Unset `VAULT_PLANE` + Brain RPC off → today's local plane. When Brain
 * RPC is on, the implicit default stays `brain_rpc` (default unchanged).
 */
export const DEFAULT_VAULT_PLANE: VaultPlane = "fs";

/** Local/dev placeholder for BFF↔harness — rejected in production when harness. */
export const DEV_HARNESS_SERVICE_TOKEN = "placeholder-harness-service-token";

export type BffConfig = {
  port: number;
  controlPlaneUrl: string;
  /**
   * BFF ↔ control-plane service credential (G1.2).
   * Sent as `x-control-plane-service-token`. Must match CP
   * `CONTROL_PLANE_SERVICE_TOKEN`. Production rejects the dev placeholder.
   */
  controlPlaneServiceToken: string;
  /**
   * Optional elevated ops token for CP ops-only routes.
   * Prefer CONTROL_PLANE_INTERNAL_TOKEN; falls back to INTERNAL_OPS_TOKEN.
   * Not a substitute for the service token on normal BFF→CP traffic.
   */
  controlPlaneInternalToken?: string;
  relayUrl: string;
  relayInternalToken: string;
  /**
   * BFF ↔ harness HTTP base (plan 0015 / lp-oop.15). Used when
   * `ChatDelivery=harness`. Unset is fine while default relay is on.
   */
  harnessUrl?: string;
  /**
   * BFF ↔ harness service credential. Sent as `x-harness-service-token`.
   * Production rejects the dev placeholder when `ChatDelivery=harness`.
   */
  harnessServiceToken: string;
  devTenantSlug?: string;
  /**
   * Hostnames that use path-first tenant routing (`/<slug>/…`).
   * Always includes shared defaults (`app.withlanyard.com`, localhost
   * variants) plus any hosts from env `APP_HOSTS` (comma-separated).
   * Staging: set `APP_HOSTS` to the CloudFront distribution hostname
   * (deploy private tfvars key `APP_HOSTS` in company-brain-deploy).
   */
  appHosts: string[];
  demoMemberRoleId?: string;
  sessionSecret: string;
  secureCookies: boolean;
  googleClientId?: string;
  /**
   * Google OAuth client secret for ops code exchange. Never log.
   * Tenant Google still exchanges on Control Plane.
   */
  googleClientSecret?: string;
  googleRedirectPath: string;
  hubspotClientId?: string;
  settingsSnapshotPath: string;
  /**
   * lp-zuh.14.3 / lp-vw3: when true, ensure `lab_echo` appears in
   * settings.snapshot.mcp_servers (VaultPlane=cp_s3 / fixture path).
   * Default off. Env: SETTINGS_SEED_LAB_MCP (also accepts LANYARD_ENTRY_SEED_MCP
   * as an alias for operators who already use the guest entrypoint name).
   */
  settingsSeedLabMcp: boolean;
  stagingMaxUploadBytes: number;
  /**
   * Absolute path to a local vault directory. When set, BFF uses the
   * filesystem content provider instead of the CI fixture vault.
   */
  vaultRoot?: string;
  /**
   * Absolute host directory that materializes Portal logical staging paths
   * under `/staging/uploads/...` (lp-uxy.21.5). When set, BFF uses the
   * filesystem staging provider so LA `parse_document` can open attached
   * files. Pair with agent `PARSE_DOCUMENT_STAGING_ROOT` pointing at the
   * same directory. Unset → in-memory fixture (CI / offline).
   */
  stagingFsRoot?: string;
  /**
   * Optional SQLite path for durable chat threads + history
   * (`CHAT_STORE_PATH`, e.g. `.data/chat.db`). Unset → in-memory only.
   * Stores message bodies on the BFF host (cleartext, owner-only 0600 —
   * not app-level encryption; see docs/runbooks/local-secret-hygiene.md).
   * Cap 2000 events/thread. Relay remains non-SoT.
   */
  chatStorePath?: string;
  /**
   * lp-oop.15 / lp-oop.16 / lp-oop.29 dual-run chat path.
   * `CHAT_DELIVERY=relay|harness` is the process default. Default **relay**.
   * Persisted tenant/instance `chat_delivery` overrides this so MockLab
   * can flip alone. `harness` routes POST messages, GET events, and
   * POST cancel through the harness client.
   */
  chatDelivery: ChatDelivery;
  /**
   * lp-oop.11 vault UI plane. `VAULT_PLANE=fs|brain_rpc|cp_s3`.
   * Unset/unknown keeps today's path: `brain_rpc` when
   * `BRAIN_RPC_ENABLED`, else `fs`. `cp_s3` selects the CP HTTP
   * provider and must not call ensure_online on GET /api/vault/tree.
   */
  vaultPlane: VaultPlane;
  /**
   * G3.3 feature flag: enable Portal → host brain RPC vertical slice
   * (`/api/brain/*`). Default **false** (fail-closed / gated). Set
   * `BRAIN_RPC_ENABLED=1|true|yes|on` to enable.
   */
  brainRpcEnabled: boolean;
  /**
   * lp-y3j / lp-kng.2.8 feature flag: call CP ensure_online on chat send
   * before relay deliver-inbound. Default **false** (offline-safe — no
   * Daytona wake). Set `ENSURE_ONLINE_ON_CHAT=1|true|yes|on` to enable.
   * When on: daytona offline|waking|error → wake; already online → skip wake;
   * non-daytona → no-op.
   */
  ensureOnlineOnChat: boolean;
  /**
   * lp-kng.2.9 feature flag: call CP ensure_online before Brain RPC host
   * ops (vault/settings/projects + /api/brain/*). Default **false**.
   * Set `ENSURE_ONLINE_ON_BRAIN_RPC=1|true|yes|on` to enable.
   * When on, still no-ops for `runtime_kind !== "daytona"`.
   */
  ensureOnlineOnBrainRpc: boolean;
  /**
   * lp-kng.2.9 / lp-e23 feature flag: channel adapter inbound ensure_online.
   * Default **false**. Set `ENSURE_ONLINE_ON_CHANNEL_ADAPTER=1|true|yes|on`
   * to wake daytona sandboxes before Slack/email (etc.) deliver-inbound.
   * Offline: leave off.
   */
  ensureOnlineOnChannelAdapter: boolean;
  /**
   * lp-96v feature flag: POST CP signal-activity from real platform activity
   * (chat message, toolbox, tool_progress SSE, brain_rpc) so idle timer
   * refreshes. Default **false** (offline-safe). Set
   * `SIGNAL_ACTIVITY_ENABLED=1|true|yes|on`. Store-only (no Daytona);
   * tool_progress debounced — not per stream token. lp-k5c4.7: **message**
   * and **toolbox** are NOT gated by this flag — spine sends always signal
   * so mid_turn arms even when unset.
   */
  signalActivityEnabled: boolean;
  /**
   * lp-v62i.8 — harness turn SSE no-activity watchdog in ms. When a proxied
   * harness turn emits nothing for this long, BFF surfaces an SSE error
   * instead of hanging silently. `0` disables. Unset/invalid → default
   * (`DEFAULT_HARNESS_TURN_STALL_TIMEOUT_MS`, 120000).
   */
  harnessTurnStallTimeoutMs: number;
  /**
   * G5.2 shared session store (memory lab / redis multi-instance).
   * See loadSessionStoreConfig — REDIS_URL never committed.
   */
  sessionStore: SessionStoreConfig;
  /**
   * L10 chat corpus host storage (lp-gkh.9).
   * Fail closed: unset → no CorpusWriter (capture no-op).
   * Lab: CHAT_CORPUS_BUCKET + CHAT_CORPUS_FS_ROOT for durable FS layout.
   * Tenant enablement remains `chat_corpus_enabled` on CP retention.
   */
  chatCorpusBucket?: string;
  chatCorpusFsRoot?: string;
};

/**
 * GitHub Secrets / deploy env names (values never committed):
 * - CONTROL_PLANE_SERVICE_TOKEN — shared with control-plane task
 * - REDIS_URL — ElastiCache Redis/Valkey URL when BFF_SESSION_BACKEND=redis
 * Rotation: dual-write new secret to BFF + CP, redeploy both, retire old.
 */
export function loadControlPlaneServiceToken(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const token = env.CONTROL_PLANE_SERVICE_TOKEN?.trim();
  if (
    env.NODE_ENV === "production" &&
    (!token || token === DEV_CONTROL_PLANE_SERVICE_TOKEN)
  ) {
    throw new Error(
      "CONTROL_PLANE_SERVICE_TOKEN must be configured to a non-development value in production",
    );
  }
  return token || DEV_CONTROL_PLANE_SERVICE_TOKEN;
}

/**
 * BFF ↔ relay internal credential. Production rejects missing / dev placeholder.
 */
export function loadRelayInternalToken(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const token = env.RELAY_INTERNAL_TOKEN?.trim();
  if (
    env.NODE_ENV === "production" &&
    (!token || token === DEV_RELAY_INTERNAL_TOKEN)
  ) {
    throw new Error(
      "RELAY_INTERNAL_TOKEN must be configured to a non-development value in production",
    );
  }
  return token || DEV_RELAY_INTERNAL_TOKEN;
}

/**
 * Cookie / OAuth state HMAC secret. Production rejects missing / dev placeholder.
 */
export function loadSessionSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = env.SESSION_SECRET?.trim();
  if (
    env.NODE_ENV === "production" &&
    (!secret || secret === DEV_SESSION_SECRET)
  ) {
    throw new Error(
      "SESSION_SECRET must be configured to a non-development value in production",
    );
  }
  return secret || DEV_SESSION_SECRET;
}

/** Parse truthy env flag; empty/unset → false (fail-closed default). */
export function parseEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * lp-v62i.8 — parse `HARNESS_TURN_STALL_TIMEOUT_MS` (non-negative integer).
 * Empty/unset/invalid/negative → null (caller applies the default). `0` is
 * meaningful: disables the watchdog.
 */
export function parseOptionalNonNegativeInt(
  value: string | undefined,
): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

/**
 * Parse `CHAT_DELIVERY`. Empty/unset/unknown → `relay` (fail-closed to
 * today's path). Accepts `relay` and `harness` (case-insensitive).
 */
export function parseChatDelivery(
  value: string | undefined,
): ChatDelivery {
  if (!value) return DEFAULT_CHAT_DELIVERY;
  const v = value.trim().toLowerCase();
  if (v === "harness") return "harness";
  return DEFAULT_CHAT_DELIVERY;
}

/**
 * Parse a persisted tenant/instance override. Empty/unknown → `null`
 * (inherit the next layer). Accepts `relay` and `harness`.
 */
export function parseOptionalChatDelivery(
  value: string | null | undefined,
): ChatDelivery | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === "relay" || v === "harness") return v;
  return null;
}

/**
 * Dual-run resolve (lp-oop.29 / lp-oop.35). Instance override > tenant
 * persist > env `CHAT_DELIVERY` > default `relay`. `harness` is the Daytona
 * target hop (no `deliverInbound`). EC2/guest stay on `relay` until those
 * tenants move. Live env default stays `relay` (OPERATOR HOLD; kitchen-sink
 * waiver). MockLab can PATCH tenant/instance to `harness` alone.
 */
export function resolveChatDelivery(input: {
  env?: ChatDelivery | null;
  tenant?: ChatDelivery | null;
  instance?: ChatDelivery | null;
}): ChatDelivery {
  return (
    parseOptionalChatDelivery(input.instance) ??
    parseOptionalChatDelivery(input.tenant) ??
    input.env ??
    DEFAULT_CHAT_DELIVERY
  );
}

/**
 * Parse `VAULT_PLANE`. Empty/unset/unknown → `undefined` so the caller
 * can keep today's implicit plane (`brain_rpc` when Brain RPC is on,
 * else `fs`). Accepts `fs`, `brain_rpc`, and `cp_s3` (case-insensitive).
 */
export function parseVaultPlane(
  value: string | undefined,
): VaultPlane | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "fs" || v === "brain_rpc" || v === "cp_s3") return v;
  return undefined;
}

/**
 * Resolve the vault UI plane. Explicit `VAULT_PLANE` wins. Otherwise
 * preserve today's path from `BRAIN_RPC_ENABLED`.
 */
export function resolveVaultPlane(
  vaultPlaneRaw: string | undefined,
  brainRpcEnabled: boolean,
): VaultPlane {
  return (
    parseVaultPlane(vaultPlaneRaw) ??
    (brainRpcEnabled ? "brain_rpc" : DEFAULT_VAULT_PLANE)
  );
}

/**
 * BFF ↔ harness service credential. Production rejects missing / dev
 * placeholder when `CHAT_DELIVERY=harness`.
 */
export function loadHarnessServiceToken(
  env: NodeJS.ProcessEnv = process.env,
  chatDelivery: ChatDelivery = DEFAULT_CHAT_DELIVERY,
): string {
  const token = env.HARNESS_SERVICE_TOKEN?.trim();
  if (
    env.NODE_ENV === "production" &&
    chatDelivery === "harness" &&
    (!token || token === DEV_HARNESS_SERVICE_TOKEN)
  ) {
    throw new Error(
      "HARNESS_SERVICE_TOKEN must be configured to a non-development value when CHAT_DELIVERY=harness in production",
    );
  }
  return token || DEV_HARNESS_SERVICE_TOKEN;
}

/**
 * Parse `APP_HOSTS` (comma-separated hostnames) and merge with path-first
 * defaults. Hosts are lowercased and port-stripped.
 */
export function loadAppHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.APP_HOSTS?.trim();
  if (!raw) {
    return mergeAppHosts();
  }
  const extras = raw
    .split(",")
    .map((part) => stripHostPort(part.trim()).toLowerCase())
    .filter(Boolean);
  return mergeAppHosts(extras);
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): BffConfig {
  const devTenantSlug = env.DEV_TENANT_SLUG?.trim() || undefined;
  const demoMemberRoleId =
    env.PORTAL_DEMO_MEMBER_ROLE_ID?.trim() || undefined;
  const vaultRoot = env.VAULT_ROOT?.trim() || undefined;
  const stagingFsRoot = env.STAGING_FS_ROOT?.trim() || undefined;
  const chatStorePath = env.CHAT_STORE_PATH?.trim() || undefined;
  const controlPlaneInternalToken =
    env.CONTROL_PLANE_INTERNAL_TOKEN?.trim() ||
    env.INTERNAL_OPS_TOKEN?.trim() ||
    undefined;
  const chatDelivery = parseChatDelivery(env.CHAT_DELIVERY);
  const brainRpcEnabled = parseEnvFlag(env.BRAIN_RPC_ENABLED);
  const vaultPlane = resolveVaultPlane(env.VAULT_PLANE, brainRpcEnabled);
  const harnessUrl = env.HARNESS_URL?.trim() || undefined;
  if (
    env.NODE_ENV === "production" &&
    chatDelivery === "harness" &&
    !harnessUrl
  ) {
    throw new Error(
      "HARNESS_URL must be configured when CHAT_DELIVERY=harness in production",
    );
  }

  return {
    port: Number(env.BFF_PORT ?? 4000),
    controlPlaneUrl: env.CONTROL_PLANE_URL ?? "http://127.0.0.1:3100",
    controlPlaneServiceToken: loadControlPlaneServiceToken(env),
    controlPlaneInternalToken,
    relayUrl: env.RELAY_URL ?? "http://127.0.0.1:8787",
    relayInternalToken: loadRelayInternalToken(env),
    harnessUrl,
    harnessServiceToken: loadHarnessServiceToken(env, chatDelivery),
    devTenantSlug,
    appHosts: loadAppHosts(env),
    demoMemberRoleId,
    sessionSecret: loadSessionSecret(env),
    secureCookies: env.NODE_ENV === "production",
    googleClientId: env.GOOGLE_CLIENT_ID?.trim() || undefined,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET?.trim() || undefined,
    googleRedirectPath:
      env.GOOGLE_REDIRECT_PATH?.trim() || "/api/auth/google/callback",
    hubspotClientId: env.HUBSPOT_CLIENT_ID?.trim() || undefined,
    settingsSnapshotPath:
      env.SETTINGS_SNAPSHOT_PATH?.trim() || defaultSettingsSnapshotPath(),
    settingsSeedLabMcp:
      parseEnvFlag(env.SETTINGS_SEED_LAB_MCP) ||
      parseEnvFlag(env.LANYARD_ENTRY_SEED_MCP),
    stagingMaxUploadBytes: Number(
      env.STAGING_MAX_UPLOAD_BYTES ?? DEFAULT_STAGING_MAX_UPLOAD_BYTES,
    ),
    vaultRoot,
    stagingFsRoot,
    chatStorePath,
    chatDelivery,
    vaultPlane,
    brainRpcEnabled,
    ensureOnlineOnChat: parseEnvFlag(env.ENSURE_ONLINE_ON_CHAT),
    ensureOnlineOnBrainRpc: parseEnvFlag(env.ENSURE_ONLINE_ON_BRAIN_RPC),
    ensureOnlineOnChannelAdapter: parseEnvFlag(
      env.ENSURE_ONLINE_ON_CHANNEL_ADAPTER,
    ),
    signalActivityEnabled: parseEnvFlag(env.SIGNAL_ACTIVITY_ENABLED),
    harnessTurnStallTimeoutMs:
      parseOptionalNonNegativeInt(env.HARNESS_TURN_STALL_TIMEOUT_MS) ??
      DEFAULT_HARNESS_TURN_STALL_TIMEOUT_MS,
    sessionStore: loadSessionStoreConfig(env),
    chatCorpusBucket: env.CHAT_CORPUS_BUCKET?.trim() || undefined,
    chatCorpusFsRoot: env.CHAT_CORPUS_FS_ROOT?.trim() || undefined,
  };
}