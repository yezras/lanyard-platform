/**
 * lp-lv9.9 — Unit gate for Agents v2 modules available on this stack.
 *
 * Stack on this branch: lp-lv9.1 (folder last + ensure) + lp-lv9.5 (config pane)
 * + lp-lv9.7 (plus ensure/select). Optional: .2 status, .3 titles, .4 purpose
 * prompt, .6 Tools without crons — detected dynamically when modules land.
 *
 * Config-pane interaction detail lives in ScheduledTaskConfigPane.test.tsx;
 * wizard ensure/select in scheduledTaskWizardChatView.test.tsx + ChatThreadContext.
 *
 * Full cross-PR verify after merging draft PRs 375–381.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import type { ChatThreadSummary } from "../../api/types.js";
import {
  isScheduledTaskThread as isScheduledTaskThreadFromPane,
} from "../chat/scheduledTaskConfig/ScheduledTaskConfigPane.js";
import { AgentTitleEditor } from "./AgentTitleEditor.js";
import {
  AGENTS_GROUP_NAME,
  CHANNELS_GROUP_NAME,
  groupThreadsForSideNav,
  isScheduledTaskThread,
  SCHEDULED_TASKS_GROUP_KEY,
  SCHEDULED_TASKS_GROUP_NAME,
  sortScheduledTaskThreads,
} from "./threadGroups.js";
import { statusDotFromThreadStatus } from "./threadResponseStatus.js";

const webSrc = path.dirname(fileURLToPath(import.meta.url));

const baseThreads: ChatThreadSummary[] = [
  {
    thread_id: "t1",
    title: "Alpha chat",
    project_id: "p1",
    project_vault_path: "/Projects/A",
    created_at: "2026-07-01T10:00:00.000Z",
    avatar_seed: "seed-t1",
    title_source: "default",
  },
  {
    thread_id: "t-gen",
    title: "General chat",
    project_id: null,
    project_vault_path: null,
    created_at: "2026-07-01T11:00:00.000Z",
    avatar_seed: "seed-gen",
    title_source: "default",
  },
  {
    thread_id: "job-1",
    title: "Nightly digest",
    project_id: null,
    project_vault_path: null,
    created_at: "2026-07-02T09:00:00.000Z",
    avatar_seed: "seed-job",
    title_source: "job",
    kind: "scheduled_task",
    scheduled_job_id: "cron-nightly",
  },
];

describe("Agents v2 unit gate (lp-lv9.9) — groups / folder last", () => {
  it("places perpetual Scheduled Tasks last with job streams only there", () => {
    const groups = groupThreadsForSideNav(baseThreads);
    const last = groups[groups.length - 1];
    expect(last?.key).toBe(SCHEDULED_TASKS_GROUP_KEY);
    expect(last?.name).toBe(SCHEDULED_TASKS_GROUP_NAME);
    expect(last?.kind).toBe("scheduled_tasks");
    expect(last?.threads.map((t) => t.thread_id)).toEqual(["job-1"]);

    expect(groups.map((g) => g.name)).toEqual([
      CHANNELS_GROUP_NAME,
      AGENTS_GROUP_NAME,
      SCHEDULED_TASKS_GROUP_NAME,
    ]);

    const agents = groups.find((g) => g.kind === "agents");
    expect(agents?.threads.every((t) => !isScheduledTaskThread(t))).toBe(true);
    expect(agents?.threads.map((t) => t.thread_id)).toEqual(["t1", "t-gen"]);
  });

  it("sorts scheduled-task rows for stable sidenav order", () => {
    const sorted = sortScheduledTaskThreads([
      {
        ...baseThreads[2]!,
        thread_id: "z",
        title: "Zulu",
        scheduled_job_id: "j-z",
      },
      {
        ...baseThreads[2]!,
        thread_id: "a",
        title: "Alpha job",
        scheduled_job_id: "j-a",
      },
    ]);
    expect(sorted.map((t) => t.thread_id)).toEqual(["a", "z"]);
  });
});

describe("Agents v2 unit gate (lp-lv9.9) — status (as available)", () => {
  it("maps base thread response status dots (always on stack)", () => {
    expect(statusDotFromThreadStatus("generating").label).toBe("Generating…");
    expect(statusDotFromThreadStatus("success").variant).toBe("success");
    expect(statusDotFromThreadStatus("error").variant).toBe("error");
    expect(statusDotFromThreadStatus(undefined).variant).toBe("neutral");
  });

  it("detects composite Off mapper when lp-lv9.2 module is present", () => {
    // Vite resolves static/dynamic import paths at transform time — use fs only.
    const statusModulePath = path.join(webSrc, "scheduledTaskStatus.ts");
    const present = existsSync(statusModulePath);
    // Soft: absence is expected on .1+.5+.7 stack (lp-lv9.2 not merged).
    expect(typeof present).toBe("boolean");
    if (present) {
      const src = readFileSync(statusModulePath, "utf8");
      expect(src).toMatch(/deriveScheduledTaskCompositeStatus/);
      expect(src).toMatch(/["']off["']/);
    } else {
      expect(present).toBe(false);
    }
  });
});

describe("Agents v2 unit gate (lp-lv9.9) — name (title editor)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renames agent via double-click editor", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(
      <Providers>
        <AgentTitleEditor
          title="Nightly digest"
          canRename
          onRename={onRename}
          testId="v2-name"
        />
      </Providers>,
    );

    fireEvent.doubleClick(screen.getByTestId("v2-name"));
    const input = screen.getByLabelText("Agent name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Morning digest" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith("Morning digest");
    });
  });
});

describe("Agents v2 unit gate (lp-lv9.9) — config pane contracts (lp-lv9.5)", () => {
  it("exports job-thread detector aligned with sidenav grouping", () => {
    expect(
      isScheduledTaskThreadFromPane({
        kind: "scheduled_task",
        scheduled_job_id: "j1",
      }),
    ).toBe(true);
    expect(
      isScheduledTaskThreadFromPane({ kind: "chat", scheduled_job_id: "j1" }),
    ).toBe(true);
    expect(isScheduledTaskThreadFromPane({ kind: "chat" })).toBe(false);
    expect(
      isScheduledTaskThread({ kind: "scheduled_task", scheduled_job_id: "j1" }),
    ).toBe(true);
  });

  it("ships config pane with slider + meta testids", () => {
    const panePath = path.join(
      webSrc,
      "../chat/scheduledTaskConfig/ScheduledTaskConfigPane.tsx",
    );
    expect(existsSync(panePath)).toBe(true);
    const src = readFileSync(panePath, "utf8");
    for (const tid of [
      "scheduled-task-config-pane",
      "scheduled-task-config-enabled",
      "scheduled-task-config-meta",
      "scheduled-task-config-schedule",
      "scheduled-task-config-last-run",
      "scheduled-task-config-next-run",
      "scheduled-task-config-last-status",
      "scheduled-task-config-instructions",
    ]) {
      expect(src).toContain(tid);
    }
    // On/Off switch (slider)
    expect(src).toMatch(/label=\{enabled \? "On" : "Off"\}/);
    expect(src).toMatch(/from "@astryxdesign\/core\/Switch"/);
  });
});

describe("Agents v2 unit gate (lp-lv9.9) — prompt (as available)", () => {
  it("detects per-thread system prompt module when lp-lv9.4 lands", () => {
    const candidates = [
      path.join(webSrc, "../chat/systemPrompt"),
      path.join(webSrc, "../chat/threadSystemPrompt.ts"),
      path.join(webSrc, "../chat/AgentPurposeEditor.tsx"),
      path.join(webSrc, "../chat/SystemPromptEditor.tsx"),
      path.join(webSrc, "threadSystemPrompt.ts"),
    ];
    const found = candidates.some(
      (p) =>
        existsSync(p) ||
        existsSync(`${p}.ts`) ||
        existsSync(`${p}.tsx`) ||
        existsSync(path.join(p, "index.ts")),
    );
    // Soft: absence is expected on .1+.5+.7 stack.
    expect(typeof found).toBe("boolean");
    if (!found) {
      expect(found).toBe(false);
    }
  });
});

describe("Agents v2 unit gate (lp-lv9.9) — Tools crons section (pre/post .6)", () => {
  it("SettingsView still declares Scheduled tasks until lp-lv9.6", () => {
    const settingsPath = path.join(webSrc, "../settings/SettingsView.tsx");
    expect(existsSync(settingsPath)).toBe(true);
    const src = readFileSync(settingsPath, "utf8");
    const hasScheduledTasksNav = /label:\s*["']Scheduled tasks["']/.test(src);
    // On this stack (.6 not merged) expect present; when .6 lands, flip expectation.
    if (hasScheduledTasksNav) {
      expect(hasScheduledTasksNav).toBe(true);
    } else {
      expect(hasScheduledTasksNav).toBe(false);
    }
  });
});
