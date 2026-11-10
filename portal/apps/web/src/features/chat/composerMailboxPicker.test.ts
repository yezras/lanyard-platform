import { describe, expect, it } from "vitest";

import { GROUP_ROOM_FIXTURE_PARTICIPANTS } from "../../api/groupRoom.js";
import type { SpaConnectorStatus } from "../settings/connectorsCatalog.js";

import { buildComposerTriggers } from "./chatComposerTriggers.js";
import {
  MAILBOX_CONNECTOR_LABELS,
  MAILBOX_PICKER_GROUP_AGENTS,
  MAILBOX_PICKER_GROUP_CONNECTORS,
  buildMailboxMentionTrigger,
  mailboxPickerAgents,
  mailboxPickerConnectors,
  mailboxPickerItemKind,
  mailboxPickerSearchItems,
  mergeMailboxMentionTrigger,
  tenantAgentsFromThreads,
  type MailboxPickerAux,
  type TenantAgentRow,
} from "./composerMailboxPicker.js";

const BILL: TenantAgentRow = { id: "bill", name: "Bill" };
const FIZZ: TenantAgentRow = { id: "fizz", name: "Fizz" };
const SKIP: TenantAgentRow = { id: "skip", name: "Skip" };

function connectorStatus(
  connectorId: SpaConnectorStatus["connector_id"],
  flags: Partial<SpaConnectorStatus> = {},
): SpaConnectorStatus {
  return {
    connector_id: connectorId,
    status: "connected",
    account_label: null,
    sticky: {},
    entitled: true,
    role_granted: true,
    hubspot_portal_id: null,
    ...flags,
  };
}

const ENTITLED_CONNECTORS: SpaConnectorStatus[] = [
  connectorStatus("google"),
  connectorStatus("hubspot"),
  connectorStatus("whatsapp"),
  connectorStatus("github"),
];

describe("tenantAgentsFromThreads", () => {
  it("reads durable 1:1 catalog rows and skips channels, jobs, and humans", () => {
    expect(
      tenantAgentsFromThreads([
        { kind: "chat", agent_id: "bill", title: "Bill" },
        { kind: "chat", agent_id: "fizz", title: "Fizz" },
        { kind: "group", agent_id: "skip", title: "Review room" },
        {
          kind: "scheduled_task",
          agent_id: "cron-bot",
          title: "Daily brief",
          scheduled_job_id: "job-1",
        },
        { kind: "chat", title: "Legacy untitled" },
        { kind: "chat", agent_id: "bill", title: "Bill dup" },
      ]),
    ).toEqual([BILL, FIZZ]);
  });
});

describe("mailboxPickerAgents", () => {
  it("1:1 lists other tenant agents so Fizz is reachable from Bill", () => {
    expect(
      mailboxPickerAgents({
        roomKind: "dm",
        currentAgentId: "bill",
        tenantAgents: [BILL, FIZZ],
        roomParticipants: [
          { kind: "human", user_id: "usr_jack", display_name: "Jack" },
          { kind: "persona", persona_id: "bill", display_name: "Bill" },
        ],
      }),
    ).toEqual([FIZZ]);
  });

  it("channel lists room personas then other tenant agents, never Jack", () => {
    expect(
      mailboxPickerAgents({
        roomKind: "channel",
        roomParticipants: GROUP_ROOM_FIXTURE_PARTICIPANTS,
        tenantAgents: [BILL, FIZZ, SKIP],
      }).map((agent) => agent.id),
    ).toEqual(["skip", "lev", "bana", "bill", "fizz"]);
  });
});

describe("mailboxPickerConnectors", () => {
  it("keeps enum order and drops connectors that are not entitled", () => {
    expect(
      mailboxPickerConnectors([
        connectorStatus("github"),
        connectorStatus("hubspot", { entitled: false, role_granted: true }),
        connectorStatus("google", { entitled: true, role_granted: false }),
        connectorStatus("whatsapp"),
      ]),
    ).toEqual([
      { id: "whatsapp", label: MAILBOX_CONNECTOR_LABELS.whatsapp },
      { id: "github", label: MAILBOX_CONNECTOR_LABELS.github },
    ]);
  });

  it("omits the connector section when none are entitled", () => {
    expect(
      mailboxPickerConnectors([
        connectorStatus("google", { entitled: false, role_granted: false }),
      ]),
    ).toEqual([]);
  });
});

describe("mailboxPickerSearchItems section order", () => {
  it("channel @ is room/tenant agents, then entitled connectors", () => {
    const items = mailboxPickerSearchItems({
      roomKind: "channel",
      roomParticipants: GROUP_ROOM_FIXTURE_PARTICIPANTS,
      tenantAgents: [FIZZ],
      connectors: ENTITLED_CONNECTORS,
    });

    expect(items.map((item) => item.label)).toEqual([
      "Skip",
      "Lev",
      "Bana",
      "Fizz",
      "Google Workspace",
      "HubSpot",
      "WhatsApp",
      "GitHub",
    ]);
    expect(items.map((item) => item.id)).not.toContain("usr_alice");
    expect(items.some((item) => item.label === "Alice")).toBe(false);
    expect(items.some((item) => item.id.startsWith("/"))).toBe(false);

    const groups = items.map(
      (item) => (item.auxiliaryData as MailboxPickerAux).group,
    );
    expect(groups).toEqual([
      MAILBOX_PICKER_GROUP_AGENTS,
      MAILBOX_PICKER_GROUP_AGENTS,
      MAILBOX_PICKER_GROUP_AGENTS,
      MAILBOX_PICKER_GROUP_AGENTS,
      MAILBOX_PICKER_GROUP_CONNECTORS,
      MAILBOX_PICKER_GROUP_CONNECTORS,
      MAILBOX_PICKER_GROUP_CONNECTORS,
      MAILBOX_PICKER_GROUP_CONNECTORS,
    ]);
  });

  it("1:1 @ is other agents then entitled connectors", () => {
    const items = mailboxPickerSearchItems({
      roomKind: "dm",
      currentAgentId: "bill",
      tenantAgents: [BILL, FIZZ],
      connectors: [
        connectorStatus("hubspot"),
        connectorStatus("google", { entitled: false }),
      ],
    });

    expect(items.map((item) => ({ id: item.id, label: item.label }))).toEqual([
      { id: "fizz", label: "Fizz" },
      { id: "hubspot", label: "HubSpot" },
    ]);
    expect(mailboxPickerItemKind(items[0]!)).toBe("persona");
    expect(mailboxPickerItemKind(items[1]!)).toBe("connector");
    expect((items[1]!.auxiliaryData as MailboxPickerAux).mention).toBeUndefined();
  });

  it("omits an empty connector section rather than faking the four enums", () => {
    const items = mailboxPickerSearchItems({
      roomKind: "dm",
      currentAgentId: "bill",
      tenantAgents: [BILL, FIZZ],
      connectors: [],
    });
    expect(items.map((item) => item.label)).toEqual(["Fizz"]);
    expect(
      items.some(
        (item) =>
          (item.auxiliaryData as MailboxPickerAux).group ===
          MAILBOX_PICKER_GROUP_CONNECTORS,
      ),
    ).toBe(false);
  });
});

describe("buildMailboxMentionTrigger", () => {
  it("inserts @DisplayName for agents and connector labels, never a persona wake", async () => {
    const trigger = buildMailboxMentionTrigger({
      roomKind: "dm",
      currentAgentId: "bill",
      tenantAgents: [BILL, FIZZ],
      connectors: [connectorStatus("hubspot"), connectorStatus("google")],
    });
    expect(trigger).not.toBeNull();
    expect(trigger!.character).toBe("@");

    const results = await Promise.resolve(trigger!.searchSource.search(""));
    expect(results.map((item) => item.label)).toEqual([
      "Fizz",
      "Google Workspace",
      "HubSpot",
    ]);
    expect(results.some((item) => item.id.includes("/") || item.label.includes(".md"))).toBe(
      false,
    );

    const fizz = results.find((item) => item.id === "fizz")!;
    expect(trigger!.onSelect(fizz)).toMatchObject({
      value: "@Fizz",
      label: "@Fizz",
      variant: "blue",
    });
    expect(mailboxPickerItemKind(fizz)).toBe("persona");

    const hubspot = results.find((item) => item.id === "hubspot")!;
    expect(trigger!.onSelect(hubspot)).toMatchObject({
      value: "@HubSpot",
      label: "@HubSpot",
      variant: "blue",
    });
    expect(mailboxPickerItemKind(hubspot)).toBe("connector");
    expect((hubspot.auxiliaryData as MailboxPickerAux).mention).not.toBe(true);

    const google = results.find((item) => item.id === "google")!;
    expect(trigger!.onSelect(google)).toMatchObject({
      value: "@Google Workspace",
      label: "@Google Workspace",
    });

    const byId = await Promise.resolve(trigger!.searchSource.search("hubspot"));
    expect(byId.map((item) => item.id)).toEqual(["hubspot"]);
  });

  it("returns null when there are no agents or entitled connectors", () => {
    expect(
      buildMailboxMentionTrigger({
        roomKind: "dm",
        tenantAgents: [],
        connectors: [connectorStatus("google", { entitled: false })],
      }),
    ).toBeNull();
  });
});

describe("mergeMailboxMentionTrigger", () => {
  it("keeps / # $ from buildComposerTriggers and does not feed vault into @", async () => {
    const rest = buildComposerTriggers({
      skills: [{ id: "sum", label: "summarize" }],
      contexts: [{ id: "/README.md", label: "README.md" }],
      workflows: [{ id: "daily-brief", label: "daily-brief" }],
    });
    const mention = buildMailboxMentionTrigger({
      roomKind: "dm",
      currentAgentId: "bill",
      tenantAgents: [BILL, FIZZ],
    });
    const merged = mergeMailboxMentionTrigger(rest, mention);
    expect(merged.map((trigger) => trigger.character)).toEqual([
      "/",
      "@",
      "#",
      "$",
    ]);
    const at = merged.find((trigger) => trigger.character === "@")!;
    const rows = await Promise.resolve(at.searchSource.search(""));
    expect(rows.map((item) => item.id)).toEqual(["fizz"]);
    expect(rows.map((item) => item.id)).not.toContain("/README.md");
  });
});
