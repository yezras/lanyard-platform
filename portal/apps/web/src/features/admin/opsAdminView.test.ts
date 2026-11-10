import { describe, expect, it } from "vitest";

import { formatIsoOrDash, tenantPickerLabel } from "./opsAdminView.js";

describe("opsAdminView helpers", () => {
  it("formats ISO timestamps as UTC and dashes for null", () => {
    expect(formatIsoOrDash("2026-08-02T03:04:05.000Z")).toBe(
      "2026-08-02 03:04:05Z",
    );
    expect(formatIsoOrDash(null)).toBe("—");
    expect(formatIsoOrDash("not-a-date")).toBe("not-a-date");
  });

  it("labels tenant picker options with display name and slug", () => {
    expect(
      tenantPickerLabel({ tenant_slug: "mocklab", display_name: "MockLab" }),
    ).toBe("MockLab (mocklab)");
  });
});
