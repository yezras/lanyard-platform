import { describe, expect, it } from "vitest";

import {
  bindHostTool,
  buildConnectorsPageModel,
  connectionStatusLabel,
  type SpaConnectorStatus,
} from "./connectorsCatalog.js";

function entitled(
  connectorId: SpaConnectorStatus["connector_id"],
  status: SpaConnectorStatus["status"] = "not_connected",
): SpaConnectorStatus {
  return {
    connector_id: connectorId,
    status,
    account_label: null,
    sticky: {},
    entitled: true,
    role_granted: true,
    hubspot_portal_id: null,
  };
}

describe("bindHostTool", () => {
  it("binds gws-gmail-* and gws path skills to google", () => {
    expect(
      bindHostTool({
        kind: "skill",
        id: "gws-gmail-send",
        name: "gws-gmail-send",
        path: "skills/gws/gmail/gws-gmail-send",
      }),
    ).toBe("google");
    expect(
      bindHostTool({
        kind: "skill",
        id: "gws-calendar-agenda",
        name: "gws-calendar-agenda",
      }),
    ).toBe("google");
    expect(
      bindHostTool({
        kind: "cli",
        id: "gmail",
        name: "Gmail",
        bin: "gws",
      }),
    ).toBe("google");
  });

  it("binds wacli and hubspot names, leaves unbound host skills null", () => {
    expect(
      bindHostTool({ kind: "skill", id: "wacli", name: "wacli" }),
    ).toBe("whatsapp");
    expect(
      bindHostTool({
        kind: "skill",
        id: "hubspot-contacts",
        name: "hubspot-contacts",
      }),
    ).toBe("hubspot");
    expect(
      bindHostTool({ kind: "cli", id: "gh", name: "gh", bin: "gh" }),
    ).toBe("github");
    expect(
      bindHostTool({
        kind: "cli",
        id: "github-cli",
        name: "github-cli",
        bin: "gh",
      }),
    ).toBe("github");
    expect(
      bindHostTool({
        kind: "skill",
        id: "post-meeting-triage",
        name: "Post-meeting triage",
        path: "skills/crm/post-meeting-triage",
      }),
    ).toBeNull();
    expect(
      bindHostTool({
        kind: "mcp",
        id: "web-search",
        name: "web-search",
      }),
    ).toBeNull();
  });
});

describe("buildConnectorsPageModel", () => {
  it("shows entitled SaaS rows even when not_connected and nests gws-gmail-* under Google", () => {
    const model = buildConnectorsPageModel({
      connectors: [
        entitled("google"),
        entitled("hubspot"),
        entitled("whatsapp"),
        entitled("github"),
      ],
      skills: [
        {
          id: "gws-gmail-send",
          name: "gws-gmail-send",
          path: "skills/gws/gmail/gws-gmail-send",
          enabled: true,
        },
        {
          id: "post-meeting-triage",
          name: "Post-meeting triage",
          path: "skills/crm/post-meeting-triage",
          enabled: true,
        },
      ],
      mcp_servers: [{ name: "web-search", transport: "stdio", enabled: true }],
      integrations: [
        { id: "gmail", name: "Gmail", type: "mcp", bin: "gws" },
        { id: "slack", name: "Slack", type: "connector" },
      ],
    });

    expect(model.saas.map((row) => row.connector_id)).toEqual([
      "google",
      "hubspot",
      "whatsapp",
      "github",
    ]);
    expect(model.saas.every((row) => row.status === "not_connected")).toBe(true);
    expect(model.saas.every((row) => row.kind === "saas")).toBe(true);

    const google = model.saas.find((row) => row.connector_id === "google")!;
    expect(google.sticky).toEqual({});
    expect(google.runtimes).toEqual(["cli", "skill"]);
    expect(google.bound_tools.map((tool) => tool.id)).toEqual([
      "gws-gmail-send",
      "gmail",
    ]);
    expect(
      model.saas.flatMap((row) => row.bound_tools).map((tool) => tool.id),
    ).not.toContain("post-meeting-triage");

    const github = model.saas.find((row) => row.connector_id === "github")!;
    expect(github.label).toBe("GitHub");
    expect(github.runtimes).toEqual(["cli", "skill"]);

    expect(model.on_this_brain.map((row) => row.id)).toEqual([
      "post-meeting-triage",
      "web-search",
      "slack",
    ]);
    expect(model.on_this_brain.every((row) => row.kind === "on_this_brain")).toBe(
      true,
    );
  });

  it("hides SaaS rows the tenant or role is not entitled to use", () => {
    const model = buildConnectorsPageModel({
      connectors: [
        { ...entitled("google"), entitled: false },
        { ...entitled("hubspot"), role_granted: false },
        entitled("whatsapp", "connected"),
      ],
      skills: [],
    });
    expect(model.saas.map((row) => row.connector_id)).toEqual(["whatsapp"]);
    expect(model.saas[0]?.status).toBe("connected");
  });

  it("shows a granted registry connector and hides ungranted registry ids", () => {
    const model = buildConnectorsPageModel({
      connectors: [
        { ...entitled("slack"), label: "Slack" },
        { ...entitled("stripe"), label: "Stripe", role_granted: false },
        entitled("google"),
      ],
    });
    expect(model.saas.map((row) => row.connector_id)).toEqual([
      "slack",
      "google",
    ]);
    expect(model.saas[0]).toMatchObject({
      connector_id: "slack",
      label: "Slack",
      runtimes: [],
      bound_tools: [],
    });
  });

  it("surfaces sticky flags for Connectors clear-without-Disconnect", () => {
    const model = buildConnectorsPageModel({
      connectors: [
        { ...entitled("google", "connected"), sticky: { "gmail.draft": true } },
      ],
    });
    expect(model.saas[0]?.sticky).toEqual({ "gmail.draft": true });
  });

  it("does not put models on the catalog", () => {
    const model = buildConnectorsPageModel({
      connectors: [entitled("google")],
      skills: [],
    });
    expect(model).not.toHaveProperty("models");
    expect(JSON.stringify(model)).not.toMatch(/grok|openai|model/i);
  });
});

describe("connectionStatusLabel", () => {
  it("labels the closed status set", () => {
    expect(connectionStatusLabel("not_connected")).toBe("Not connected");
    expect(connectionStatusLabel("connected")).toBe("Connected");
    expect(connectionStatusLabel("needs_reauth")).toBe("Needs reauth");
    expect(connectionStatusLabel("pairing")).toBe("Pairing");
  });
});
