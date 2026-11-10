/**
 * Bind user-principal connectors onto BFF scheduled-task creates (lp-xhf4.13).
 *
 * Tenant cron cannot hold Alice Gmail. Mirror of the CP detector so vault
 * jobs.json stores owner_user_id + connector_ids at create.
 */
import { CONNECTOR_IDS, type ConnectorId } from "./connectors.js";

export const USER_PRINCIPAL_CONNECTOR_IDS = CONNECTOR_IDS;
export type UserPrincipalConnectorId = ConnectorId;

export type ScheduledTaskConnectorNeed =
  | { kind: "none" }
  | {
      kind: "user_principal";
      owner_user_id: string;
      connector_ids: readonly UserPrincipalConnectorId[];
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
  {
    id: "github",
    test: (token) => {
      const t = token.toLowerCase();
      return (
        t === "gh" ||
        t === "github" ||
        t.startsWith("gh-") ||
        t.startsWith("github-")
      );
    },
  },
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

function parseExplicit(raw: unknown): UserPrincipalConnectorId[] {
  if (!Array.isArray(raw)) return [];
  const out: UserPrincipalConnectorId[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if ((CONNECTOR_IDS as readonly string[]).includes(id)) {
      out.push(id as UserPrincipalConnectorId);
    }
  }
  return uniqueIds(out);
}

function promptHasBinary(prompt: string, bin: string): boolean {
  const re = new RegExp(`(?:^|\\s|/)${bin}(?:\\s|$)`, "i");
  return re.test(prompt);
}

export function detectUserPrincipalConnectors(
  input: ScheduledTaskConnectorHints,
): UserPrincipalConnectorId[] {
  const found: UserPrincipalConnectorId[] = [
    ...parseExplicit(input.connector_ids),
  ];
  for (const skill of input.skills ?? []) {
    const token = skill.trim();
    if (!token) continue;
    for (const hint of SKILL_HINTS) {
      if (hint.test(token)) found.push(hint.id);
    }
  }
  const prompt = input.prompt?.trim() ?? "";
  if (prompt) {
    if (promptHasBinary(prompt, "gws")) found.push("google");
    if (promptHasBinary(prompt, "hs") || promptHasBinary(prompt, "hubspot")) {
      found.push("hubspot");
    }
    if (promptHasBinary(prompt, "wacli")) found.push("whatsapp");
    if (promptHasBinary(prompt, "gh")) found.push("github");
  }
  return uniqueIds(found);
}

export function bindScheduledTaskConnectorNeed(
  input: ScheduledTaskConnectorHints,
): ScheduledTaskConnectorNeed {
  const connector_ids = detectUserPrincipalConnectors(input);
  if (connector_ids.length === 0) return { kind: "none" };
  const owner_user_id =
    input.owner_user_id?.trim() || input.user_id?.trim() || "";
  if (!owner_user_id) {
    throw new TenantCronUserConnectorError(connector_ids);
  }
  return { kind: "user_principal", owner_user_id, connector_ids };
}
