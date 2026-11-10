/**
 * Interaction proof for lp-khq.8 / lp-khq.12.1 chat workflow wizard → create.
 * Browser paint: `?story=workflow-chat-wizard`.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";

import { WorkflowChatWizardProofStory } from "./WorkflowChatWizardProofStory.js";

describe("WorkflowChatWizardProofStory", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
  });

  it("mounts chat + settings harness with intent MCQ (no IR jargon)", async () => {
    render(
      <Providers>
        <WorkflowChatWizardProofStory />
      </Providers>,
    );

    expect(screen.getByTestId("wf-wizard-proof-story")).toBeTruthy();
    expect(screen.getByTestId("wf-wizard-proof-chrome")).toBeTruthy();
    expect(screen.getByTestId("wf-wizard-step").textContent).toBe("intent");

    const chat = within(screen.getByTestId("wf-wizard-chat-pane"));
    expect(
      chat.getByRole("button", { name: /Yes, create a workflow/i }),
    ).toBeTruthy();
    expect(chat.getByRole("button", { name: /No, cancel/i })).toBeTruthy();

    const paneText =
      screen.getByTestId("wf-wizard-chat-pane").textContent ?? "";
    expect(paneText).not.toMatch(
      /IR JSON|JSON paste|host workflow tool|Call workflow\(/i,
    );

    await waitFor(
      () => {
        expect(screen.getByLabelText("Connectors sections")).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });

  it("NL multi-phase path creates workflow and refreshes inventory chrome", async () => {
    render(
      <Providers>
        <WorkflowChatWizardProofStory />
      </Providers>,
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("wf-wizard-workflow-names")).toBeTruthy();
      },
      { timeout: 3000 },
    );

    const chat = () => within(screen.getByTestId("wf-wizard-chat-pane"));

    expect(screen.getByTestId("wf-wizard-workflow-names").textContent).toMatch(
      /\(none\)/i,
    );

    // intent → yes
    await act(async () => {
      fireEvent.click(
        chat().getByRole("button", { name: /Yes, create a workflow/i }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("wf-wizard-step").textContent).toBe("describe");
      expect(chat().getByTestId("wf-wizard-free-text-input")).toBeTruthy();
    });

    // Multi-sentence research → write with title in prose
    await act(async () => {
      fireEvent.change(chat().getByTestId("wf-wizard-free-text-input"), {
        target: {
          value:
            "Title: Research Report\nResearch the topic thoroughly. Then write a concise report.",
        },
      });
      fireEvent.click(chat().getByTestId("wf-wizard-free-text-send"));
    });

    await waitFor(() => {
      expect(
        chat().getByRole("button", { name: /Create workflow/i }),
      ).toBeTruthy();
    });

    // Confirm content is plain language
    const confirmText =
      screen.getByTestId("wf-wizard-chat-pane").textContent ?? "";
    expect(confirmText).not.toMatch(
      /IR JSON|JSON paste|host workflow tool|Call workflow\(|kebab-case/i,
    );
    // Summary should mention research/write steps
    expect(confirmText).toMatch(/research|write|report/i);

    // confirm create
    await act(async () => {
      fireEvent.click(
        chat().getByRole("button", { name: /^Create workflow$/i }),
      );
    });

    await waitFor(
      () => {
        expect(screen.getByTestId("wf-wizard-step").textContent).toBe("done");
        expect(
          screen.getByTestId("wf-wizard-workflow-names").textContent,
        ).toMatch(/research-report/i);
      },
      { timeout: 5000 },
    );

    const win = window as Window & {
      __workflowWizardProof?: {
        created: boolean;
        lastCreateBody: { name?: string; stages?: unknown[] };
        lastAgentRequest: string | null;
      };
    };
    expect(win.__workflowWizardProof?.created).toBe(true);
    expect(win.__workflowWizardProof?.lastCreateBody?.name).toBe(
      "research-report",
    );
    expect(
      Array.isArray(win.__workflowWizardProof?.lastCreateBody?.stages),
    ).toBe(true);
    expect(
      (win.__workflowWizardProof?.lastCreateBody?.stages as unknown[])
        ?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(win.__workflowWizardProof?.lastAgentRequest).toMatch(
      /action=create/,
    );
    expect(win.__workflowWizardProof?.lastAgentRequest).not.toMatch(
      /spawn_agent/,
    );
    expect(win.__workflowWizardProof?.lastAgentRequest).not.toMatch(
      /IR JSON|Call workflow\(/i,
    );
  });
});
