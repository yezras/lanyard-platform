import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import { NewScheduledTaskForm } from "./NewScheduledTaskForm.js";

describe("NewScheduledTaskForm", () => {
  afterEach(() => cleanup());

  it("submits encoded schedule without raw cron field", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    render(
      <Providers>
        <NewScheduledTaskForm onSubmit={onSubmit} onCancel={onCancel} />
      </Providers>,
    );

    const form = screen.getByTestId("new-scheduled-task-form");
    const title = form.querySelector(
      'input[name="scheduled-task-title"]',
    ) as HTMLInputElement;
    const instructions = form.querySelector(
      'textarea[name="scheduled-task-instructions"]',
    ) as HTMLTextAreaElement;
    expect(title).toBeTruthy();
    expect(instructions).toBeTruthy();

    fireEvent.change(title, { target: { value: "Weekly digest" } });
    fireEvent.change(instructions, {
      target: { value: "Summarize last week vault changes" },
    });

    // Defaults: weekdays + 09:00 + browser/UTC tz
    fireEvent.submit(form);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });

    const body = onSubmit.mock.calls[0]?.[0];
    expect(body.name).toBe("Weekly digest");
    expect(body.prompt).toBe("Summarize last week vault changes");
    expect(body.enabled).toBe(true);
    expect(body.schedule.expr).toMatch(/^\d+ \d+ \* \* /);
    expect(body.schedule.display).toMatch(/at/i);
    expect(body.schedule.kind).toBe("cron");
    expect(body.schedule.timezone).toBeTruthy();
  });

  it("shows validation error when title is empty", async () => {
    const onSubmit = vi.fn();
    render(
      <Providers>
        <NewScheduledTaskForm onSubmit={onSubmit} onCancel={() => {}} />
      </Providers>,
    );
    fireEvent.submit(screen.getByTestId("new-scheduled-task-form"));
    expect(await screen.findByTestId("new-scheduled-task-error")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
