/**
 * Component proof for lp-khq.5 (+ attach menu).
 * Browser paint / screenshot: `?story=composer-attach-menu` + ui-testing.
 *
 * Asserts controlled composer **value** (not only last_action) so insert
 * sync regressions are caught before ship.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ComposerAttachMenuProofStory } from "./ComposerAttachMenuProofStory.js";

afterEach(() => {
  cleanup();
});

describe("ComposerAttachMenuProofStory", () => {
  it("renders composer with + attach trigger", () => {
    render(<ComposerAttachMenuProofStory />);
    expect(screen.getByTestId("composer-attach-menu-proof-story")).toBeTruthy();
    expect(screen.getByTestId("composer-attach-menu")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Attach to message" }),
    ).toBeTruthy();
  });

  it("lp-khq.12.3: Attach file root item records last_action", async () => {
    render(<ComposerAttachMenuProofStory />);

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Attach file/i }),
    );

    await waitFor(() => {
      expect(
        screen
          .getByTestId("composer-attach-menu-last-action")
          .getAttribute("data-action"),
      ).toBe("attach:file");
    });
  });

  it("skill pick inserts /name into controlled composer value", async () => {
    render(<ComposerAttachMenuProofStory />);

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Skills/i }));

    await waitFor(() => {
      expect(
        screen.getByTestId("composer-attach-menu").getAttribute("data-panel"),
      ).toBe("skills");
    });

    fireEvent.click(
      await screen.findByRole("menuitem", { name: /summarize/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("composer-attach-menu-last-action").getAttribute(
          "data-action",
        ),
      ).toBe("skill:summarize");
      const valueEl = screen.getByTestId("composer-attach-menu-value");
      expect(valueEl.getAttribute("data-value")).toBe("/summarize");
      expect(valueEl.textContent).toContain("/summarize");
    });
  });

  it("vault folder browse inserts path into controlled composer value", async () => {
    render(<ComposerAttachMenuProofStory />);

    const menu = screen.getByTestId("composer-attach-menu");
    expect(menu.getAttribute("data-vault-mode")).toBe("tree");

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Select from vault/i }),
    );

    await waitFor(() => {
      expect(menu.getAttribute("data-panel")).toBe("vault");
    });

    fireEvent.click(await screen.findByRole("menuitem", { name: /Business\//i }));
    await waitFor(() => {
      expect(menu.getAttribute("data-vault-browse-path")).toBe("/Business");
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Contracts\//i }),
    );
    await waitFor(() => {
      expect(menu.getAttribute("data-vault-browse-path")).toBe(
        "/Business/Contracts",
      );
    });

    fireEvent.click(await screen.findByRole("menuitem", { name: /MSA\.docx/i }));

    await waitFor(() => {
      expect(
        screen.getByTestId("composer-attach-menu-last-action").getAttribute(
          "data-action",
        ),
      ).toBe("vault:/Business/Contracts/MSA.docx");
      const valueEl = screen.getByTestId("composer-attach-menu-value");
      expect(valueEl.getAttribute("data-value")).toBe(
        "/Business/Contracts/MSA.docx",
      );
      expect(valueEl.textContent).toContain("/Business/Contracts/MSA.docx");
    });
  });

  it("lp-khq.12.4: vault panel has no Open vault deep-link", async () => {
    render(<ComposerAttachMenuProofStory />);

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Select from vault/i }),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("composer-attach-menu").getAttribute("data-panel"),
      ).toBe("vault");
    });
    expect(screen.queryByRole("menuitem", { name: /Open vault/i })).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: /Business\//i }),
    ).toBeTruthy();
  });

  // Sequential skill→vault multi-open is covered by Playwright
  // (ui-testing/test_composer_attach_menu.py) — Astryx popover light-dismiss
  // is flaky under jsdom for a second open on the same mount.
});
