/**
 * Unit tests: scheduled task skill attachment from snapshot inventory
 * (lp-jzl.9.2). No live Daytona.
 */

import { describe, expect, it } from "vitest";

import {
  applySkillMcqChoice,
  buildSkillMcqChoices,
  listAttachableSkills,
  partitionSkillIdsAgainstInventory,
  resolveJobSkillIds,
  shouldPromptForSkills,
  skillAttachmentOptionsFromSnapshot,
  skillIdsForJobWrite,
  SKILL_MCQ_DONE,
  SKILL_MCQ_NONE,
  summarizeAttachedSkills,
} from "./scheduledTaskSkills.js";

const inventory = [
  {
    id: "post-meeting-triage",
    name: "Post-meeting triage",
    enabled: true,
    path: "skills/crm/post-meeting-triage",
  },
  {
    id: "draft-reply",
    name: "Draft reply",
    enabled: true,
    path: "skills/email/draft-reply",
  },
  {
    id: "disabled-skill",
    name: "Disabled",
    enabled: false,
    path: "skills/x/disabled",
  },
];

describe("listAttachableSkills / skillAttachmentOptionsFromSnapshot", () => {
  it("lists enabled skills from snapshot inventory with paths", () => {
    const opts = skillAttachmentOptionsFromSnapshot(inventory);
    expect(opts).toHaveLength(2);
    expect(opts.map((s) => s.id)).toEqual([
      "post-meeting-triage",
      "draft-reply",
    ]);
    expect(opts[0]?.path).toBe("skills/crm/post-meeting-triage");
    expect(shouldPromptForSkills(inventory)).toBe(true);
    expect(shouldPromptForSkills([])).toBe(false);
    expect(shouldPromptForSkills(undefined)).toBe(false);
  });

  it("can include disabled when asked", () => {
    const all = listAttachableSkills(inventory, { includeDisabled: true });
    expect(all.map((s) => s.id)).toContain("disabled-skill");
  });
});

describe("resolveJobSkillIds / skillIdsForJobWrite", () => {
  it("accepts skill ids from inventory for job store", () => {
    const result = resolveJobSkillIds(
      ["post-meeting-triage", "draft-reply"],
      inventory,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skillIds).toEqual(["post-meeting-triage", "draft-reply"]);
    expect(result.resolved[0]?.path).toBe("skills/crm/post-meeting-triage");

    expect(skillIdsForJobWrite(["post-meeting-triage"], inventory)).toEqual([
      "post-meeting-triage",
    ]);
    expect(skillIdsForJobWrite([], inventory)).toBeUndefined();
    expect(skillIdsForJobWrite(undefined, inventory)).toBeUndefined();
  });

  it("fails closed on unknown skill ids (not invent a separate registry)", () => {
    const result = resolveJobSkillIds(["not-in-inventory"], inventory);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unknown).toEqual(["not-in-inventory"]);
    expect(result.error).toMatch(/Unknown skill id/i);

    expect(() => skillIdsForJobWrite(["nope"], inventory)).toThrow(
      /Unknown skill id/i,
    );
  });

  it("de-dupes and preserves order", () => {
    const result = resolveJobSkillIds(
      ["draft-reply", "post-meeting-triage", "draft-reply"],
      inventory,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skillIds).toEqual(["draft-reply", "post-meeting-triage"]);
  });

  it("partition reports unknown without failing", () => {
    const { accepted, unknown } = partitionSkillIdsAgainstInventory(
      ["post-meeting-triage", "ghost"],
      inventory,
    );
    expect(accepted).toEqual(["post-meeting-triage"]);
    expect(unknown).toEqual(["ghost"]);
  });
});

describe("buildSkillMcqChoices / applySkillMcqChoice", () => {
  it("offers No skills + each attachable skill", () => {
    const choices = buildSkillMcqChoices(inventory, []);
    expect(choices[0]?.id).toBe(SKILL_MCQ_NONE);
    expect(choices.some((c) => c.id === "post-meeting-triage")).toBe(true);
    expect(choices.some((c) => c.id === "disabled-skill")).toBe(false);
  });

  it("multi-select chain: pick skill → Done", () => {
    let r = applySkillMcqChoice("post-meeting-triage", inventory, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skills).toEqual(["post-meeting-triage"]);
    expect(r.complete).toBe(false);

    const nextChoices = buildSkillMcqChoices(inventory, r.skills);
    expect(nextChoices[0]?.id).toBe(SKILL_MCQ_DONE);
    expect(nextChoices.some((c) => c.id === "post-meeting-triage")).toBe(
      false,
    );
    expect(nextChoices.some((c) => c.id === "draft-reply")).toBe(true);

    r = applySkillMcqChoice(SKILL_MCQ_DONE, inventory, r.skills);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.complete).toBe(true);
    expect(r.skills).toEqual(["post-meeting-triage"]);
  });

  it("none completes with empty skills", () => {
    const r = applySkillMcqChoice(SKILL_MCQ_NONE, inventory, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.complete).toBe(true);
    expect(r.skills).toEqual([]);
  });

  it("rejects unknown choice_id", () => {
    const r = applySkillMcqChoice("ghost-skill", inventory, []);
    expect(r.ok).toBe(false);
  });
});

describe("summarizeAttachedSkills", () => {
  it("uses inventory names for confirm card", () => {
    expect(summarizeAttachedSkills(["post-meeting-triage"], inventory)).toBe(
      "Post-meeting triage",
    );
    expect(summarizeAttachedSkills([], inventory)).toBe("None");
  });
});
