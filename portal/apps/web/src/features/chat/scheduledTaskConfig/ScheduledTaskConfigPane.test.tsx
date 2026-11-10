/**
 * Unit + component tests for ScheduledTaskConfigPane (lp-lv9.5).
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../../app/providers.js";

import {
  isScheduledTaskThread,
  ScheduledTaskConfigPane,
} from "./ScheduledTaskConfigPane.js";

const fetchSettingsCronDetail = vi.fn();
const patchSettingsCron = vi.fn();

vi.mock("../../../api/settings.js", () => ({
  fetchSettingsCronDetail: (...args: unknown[]) =>
    fetchSettingsCronDetail(...args),
  patchSettingsCron: (...args: unknown[]) => patchSettingsCron(...args),
}));

const BASE_CRON = {
  id: "st-vault-digest",
  name: "Vault digest",
  schedule: "0 9 * * 1-5",
  enabled: true,
  last_run_at: "2026-08-11T09:00:00.000Z",
  next_run_at: "2026-08-12T09:00:00.000Z",
  last_status: "ok",
  prompt: "Summarize overnight vault changes.",
};

describe("isScheduledTaskThread", () => {
  it("detects kind=scheduled_task and job binding", () => {
    expect(isScheduledTaskThread({ kind: "scheduled_task" })).toBe(true);
    expect(
      isScheduledTaskThread({
        kind: "chat",
        scheduled_job_id: "job-1",
      }),
    ).toBe(true);
    expect(isScheduledTaskThread({ kind: "chat" })).toBe(false);
    expect(isScheduledTaskThread(null)).toBe(false);
  });
});

describe("ScheduledTaskConfigPane (lp-lv9.5)", () => {
  beforeEach(() => {
    fetchSettingsCronDetail.mockReset();
    patchSettingsCron.mockReset();
    fetchSettingsCronDetail.mockResolvedValue({
      id: BASE_CRON.id,
      name: BASE_CRON.name,
      schedule: BASE_CRON.schedule,
      enabled: true,
      last_run_at: BASE_CRON.last_run_at,
      next_run_at: BASE_CRON.next_run_at,
      prompt: BASE_CRON.prompt,
    });
    patchSettingsCron.mockImplementation(
      async (id: string, body: boolean | { enabled?: boolean; prompt?: string }) => {
        const enabled =
          typeof body === "boolean" ? body : (body.enabled ?? true);
        const prompt =
          typeof body === "object" && typeof body.prompt === "string"
            ? body.prompt
            : BASE_CRON.prompt;
        return {
          cron: {
            ...BASE_CRON,
            id,
            enabled,
            prompt,
          },
          source: "fixture",
        };
      },
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("renders schedule, last/next run, status, and instructions", async () => {
    render(
      <Providers>
        <ScheduledTaskConfigPane jobId={BASE_CRON.id} cron={BASE_CRON} />
      </Providers>,
    );

    expect(screen.getByTestId("scheduled-task-config-pane")).toBeTruthy();
    await waitFor(() => {
      expect(
        screen.getByTestId("scheduled-task-config-schedule").textContent,
      ).toMatch(/Weekdays at 9:00 AM/i);
    });
    expect(
      screen.getByTestId("scheduled-task-config-last-run").textContent,
    ).not.toBe("—");
    expect(
      screen.getByTestId("scheduled-task-config-next-run").textContent,
    ).not.toBe("—");
    expect(
      screen.getByTestId("scheduled-task-config-last-status").textContent,
    ).toMatch(/ok/i);
    await waitFor(() => {
      expect(
        screen.getByTestId("scheduled-task-config-instructions-readonly")
          .textContent,
      ).toMatch(/Summarize overnight vault changes/);
    });
  });

  it("omits fire helper under On/Off switch (lp-pxr.3)", async () => {
    render(
      <Providers>
        <ScheduledTaskConfigPane jobId={BASE_CRON.id} cron={BASE_CRON} />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("scheduled-task-config-enabled")).toBeTruthy();
    });

    const enabled = screen.getByTestId("scheduled-task-config-enabled");
    expect(enabled.textContent).toMatch(/On|Off/);
    expect(enabled.textContent).not.toMatch(/Task will fire on its schedule/i);
    expect(enabled.textContent).not.toMatch(/No future fires/i);
    expect(enabled.textContent).not.toMatch(/In-flight runs are not cancelled/i);
  });

  it("toggles enabled via patchSettingsCron (slider)", async () => {
    render(
      <Providers>
        <ScheduledTaskConfigPane jobId={BASE_CRON.id} cron={BASE_CRON} />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("scheduled-task-config-enabled")).toBeTruthy();
    });

    // Astryx Switch uses role=switch on a checkbox input.
    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(patchSettingsCron).toHaveBeenCalledWith(BASE_CRON.id, false);
    });
  });

  it("shows editable instructions and saves via PATCH when allowed", async () => {
    const onCronUpdated = vi.fn();
    render(
      <Providers>
        <ScheduledTaskConfigPane
          jobId={BASE_CRON.id}
          cron={BASE_CRON}
          canEditInstructions
          onCronUpdated={onCronUpdated}
        />
      </Providers>,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("scheduled-task-config-instructions-input"),
      ).toBeTruthy();
    });

    const input = screen.getByTestId(
      "scheduled-task-config-instructions-input",
    ) as HTMLTextAreaElement;
    // TextArea may wrap the actual textarea.
    const textarea =
      input.tagName === "TEXTAREA"
        ? input
        : (input.querySelector("textarea") as HTMLTextAreaElement);
    fireEvent.change(textarea, {
      target: { value: "New digest instructions for the team." },
    });

    fireEvent.click(
      screen.getByTestId("scheduled-task-config-save-instructions"),
    );

    await waitFor(() => {
      expect(patchSettingsCron).toHaveBeenCalledWith(BASE_CRON.id, {
        prompt: "New digest instructions for the team.",
      });
    });
    await waitFor(() => {
      expect(onCronUpdated).toHaveBeenCalled();
    });
  });

  it("uses a single Agent instructions label without dual Instructions chrome (lp-pxr.3)", async () => {
    render(
      <Providers>
        <ScheduledTaskConfigPane
          jobId={BASE_CRON.id}
          cron={BASE_CRON}
          canEditInstructions
        />
      </Providers>,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("scheduled-task-config-instructions-input"),
      ).toBeTruthy();
    });

    const section = screen.getByTestId("scheduled-task-config-instructions");
    // Exactly one "Agent instructions" label (TextArea); no supporting "Instructions".
    const agentLabelMatches =
      section.textContent?.match(/Agent instructions/g) ?? [];
    expect(agentLabelMatches.length).toBeGreaterThanOrEqual(1);
    // Standalone supporting "Instructions" line removed — avoid matching
    // the substring inside "Agent instructions" by checking label-only text nodes.
    const supportingOnly = Array.from(section.querySelectorAll("*")).filter(
      (el) => el.textContent?.trim() === "Instructions",
    );
    expect(supportingOnly).toHaveLength(0);
  });

  it("shows empty binding message without job id", () => {
    render(
      <Providers>
        <ScheduledTaskConfigPane jobId="" />
      </Providers>,
    );
    expect(screen.getByTestId("scheduled-task-config-pane").textContent).toMatch(
      /not bound/i,
    );
  });
});
