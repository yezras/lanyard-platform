import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  listSettingsHostDirectory,
  loadSettingsCronJobDetail,
  normalizeSettingsRelativePath,
  readSettingsHostContent,
  resolveSkillContentPath,
  SettingsContentError,
} from "../src/settings-content.js";

async function makeTempHome(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "settings-content-"));
  await mkdir(path.join(root, "skills", "crm", "post-meeting-triage"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "skills", "crm", "post-meeting-triage", "SKILL.md"),
    `---
name: post-meeting-triage
description: demo
---
# Post-meeting triage

Do the thing.
`,
    "utf8",
  );
  await writeFile(
    path.join(root, "skills", "crm", "post-meeting-triage", "notes.md"),
    "# Notes\n",
    "utf8",
  );
  await mkdir(
    path.join(root, "skills", "crm", "post-meeting-triage", "assets"),
    { recursive: true },
  );
  await mkdir(path.join(root, ".lanyard", "workflows"), { recursive: true });
  await writeFile(
    path.join(root, ".lanyard", "workflows", "demo.yaml"),
    `meta:
  name: Demo workflow
  description: A demo
steps: []
`,
    "utf8",
  );
  await mkdir(path.join(root, "cron"), { recursive: true });
  await writeFile(
    path.join(root, "cron", "jobs.json"),
    JSON.stringify({
      jobs: [
        {
          id: "vault-index",
          name: "Vault index",
          schedule_display: "Daily at 3:00 AM",
          enabled: true,
          command: "vault-index --full",
          prompt: "Refresh the vault index",
          payload: { mode: "full", token: "should-redact-secret" },
          last_run_at: "2026-07-01T03:00:12.000Z",
          next_run_at: "2026-07-02T03:00:00.000Z",
        },
      ],
    }),
    "utf8",
  );
  return root;
}

describe("resolveSkillContentPath", () => {
  it("appends SKILL.md for directory paths", () => {
    expect(resolveSkillContentPath("skills/crm/post-meeting-triage")).toBe(
      "skills/crm/post-meeting-triage/SKILL.md",
    );
  });

  it("keeps explicit skill.md / file paths", () => {
    expect(resolveSkillContentPath("skills/x/SKILL.md")).toBe(
      "skills/x/SKILL.md",
    );
    expect(resolveSkillContentPath("skills/x/notes.md")).toBe(
      "skills/x/notes.md",
    );
  });
});

describe("normalizeSettingsRelativePath", () => {
  it("rejects absolute and parent paths", () => {
    expect(() => normalizeSettingsRelativePath("/etc/passwd")).toThrow(
      SettingsContentError,
    );
    expect(() => normalizeSettingsRelativePath("../secrets")).toThrow(
      SettingsContentError,
    );
  });

  it("normalizes relative segments", () => {
    expect(normalizeSettingsRelativePath("skills/./foo/bar")).toBe(
      "skills/foo/bar",
    );
  });
});

describe("readSettingsHostContent", () => {
  it("reads skill and workflow bodies under host home", async () => {
    const home = await makeTempHome();
    const skill = await readSettingsHostContent(
      "skills/crm/post-meeting-triage/SKILL.md",
      { hermesHome: home },
    );
    expect(skill.content).toContain("# Post-meeting triage");
    expect(skill.mime_type).toMatch(/markdown/);

    const workflow = await readSettingsHostContent(
      ".lanyard/workflows/demo.yaml",
      { hermesHome: home },
    );
    expect(workflow.content).toContain("Demo workflow");
  });

  it("returns no_host_home in fixture mode", async () => {
    await expect(
      readSettingsHostContent("skills/x/SKILL.md", { preferFixture: true }),
    ).rejects.toMatchObject({ code: "no_host_home", status: 404 });
  });

  it("returns not_found for missing files", async () => {
    const home = await makeTempHome();
    await expect(
      readSettingsHostContent("skills/missing/SKILL.md", { hermesHome: home }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });
});

describe("listSettingsHostDirectory (lp-75r.4)", () => {
  it("lists skill pack siblings (dirs first, then files)", async () => {
    const home = await makeTempHome();
    const listed = await listSettingsHostDirectory(
      "skills/crm/post-meeting-triage",
      { hermesHome: home },
    );
    expect(listed.path).toBe("skills/crm/post-meeting-triage");
    expect(listed.entries.map((e) => e.name)).toEqual([
      "assets",
      "notes.md",
      "SKILL.md",
    ]);
    expect(listed.entries.find((e) => e.name === "assets")?.kind).toBe(
      "directory",
    );
    expect(listed.entries.find((e) => e.name === "SKILL.md")?.path).toBe(
      "skills/crm/post-meeting-triage/SKILL.md",
    );
  });

  it("returns no_host_home in fixture mode", async () => {
    await expect(
      listSettingsHostDirectory("skills/x", { preferFixture: true }),
    ).rejects.toMatchObject({ code: "no_host_home", status: 404 });
  });

  it("returns not_a_directory for file paths", async () => {
    const home = await makeTempHome();
    await expect(
      listSettingsHostDirectory("skills/crm/post-meeting-triage/SKILL.md", {
        hermesHome: home,
      }),
    ).rejects.toMatchObject({ code: "not_a_directory", status: 400 });
  });
});

describe("loadSettingsCronJobDetail", () => {
  it("returns command/prompt and redacts secret-shaped payload keys", async () => {
    const home = await makeTempHome();
    const detail = await loadSettingsCronJobDetail("vault-index", {
      hermesHome: home,
    });
    expect(detail.command).toBe("vault-index --full");
    expect(detail.prompt).toBe("Refresh the vault index");
    expect(detail.schedule).toBe("Daily at 3:00 AM");
    expect(detail.payload).toEqual({ mode: "full" });
    expect(JSON.stringify(detail)).not.toMatch(/should-redact|secret/i);
  });

  it("returns not_found for unknown cron ids", async () => {
    const home = await makeTempHome();
    await expect(
      loadSettingsCronJobDetail("nope", { hermesHome: home }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });
});
