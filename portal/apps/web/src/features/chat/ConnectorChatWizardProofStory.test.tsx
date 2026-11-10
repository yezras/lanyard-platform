import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectorChatWizardProofStory } from "./ConnectorChatWizardProofStory.js";

describe("ConnectorChatWizardProofStory", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows Connect wizard in chat, not a dead 403, with Connectors beside it", async () => {
    const open = vi.fn().mockReturnValue({ closed: false });
    vi.stubGlobal("open", open);

    render(<ConnectorChatWizardProofStory />);

    expect(screen.getByTestId("cc-wizard-proof-story")).toBeTruthy();
    const chat = within(screen.getByTestId("cc-wizard-chat-pane"));
    expect(chat.getByText(/gws-gmail-send/i)).toBeTruthy();
    expect(
      chat.getByRole("button", { name: /Connect Google/i }),
    ).toBeTruthy();
    expect(chat.getByRole("button", { name: /Cancel/i })).toBeTruthy();
    expect(screen.getByTestId("connectors-page")).toBeTruthy();
    expect(screen.getByTestId("connector-row-google")).toBeTruthy();
    expect(screen.getByTestId("cc-wizard-step").textContent).toBe("needs_auth");
  });

  it("opens OAuth in a new tab and resumes only the stored draft args", async () => {
    const open = vi.fn().mockReturnValue({ closed: false });
    vi.stubGlobal("open", open);

    render(<ConnectorChatWizardProofStory />);
    const chat = () => within(screen.getByTestId("cc-wizard-chat-pane"));

    await act(async () => {
      fireEvent.click(chat().getByRole("button", { name: /Connect Google/i }));
    });

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("accounts.google.com"),
      "_blank",
    );
    expect(screen.getByTestId("cc-wizard-step").textContent).toBe("waiting_oauth");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Simulate OAuth success/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("cc-wizard-last-action").textContent).toBe(
        "resumed_stored_tool",
      );
    });
    const resume = screen.getByTestId("cc-wizard-resume").textContent ?? "";
    expect(resume).toContain("gws gmail users drafts create");
    expect(resume).toContain("ada@example.com");
    expect(resume).not.toContain("messages send");
    expect(resume).toMatch(/do not replay the previous turn/i);
  });

  it("cancel does not auto-send; page Connect stores no pending tool", async () => {
    const open = vi.fn().mockReturnValue({ closed: false });
    vi.stubGlobal("open", open);

    render(<ConnectorChatWizardProofStory />);
    const chat = () => within(screen.getByTestId("cc-wizard-chat-pane"));

    await act(async () => {
      fireEvent.click(chat().getByRole("button", { name: /Cancel/i }));
    });
    expect(screen.getByTestId("cc-wizard-last-action").textContent).toBe(
      "cancelled_no_send",
    );
    expect(screen.getByTestId("cc-wizard-resume").textContent).toMatch(
      /was not sent/i,
    );

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("connector-connect-google")).getByRole(
          "button",
        ),
      );
    });
    expect(screen.getByTestId("cc-wizard-page-connects").textContent).toBe(
      "page:1",
    );
    expect(screen.getByTestId("cc-wizard-last-action").textContent).toBe(
      "page_connect_no_pending",
    );
  });
});
