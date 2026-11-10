/**
 * Smoke + interaction proof for lp-uxy.4 NL create → inventory refresh story.
 * Browser paint: `?story=nl-cron-create-settings` (+ optional `mode=capability-off`).
 *
 * lp-lv9.6: Tools no longer hosts Scheduled tasks / crons-table. Inventory proof is
 * the story chrome job-names probe + snapshot refresh (Agents owns cron UI).
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";

import { NlCronCreateSettingsProofStory } from "./NlCronCreateSettingsProofStory.js";

describe("NlCronCreateSettingsProofStory", () => {
  beforeEach(() => {
    // Story installs window.fetch mock; ensure timers are real for debounce.
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
  });

  it("mounts harness and create-via-agent chrome without Tools crons section", async () => {
    render(
      <Providers>
        <NlCronCreateSettingsProofStory />
      </Providers>,
    );

    expect(screen.getByTestId("nl-cron-create-settings-proof-story")).toBeTruthy();
    expect(screen.getByTestId("nl-cron-create-proof-chrome")).toBeTruthy();
    expect(screen.getByTestId("nl-cron-create-tool-label").textContent).toMatch(
      /Scheduling a task/i,
    );
    expect(screen.getByTestId("nl-cron-create-simulate")).toBeTruthy();

    // Tools inventory rail paints; no Scheduled tasks / crons table (lp-lv9.6).
    await waitFor(
      () => {
        expect(screen.getByLabelText("Connectors sections")).toBeTruthy();
      },
      { timeout: 3000 },
    );
    // Skills content (table or empty copy) — never Tools crons.
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

  it("simulate agent create refreshes inventory so new job appears without reload", async () => {
    render(
      <Providers>
        <NlCronCreateSettingsProofStory />
      </Providers>,
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("nl-cron-create-job-names")).toBeTruthy();
        expect(screen.getByLabelText("Connectors sections")).toBeTruthy();
      },
      { timeout: 3000 },
    );

    expect(screen.getByTestId("nl-cron-create-job-names").textContent).toMatch(
      /\(none\)/i,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("nl-cron-create-simulate"));
    });

    // Inventory proof via story chrome (Tools has no crons-table after lp-lv9.6).
    await waitFor(
      () => {
        expect(screen.getByTestId("nl-cron-create-job-names").textContent).toContain(
          "Daily vault index",
        );
      },
      { timeout: 3000 },
    );

    expect(screen.queryByTestId("crons-table")).toBeNull();
    expect(screen.queryByText("Scheduled tasks")).toBeNull();
  });
});
