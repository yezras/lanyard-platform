import { describe, expect, it } from "vitest";

import {
  buildConnectorsTeamModel,
  parseConnectorsTeam,
  teamJsonLeaksSecrets,
} from "./connectorsTeam.js";

describe("parseConnectorsTeam", () => {
  it("allowlists status/account_label/grants and drops ciphertext keys", () => {
    const parsed = parseConnectorsTeam({
      hubspot_portal_id: "123456",
      oauth_refresh: "leaked",
      members: [
        {
          user_id: "u1",
          email: "alice@demo.test",
          oauth_access: "atok",
          connectors: [
            {
              connector_id: "google",
              status: "connected",
              account_label: "alice@gmail.com",
              secrets_ciphertext: "kms-blob",
            },
            {
              connector_id: "outlook",
              status: "connected",
              account_label: "nope",
            },
            {
              connector_id: "hubspot",
              status: "bogus",
            },
          ],
        },
      ],
      grants: [
        {
          role_id: "role-member",
          role_name: "member",
          connector_id: "google",
          enabled: true,
        },
        {
          role_id: "role-member",
          connector_id: "slack",
          enabled: true,
        },
      ],
    });

    expect(parsed).toEqual({
      hubspot_portal_id: "123456",
      members: [
        {
          user_id: "u1",
          email: "alice@demo.test",
          connectors: [
            {
              connector_id: "google",
              status: "connected",
              account_label: "alice@gmail.com",
            },
            {
              connector_id: "hubspot",
              status: "not_connected",
              account_label: null,
            },
            {
              connector_id: "whatsapp",
              status: "not_connected",
              account_label: null,
            },
            {
              connector_id: "github",
              status: "not_connected",
              account_label: null,
            },
          ],
        },
      ],
      grants: [
        {
          role_id: "role-member",
          role_name: "member",
          connector_id: "google",
          enabled: true,
        },
      ],
    });
    expect(JSON.stringify(parsed)).not.toContain("kms-blob");
    expect(JSON.stringify(parsed)).not.toContain("atok");
    expect(JSON.stringify(parsed)).not.toContain("leaked");
  });
});

describe("buildConnectorsTeamModel", () => {
  it("projects a closed role × connector matrix and status cells", () => {
    const model = buildConnectorsTeamModel({
      hubspot_portal_id: "999",
      grants: [
        {
          role_id: "role-member",
          role_name: "member",
          connector_id: "google",
          enabled: true,
        },
        {
          role_id: "role-member",
          role_name: "member",
          connector_id: "hubspot",
          enabled: false,
        },
        {
          role_id: "role-member",
          role_name: "member",
          connector_id: "whatsapp",
          enabled: false,
        },
        {
          role_id: "role-member",
          role_name: "member",
          connector_id: "github",
          enabled: false,
        },
      ],
      members: [
        {
          user_id: "u1",
          email: "alice@demo.test",
          connectors: [
            {
              connector_id: "google",
              status: "connected",
              account_label: "alice@gmail.com",
            },
            {
              connector_id: "hubspot",
              status: "needs_reauth",
              account_label: null,
            },
            {
              connector_id: "whatsapp",
              status: "pairing",
              account_label: "+1555",
            },
            {
              connector_id: "github",
              status: "not_connected",
              account_label: null,
            },
          ],
        },
      ],
    });

    expect(model.roles).toEqual([
      {
        role_id: "role-member",
        role_name: "member",
        grants: { google: true, hubspot: false, whatsapp: false, github: false },
      },
    ]);
    expect(model.members[0]?.cells.map((cell) => cell.status)).toEqual([
      "connected",
      "needs_reauth",
      "pairing",
      "not_connected",
    ]);
    expect(model.hubspot_portal_id).toBe("999");
  });
});

describe("teamJsonLeaksSecrets", () => {
  it("flags ciphertext keys so the pane can refuse to render them", () => {
    expect(teamJsonLeaksSecrets({ members: [], grants: [] })).toBe(false);
    expect(
      teamJsonLeaksSecrets({ secrets_ciphertext: "kms-blob" }),
    ).toBe(true);
  });
});
