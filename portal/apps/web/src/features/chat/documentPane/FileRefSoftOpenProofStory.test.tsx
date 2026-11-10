/**
 * Unit proof for lp-86d.11: file references soft-open document pane (mode A).
 * Browser paint: `?story=file-ref-soft-open` + ui-testing.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ASSISTANT_FREE_TEXT_PATH_MESSAGE,
  FILE_REF_OFFICE_PATH,
  FileRefSoftOpenProofStory,
  USER_PATH_REFERENCE_MESSAGE,
} from "./FileRefSoftOpenProofStory.js";

afterEach(() => {
  cleanup();
});

describe("FileRefSoftOpenProofStory", () => {
  it("renders seeded user/assistant path references with pane closed", () => {
    render(<FileRefSoftOpenProofStory />);

    const story = screen.getByTestId("file-ref-soft-open-proof-story");
    expect(story).toBeTruthy();
    expect(story.getAttribute("data-pane-open")).toBe("0");
    expect(story.getAttribute("data-bead")).toBe("lp-86d.11");
    expect(story.getAttribute("data-office-path")).toBe(FILE_REF_OFFICE_PATH);

    expect(screen.getByTestId("file-ref-proof-user-bubble")).toBeTruthy();
    expect(screen.getByTestId("file-ref-proof-assistant-bubble")).toBeTruthy();
    expect(screen.getByTestId("file-ref-proof-user-text").textContent).toContain(
      USER_PATH_REFERENCE_MESSAGE,
    );
    expect(
      screen.getByTestId("file-ref-proof-assistant-text").textContent,
    ).toContain(ASSISTANT_FREE_TEXT_PATH_MESSAGE);
    expect(screen.queryByTestId("chat-document-pane")).toBeNull();
    expect(screen.queryByTestId("document-reopen-chip-bar")).toBeNull();
  });

  it("user soft mode A path_reference opens document pane with body", async () => {
    render(<FileRefSoftOpenProofStory />);

    fireEvent.click(
      screen.getByRole("button", { name: "Simulate user soft mode A" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });

    const story = screen.getByTestId("file-ref-soft-open-proof-story");
    expect(story.getAttribute("data-pane-open")).toBe("1");
    expect(story.getAttribute("data-last-open-source")).toBe(
      "user_path_reference",
    );
    expect(story.getAttribute("data-last-open-path")).toBe(FILE_REF_OFFICE_PATH);
    expect(story.getAttribute("data-last-intent-kind")).toBe("path_reference");

    const body = screen.getByTestId("chat-document-pane-body");
    expect(body.textContent).toMatch(/MSA\.docx — file-ref soft-open preview/);
    expect(body.textContent).toMatch(/User path_reference soft-opens the pane/);
    expect(body.textContent).toMatch(/Soft open loads content/);
  });

  it("assistant free-text office path soft-opens pane with body", async () => {
    render(<FileRefSoftOpenProofStory />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Simulate assistant free-text path",
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });

    const story = screen.getByTestId("file-ref-soft-open-proof-story");
    expect(story.getAttribute("data-pane-open")).toBe("1");
    expect(story.getAttribute("data-last-open-source")).toBe(
      "assistant_free_text",
    );
    expect(story.getAttribute("data-last-open-path")).toBe(FILE_REF_OFFICE_PATH);

    const body = screen.getByTestId("chat-document-pane-body");
    expect(body.textContent).toMatch(
      /Assistant free-text office path soft-opens the pane/,
    );
  });

  it("path pill (reopen chip) reopens pane with body after close", async () => {
    render(<FileRefSoftOpenProofStory />);

    fireEvent.click(
      screen.getByRole("button", { name: "Simulate user soft mode A" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    expect(screen.getByTestId("document-reopen-chip-1")).toBeTruthy();

    // DocumentPaneHost chrome close (same label as production pane).
    fireEvent.click(screen.getByRole("button", { name: "Close document pane" }));
    await waitFor(() => {
      expect(screen.queryByTestId("chat-document-pane")).toBeNull();
    });
    // Pill remains after close.
    expect(screen.getByTestId("document-reopen-chip-1")).toBeTruthy();

    fireEvent.click(screen.getByTestId("document-reopen-chip-1"));
    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });

    const story = screen.getByTestId("file-ref-soft-open-proof-story");
    expect(story.getAttribute("data-last-open-source")).toBe("path_pill");
    expect(story.getAttribute("data-last-open-path")).toBe(FILE_REF_OFFICE_PATH);
    expect(story.getAttribute("data-open-count")).toBe("2");

    const body = screen.getByTestId("chat-document-pane-body");
    expect(body.textContent).toMatch(/Path pill \(reopen chip\) click reloads body/);
  });
});
