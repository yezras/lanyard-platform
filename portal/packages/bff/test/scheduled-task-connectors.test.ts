import { describe, expect, it } from "vitest";

import {
  TenantCronUserConnectorError,
  bindScheduledTaskConnectorNeed,
  detectUserPrincipalConnectors,
} from "../src/scheduled-task-connectors.js";

describe("BFF scheduled-task connector bind (lp-xhf4.13)", () => {
  it("detects google from a draft-only gws job", () => {
    expect(
      detectUserPrincipalConnectors({
        skills: ["gws-gmail-read"],
        prompt: "gws gmail users drafts create --subject 'GPU brief'",
      }),
    ).toEqual(["google"]);
  });

  it("stores owner_user_id when binding a Gmail job", () => {
    expect(
      bindScheduledTaskConnectorNeed({
        skills: ["gws-gmail-read"],
        prompt: "gws gmail users drafts create",
        user_id: "user-alice",
      }),
    ).toEqual({
      kind: "user_principal",
      owner_user_id: "user-alice",
      connector_ids: ["google"],
    });
  });

  it("refuses tenant cron without a user", () => {
    expect(() =>
      bindScheduledTaskConnectorNeed({
        skills: ["gws-gmail-read"],
        prompt: "gws gmail users drafts create",
      }),
    ).toThrow(TenantCronUserConnectorError);
  });
});
