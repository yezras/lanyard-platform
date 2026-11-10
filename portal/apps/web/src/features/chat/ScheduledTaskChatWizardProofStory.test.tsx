/**
 * Interaction proof for lp-jzl.9.1 chat MCQ wizard → create → inventory refresh.
 * Browser paint: `?story=scheduled-task-chat-wizard`.
 *
 * lp-lv9.6: Tools no longer hosts Scheduled tasks / crons-table. After create,
 * inventory is asserted via story chrome job-names (and structured create body).
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";

import { ScheduledTaskChatWizardProofStory } from "./ScheduledTaskChatWizardProofStory.js";

describe("ScheduledTaskChatWizardProofStory", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
  });

  it("mounts chat + tools inventory harness with intent MCQ", async () => {
    render(
      <Providers>
        <ScheduledTaskChatWizardProofStory />
      </Providers>,
    );

    expect(screen.getByTestId("st-wizard-proof-story")).toBeTruthy();
    expect(screen.getByTestId("st-wizard-proof-chrome")).toBeTruthy();
    expect(screen.getByTestId("st-wizard-step").textContent).toBe("intent");

    const chat = within(screen.getByTestId("st-wizard-chat-pane"));

    // MCQ choice labels from D4
    expect(
      chat.getByRole("button", { name: /Yes, create scheduled task/i }),
    ).toBeTruthy();
    expect(chat.getByRole("button", { name: /No, cancel/i })).toBeTruthy();

    // Tools inventory rail paints; no Tools crons section (lp-lv9.6).
    await waitFor(
      () => {
        expect(screen.getByLabelText("Connectors sections")).toBeTruthy();
      },
      { timeout: 3000 },
    );
    await waitFor(
      () => {
        const skillsSurface =
          screen.queryByTestId("skills-table") ||
          screen.queryByText(/No skills in this snapshot/i);
        expect(skillsSurface).toBeTruthy();
      },
      { timeout: 3000 },
    );
    expect(screen.queryByText("Scheduled tasks")).toBeNull();
    expect(screen.queryByTestId("crons-section-intro")).toBeNull();
    expect(screen.queryByTestId("crons-table")).toBeNull();
  });

  it("MCQ happy path creates scheduled task and refreshes inventory chrome", async () => {
    render(
      <Providers>
        <ScheduledTaskChatWizardProofStory />
      </Providers>,
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("st-wizard-job-names")).toBeTruthy();
        expect(screen.getByLabelText("Connectors sections")).toBeTruthy();
      },
      { timeout: 3000 },
    );

    const chat = () => within(screen.getByTestId("st-wizard-chat-pane"));

    expect(screen.getByTestId("st-wizard-job-names").textContent).toMatch(
      /\(none\)/i,
    );

    // intent → yes (scope to chat pane — Tools skills table shares skill names)
    await act(async () => {
      fireEvent.click(
        chat().getByRole("button", { name: /Yes, create scheduled task/i }),
      );
    });

    await waitFor(() => {
      expect(
        chat().getByRole("button", { name: /Weekly digest/i }),
      ).toBeTruthy();
    });

    // template
    await act(async () => {
      fireEvent.click(chat().getByRole("button", { name: /Weekly digest/i }));
    });

    await waitFor(() => {
      expect(
        chat().getByRole("button", { name: /Weekdays \(Mon–Fri\)/i }),
      ).toBeTruthy();
    });

    // days
    await act(async () => {
      fireEvent.click(
        chat().getByRole("button", { name: /Weekdays \(Mon–Fri\)/i }),
      );
    });

    await waitFor(() => {
      expect(chat().getByRole("button", { name: /9:00 AM/i })).toBeTruthy();
    });

    // time
    await act(async () => {
      fireEvent.click(chat().getByRole("button", { name: /9:00 AM/i }));
    });

    await waitFor(() => {
      expect(
        chat().getByRole("button", { name: /Use America\/New_York/i }),
      ).toBeTruthy();
    });

    // timezone
    await act(async () => {
      fireEvent.click(
        chat().getByRole("button", { name: /Use America\/New_York/i }),
      );
    });

    // skills (lp-jzl.9.2) — snapshot inventory same as Settings; click MCQ in chat only
    await waitFor(() => {
      expect(
        chat().getByRole("button", { name: /Post-meeting triage/i }),
      ).toBeTruthy();
      expect(chat().getByRole("button", { name: /No skills/i })).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(
        chat().getByRole("button", { name: /Post-meeting triage/i }),
      );
    });

    await waitFor(() => {
      expect(
        chat().getByRole("button", { name: /Done selecting skills/i }),
      ).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(
        chat().getByRole("button", { name: /Done selecting skills/i }),
      );
    });

    await waitFor(() => {
      expect(
        chat().getByRole("button", { name: "Create scheduled task" }),
      ).toBeTruthy();
    });

    // confirm create
    await act(async () => {
      fireEvent.click(
        chat().getByRole("button", { name: "Create scheduled task" }),
      );
    });

    await waitFor(
      () => {
        expect(screen.getByTestId("st-wizard-job-names").textContent).toContain(
          "Weekly digest",
        );
      },
      { timeout: 3000 },
    );

    // Human schedule in chrome (not Tools crons-table — removed lp-lv9.6).
    await waitFor(() => {
      const schedules = screen.getByTestId("st-wizard-job-schedules");
      expect(schedules.textContent).toMatch(/Weekdays/i);
      expect(schedules.textContent).not.toMatch(/0 9 \* \* 1-5/);
    });

    expect(screen.queryByTestId("crons-table")).toBeNull();
    expect(screen.queryByText("Scheduled tasks")).toBeNull();
    expect(screen.getByTestId("st-wizard-step").textContent).toBe("done");

    // Create body used structured schedule + skills from inventory (proof window)
    const proof = (
      window as Window & {
        __scheduledTaskWizardProof?: {
          lastCreateBody: { schedule?: unknown; skills?: string[] };
        };
      }
    ).__scheduledTaskWizardProof;
    expect(proof?.lastCreateBody).toBeTruthy();
    const schedule = proof!.lastCreateBody!.schedule as {
      kind?: string;
      expr?: string;
      display?: string;
      timezone?: string;
    };
    expect(schedule.kind).toBe("cron");
    expect(schedule.expr).toBe("0 9 * * 1-5");
    expect(schedule.timezone).toBe("America/New_York");
    expect(schedule.display).toMatch(/Weekdays/);
    expect(proof!.lastCreateBody!.skills).toEqual(["post-meeting-triage"]);
  });
});
