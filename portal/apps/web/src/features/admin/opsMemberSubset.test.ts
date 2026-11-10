import { describe, expect, it } from "vitest";

import {
  groupedMemberTools,
  showsMemberSubset,
  toggleAllowedTool,
} from "./opsMemberSubset.js";

describe("opsMemberSubset domain (lp-hdzm.23)", () => {
  it("groups classified tools and toggles the allowlist", () => {
    const grouped = groupedMemberTools([
      { name: "GetCustomers", group: "read" },
      { name: "CreateCustomer", group: "write" },
    ]);
    expect(grouped.read.map((row) => row.name)).toEqual(["GetCustomers"]);
    expect(grouped.write.map((row) => row.name)).toEqual(["CreateCustomer"]);
    expect(toggleAllowedTool([], "GetCustomers", true)).toEqual(["GetCustomers"]);
    expect(toggleAllowedTool(["GetCustomers"], "GetCustomers", false)).toEqual([]);
  });

  it("hides first-class grant-only connectors and empty allowlists", () => {
    expect(showsMemberSubset("grant_only", 3)).toBe(false);
    expect(showsMemberSubset("allowlist", 0)).toBe(false);
    expect(showsMemberSubset("allowlist", 2)).toBe(true);
  });
});
