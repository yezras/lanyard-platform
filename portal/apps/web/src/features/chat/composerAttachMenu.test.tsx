/**
 * Unit tests for composer + attach menu shell (lp-khq.5 / lp-khq.7).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComposerAttachMenu } from "./composerAttachMenu.js";
import type { AttachMenuVaultTreeNode } from "./composerAttachMenuModel.js";

afterEach(() => {
  cleanup();
});

const FIXTURE_SKILLS = [
  {
    id: "summarize",
    name: "summarize",
    description: "Condense long documents",
    enabled: true as const,
  },
  {
    id: "triage",
    name: "post-meeting-triage",
    description: "Extract actions from notes",
    enabled: true as const,
  },
];

const FIXTURE_VAULT = [
  { path: "/Business/Contracts/MSA.docx", name: "MSA.docx" },
  { path: "/Projects/A/notes.md", name: "notes.md" },
];

const FIXTURE_TREE: AttachMenuVaultTreeNode[] = [
  {
    name: "Business",
    path: "/Business",
    kind: "directory",
    children: [
      {
        name: "Contracts",
        path: "/Business/Contracts",
        kind: "directory",
        children: [
          {
            name: "MSA.docx",
            path: "/Business/Contracts/MSA.docx",
            kind: "file",
          },
        ],
      },
    ],
  },
  {
    name: "Projects",
    path: "/Projects",
    kind: "directory",
    children: [
      {
        name: "A",
        path: "/Projects/A",
        kind: "directory",
        children: [
          { name: "notes.md", path: "/Projects/A/notes.md", kind: "file" },
        ],
      },
    ],
  },
];

describe("ComposerAttachMenu", () => {
  it("opens root menu with Attach file, Skills, Select from vault only", async () => {
    const onAttachFile = vi.fn();
    render(
      <ComposerAttachMenu
        skills={FIXTURE_SKILLS}
        vaultFiles={FIXTURE_VAULT}
        composerValue=""
        onComposerChange={vi.fn()}
        onAttachFile={onAttachFile}
      />,
    );

    expect(screen.getByTestId("composer-attach-menu")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));

    // lp-khq.12.3: Attach file is a root + menu item (not a standalone paperclip).
    expect(
      await screen.findByRole("menuitem", { name: /Attach file/i }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Skills/i })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /Select from vault/i }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: /New workflow/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: /Workflow wizard/i }),
    ).toBeNull();
  });

  it("Attach file menu item invokes onAttachFile and closes menu", async () => {
    const onAttachFile = vi.fn();
    render(
      <ComposerAttachMenu
        skills={FIXTURE_SKILLS}
        vaultFiles={FIXTURE_VAULT}
        composerValue=""
        onComposerChange={vi.fn()}
        onAttachFile={onAttachFile}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Attach file/i }),
    );

    expect(onAttachFile).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(
        screen.getByTestId("composer-attach-menu").getAttribute("data-open"),
      ).toBe("false");
    });
  });

  it("omits Attach file row when onAttachFile is not provided", async () => {
    render(
      <ComposerAttachMenu
        skills={FIXTURE_SKILLS}
        vaultFiles={FIXTURE_VAULT}
        composerValue=""
        onComposerChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    expect(await screen.findByRole("menuitem", { name: /Skills/i })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Attach file/i })).toBeNull();
  });

  it("selecting a skill inserts /name into controlled composer value", async () => {
    const onChange = vi.fn();
    render(
      <ComposerAttachMenu
        skills={FIXTURE_SKILLS}
        vaultFiles={FIXTURE_VAULT}
        composerValue="Please"
        onComposerChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Skills/i }));

    // Nested panel re-opens after Astryx item close.
    await waitFor(() => {
      expect(
        screen.getByTestId("composer-attach-menu").getAttribute("data-panel"),
      ).toBe("skills");
    });

    // Re-query after panel swap (menu re-opens with skill rows).
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /summarize/i }),
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("Please /summarize");
    });
  });

  it("selecting vault file inserts path reference into controlled value", async () => {
    const onChange = vi.fn();
    render(
      <ComposerAttachMenu
        skills={FIXTURE_SKILLS}
        vaultFiles={FIXTURE_VAULT}
        composerValue=""
        onComposerChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Select from vault/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("composer-attach-menu").getAttribute("data-panel"),
      ).toBe("vault");
    });

    fireEvent.click(await screen.findByRole("menuitem", { name: /MSA\.docx/i }));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("/Business/Contracts/MSA.docx");
    });
  });

  it("always updates controlled value even when side-effect hooks are provided", async () => {
    const onInsertSkill = vi.fn();
    const onInsertVault = vi.fn();
    const onChange = vi.fn();

    render(
      <ComposerAttachMenu
        skills={FIXTURE_SKILLS}
        vaultFiles={FIXTURE_VAULT}
        composerValue=""
        onComposerChange={onChange}
        onInsertSkillToken={onInsertSkill}
        onInsertVaultPath={onInsertVault}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Skills/i }));
    await waitFor(() => {
      expect(
        screen.getByTestId("composer-attach-menu").getAttribute("data-panel"),
      ).toBe("skills");
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /post-meeting-triage/i }),
    );
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("/post-meeting-triage");
      expect(onInsertSkill).toHaveBeenCalled();
    });
  });

  it("skills panel shows one-line descriptions; name-only when empty", async () => {
    render(
      <ComposerAttachMenu
        skills={[
          ...FIXTURE_SKILLS,
          { id: "plain", name: "plain-skill", enabled: true },
          {
            id: "long",
            name: "long-desc",
            description:
              "This is a deliberately long skill description that should still render as a single supporting line under the name",
            enabled: true,
          },
        ]}
        vaultFiles={FIXTURE_VAULT}
        composerValue=""
        onComposerChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Skills/i }));
    await waitFor(() => {
      expect(
        screen.getByTestId("composer-attach-menu").getAttribute("data-panel"),
      ).toBe("skills");
    });

    // Description text is visible under skill names.
    expect(screen.getByText("Condense long documents")).toBeTruthy();
    expect(screen.getByText("Extract actions from notes")).toBeTruthy();
    expect(
      screen.getByText(
        /This is a deliberately long skill description that should still render/,
      ),
    ).toBeTruthy();

    // Name-only skill still present; no empty description layout break.
    expect(
      screen.getByRole("menuitem", { name: /plain-skill/i }),
    ).toBeTruthy();
  });

  it("lp-khq.7: tree browse drills into folders and inserts file path", async () => {
    const onChange = vi.fn();
    render(
      <ComposerAttachMenu
        skills={FIXTURE_SKILLS}
        vaultTree={FIXTURE_TREE}
        vaultFiles={FIXTURE_VAULT}
        composerValue=""
        onComposerChange={onChange}
      />,
    );

    const menu = screen.getByTestId("composer-attach-menu");
    expect(menu.getAttribute("data-vault-mode")).toBe("tree");

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Select from vault/i }),
    );

    await waitFor(() => {
      expect(menu.getAttribute("data-panel")).toBe("vault");
      expect(menu.getAttribute("data-vault-browse-path")).toBe("/");
    });

    // Roots: folders only (Business/, Projects/).
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
      expect(onChange).toHaveBeenCalledWith("/Business/Contracts/MSA.docx");
    });
  });

  it("lp-khq.12.4: vault panel has no Open vault deep-link control", async () => {
    render(
      <ComposerAttachMenu
        skills={FIXTURE_SKILLS}
        vaultTree={FIXTURE_TREE}
        vaultFiles={FIXTURE_VAULT}
        composerValue=""
        onComposerChange={vi.fn()}
      />,
    );

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
    // Folder drill still available.
    expect(
      screen.getByRole("menuitem", { name: /Business\//i }),
    ).toBeTruthy();
  });

  it("lp-khq.12.4: empty vault is disabled with honest empty state (no deep-link CTA)", async () => {
    render(
      <ComposerAttachMenu
        skills={FIXTURE_SKILLS}
        vaultFiles={[]}
        composerValue=""
        onComposerChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    const selectVault = await screen.findByRole("menuitem", {
      name: /Select from vault/i,
    });
    expect(selectVault.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("No vault files loaded")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Open vault/i })).toBeNull();
    expect(screen.queryByText(/Open vault tab/i)).toBeNull();

    // Click must not open vault panel.
    fireEvent.click(selectVault);
    expect(
      screen.getByTestId("composer-attach-menu").getAttribute("data-panel"),
    ).toBe("root");
  });
});
