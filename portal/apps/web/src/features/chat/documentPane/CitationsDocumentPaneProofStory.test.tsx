/**
 * Unit proof for lp-75r.6 / lp-86d.12: every citation path opens the pane.
 * Browser paint: `?story=citations-document-pane` + ui-testing.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  CITATION_FIXTURES,
  CitationsDocumentPaneProofStory,
  EXTERNAL_HREF,
} from "./CitationsDocumentPaneProofStory.js";

afterEach(() => {
  cleanup();
});

describe("CitationsDocumentPaneProofStory", () => {
  it("renders seeded assistant message with two vault citation chips", () => {
    render(<CitationsDocumentPaneProofStory />);

    const story = screen.getByTestId("citations-document-pane-proof-story");
    expect(story).toBeTruthy();
    expect(story.getAttribute("data-pane-open")).toBe("0");
    expect(story.getAttribute("data-bead")).toBe("lp-75r.6");
    expect(story.getAttribute("data-related-bead")).toBe("lp-86d.12");

    expect(screen.getByTestId("citations-proof-assistant-bubble")).toBeTruthy();
    expect(screen.getByTestId("vault-citation-1")).toBeTruthy();
    expect(screen.getByTestId("vault-citation-2")).toBeTruthy();
    // Pane closed until a chip is activated.
    expect(screen.queryByTestId("chat-document-pane")).toBeNull();
  });

  it("vault citation 1 opens document pane with README fixture body", async () => {
    render(<CitationsDocumentPaneProofStory />);

    fireEvent.click(screen.getByTestId("vault-citation-1"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    const story = screen.getByTestId("citations-document-pane-proof-story");
    expect(story.getAttribute("data-pane-open")).toBe("1");
    expect(story.getAttribute("data-last-open-source")).toBe("citation");
    expect(story.getAttribute("data-last-open-path")).toBe(
      CITATION_FIXTURES.vaultReadme.path,
    );

    const body = screen.getByTestId("chat-document-pane-body");
    expect(body.textContent).toMatch(/Team A README \(vault citation\)/);
    expect(body.textContent).toMatch(/vault citation chip/);
  });

  it("vault citation 2 opens pane with notes body (every chip works)", async () => {
    render(<CitationsDocumentPaneProofStory />);

    fireEvent.click(screen.getByTestId("vault-citation-2"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    expect(
      screen
        .getByTestId("citations-document-pane-proof-story")
        .getAttribute("data-last-open-path"),
    ).toBe(CITATION_FIXTURES.vaultNotes.path);
    expect(screen.getByText("Project notes (vault citation)")).toBeTruthy();
  });

  it("artifact.open control opens pane with memo body", async () => {
    render(<CitationsDocumentPaneProofStory />);

    fireEvent.click(screen.getByRole("button", { name: "Simulate artifact.open" }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    const story = screen.getByTestId("citations-document-pane-proof-story");
    expect(story.getAttribute("data-last-open-source")).toBe("artifact_event");
    expect(story.getAttribute("data-last-open-path")).toBe(
      CITATION_FIXTURES.artifactMemo.path,
    );
    expect(screen.getByText("Memo (artifact.open)")).toBeTruthy();
  });

  it("tool_target control opens pane with legal memo body", async () => {
    render(<CitationsDocumentPaneProofStory />);

    fireEvent.click(screen.getByRole("button", { name: "Simulate tool_target" }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    const story = screen.getByTestId("citations-document-pane-proof-story");
    expect(story.getAttribute("data-last-open-source")).toBe("tool_target");
    expect(story.getAttribute("data-last-open-path")).toBe(
      CITATION_FIXTURES.toolTargetLegal.path,
    );
    expect(screen.getByText("Legal memo (tool_target)")).toBeTruthy();
  });

  it("external https control does not open the document pane", () => {
    render(<CitationsDocumentPaneProofStory />);

    fireEvent.click(
      screen.getByRole("button", { name: "External https (no pane)" }),
    );

    expect(screen.queryByTestId("chat-document-pane")).toBeNull();
    const story = screen.getByTestId("citations-document-pane-proof-story");
    expect(story.getAttribute("data-pane-open")).toBe("0");
    expect(story.getAttribute("data-last-open-source")).toBe("external_blocked");
    expect(story.getAttribute("data-external-click-count")).toBe("1");
    expect(story.getAttribute("data-open-count")).toBe("0");

    const log = screen.getByTestId("citations-proof-open-log");
    expect(log.getAttribute("data-external-href")).toBe(EXTERNAL_HREF);
  });

  it("clicking each vault chip then artifact and tool_target increments open count", async () => {
    render(<CitationsDocumentPaneProofStory />);

    fireEvent.click(screen.getByTestId("vault-citation-1"));
    fireEvent.click(screen.getByTestId("vault-citation-2"));
    fireEvent.click(screen.getByRole("button", { name: "Simulate artifact.open" }));
    fireEvent.click(screen.getByRole("button", { name: "Simulate tool_target" }));

    await waitFor(() => {
      expect(
        screen
          .getByTestId("citations-document-pane-proof-story")
          .getAttribute("data-open-count"),
      ).toBe("4");
    });
  });
});
