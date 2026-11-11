/**
 * User-sandbox provision + lazy connector inject (lp-xhf4.6).
 *
 * User-principal connectors (google, hubspot, whatsapp) bind a scope=user
 * instance on first connect and inject only that connector, only onto that
 * user's sandbox. Tenant primary never receives oauth/session files.
 *
 * Design: docs/architecture/portal-connectors.md §4.
 */

import type { ConnectorId, ConnectorSecrets, ConnectionStatus } from "./connectors.js";
import type { InstanceScope } from "./resolve-instance.js";

export const CONNECTOR_GUEST_HOME = "/var/lib/company-brain-backend" as const;

export const CONNECTOR_GUEST_PATHS = {
  google: `${CONNECTOR_GUEST_HOME}/gws/token_cache.json`,
  hubspot: `${CONNECTOR_GUEST_HOME}/hubspot/access_token`,
  whatsapp: `${CONNECTOR_GUEST_HOME}/wacli/session.db`,
} as const;

export const WACLI_STORE_DIR = `${CONNECTOR_GUEST_HOME}/wacli` as const;

export const CONNECTOR_GUEST_ENV_KEYS = [
  "GOOGLE_WORKSPACE_CLI_TOKEN",
  "GWS_ACCESS_TOKEN",
  "HUBSPOT_ACCESS_TOKEN",
  "WACLI_STORE_DIR",
] as const;

export type ConnectorGuestEnvKey = (typeof CONNECTOR_GUEST_ENV_KEYS)[number];

const CONNECTOR_GUEST_ENV_KEY_SET = new Set<string>(CONNECTOR_GUEST_ENV_KEYS);

/** Statuses that create the user-instance mapping (no Daytona wake). */
export const USER_SANDBOX_PROVISION_STATUSES = [
  "connected",
  "pairing",
] as const satisfies readonly ConnectionStatus[];

export type UserSandboxBinding = {
  tenant_id: string;
  owner_user_id: string;
  instance_id: string;
  scope: "user";
  created: boolean;
};

/** Only legal inject target. Tenant sandboxes are a different type. */
export type ConnectorInjectTarget = {
  kind: "user_sandbox";
  tenant_id: string;
  owner_user_id: string;
  instance_id: string;
  sandbox_id: string;
};

export type TenantSandboxRef = {
  kind: "tenant_sandbox";
  tenant_id: string;
  instance_id: string;
  sandbox_id: string | null;
};

export type ConnectorGuestFile = {
  path: string;
  mode: 0o600;
  contents: string;
  encoding: "utf8" | "base64";
};

export type ConnectorInjectPlan = {
  connector_id: ConnectorId;
  target: ConnectorInjectTarget;
  files: ConnectorGuestFile[];
  env: Readonly<Record<ConnectorGuestEnvKey, string>> | Record<string, string>;
};

export type ConnectorRestoreReason =
  | "already_hydrated"
  | "sandbox_destroyed"
  | "cache_missing"
  | "refresh_invalid"
  | "session_invalid";

export type ConnectorRestoreDecision =
  | { action: "noop"; reason: "already_hydrated"; skip_oauth: true }
  | {
      action: "restore_from_cp";
      reason: "sandbox_destroyed" | "cache_missing";
      skip_oauth: true;
    }
  | {
      action: "needs_reauth";
      reason: "refresh_invalid" | "session_invalid";
      skip_oauth: false;
    };

export type InjectUserConnectorReason =
  | "injected"
  | "already_hydrated"
  | "sandbox_not_online"
  | "needs_reauth"
  | "access_token_missing";

export type InjectUserConnectorResult = {
  tenant_id: string;
  owner_user_id: string;
  instance_id: string;
  connector_id: ConnectorId;
  sandbox_id: string | null;
  injected: boolean;
  reason: InjectUserConnectorReason;
  skip_oauth: boolean;
  files: string[];
  /** After restore, run wacli sync on the user sandbox. Never a new QR. */
  post_commands: ConnectorPostCommand[];
};

export type ConnectorPostCommand = {
  argv: readonly string[];
  env: Record<string, string>;
};

export const WACLI_SYNC_ARGV = ["wacli", "sync"] as const;

export function whatsappPostInjectCommands(
  connectorId: ConnectorId,
  injected: boolean,
): ConnectorPostCommand[] {
  if (connectorId !== "whatsapp" || !injected) {
    return [];
  }
  return [{ argv: [...WACLI_SYNC_ARGV], env: { WACLI_STORE_DIR } }];
}

export function whatsappSyncOutcome(input: {
  exit_code: number;
  stderr: string;
  stdout?: string;
}): "ok" | "needs_reauth" | "error" {
  const blob = `${input.stderr}\n${input.stdout ?? ""}`;
  if (
    /logged[\s_-]?out|not authenticated|unlinked|device.?removed|logged_out/i.test(
      blob,
    )
  ) {
    return "needs_reauth";
  }
  if (input.exit_code === 0) return "ok";
  return "error";
}

export function exportWhatsAppSessionFromGuest(
  guest: GuestConnectorStore,
  sandbox_id: string,
): { filename: "session.db"; contents_base64: string } {
  const disk = guest.read(sandbox_id);
  if (!disk) {
    throw new InvalidConnectorInjectTargetError(
      "WhatsApp session.db is missing on the sandbox",
    );
  }
  for (const path of disk.files.keys()) {
    const base = path.replaceAll("\\", "/").split("/").pop() ?? path;
    if (base === "wacli.db" || base.startsWith("media")) {
      throw new InvalidConnectorInjectTargetError(
        `Refusing to export ${base} to the control plane`,
      );
    }
  }
  const file = disk.files.get(CONNECTOR_GUEST_PATHS.whatsapp);
  const contents = file?.contents?.trim() ?? "";
  if (!contents || file?.encoding !== "base64") {
    throw new InvalidConnectorInjectTargetError(
      "WhatsApp session.db export must be base64 session.db",
    );
  }
  return { filename: "session.db", contents_base64: contents };
}

export class TenantSandboxConnectorInjectError extends Error {
  readonly code = "TENANT_SANDBOX_CONNECTOR_INJECT" as const;

  constructor(message = "User-principal connectors cannot inject into a tenant sandbox") {
    super(message);
    this.name = "TenantSandboxConnectorInjectError";
  }
}

export class InvalidConnectorInjectTargetError extends Error {
  readonly code = "INVALID_CONNECTOR_INJECT_TARGET" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidConnectorInjectTargetError";
  }
}

export function shouldProvisionUserSandbox(
  status: ConnectionStatus,
): boolean {
  return (USER_SANDBOX_PROVISION_STATUSES as readonly string[]).includes(
    status,
  );
}

export function isConnectorGuestEnvKey(key: string): boolean {
  return CONNECTOR_GUEST_ENV_KEY_SET.has(key);
}

export function listConnectorGuestEnvKeys(
  env: Readonly<Record<string, string>> | undefined | null,
): string[] {
  if (!env) return [];
  return Object.keys(env)
    .filter((key) => isConnectorGuestEnvKey(key))
    .sort();
}

export function assertNoConnectorSecretsOnTenantEnv(
  env: Readonly<Record<string, string>> | undefined | null,
): void {
  const keys = listConnectorGuestEnvKeys(env);
  if (keys.length > 0) {
    throw new TenantSandboxConnectorInjectError(
      `Tenant sandbox env must not include connector secrets (${keys.join(", ")})`,
    );
  }
}

export function parseUserSandboxTarget(input: {
  kind?: unknown;
  tenant_id: unknown;
  owner_user_id: unknown;
  instance_id: unknown;
  sandbox_id: unknown;
}): ConnectorInjectTarget {
  if (input.kind === "tenant_sandbox") {
    throw new TenantSandboxConnectorInjectError();
  }
  const tenant_id = requireId(input.tenant_id, "tenant_id");
  const owner_user_id = requireId(input.owner_user_id, "owner_user_id");
  const instance_id = requireId(input.instance_id, "instance_id");
  const sandbox_id = requireId(input.sandbox_id, "sandbox_id");
  return {
    kind: "user_sandbox",
    tenant_id,
    owner_user_id,
    instance_id,
    sandbox_id,
  };
}

export function assertUserSandboxInjectAllowed(input: {
  scope: InstanceScope | string | null | undefined;
  owner_user_id: string | null | undefined;
  target_user_id: string;
}): ConnectorInjectTarget["kind"] {
  if (input.scope === "tenant" || input.scope == null || input.scope === "") {
    throw new TenantSandboxConnectorInjectError();
  }
  if (input.scope !== "user") {
    throw new InvalidConnectorInjectTargetError(
      `Unknown instance scope: ${String(input.scope)}`,
    );
  }
  const owner = input.owner_user_id?.trim() ?? "";
  if (!owner || owner !== input.target_user_id.trim()) {
    throw new TenantSandboxConnectorInjectError(
      "Connector inject owner_user_id must match the acting user",
    );
  }
  return "user_sandbox";
}

export function oauthRefreshStillValid(secrets: ConnectorSecrets): boolean {
  return Boolean(secrets.oauth_refresh?.trim());
}

export function whatsappSessionStillValid(secrets: ConnectorSecrets): boolean {
  return Boolean(secrets.whatsapp_session_db?.trim());
}

export function oauthAccessUsable(
  secrets: ConnectorSecrets,
  now: Date = new Date(),
): boolean {
  const access = secrets.oauth_access?.trim() ?? "";
  if (!access) return false;
  const expiry = secrets.oauth_expiry?.trim() ?? "";
  if (!expiry) return true;
  const ms = Date.parse(expiry);
  if (Number.isNaN(ms)) return true;
  return ms > now.getTime();
}

export function connectorDurableMaterialValid(
  connectorId: ConnectorId,
  secrets: ConnectorSecrets,
  now: Date = new Date(),
): boolean {
  if (connectorId === "whatsapp") {
    return whatsappSessionStillValid(secrets);
  }
  return oauthRefreshStillValid(secrets) || oauthAccessUsable(secrets, now);
}

export function decideConnectorRestore(input: {
  connector_id: ConnectorId;
  sandbox_destroyed: boolean;
  guest_has_material: boolean;
  secrets: ConnectorSecrets;
  now?: Date;
}): ConnectorRestoreDecision {
  if (input.guest_has_material && !input.sandbox_destroyed) {
    return {
      action: "noop",
      reason: "already_hydrated",
      skip_oauth: true,
    };
  }
  const durable = connectorDurableMaterialValid(
    input.connector_id,
    input.secrets,
    input.now,
  );
  if (!durable) {
    return {
      action: "needs_reauth",
      reason:
        input.connector_id === "whatsapp"
          ? "session_invalid"
          : "refresh_invalid",
      skip_oauth: false,
    };
  }
  return {
    action: "restore_from_cp",
    reason: input.sandbox_destroyed ? "sandbox_destroyed" : "cache_missing",
    skip_oauth: true,
  };
}

export function buildConnectorInjectPlan(input: {
  connector_id: ConnectorId;
  target: ConnectorInjectTarget;
  secrets: ConnectorSecrets;
}): ConnectorInjectPlan {
  if (input.target.kind !== "user_sandbox") {
    throw new TenantSandboxConnectorInjectError();
  }
  const files: ConnectorGuestFile[] = [];
  const env: Record<string, string> = {};

  if (input.connector_id === "google") {
    const access = input.secrets.oauth_access?.trim() ?? "";
    if (access) {
      files.push({
        path: CONNECTOR_GUEST_PATHS.google,
        mode: 0o600,
        encoding: "utf8",
        contents: JSON.stringify({
          access_token: access,
          expiry: input.secrets.oauth_expiry,
          scopes: input.secrets.oauth_scopes,
          connector_id: "google",
        }),
      });
      // gws reads GOOGLE_WORKSPACE_CLI_TOKEN first; GWS_ACCESS_TOKEN is a
      // Lanyard alias for the same short-lived cache (not ~/.config/gws SoT).
      env.GOOGLE_WORKSPACE_CLI_TOKEN = access;
      env.GWS_ACCESS_TOKEN = access;
    }
  } else if (input.connector_id === "hubspot") {
    const access = input.secrets.oauth_access?.trim() ?? "";
    if (access) {
      files.push({
        path: CONNECTOR_GUEST_PATHS.hubspot,
        mode: 0o600,
        encoding: "utf8",
        contents: access,
      });
      env.HUBSPOT_ACCESS_TOKEN = access;
    }
  } else {
    const session = input.secrets.whatsapp_session_db?.trim() ?? "";
    if (session) {
      files.push({
        path: CONNECTOR_GUEST_PATHS.whatsapp,
        mode: 0o600,
        encoding: "base64",
        contents: session,
      });
      env.WACLI_STORE_DIR = WACLI_STORE_DIR;
    }
  }

  assertNoRefreshTokenInGuestFiles(files);
  return {
    connector_id: input.connector_id,
    target: input.target,
    files,
    env,
  };
}

export function assertNoRefreshTokenInGuestFiles(
  files: readonly ConnectorGuestFile[],
): void {
  for (const file of files) {
    if (file.path === CONNECTOR_GUEST_PATHS.whatsapp) continue;
    if (/refresh/i.test(file.contents)) {
      throw new InvalidConnectorInjectTargetError(
        "OAuth refresh tokens must not be written to the sandbox",
      );
    }
  }
}

export type GuestConnectorDisk = {
  files: Map<
    string,
    { contents: string; encoding: "utf8" | "base64"; mode: number }
  >;
  env: Record<string, string>;
  connectors: Set<ConnectorId>;
};

export type GuestConnectorStore = {
  write(plan: ConnectorInjectPlan): Promise<void>;
  read(sandbox_id: string): GuestConnectorDisk | null;
  hasConnector(sandbox_id: string, connector_id: ConnectorId): boolean;
  printenv(sandbox_id: string): Record<string, string>;
  listFiles(sandbox_id: string): string[];
  wipe(sandbox_id: string): Promise<void>;
  wipeOauth(sandbox_id: string): Promise<void>;
  wipeConnector(sandbox_id: string, connector_id: ConnectorId): Promise<void>;
};

export function createInMemoryGuestConnectorStore(): GuestConnectorStore & {
  sandboxCount(): number;
  snapshot(): Record<string, { files: string[]; env: string[]; connectors: ConnectorId[] }>;
} {
  const bySandbox = new Map<string, GuestConnectorDisk>();

  function disk(sandboxId: string): GuestConnectorDisk {
    let row = bySandbox.get(sandboxId);
    if (!row) {
      row = { files: new Map(), env: {}, connectors: new Set() };
      bySandbox.set(sandboxId, row);
    }
    return row;
  }

  return {
    async write(plan) {
      if (plan.target.kind !== "user_sandbox") {
        throw new TenantSandboxConnectorInjectError();
      }
      const row = disk(plan.target.sandbox_id);
      for (const file of plan.files) {
        row.files.set(file.path, {
          contents: file.contents,
          encoding: file.encoding,
          mode: file.mode,
        });
      }
      Object.assign(row.env, plan.env);
      row.connectors.add(plan.connector_id);
    },

    read(sandbox_id) {
      const id = sandbox_id.trim();
      return bySandbox.get(id) ?? null;
    },

    hasConnector(sandbox_id, connector_id) {
      return bySandbox.get(sandbox_id.trim())?.connectors.has(connector_id) === true;
    },

    printenv(sandbox_id) {
      return { ...(bySandbox.get(sandbox_id.trim())?.env ?? {}) };
    },

    listFiles(sandbox_id) {
      const row = bySandbox.get(sandbox_id.trim());
      return row ? [...row.files.keys()].sort() : [];
    },

    async wipe(sandbox_id) {
      bySandbox.delete(sandbox_id.trim());
    },

    async wipeOauth(sandbox_id) {
      const row = bySandbox.get(sandbox_id.trim());
      if (!row) return;
      row.files.delete(CONNECTOR_GUEST_PATHS.google);
      row.files.delete(CONNECTOR_GUEST_PATHS.hubspot);
      delete row.env.GOOGLE_WORKSPACE_CLI_TOKEN;
      delete row.env.GWS_ACCESS_TOKEN;
      delete row.env.HUBSPOT_ACCESS_TOKEN;
      row.connectors.delete("google");
      row.connectors.delete("hubspot");
    },

    async wipeConnector(sandbox_id, connector_id) {
      const row = bySandbox.get(sandbox_id.trim());
      if (!row) return;
      if (connector_id === "google") {
        row.files.delete(CONNECTOR_GUEST_PATHS.google);
        delete row.env.GWS_ACCESS_TOKEN;
        row.connectors.delete("google");
        return;
      }
      if (connector_id === "hubspot") {
        row.files.delete(CONNECTOR_GUEST_PATHS.hubspot);
        delete row.env.HUBSPOT_ACCESS_TOKEN;
        row.connectors.delete("hubspot");
        return;
      }
      row.files.delete(CONNECTOR_GUEST_PATHS.whatsapp);
      delete row.env.WACLI_STORE_DIR;
      row.connectors.delete("whatsapp");
    },

    sandboxCount() {
      return bySandbox.size;
    },

    snapshot() {
      const out: Record<
        string,
        { files: string[]; env: string[]; connectors: ConnectorId[] }
      > = {};
      for (const [id, row] of bySandbox) {
        out[id] = {
          files: [...row.files.keys()].sort(),
          env: Object.keys(row.env).sort(),
          connectors: [...row.connectors].sort() as ConnectorId[],
        };
      }
      return out;
    },
  };
}

export type InjectUserConnectorPorts = {
  ensureBinding(input: {
    tenant_id: string;
    owner_user_id: string;
  }): Promise<Omit<UserSandboxBinding, "created"> & { created?: boolean }>;
  getInstance(instance_id: string): Promise<{
    instance_id: string;
    tenant_id: string;
    sandbox_id: string | null;
    scope: InstanceScope | string | null;
    owner_user_id: string | null;
  } | null>;
  getSecrets(
    tenant_id: string,
    user_id: string,
    connector_id: ConnectorId,
  ): Promise<ConnectorSecrets>;
  guest: GuestConnectorStore;
};

export async function injectUserConnector(input: {
  tenant_id: string;
  user_id: string;
  connector_id: ConnectorId;
  sandbox_destroyed?: boolean;
  force?: boolean;
  ports: InjectUserConnectorPorts;
}): Promise<InjectUserConnectorResult> {
  const tenant_id = requireId(input.tenant_id, "tenant_id");
  const user_id = requireId(input.user_id, "user_id");
  const binding = await input.ports.ensureBinding({
    tenant_id,
    owner_user_id: user_id,
  });
  const instance = await input.ports.getInstance(binding.instance_id);
  if (!instance) {
    return {
      tenant_id,
      owner_user_id: user_id,
      instance_id: binding.instance_id,
      connector_id: input.connector_id,
      sandbox_id: null,
      injected: false,
      reason: "sandbox_not_online",
      skip_oauth: true,
      files: [],
      post_commands: [],
    };
  }

  assertUserSandboxInjectAllowed({
    scope: instance.scope,
    owner_user_id: instance.owner_user_id,
    target_user_id: user_id,
  });

  const sandbox_id = instance.sandbox_id?.trim() ?? "";
  if (!sandbox_id) {
    return {
      tenant_id,
      owner_user_id: user_id,
      instance_id: instance.instance_id,
      connector_id: input.connector_id,
      sandbox_id: null,
      injected: false,
      reason: "sandbox_not_online",
      skip_oauth: true,
      files: [],
      post_commands: [],
    };
  }

  const secrets = await input.ports.getSecrets(
    tenant_id,
    user_id,
    input.connector_id,
  );
  const guest_has = input.ports.guest.hasConnector(
    sandbox_id,
    input.connector_id,
  );
  const decision = decideConnectorRestore({
    connector_id: input.connector_id,
    sandbox_destroyed: input.sandbox_destroyed === true,
    guest_has_material: guest_has && input.force !== true,
    secrets,
  });

  if (decision.action === "noop") {
    return {
      tenant_id,
      owner_user_id: user_id,
      instance_id: instance.instance_id,
      connector_id: input.connector_id,
      sandbox_id,
      injected: false,
      reason: "already_hydrated",
      skip_oauth: true,
      files: input.ports.guest.listFiles(sandbox_id),
      post_commands: [],
    };
  }

  if (decision.action === "needs_reauth") {
    return {
      tenant_id,
      owner_user_id: user_id,
      instance_id: instance.instance_id,
      connector_id: input.connector_id,
      sandbox_id,
      injected: false,
      reason: "needs_reauth",
      skip_oauth: false,
      files: [],
      post_commands: [],
    };
  }

  const target = parseUserSandboxTarget({
    kind: "user_sandbox",
    tenant_id,
    owner_user_id: user_id,
    instance_id: instance.instance_id,
    sandbox_id,
  });
  const plan = buildConnectorInjectPlan({
    connector_id: input.connector_id,
    target,
    secrets,
  });
  if (plan.files.length === 0 && input.connector_id !== "whatsapp") {
    return {
      tenant_id,
      owner_user_id: user_id,
      instance_id: instance.instance_id,
      connector_id: input.connector_id,
      sandbox_id,
      injected: false,
      reason: "access_token_missing",
      skip_oauth: decision.skip_oauth,
      files: [],
      post_commands: [],
    };
  }
  await input.ports.guest.write(plan);
  const files = plan.files.map((file) => file.path);
  return {
    tenant_id,
    owner_user_id: user_id,
    instance_id: instance.instance_id,
    connector_id: input.connector_id,
    sandbox_id,
    injected: true,
    reason: "injected",
    skip_oauth: true,
    files,
    post_commands: whatsappPostInjectCommands(input.connector_id, true),
  };
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidConnectorInjectTargetError(`${field} is required`);
  }
  return value.trim();
}
