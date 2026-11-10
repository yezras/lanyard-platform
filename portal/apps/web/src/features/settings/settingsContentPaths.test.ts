import { describe, expect, it } from "vitest";

import {
  hasSettingsFilePath,
  isVaultVisibleSettingsPath,
  resolveSkillContentPath,
  resolveSkillDirectoryPath,
} from "./settingsContentPaths.js";

describe("resolveSkillContentPath", () => {
  it("appends SKILL.md for directory paths", () => {
    expect(resolveSkillContentPath("skills/crm/post-meeting-triage")).toBe(
      "skills/crm/post-meeting-triage/SKILL.md",
    );
  });

  it("keeps explicit file paths", () => {
    expect(resolveSkillContentPath("skills/x/SKILL.md")).toBe(
      "skills/x/SKILL.md",
    );
    expect(resolveSkillContentPath("skills/x/notes.md")).toBe(
      "skills/x/notes.md",
    );
  });
});

describe("resolveSkillDirectoryPath (lp-75r.4)", () => {
  it("returns directory paths as-is", () => {
    expect(resolveSkillDirectoryPath("skills/crm/post-meeting-triage")).toBe(
      "skills/crm/post-meeting-triage",
    );
  });

  it("strips file basename for file paths", () => {
    expect(resolveSkillDirectoryPath("skills/x/SKILL.md")).toBe("skills/x");
    expect(resolveSkillDirectoryPath("skills/x/notes.md")).toBe("skills/x");
  });
});

describe("hasSettingsFilePath", () => {
  it("requires non-empty string", () => {
    expect(hasSettingsFilePath("skills/x")).toBe(true);
    expect(hasSettingsFilePath("")).toBe(false);
    expect(hasSettingsFilePath(undefined)).toBe(false);
    expect(hasSettingsFilePath(null)).toBe(false);
  });
});

describe("isVaultVisibleSettingsPath", () => {
  it("accepts vault-rooted paths", () => {
    expect(isVaultVisibleSettingsPath("/Projects/foo")).toBe(true);
    expect(isVaultVisibleSettingsPath("Projects/foo")).toBe(true);
  });

  it("rejects host-home skill packs", () => {
    expect(isVaultVisibleSettingsPath("skills/crm/post-meeting-triage")).toBe(
      false,
    );
  });
});
