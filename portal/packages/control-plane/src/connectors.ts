/**
 * Connector entitlements, role grants, and connection rows (lp-xhf4.2).
 *
 * Live ids are canonical_connectors (lp-hdzm.4). First-class ids stay as
 * literals for custom runtimes. Ciphertext lives in Postgres as a KMS
 * envelope; public DTOs never include it.
 */

import { randomUUID } from "node:crypto";

import type { SqlClient } from "./db.js";
import {
  ConnectorKmsError,
  ConnectorKmsNotConfiguredError,
  decryptUtf8Envelope,
  encryptUtf8Envelope,
  type ConnectorKms,
} from "./connector-kms.js";
import { RoleNotFoundError, UserNotFoundError } from "./rbac.js";

export const FIRST_CLASS_CONNECTOR_IDS = [
  "google",
  "hubspot",
  "whatsapp",
  "github",
] as const;
export type FirstClassConnectorId = (typeof FIRST_CLASS_CONNECTOR_IDS)[number];

/** First-class custom runtimes. Live list is canonical_connectors. */
export const CONNECTOR_IDS = FIRST_CLASS_CONNECTOR_IDS;

declare const connectorIdBrand: unique symbol;
export type ConnectorId =
  | FirstClassConnectorId
  | (string & { readonly [connectorIdBrand]: true });

export const CONNECTOR_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export const CONNECTION_STATUSES = [
  "not_connected",
  "pairing",
  "connected",
  "needs_reauth",
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const ACTION_CLASSES = [
  "gmail.read",
  "gmail.draft",
  "gmail.send",
  "calendar.read",
  "calendar.write",
  "drive.read",
  "drive.write",
  "hubspot.read",
  "hubspot.write",
  "whatsapp.read",
  "whatsapp.send",
  "github.read",
  "github.write",
] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];

/** High-gate classes cannot be sticky (portal-connectors.md §8). */
export const EVERY_CALL_ACTION_CLASSES = [
  "gmail.send",
  "calendar.write",
  "drive.write",
  "hubspot.write",
  "whatsapp.send",
  "github.write",
] as const satisfies readonly ActionClass[];

export type ConnectorSticky = Partial<Record<ActionClass, true>>;

export type ConnectorSecrets = {
  oauth_access: string | null;
  oauth_refresh: string | null;
  oauth_expiry: string | null;
  oauth_scopes: string[];
  whatsapp_session_db: string | null;
};

export const ONBOARD_SURFACE_IDS = ["mcp", "api", "cli"] as const;
export type OnboardSurfaceId = (typeof ONBOARD_SURFACE_IDS)[number];

export type TenantConnectorEntitlement = {
  tenant_id: string;
  connector_id: ConnectorId;
  enabled: boolean;
  hubspot_portal_id: string | null;
  surfaces: OnboardSurfaceId[];
  created_at: string;
  updated_at: string;
};

/** Cross-tenant connection counts. `not_connected` is the absence of a row. */
export type ConnectorStatusCounts = {
  connected: number;
  pairing: number;
  needs_reauth: number;
};

export type ConnectorCatalogEntry = {
  connector_id: ConnectorId;
  enabled: boolean;
  status_counts: ConnectorStatusCounts;
};

export type ConnectorCatalogTenant = {
  tenant_id: string;
  tenant_slug: string;
  display_name: string;
  connectors: ConnectorCatalogEntry[];
};

export type ConnectorCatalogTotals = Record<
  FirstClassConnectorId,
  ConnectorStatusCounts & { entitled_tenants: number }
>;

/** Ops catalog: every tenant × v1 connector. No secrets, no OAuth, no QR. */
export type ConnectorCatalog = {
  tenants: ConnectorCatalogTenant[];
  totals: ConnectorCatalogTotals;
};

export type ConnectorCatalogTenantRef = {
  tenant_id: string;
  tenant_slug: string;
  display_name: string;
};

export type ConnectorCatalogEntitlementInput = {
  tenant_id: string;
  connector_id: ConnectorId;
  enabled: boolean;
};

export type ConnectorCatalogStatusInput = {
  tenant_id: string;
  connector_id: ConnectorId;
  status: ConnectionStatus;
  n: number;
};

export function emptyConnectorStatusCounts(): ConnectorStatusCounts {
  return { connected: 0, pairing: 0, needs_reauth: 0 };
}

export function emptyConnectorCatalogTotals(): ConnectorCatalogTotals {
  return {
    google: { ...emptyConnectorStatusCounts(), entitled_tenants: 0 },
    hubspot: { ...emptyConnectorStatusCounts(), entitled_tenants: 0 },
    whatsapp: { ...emptyConnectorStatusCounts(), entitled_tenants: 0 },
    github: { ...emptyConnectorStatusCounts(), entitled_tenants: 0 },
  };
}

function addStatusCounts(
  left: ConnectorStatusCounts,
  right: ConnectorStatusCounts,
): ConnectorStatusCounts {
  return {
    connected: left.connected + right.connected,
    pairing: left.pairing + right.pairing,
    needs_reauth: left.needs_reauth + right.needs_reauth,
  };
}

function countForStatus(
  counts: ConnectorStatusCounts,
  status: ConnectionStatus,
  n: number,
): ConnectorStatusCounts {
  if (status === "connected") {
    return { ...counts, connected: counts.connected + n };
  }
  if (status === "pairing") {
    return { ...counts, pairing: counts.pairing + n };
  }
  if (status === "needs_reauth") {
    return { ...counts, needs_reauth: counts.needs_reauth + n };
  }
  return counts;
}

/**
 * Assemble the ops catalog from tenant/entitlement/status rows.
 * Always emits the first-class catalog ids so the SPA never invents them.
 */
export function buildConnectorCatalog(input: {
  tenants: ConnectorCatalogTenantRef[];
  entitlements: ConnectorCatalogEntitlementInput[];
  statusRows: ConnectorCatalogStatusInput[];
}): ConnectorCatalog {
  const entitled = new Map<string, boolean>();
  for (const row of input.entitlements) {
    entitled.set(`${row.tenant_id}:${row.connector_id}`, row.enabled);
  }

  const counts = new Map<string, ConnectorStatusCounts>();
  for (const row of input.statusRows) {
    const n = Number(row.n);
    if (!Number.isFinite(n) || n <= 0) {
      continue;
    }
    const key = `${row.tenant_id}:${row.connector_id}`;
    const current = counts.get(key) ?? emptyConnectorStatusCounts();
    counts.set(key, countForStatus(current, row.status, n));
  }

  const totals = emptyConnectorCatalogTotals();
  const tenants = input.tenants.map((tenant) => {
    const connectors = CONNECTOR_IDS.map((connector_id) => {
      const key = `${tenant.tenant_id}:${connector_id}`;
      const enabled = entitled.get(key) === true;
      const status_counts = counts.get(key) ?? emptyConnectorStatusCounts();
      if (enabled) {
        totals[connector_id].entitled_tenants += 1;
      }
      totals[connector_id] = {
        ...addStatusCounts(totals[connector_id], status_counts),
        entitled_tenants: totals[connector_id].entitled_tenants,
      };
      return { connector_id, enabled, status_counts };
    });
    return {
      tenant_id: tenant.tenant_id,
      tenant_slug: tenant.tenant_slug,
      display_name: tenant.display_name,
      connectors,
    };
  });

  return { tenants, totals };
}

export type RoleConnectorGrant = {
  tenant_id: string;
  role_id: string;
  connector_id: ConnectorId;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

/** Public connection row — never ciphertext, never plaintext tokens. */
export type ConnectorConnectionPublic = {
  tenant_id: string;
  user_id: string;
  connector_id: ConnectorId;
  status: ConnectionStatus;
  account_label: string | null;
  hubspot_portal_id: string | null;
  sticky: ConnectorSticky;
  created_at: string;
  updated_at: string;
};

export type ConnectorAccess = {
  tenant_id: string;
  user_id: string;
  connector_id: ConnectorId;
  entitled: boolean;
  role_granted: boolean;
  connection: ConnectorConnectionPublic | null;
};

/** Portal list row: onboarded ∧ person-granted. Label is canonical. */
export type UserGrantedConnector = ConnectorAccess & {
  label: string;
};

export const CONNECTOR_PUBLIC_FORBIDDEN_KEYS = [
  "secrets_ciphertext",
  "ciphertext",
  "secrets",
  "oauth_access",
  "oauth_refresh",
  "oauth_expiry",
  "oauth_scopes",
  "whatsapp_session_db",
  "access_token",
  "refresh_token",
] as const;

type AuditRecorder = (input: {
  tenant_id: string | null;
  action:
    | "connector.entitlement_upserted"
    | "connector.grant_upserted"
    | "connector.connection_upserted"
    | "connector.disconnected"
    | "connector.secrets_written";
  actor: string | null;
  metadata: Record<string, unknown>;
}) => Promise<void> | void;

export class InvalidConnectorIdError extends Error {
  readonly code = "INVALID_CONNECTOR_ID";

  constructor(value: string) {
    super(`Unknown connector_id: ${value}`);
    this.name = "InvalidConnectorIdError";
  }
}

export class InvalidConnectionStatusError extends Error {
  readonly code = "INVALID_CONNECTION_STATUS";

  constructor(value: string) {
    super(`Unknown connection status: ${value}`);
    this.name = "InvalidConnectionStatusError";
  }
}

export class InvalidConnectorStickyError extends Error {
  readonly code = "INVALID_CONNECTOR_STICKY";

  constructor(message: string) {
    super(message);
    this.name = "InvalidConnectorStickyError";
  }
}

export class InvalidConnectorSecretsError extends Error {
  readonly code = "INVALID_CONNECTOR_SECRETS";

  constructor(message: string) {
    super(message);
    this.name = "InvalidConnectorSecretsError";
  }
}

export class InvalidHubSpotPinError extends Error {
  readonly code = "INVALID_HUBSPOT_PIN";

  constructor(message: string) {
    super(message);
    this.name = "InvalidHubSpotPinError";
  }
}

export class ConnectorConnectionNotFoundError extends Error {
  readonly code = "CONNECTOR_CONNECTION_NOT_FOUND";

  constructor(tenant_id: string, user_id: string, connector_id: ConnectorId) {
    super(
      `Connector connection not found: ${tenant_id}/${user_id}/${connector_id}`,
    );
    this.name = "ConnectorConnectionNotFoundError";
  }
}

export class ConnectorEntitlementNotFoundError extends Error {
  readonly code = "CONNECTOR_ENTITLEMENT_NOT_FOUND";

  constructor(tenant_id: string, connector_id: ConnectorId) {
    super(`Connector entitlement not found: ${tenant_id}/${connector_id}`);
    this.name = "ConnectorEntitlementNotFoundError";
  }
}

export function isFirstClassConnectorId(
  value: string,
): value is FirstClassConnectorId {
  return (FIRST_CLASS_CONNECTOR_IDS as readonly string[]).includes(value);
}

/** Slug shape only. Membership is parseConnectorId against the registry. */
export function isConnectorId(value: string): value is ConnectorId {
  return CONNECTOR_ID_PATTERN.test(value);
}

/** Brand a row already stored under the canonical FK. */
export function connectorIdFromRow(value: string): ConnectorId {
  if (!isConnectorId(value)) {
    throw new InvalidConnectorIdError(value);
  }
  return value;
}

/** HTTP/API boundary: id must exist on canonical_connectors and not be archived. */
export async function parseConnectorId(
  db: SqlClient,
  value: string,
): Promise<ConnectorId> {
  if (!isConnectorId(value)) {
    throw new InvalidConnectorIdError(value);
  }
  const row = await db.get<{ id: string }>(
    `SELECT id FROM canonical_connectors WHERE id = ? AND archived = 0`,
    [value],
  );
  if (!row) {
    throw new InvalidConnectorIdError(value);
  }
  return connectorIdFromRow(row.id);
}

export function isConnectionStatus(value: string): value is ConnectionStatus {
  return (CONNECTION_STATUSES as readonly string[]).includes(value);
}

export function parseConnectionStatus(value: string): ConnectionStatus {
  if (!isConnectionStatus(value)) {
    throw new InvalidConnectionStatusError(value);
  }
  return value;
}

export function isActionClass(value: string): value is ActionClass {
  return (ACTION_CLASSES as readonly string[]).includes(value);
}

export function parseSticky(value: unknown): ConnectorSticky {
  if (value == null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidConnectorStickyError("sticky must be an object");
  }
  const sticky: ConnectorSticky = {};
  for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
    if (!isActionClass(key)) {
      throw new InvalidConnectorStickyError(`unknown action_class: ${key}`);
    }
    if (flag !== true && flag !== false) {
      throw new InvalidConnectorStickyError(
        `sticky.${key} must be true or omitted`,
      );
    }
    if (flag !== true) {
      continue;
    }
    if ((EVERY_CALL_ACTION_CLASSES as readonly string[]).includes(key)) {
      throw new InvalidConnectorStickyError(
        `action_class ${key} is every_call and cannot be sticky`,
      );
    }
    sticky[key] = true;
  }
  return sticky;
}

export function emptyConnectorSecrets(): ConnectorSecrets {
  return {
    oauth_access: null,
    oauth_refresh: null,
    oauth_expiry: null,
    oauth_scopes: [],
    whatsapp_session_db: null,
  };
}

export function parseConnectorSecrets(value: unknown): ConnectorSecrets {
  if (value == null) {
    return emptyConnectorSecrets();
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidConnectorSecretsError("secrets must be an object");
  }
  const raw = value as Record<string, unknown>;
  const forbidden = ["secrets_ciphertext", "ciphertext", "encrypted"];
  for (const key of forbidden) {
    if (key in raw) {
      throw new InvalidConnectorSecretsError(
        "secrets payload must be plaintext fields, not ciphertext",
      );
    }
  }
  for (const key of Object.keys(raw)) {
    const lower = key.toLowerCase();
    if (
      lower === "wacli.db" ||
      lower === "wacli_db" ||
      lower === "media" ||
      lower === "media_dir" ||
      lower.includes("wacli.db")
    ) {
      throw new InvalidConnectorSecretsError(
        "Only WhatsApp session.db may be stored; wacli.db and media are forbidden",
      );
    }
  }
  const optString = (key: string): string | null => {
    const v = raw[key];
    if (v == null) {
      return null;
    }
    if (typeof v !== "string") {
      throw new InvalidConnectorSecretsError(`${key} must be a string or null`);
    }
    return v;
  };
  let oauth_scopes: string[] = [];
  if (raw.oauth_scopes != null) {
    if (
      !Array.isArray(raw.oauth_scopes) ||
      raw.oauth_scopes.some((s) => typeof s !== "string")
    ) {
      throw new InvalidConnectorSecretsError("oauth_scopes must be a string array");
    }
    oauth_scopes = raw.oauth_scopes as string[];
  }
  return {
    oauth_access: optString("oauth_access"),
    oauth_refresh: optString("oauth_refresh"),
    oauth_expiry: optString("oauth_expiry"),
    oauth_scopes,
    whatsapp_session_db: optString("whatsapp_session_db"),
  };
}

function secretsAreEmpty(secrets: ConnectorSecrets): boolean {
  return (
    !secrets.oauth_access &&
    !secrets.oauth_refresh &&
    !secrets.oauth_expiry &&
    secrets.oauth_scopes.length === 0 &&
    !secrets.whatsapp_session_db
  );
}

function mergeSecrets(
  base: ConnectorSecrets,
  patch: Partial<ConnectorSecrets>,
): ConnectorSecrets {
  return {
    oauth_access:
      patch.oauth_access !== undefined ? patch.oauth_access : base.oauth_access,
    oauth_refresh:
      patch.oauth_refresh !== undefined ? patch.oauth_refresh : base.oauth_refresh,
    oauth_expiry:
      patch.oauth_expiry !== undefined ? patch.oauth_expiry : base.oauth_expiry,
    oauth_scopes:
      patch.oauth_scopes !== undefined ? patch.oauth_scopes : base.oauth_scopes,
    whatsapp_session_db:
      patch.whatsapp_session_db !== undefined
        ? patch.whatsapp_session_db
        : base.whatsapp_session_db,
  };
}

export function assertPublicConnectorJson(value: unknown): void {
  if (value == null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertPublicConnectorJson(item);
    }
    return;
  }
  const rec = value as Record<string, unknown>;
  for (const key of CONNECTOR_PUBLIC_FORBIDDEN_KEYS) {
    if (key in rec) {
      throw new Error(`public connector JSON leaked ${key}`);
    }
  }
  for (const child of Object.values(rec)) {
    if (child && typeof child === "object") {
      assertPublicConnectorJson(child);
    }
  }
}

function requireKms(kms: ConnectorKms | null | undefined): ConnectorKms {
  if (!kms) {
    throw new ConnectorKmsNotConfiguredError();
  }
  return kms;
}

async function encryptSecrets(
  kms: ConnectorKms,
  secrets: ConnectorSecrets,
): Promise<string | null> {
  if (secretsAreEmpty(secrets)) {
    return null;
  }
  return encryptUtf8Envelope(kms, JSON.stringify(secrets));
}

async function decryptSecrets(
  kms: ConnectorKms,
  envelope: string | null,
): Promise<ConnectorSecrets> {
  if (!envelope) {
    return emptyConnectorSecrets();
  }
  const plaintext = await decryptUtf8Envelope(kms, envelope);
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new ConnectorKmsError(
      "CORRUPT_SECRETS",
      "decrypted connector secrets are not JSON",
    );
  }
  return parseConnectorSecrets(parsed);
}

type EntitlementRow = {
  tenant_id: string;
  connector_id: string;
  enabled: number | boolean;
  hubspot_portal_id: string | null;
  surfaces_json?: string | null;
  created_at: string;
  updated_at: string;
};

function isOnboardSurfaceId(value: string): value is OnboardSurfaceId {
  return (ONBOARD_SURFACE_IDS as readonly string[]).includes(value);
}

function parseEntitlementSurfaces(value: unknown): OnboardSurfaceId[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const surfaces: OnboardSurfaceId[] = [];
  for (const item of parsed) {
    if (typeof item === "string" && isOnboardSurfaceId(item) && !surfaces.includes(item)) {
      surfaces.push(item);
    }
  }
  return surfaces;
}

function mapEntitlement(row: EntitlementRow): TenantConnectorEntitlement {
  return {
    tenant_id: row.tenant_id,
    connector_id: connectorIdFromRow(row.connector_id),
    enabled: Boolean(row.enabled),
    hubspot_portal_id: row.hubspot_portal_id,
    surfaces: parseEntitlementSurfaces(row.surfaces_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

type GrantRow = {
  tenant_id: string;
  role_id: string;
  connector_id: string;
  enabled: number | boolean;
  created_at: string;
  updated_at: string;
};

function mapGrant(row: GrantRow): RoleConnectorGrant {
  return {
    tenant_id: row.tenant_id,
    role_id: row.role_id,
    connector_id: connectorIdFromRow(row.connector_id),
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

type ConnectionRow = {
  tenant_id: string;
  user_id: string;
  connector_id: string;
  status: string;
  account_label: string | null;
  sticky_json: string;
  created_at: string;
  updated_at: string;
};

function mapConnection(
  row: ConnectionRow,
  hubspot_portal_id: string | null,
): ConnectorConnectionPublic {
  let sticky: ConnectorSticky = {};
  try {
    sticky = parseSticky(JSON.parse(row.sticky_json) as unknown);
  } catch {
    sticky = {};
  }
  return {
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    connector_id: connectorIdFromRow(row.connector_id),
    status: parseConnectionStatus(row.status),
    account_label: row.account_label,
    hubspot_portal_id,
    sticky,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getHubSpotPin(
  db: SqlClient,
  tenant_id: string,
): Promise<string | null> {
  const row = await db.get<{ hubspot_portal_id: string | null }>(
    `SELECT hubspot_portal_id
     FROM tenant_connector_entitlements
     WHERE tenant_id = ? AND connector_id = 'hubspot'`,
    [tenant_id],
  );
  return row?.hubspot_portal_id ?? null;
}

async function requireUserInTenant(
  db: SqlClient,
  tenant_id: string,
  user_id: string,
): Promise<void> {
  const row = await db.get<{ user_id: string }>(
    `SELECT user_id FROM users WHERE tenant_id = ? AND user_id = ?`,
    [tenant_id, user_id],
  );
  if (!row) {
    throw new UserNotFoundError(user_id);
  }
}

async function requireRoleInTenant(
  db: SqlClient,
  tenant_id: string,
  role_id: string,
): Promise<void> {
  const row = await db.get<{ role_id: string }>(
    `SELECT role_id FROM roles WHERE tenant_id = ? AND role_id = ?`,
    [tenant_id, role_id],
  );
  if (!row) {
    throw new RoleNotFoundError(role_id);
  }
}

export async function listConnectorCatalog(
  db: SqlClient,
): Promise<ConnectorCatalog> {
  const tenants = await db.all<ConnectorCatalogTenantRef>(
    `SELECT tenant_id, tenant_slug, display_name
     FROM tenants
     ORDER BY tenant_slug`,
  );
  const entitlements = await db.all<{
    tenant_id: string;
    connector_id: string;
    enabled: number | boolean;
  }>(
    `SELECT tenant_id, connector_id, enabled
     FROM tenant_connector_entitlements`,
  );
  const statusRows = await db.all<{
    tenant_id: string;
    connector_id: string;
    status: string;
    n: number | string;
  }>(
    `SELECT tenant_id, connector_id, status, COUNT(*)::text AS n
     FROM connector_connections
     GROUP BY tenant_id, connector_id, status`,
  );

  const catalog = buildConnectorCatalog({
    tenants,
    entitlements: entitlements.flatMap((row) => {
      try {
        return [
          {
            tenant_id: row.tenant_id,
            connector_id: connectorIdFromRow(row.connector_id),
            enabled: Boolean(row.enabled),
          },
        ];
      } catch {
        return [];
      }
    }),
    statusRows: statusRows.flatMap((row) => {
      try {
        return [
          {
            tenant_id: row.tenant_id,
            connector_id: connectorIdFromRow(row.connector_id),
            status: parseConnectionStatus(row.status),
            n: Number(row.n),
          },
        ];
      } catch {
        return [];
      }
    }),
  });
  return catalog;
}

export async function listTenantConnectorEntitlements(
  db: SqlClient,
  tenant_id: string,
): Promise<TenantConnectorEntitlement[]> {
  const rows = await db.all<EntitlementRow>(
    `SELECT tenant_id, connector_id, enabled, hubspot_portal_id, surfaces_json,
            created_at, updated_at
     FROM tenant_connector_entitlements
     WHERE tenant_id = ?
     ORDER BY connector_id`,
    [tenant_id],
  );
  return rows.map(mapEntitlement);
}

export async function getTenantConnectorEntitlement(
  db: SqlClient,
  tenant_id: string,
  connector_id: ConnectorId,
): Promise<TenantConnectorEntitlement | null> {
  const row = await db.get<EntitlementRow>(
    `SELECT tenant_id, connector_id, enabled, hubspot_portal_id, surfaces_json,
            created_at, updated_at
     FROM tenant_connector_entitlements
     WHERE tenant_id = ? AND connector_id = ?`,
    [tenant_id, connector_id],
  );
  return row ? mapEntitlement(row) : null;
}

export async function upsertTenantConnectorEntitlement(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: {
    tenant_id: string;
    connector_id: ConnectorId;
    enabled: boolean;
    hubspot_portal_id?: string | null;
    surfaces?: OnboardSurfaceId[];
    actor?: string | null;
  },
): Promise<TenantConnectorEntitlement> {
  if (
    input.hubspot_portal_id != null &&
    input.hubspot_portal_id !== "" &&
    input.connector_id !== "hubspot"
  ) {
    throw new InvalidHubSpotPinError(
      "hubspot_portal_id is only valid for the hubspot connector",
    );
  }
  const now = new Date().toISOString();
  const pin =
    input.connector_id === "hubspot"
      ? (input.hubspot_portal_id === undefined
          ? undefined
          : input.hubspot_portal_id || null)
      : null;

  const existing = await getTenantConnectorEntitlement(
    db,
    input.tenant_id,
    input.connector_id,
  );
  const hubspot_portal_id =
    pin === undefined ? (existing?.hubspot_portal_id ?? null) : pin;
  const surfaces: OnboardSurfaceId[] = input.enabled
    ? (input.surfaces ?? existing?.surfaces ?? [])
    : [];
  const surfaces_json = JSON.stringify(surfaces);

  await db.run(
    `INSERT INTO tenant_connector_entitlements
       (tenant_id, connector_id, enabled, hubspot_portal_id, surfaces_json,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, connector_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       hubspot_portal_id = EXCLUDED.hubspot_portal_id,
       surfaces_json = EXCLUDED.surfaces_json,
       updated_at = EXCLUDED.updated_at`,
    [
      input.tenant_id,
      input.connector_id,
      input.enabled ? 1 : 0,
      hubspot_portal_id,
      surfaces_json,
      existing?.created_at ?? now,
      now,
    ],
  );

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "connector.entitlement_upserted",
    actor: input.actor ?? null,
    metadata: {
      connector_id: input.connector_id,
      enabled: input.enabled,
      surfaces,
      hubspot_pin_set: Boolean(hubspot_portal_id),
    },
  });

  const row = await getTenantConnectorEntitlement(
    db,
    input.tenant_id,
    input.connector_id,
  );
  if (!row) {
    throw new ConnectorEntitlementNotFoundError(
      input.tenant_id,
      input.connector_id,
    );
  }
  return row;
}

export async function listRoleConnectorGrants(
  db: SqlClient,
  tenant_id: string,
  role_id: string,
): Promise<RoleConnectorGrant[]> {
  await requireRoleInTenant(db, tenant_id, role_id);
  const rows = await db.all<GrantRow>(
    `SELECT tenant_id, role_id, connector_id, enabled, created_at, updated_at
     FROM role_connector_grants
     WHERE tenant_id = ? AND role_id = ?
     ORDER BY connector_id`,
    [tenant_id, role_id],
  );
  return rows.map(mapGrant);
}

export async function upsertRoleConnectorGrant(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: {
    tenant_id: string;
    role_id: string;
    connector_id: ConnectorId;
    enabled: boolean;
    actor?: string | null;
  },
): Promise<RoleConnectorGrant> {
  await requireRoleInTenant(db, input.tenant_id, input.role_id);
  const now = new Date().toISOString();
  const existing = await db.get<GrantRow>(
    `SELECT tenant_id, role_id, connector_id, enabled, created_at, updated_at
     FROM role_connector_grants
     WHERE tenant_id = ? AND role_id = ? AND connector_id = ?`,
    [input.tenant_id, input.role_id, input.connector_id],
  );

  await db.run(
    `INSERT INTO role_connector_grants
       (tenant_id, role_id, connector_id, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, role_id, connector_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       updated_at = EXCLUDED.updated_at`,
    [
      input.tenant_id,
      input.role_id,
      input.connector_id,
      input.enabled ? 1 : 0,
      existing?.created_at ?? now,
      now,
    ],
  );

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "connector.grant_upserted",
    actor: input.actor ?? null,
    metadata: {
      role_id: input.role_id,
      connector_id: input.connector_id,
      enabled: input.enabled,
    },
  });

  const row = await db.get<GrantRow>(
    `SELECT tenant_id, role_id, connector_id, enabled, created_at, updated_at
     FROM role_connector_grants
     WHERE tenant_id = ? AND role_id = ? AND connector_id = ?`,
    [input.tenant_id, input.role_id, input.connector_id],
  );
  if (!row) {
    throw new RoleNotFoundError(input.role_id);
  }
  return mapGrant(row);
}

export async function listUserConnectorConnections(
  db: SqlClient,
  tenant_id: string,
  user_id: string,
): Promise<ConnectorConnectionPublic[]> {
  await requireUserInTenant(db, tenant_id, user_id);
  const pin = await getHubSpotPin(db, tenant_id);
  const rows = await db.all<ConnectionRow>(
    `SELECT tenant_id, user_id, connector_id, status, account_label, sticky_json,
            created_at, updated_at
     FROM connector_connections
     WHERE tenant_id = ? AND user_id = ?
     ORDER BY connector_id`,
    [tenant_id, user_id],
  );
  return rows.map((row) =>
    mapConnection(row, row.connector_id === "hubspot" ? pin : null),
  );
}

export async function getUserConnectorConnection(
  db: SqlClient,
  tenant_id: string,
  user_id: string,
  connector_id: ConnectorId,
): Promise<ConnectorConnectionPublic | null> {
  await requireUserInTenant(db, tenant_id, user_id);
  const row = await db.get<ConnectionRow>(
    `SELECT tenant_id, user_id, connector_id, status, account_label, sticky_json,
            created_at, updated_at
     FROM connector_connections
     WHERE tenant_id = ? AND user_id = ? AND connector_id = ?`,
    [tenant_id, user_id, connector_id],
  );
  if (!row) {
    return null;
  }
  const pin =
    connector_id === "hubspot" ? await getHubSpotPin(db, tenant_id) : null;
  return mapConnection(row, pin);
}

export async function upsertUserConnectorConnection(
  db: SqlClient,
  recordAudit: AuditRecorder,
  kms: ConnectorKms | null,
  input: {
    tenant_id: string;
    user_id: string;
    connector_id: ConnectorId;
    status?: ConnectionStatus;
    account_label?: string | null;
    sticky?: ConnectorSticky;
    secrets?: Partial<ConnectorSecrets>;
    replace_secrets?: boolean;
    actor?: string | null;
  },
): Promise<ConnectorConnectionPublic> {
  await requireUserInTenant(db, input.tenant_id, input.user_id);
  const now = new Date().toISOString();
  const existing = await db.get<ConnectionRow & { secrets_ciphertext: string | null }>(
    `SELECT tenant_id, user_id, connector_id, status, account_label, sticky_json,
            secrets_ciphertext, created_at, updated_at
     FROM connector_connections
     WHERE tenant_id = ? AND user_id = ? AND connector_id = ?`,
    [input.tenant_id, input.user_id, input.connector_id],
  );

  const status = input.status ?? (existing ? parseConnectionStatus(existing.status) : "not_connected");
  const account_label =
    input.account_label === undefined
      ? (existing?.account_label ?? null)
      : input.account_label;
  const sticky = input.sticky ?? (existing ? parseSticky(JSON.parse(existing.sticky_json)) : {});
  const sticky_json = JSON.stringify(sticky);

  let secrets_ciphertext = existing?.secrets_ciphertext ?? null;
  if (input.secrets !== undefined) {
    const cipher = requireKms(kms);
    const patch = parseConnectorSecrets(input.secrets);
    const merged = input.replace_secrets
      ? patch
      : mergeSecrets(
          await decryptSecrets(cipher, existing?.secrets_ciphertext ?? null),
          patch,
        );
    secrets_ciphertext = await encryptSecrets(cipher, merged);
  }

  const connection_id = existing ? undefined : randomUUID();

  await db.run(
    `INSERT INTO connector_connections
       (connection_id, tenant_id, user_id, connector_id, status, account_label,
        sticky_json, secrets_ciphertext, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, user_id, connector_id) DO UPDATE SET
       status = EXCLUDED.status,
       account_label = EXCLUDED.account_label,
       sticky_json = EXCLUDED.sticky_json,
       secrets_ciphertext = EXCLUDED.secrets_ciphertext,
       updated_at = EXCLUDED.updated_at`,
    [
      connection_id ?? randomUUID(),
      input.tenant_id,
      input.user_id,
      input.connector_id,
      status,
      account_label,
      sticky_json,
      secrets_ciphertext,
      existing?.created_at ?? now,
      now,
    ],
  );

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "connector.connection_upserted",
    actor: input.actor ?? null,
    metadata: {
      user_id: input.user_id,
      connector_id: input.connector_id,
      status,
      secrets_written: input.secrets !== undefined,
    },
  });

  if (input.secrets !== undefined) {
    await recordAudit({
      tenant_id: input.tenant_id,
      action: "connector.secrets_written",
      actor: input.actor ?? null,
      metadata: {
        user_id: input.user_id,
        connector_id: input.connector_id,
        has_oauth: Boolean(
          input.secrets.oauth_access || input.secrets.oauth_refresh,
        ),
        has_whatsapp_session: Boolean(input.secrets.whatsapp_session_db),
      },
    });
  }

  const publicRow = await getUserConnectorConnection(
    db,
    input.tenant_id,
    input.user_id,
    input.connector_id,
  );
  if (!publicRow) {
    throw new ConnectorConnectionNotFoundError(
      input.tenant_id,
      input.user_id,
      input.connector_id,
    );
  }
  return publicRow;
}

export async function deleteUserConnectorConnection(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: {
    tenant_id: string;
    user_id: string;
    connector_id: ConnectorId;
    actor?: string | null;
    reason?: string | null;
    missing?: "throw" | "ignore";
  },
): Promise<boolean> {
  await requireUserInTenant(db, input.tenant_id, input.user_id);
  const result = await db.run(
    `DELETE FROM connector_connections
     WHERE tenant_id = ? AND user_id = ? AND connector_id = ?`,
    [input.tenant_id, input.user_id, input.connector_id],
  );
  if (result.changes === 0) {
    if (input.missing === "ignore") {
      return false;
    }
    throw new ConnectorConnectionNotFoundError(
      input.tenant_id,
      input.user_id,
      input.connector_id,
    );
  }
  await recordAudit({
    tenant_id: input.tenant_id,
    action: "connector.disconnected",
    actor: input.actor ?? null,
    metadata: {
      user_id: input.user_id,
      connector_id: input.connector_id,
      reason: input.reason ?? "user_disconnect",
    },
  });
  return true;
}

export async function listTenantConnectorConnections(
  db: SqlClient,
  tenant_id: string,
  connector_id: ConnectorId,
): Promise<Array<{ user_id: string; connector_id: ConnectorId }>> {
  const rows = await db.all<{ user_id: string; connector_id: string }>(
    `SELECT user_id, connector_id
     FROM connector_connections
     WHERE tenant_id = ? AND connector_id = ?
     ORDER BY user_id`,
    [tenant_id, connector_id],
  );
  return rows.map((row) => ({
    user_id: row.user_id,
    connector_id: connectorIdFromRow(row.connector_id),
  }));
}


/**
 * Users on `role_id` who still have a connection and no remaining enabled
 * grant for `connector_id`. Call after the role grant is written off.
 */
export async function listUserIdsLosingRoleConnectorGrant(
  db: SqlClient,
  tenant_id: string,
  role_id: string,
  connector_id: ConnectorId,
): Promise<string[]> {
  await requireRoleInTenant(db, tenant_id, role_id);
  const rows = await db.all<{ user_id: string }>(
    `SELECT DISTINCT ur.user_id
     FROM user_roles ur
     INNER JOIN users u ON u.user_id = ur.user_id
     INNER JOIN connector_connections c
       ON c.user_id = ur.user_id
      AND c.tenant_id = u.tenant_id
      AND c.connector_id = ?
     WHERE ur.role_id = ?
       AND u.tenant_id = ?
       AND NOT EXISTS (
         SELECT 1
         FROM role_connector_grants g
         INNER JOIN user_roles ur2 ON ur2.role_id = g.role_id
         WHERE ur2.user_id = ur.user_id
           AND g.tenant_id = ?
           AND g.connector_id = ?
           AND g.enabled = 1
       )
     ORDER BY ur.user_id`,
    [connector_id, role_id, tenant_id, tenant_id, connector_id],
  );
  return rows.map((row) => row.user_id);
}

/** Lifecycle: tenant entitlement off deletes leftover connection rows (no soft-delete). */
export async function deleteConnectionsForConnector(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: {
    tenant_id: string;
    connector_id: ConnectorId;
    actor?: string | null;
    reason?: string | null;
  },
): Promise<{ deleted: number }> {
  const rows = await db.all<{ user_id: string }>(
    `SELECT user_id
     FROM connector_connections
     WHERE tenant_id = ? AND connector_id = ?`,
    [input.tenant_id, input.connector_id],
  );
  for (const row of rows) {
    await deleteUserConnectorConnection(db, recordAudit, {
      tenant_id: input.tenant_id,
      user_id: row.user_id,
      connector_id: input.connector_id,
      actor: input.actor,
      reason: input.reason ?? "tenant_entitlement_off",
    });
  }
  return { deleted: rows.length };
}

export async function getUserConnectorSecrets(
  db: SqlClient,
  kms: ConnectorKms | null,
  tenant_id: string,
  user_id: string,
  connector_id: ConnectorId,
): Promise<ConnectorSecrets> {
  await requireUserInTenant(db, tenant_id, user_id);
  const row = await db.get<{ secrets_ciphertext: string | null }>(
    `SELECT secrets_ciphertext
     FROM connector_connections
     WHERE tenant_id = ? AND user_id = ? AND connector_id = ?`,
    [tenant_id, user_id, connector_id],
  );
  if (!row) {
    throw new ConnectorConnectionNotFoundError(tenant_id, user_id, connector_id);
  }
  if (!row.secrets_ciphertext) {
    return emptyConnectorSecrets();
  }
  return decryptSecrets(requireKms(kms), row.secrets_ciphertext);
}

export async function putUserConnectorSecrets(
  db: SqlClient,
  recordAudit: AuditRecorder,
  kms: ConnectorKms | null,
  input: {
    tenant_id: string;
    user_id: string;
    connector_id: ConnectorId;
    secrets: Partial<ConnectorSecrets>;
    replace?: boolean;
    actor?: string | null;
  },
): Promise<ConnectorSecrets> {
  await upsertUserConnectorConnection(db, recordAudit, kms, {
    tenant_id: input.tenant_id,
    user_id: input.user_id,
    connector_id: input.connector_id,
    secrets: input.secrets,
    replace_secrets: input.replace,
    actor: input.actor,
  });
  return getUserConnectorSecrets(
    db,
    kms,
    input.tenant_id,
    input.user_id,
    input.connector_id,
  );
}

export async function getUserConnectorAccess(
  db: SqlClient,
  tenant_id: string,
  user_id: string,
  connector_id: ConnectorId,
): Promise<ConnectorAccess> {
  await requireUserInTenant(db, tenant_id, user_id);
  const entitlement = await getTenantConnectorEntitlement(
    db,
    tenant_id,
    connector_id,
  );
  const entitled = Boolean(entitlement?.enabled);
  const connection = await getUserConnectorConnection(
    db,
    tenant_id,
    user_id,
    connector_id,
  );
  return {
    tenant_id,
    user_id,
    connector_id,
    entitled,
    // Person grants (lp-hdzm.6) are ops/Portal write APIs. Runtime ACL
    // still follows onboard until Portal writes the same rows (0018.23 /
    // tenant Portal rebuild). Do not read role_connector_grants.
    role_granted: entitled,
    connection,
  };
}

type GrantedListRow = {
  connector_id: string;
  label: string;
  conn_tenant_id: string | null;
  conn_user_id: string | null;
  conn_connector_id: string | null;
  status: string | null;
  account_label: string | null;
  sticky_json: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/**
 * Portal Connectors list (lp-hdzm.28): person grants ∩ enabled entitlements.
 * Canonical label comes from the registry row, not integrations.sh.
 */
export async function listUserGrantedConnectors(
  db: SqlClient,
  tenant_id: string,
  user_id: string,
): Promise<UserGrantedConnector[]> {
  await requireUserInTenant(db, tenant_id, user_id);
  const pin = await getHubSpotPin(db, tenant_id);
  const rows = await db.all<GrantedListRow>(
    `SELECT g.connector_id,
            c.label,
            conn.tenant_id AS conn_tenant_id,
            conn.user_id AS conn_user_id,
            conn.connector_id AS conn_connector_id,
            conn.status,
            conn.account_label,
            conn.sticky_json,
            conn.created_at,
            conn.updated_at
       FROM person_connector_grants g
       INNER JOIN tenant_connector_entitlements e
         ON e.tenant_id = g.tenant_id AND e.connector_id = g.connector_id
       INNER JOIN canonical_connectors c
         ON c.id = g.connector_id
       LEFT JOIN connector_connections conn
         ON conn.tenant_id = g.tenant_id
        AND conn.user_id = g.user_id
        AND conn.connector_id = g.connector_id
      WHERE g.tenant_id = ?
        AND g.user_id = ?
        AND e.enabled = 1
        AND c.archived = 0
      ORDER BY g.connector_id`,
    [tenant_id, user_id],
  );

  return rows.map((row) => {
    const connector_id = connectorIdFromRow(row.connector_id);
    const connection =
      row.conn_connector_id &&
      row.conn_tenant_id &&
      row.conn_user_id &&
      row.status &&
      row.sticky_json &&
      row.created_at &&
      row.updated_at
        ? mapConnection(
            {
              tenant_id: row.conn_tenant_id,
              user_id: row.conn_user_id,
              connector_id: row.conn_connector_id,
              status: row.status,
              account_label: row.account_label,
              sticky_json: row.sticky_json,
              created_at: row.created_at,
              updated_at: row.updated_at,
            },
            connector_id === "hubspot" ? pin : null,
          )
        : null;
    return {
      tenant_id,
      user_id,
      connector_id,
      label: row.label,
      entitled: true,
      role_granted: true,
      connection,
    };
  });
}

export function connectionHasCiphertextColumn(
  value: ConnectorConnectionPublic,
): boolean {
  return "secrets_ciphertext" in value;
}
