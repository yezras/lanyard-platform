import { createElement, type ReactNode } from "react";

import type { ChatComposerTrigger } from "@astryxdesign/core/Chat";
import {
  createStaticSource,
  TypeaheadItem,
  type SearchableItem,
} from "@astryxdesign/core/Typeahead";

import type { ThreadParticipant } from "../../api/types.js";
import { participantDisplayName } from "../../api/groupRoom.js";
import {
  CONNECTOR_IDS,
  connectorIsEntitled,
  type ConnectorId,
  type SpaConnectorStatus,
} from "../settings/connectorsCatalog.js";

import { DitherAvatar } from "./DitherAvatar.js";

/** Composer @ section headings (agents first, then provisioned connectors). */
export const MAILBOX_PICKER_GROUP_AGENTS = "Agents";
export const MAILBOX_PICKER_GROUP_CONNECTORS = "Connectors";

/** Display labels for @ connector rows (parser matches label and id). */
export const MAILBOX_CONNECTOR_LABELS: Record<ConnectorId, string> = {
  google: "Google Workspace",
  hubspot: "HubSpot",
  whatsapp: "WhatsApp",
  github: "GitHub",
};

export type MailboxPickerKind = "persona" | "connector";

/** Auxiliary payload so later parse can tell persona vs connector (no wake). */
export type MailboxPickerAux = {
  kind: MailboxPickerKind;
  group: typeof MAILBOX_PICKER_GROUP_AGENTS | typeof MAILBOX_PICKER_GROUP_CONNECTORS;
  mention?: boolean;
};

export type TenantAgentRow = {
  id: string;
  name: string;
};

export type MailboxPickerRoomKind = "channel" | "dm";

export type MailboxPickerSources = {
  roomKind: MailboxPickerRoomKind;
  roomParticipants?: readonly ThreadParticipant[];
  currentAgentId?: string | null;
  tenantAgents?: readonly TenantAgentRow[];
  connectors?: readonly SpaConnectorStatus[];
};

function trimId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isScheduledTaskThread(thread: {
  kind?: string;
  scheduled_job_id?: string | null;
}): boolean {
  if (thread.kind === "scheduled_task") {
    return true;
  }
  const jobId = thread.scheduled_job_id;
  return typeof jobId === "string" && jobId.trim().length > 0;
}

/** Durable 1:1 catalog already loaded on the Agents sidenav — no mailbox API. */
export function tenantAgentsFromThreads(
  threads: ReadonlyArray<{
    kind?: string;
    agent_id?: string | null;
    title?: string;
    scheduled_job_id?: string | null;
  }>,
): TenantAgentRow[] {
  const out: TenantAgentRow[] = [];
  const seen = new Set<string>();
  for (const thread of threads) {
    if (thread.kind === "group" || isScheduledTaskThread(thread)) {
      continue;
    }
    const id = trimId(thread.agent_id);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const name = thread.title?.trim();
    out.push({ id, name: name && name.length > 0 ? name : id });
  }
  return out;
}

function roomAgentsFromParticipants(
  participants: readonly ThreadParticipant[],
): TenantAgentRow[] {
  const out: TenantAgentRow[] = [];
  const seen = new Set<string>();
  for (const participant of participants) {
    if (participant.kind !== "persona") {
      continue;
    }
    const id = trimId(participant.persona_id);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push({ id, name: participantDisplayName(participant) });
  }
  return out;
}

function pushUniqueAgent(
  out: TenantAgentRow[],
  seen: Set<string>,
  agent: TenantAgentRow,
): void {
  const id = trimId(agent.id);
  if (!id || seen.has(id)) {
    return;
  }
  const name = agent.name.trim();
  seen.add(id);
  out.push({ id, name: name.length > 0 ? name : id });
}

/**
 * Channel: room personas, then other tenant agents.
 * 1:1: tenant catalog minus the current persona (Fizz from Bill).
 * Humans (Jack) are never @ targets.
 */
export function mailboxPickerAgents(
  sources: MailboxPickerSources,
): TenantAgentRow[] {
  const out: TenantAgentRow[] = [];
  const seen = new Set<string>();
  const tenantAgents = sources.tenantAgents ?? [];

  if (sources.roomKind === "channel") {
    for (const agent of roomAgentsFromParticipants(
      sources.roomParticipants ?? [],
    )) {
      pushUniqueAgent(out, seen, agent);
    }
    for (const agent of tenantAgents) {
      pushUniqueAgent(out, seen, agent);
    }
    return out;
  }

  const exclude = trimId(sources.currentAgentId);
  for (const agent of tenantAgents) {
    if (exclude && trimId(agent.id) === exclude) {
      continue;
    }
    pushUniqueAgent(out, seen, agent);
  }
  return out;
}

/** Entitled + role-granted catalog rows only. Unknown ids dropped. */
export function mailboxPickerConnectors(
  statuses: readonly SpaConnectorStatus[] = [],
): Array<{ id: ConnectorId; label: string }> {
  const byId = new Map<ConnectorId, SpaConnectorStatus>();
  for (const row of statuses) {
    byId.set(row.connector_id, row);
  }
  const out: Array<{ id: ConnectorId; label: string }> = [];
  for (const id of CONNECTOR_IDS) {
    const row = byId.get(id);
    if (!row || !connectorIsEntitled(row)) {
      continue;
    }
    out.push({ id, label: MAILBOX_CONNECTOR_LABELS[id] });
  }
  return out;
}

export function mailboxPickerItemKind(
  item: SearchableItem,
): MailboxPickerKind | null {
  const aux = item.auxiliaryData as MailboxPickerAux | undefined;
  if (aux?.kind === "persona" || aux?.kind === "connector") {
    return aux.kind;
  }
  return null;
}

export function mailboxPickerSearchItems(
  sources: MailboxPickerSources,
): SearchableItem<MailboxPickerAux>[] {
  const items: SearchableItem<MailboxPickerAux>[] = [];
  for (const agent of mailboxPickerAgents(sources)) {
    items.push({
      id: agent.id,
      label: agent.name,
      auxiliaryData: {
        kind: "persona",
        group: MAILBOX_PICKER_GROUP_AGENTS,
        mention: true,
      },
    });
  }
  for (const connector of mailboxPickerConnectors(sources.connectors)) {
    items.push({
      id: connector.id,
      label: connector.label,
      auxiliaryData: {
        kind: "connector",
        group: MAILBOX_PICKER_GROUP_CONNECTORS,
      },
    });
  }
  return items;
}

export function renderMailboxPickerItem(item: SearchableItem): ReactNode {
  const kind = mailboxPickerItemKind(item);
  return createElement(TypeaheadItem, {
    item,
    ...(kind === "persona"
      ? {
          icon: createElement(DitherAvatar, {
            seed: item.id,
            size: 16,
            label: item.label,
          }),
        }
      : {}),
  });
}

function mailboxPickerKeywords(item: SearchableItem): string[] {
  const kind = mailboxPickerItemKind(item);
  if (kind === "connector") {
    return [item.id];
  }
  return [];
}

export function buildMailboxMentionTrigger(
  sources: MailboxPickerSources,
): ChatComposerTrigger | null {
  const items = mailboxPickerSearchItems(sources);
  if (items.length === 0) {
    return null;
  }
  return {
    character: "@",
    searchSource: createStaticSource(items, {
      keywords: mailboxPickerKeywords,
    }),
    menuLabel: "Mentions",
    renderItem: renderMailboxPickerItem,
    onSelect: (item) => ({
      value: `@${item.label}`,
      label: item.label.startsWith("@") ? item.label : `@${item.label}`,
      variant: "blue" as const,
    }),
  };
}

/** Keep / # $ from buildComposerTriggers; @ comes only from the mailbox picker. */
export function mergeMailboxMentionTrigger(
  triggers: ChatComposerTrigger[],
  mention: ChatComposerTrigger | null,
): ChatComposerTrigger[] {
  const rest = triggers.filter((trigger) => trigger.character !== "@");
  if (!mention) {
    return rest;
  }
  const slashIdx = rest.findIndex((trigger) => trigger.character === "/");
  if (slashIdx >= 0) {
    return [
      ...rest.slice(0, slashIdx + 1),
      mention,
      ...rest.slice(slashIdx + 1),
    ];
  }
  return [mention, ...rest];
}
