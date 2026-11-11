/**
 * User-principal connectors on scheduled tasks (lp-xhf4.13).
 *
 * Tenant cron cannot hold Alice Gmail. Jobs that need google/hubspot/whatsapp
 * bind owner_user_id, wake that user's sandbox, and inject that connection
 * row. Design: docs/architecture/portal-connectors.md §4 last paragraph.
 */

import type { ConnectorId } from "./connectors.js";
import { CONNECTOR_IDS, isConnectorId } from "./connectors.js";
import {
  TenantSandboxConnectorInjectError,
  injectUserConnector,
  type InjectUserConnectorPorts,
  type InjectUserConnectorResult,
} from "./connector-user-sandbox.js";
import type { InstanceScope } from "./resolve-instance.js";

/** Job fields the connector bind/fire path reads. */
export type ScheduledTaskConnectorJob = {
  tenant_id?: string;
  user_id?: string;
  owner_user_id?: string;
  skills?: string[];
  prompt?: string;
  connector_ids?: string[];
};

/** v1 user-principal catalog ids. Tenant-principal connectors are not v1. */
export const USER_PRINCIPAL_CONNECTOR_IDS = CONNECTOR_IDS;
export type UserPrincipalConnectorId = ConnectorId;

/**
 * Whether a scheduled task needs a user-principal connector.
 * Tenant + gmail is unrepresentable: missing owner fails at bind.
 */
export type ScheduledTaskConnectorNeed =
  | { kind: "none" }
  | {
      kind: "user_principal";
      owner_user_id: string;
      connector_ids: readonly UserPrincipalConnectorId[];
    };

export type ScheduledTaskFireTarget = {
  instance_id: string;
  scope: InstanceScope;
  owner_user_id: string | null;
};

export class TenantCronUserConnectorError extends Error {
  readonly code = "TENANT_CRON_USER_CONNECTOR" as const;
  readonly connector_ids: readonly UserPrincipalConnectorId[];

  constructor(connector_ids: readonly UserPrincipalConnectorId[]) {
    super(
      `Tenant-scoped cron cannot use user-principal connectors (${connector_ids.join(", ")})`,
    );
    this.name = "TenantCronUserConnectorError";
    this.connector_ids = connector_ids;
  }
}

export type ScheduledTaskConnectorHints = {
  skills?: readonly string[] | null;
  prompt?: string | null;
  connector_ids?: unknown;
  user_id?: string | null;
  owner_user_id?: string | null;
};

const SKILL_HINTS: ReadonlyArray<{
  id: UserPrincipalConnectorId;
  test: (token: string) => boolean;
}> = [
  {
    id: "google",
    test: (token) => {
      const t = token.toLowerCase();
      return (
        t === "gws" ||
        t === "gmail" ||
        t === "google" ||
        t.startsWith("gws-") ||
        t.startsWith("gmail-") ||
        t.startsWith("google-") ||
        t.includes("gws-gmail")
      );
    },
  },
  {
    id: "hubspot",
    test: (token) => {
      const t = token.toLowerCase();
      return t === "hs" || t === "hubspot" || t.startsWith("hubspot-");
    },
  },
  {
    id: "whatsapp",
    test: (token) => {
      const t = token.toLowerCase();
      return (
        t === "wacli" ||
        t === "whatsapp" ||
        t.startsWith("wacli-") ||
        t.startsWith("whatsapp-")
      );
    },
  },
];

const PROMPT_BINARIES: ReadonlyArray<{
  id: UserPrincipalConnectorId;
  bin: string;
}> = [
  { id: "google", bin: "gws" },
  { id: "hubspot", bin: "hs" },
  { id: "hubspot", bin: "hubspot" },
  { id: "whatsapp", bin: "wacli" },
];

function uniqueIds(
  ids: readonly UserPrincipalConnectorId[],
): UserPrincipalConnectorId[] {
  const out: UserPrincipalConnectorId[] = [];
  for (const id of USER_PRINCIPAL_CONNECTOR_IDS) {
    if (ids.includes(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

function parseExplicitConnectorIds(
  raw: unknown,
): UserPrincipalConnectorId[] {
  if (!Array.isArray(raw)) return [];
  const out: UserPrincipalConnectorId[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (isConnectorId(id)) out.push(id);
  }
  return uniqueIds(out);
}

function skillTokens(skills: readonly string[] | null | undefined): string[] {
  if (!skills) return [];
  return skills.map((s) => s.trim()).filter(Boolean);
}

function promptHasBinary(prompt: string, bin: string): boolean {
  const re = new RegExp(`(?:^|\\s|/)${bin}(?:\\s|$)`, "i");
  return re.test(prompt);
}

/**
 * Classify which user-principal connectors a job needs.
 * Skills, prompt argv, and explicit connector_ids are the only inputs.
 */
export function detectUserPrincipalConnectors(
  input: ScheduledTaskConnectorHints,
): UserPrincipalConnectorId[] {
  const found: UserPrincipalConnectorId[] = [
    ...parseExplicitConnectorIds(input.connector_ids),
  ];
  for (const skill of skillTokens(input.skills)) {
    for (const hint of SKILL_HINTS) {
      if (hint.test(skill)) found.push(hint.id);
    }
  }
  const prompt = input.prompt?.trim() ?? "";
  if (prompt) {
    for (const { id, bin } of PROMPT_BINARIES) {
      if (promptHasBinary(prompt, bin)) found.push(id);
    }
  }
  return uniqueIds(found);
}

function ownerFromHints(input: ScheduledTaskConnectorHints): string {
  const owner =
    input.owner_user_id?.trim() || input.user_id?.trim() || "";
  return owner;
}

/**
 * Bind a job to a user-principal need, or none.
 * Gmail/HubSpot/WhatsApp without a user id is tenant cron — illegal in v1.
 */
export function bindScheduledTaskConnectorNeed(
  input: ScheduledTaskConnectorHints,
): ScheduledTaskConnectorNeed {
  const connector_ids = detectUserPrincipalConnectors(input);
  if (connector_ids.length === 0) {
    return { kind: "none" };
  }
  const owner_user_id = ownerFromHints(input);
  if (!owner_user_id) {
    throw new TenantCronUserConnectorError(connector_ids);
  }
  return { kind: "user_principal", owner_user_id, connector_ids };
}

export function scheduledTaskConnectorNeedFromJob(
  job: ScheduledTaskConnectorJob,
): ScheduledTaskConnectorNeed {
  return bindScheduledTaskConnectorNeed({
    skills: job.skills,
    prompt: job.prompt,
    connector_ids: job.connector_ids,
    user_id: job.user_id,
    owner_user_id: job.owner_user_id,
  });
}

/** Stamp owner_user_id + connector_ids onto a create payload. */
export function stampScheduledTaskConnectorBinding<T extends Record<string, unknown>>(
  job: T,
  hints: ScheduledTaskConnectorHints,
): T & {
  owner_user_id?: string;
  connector_ids?: UserPrincipalConnectorId[];
} {
  const need = bindScheduledTaskConnectorNeed({
    ...hints,
    skills: hints.skills ?? (job.skills as string[] | undefined),
    prompt: hints.prompt ?? (job.prompt as string | undefined),
    connector_ids: hints.connector_ids ?? job.connector_ids,
    user_id: hints.user_id ?? (job.user_id as string | undefined),
    owner_user_id:
      hints.owner_user_id ?? (job.owner_user_id as string | undefined),
  });
  if (need.kind === "none") {
    return job;
  }
  return {
    ...job,
    owner_user_id: need.owner_user_id,
    connector_ids: [...need.connector_ids],
  };
}

/**
 * Draft-only gws job: google connector, drafts create/update, no send.
 * Acceptance proof for lp-xhf4.13 (gmail.draft is sticky; send is every_call).
 */
export function isDraftOnlyGwsJob(input: ScheduledTaskConnectorHints): boolean {
  const ids = detectUserPrincipalConnectors(input);
  if (!ids.includes("google")) return false;
  const blob = `${skillTokens(input.skills).join(" ")} ${input.prompt ?? ""}`.toLowerCase();
  const hasDraft =
    /\bdrafts?\b/.test(blob) &&
    !/\bdrafts?\s+send\b/.test(blob);
  const hasSend =
    /\bgmail\.send\b/.test(blob) ||
    /\+send\b/.test(blob) ||
    /\bmessages\s+send\b/.test(blob) ||
    /\bdrafts\s+send\b/.test(blob) ||
    /(^|[\s/_-])gws-gmail-send($|[\s/_-])/.test(blob) ||
    /(^|[\s/_-])gws-gmail-reply($|[\s/_-])/.test(blob);
  return hasDraft && !hasSend;
}

export type ResolveScheduledTaskFireTargetInput = {
  job: ScheduledTaskConnectorJob;
  requested_instance_id: string;
  need: ScheduledTaskConnectorNeed;
};

export type ScheduledTaskConnectorFirePorts = {
  ensureUserSandbox(input: {
    tenant_id: string;
    owner_user_id: string;
  }): Promise<{
    instance_id: string;
    tenant_id: string;
    owner_user_id: string;
    scope: "user";
  }>;
  getInstance(instance_id: string): Promise<{
    instance_id: string;
    tenant_id: string;
    sandbox_id: string | null;
    scope: InstanceScope | string | null;
    owner_user_id: string | null;
  } | null>;
};

/**
 * User-principal jobs wake the owner sandbox. Tenant primary is not a legal
 * fire target for Gmail/HubSpot/WhatsApp.
 */
export async function resolveScheduledTaskFireTarget(
  input: ResolveScheduledTaskFireTargetInput & {
    ports: ScheduledTaskConnectorFirePorts;
  },
): Promise<ScheduledTaskFireTarget> {
  if (input.need.kind === "none") {
    const row = await input.ports.getInstance(input.requested_instance_id);
    return {
      instance_id: input.requested_instance_id,
      scope: row?.scope === "user" ? "user" : "tenant",
      owner_user_id: row?.owner_user_id ?? null,
    };
  }

  const tenant_id = input.job.tenant_id?.trim() ?? "";
  if (!tenant_id) {
    throw new TenantCronUserConnectorError(input.need.connector_ids);
  }

  const binding = await input.ports.ensureUserSandbox({
    tenant_id,
    owner_user_id: input.need.owner_user_id,
  });
  const row = await input.ports.getInstance(binding.instance_id);
  const scope = row?.scope ?? binding.scope;
  if (scope === "tenant" || scope == null || scope === "") {
    throw new TenantSandboxConnectorInjectError(
      "User-principal scheduled tasks cannot fire on a tenant sandbox",
    );
  }
  if (scope !== "user") {
    throw new TenantSandboxConnectorInjectError(
      `User-principal scheduled tasks require scope=user, got ${String(scope)}`,
    );
  }
  const owner = row?.owner_user_id?.trim() || binding.owner_user_id;
  if (owner !== input.need.owner_user_id) {
    throw new TenantSandboxConnectorInjectError(
      "Scheduled-task fire owner_user_id must match the user sandbox",
    );
  }
  return {
    instance_id: binding.instance_id,
    scope: "user",
    owner_user_id: owner,
  };
}

export async function injectScheduledTaskConnectors(input: {
  need: ScheduledTaskConnectorNeed;
  tenant_id: string;
  ports: InjectUserConnectorPorts;
}): Promise<InjectUserConnectorResult[]> {
  if (input.need.kind === "none") return [];
  const results: InjectUserConnectorResult[] = [];
  for (const connector_id of input.need.connector_ids) {
    const result = await injectUserConnector({
      tenant_id: input.tenant_id,
      user_id: input.need.owner_user_id,
      connector_id,
      ports: input.ports,
    });
    results.push(result);
  }
  return results;
}

export type ScheduledTaskConnectorFireHooks = {
  resolveFireInstance: (
    input: ResolveScheduledTaskFireTargetInput,
  ) => Promise<ScheduledTaskFireTarget>;
  injectJobConnectors: (input: {
    job: ScheduledTaskConnectorJob;
    need: ScheduledTaskConnectorNeed;
    instance_id: string;
    sandbox_id: string | null;
  }) => Promise<void>;
};

export function createScheduledTaskConnectorFireHooks(input: {
  firePorts: ScheduledTaskConnectorFirePorts;
  injectPorts: InjectUserConnectorPorts;
}): ScheduledTaskConnectorFireHooks {
  return {
    async resolveFireInstance(resolveInput) {
      return resolveScheduledTaskFireTarget({
        ...resolveInput,
        ports: input.firePorts,
      });
    },
    async injectJobConnectors({ job, need }) {
      if (need.kind === "none") return;
      const tenant_id = job.tenant_id?.trim() ?? "";
      if (!tenant_id) {
        throw new TenantCronUserConnectorError(need.connector_ids);
      }
      await injectScheduledTaskConnectors({
        need,
        tenant_id,
        ports: input.injectPorts,
      });
    },
  };
}
