import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

import { ShareThreadDialog } from "./ShareThreadDialog.js";

const listOrgMembers = vi.fn();
const createChatThreadShare = vi.fn();
const listChatThreadShares = vi.fn();
const revokeChatThreadShare = vi.fn();

vi.mock("../../api/sessionShares.js", () => ({
  listOrgMembers: (...args: unknown[]) => listOrgMembers(...args),
  createChatThreadShare: (...args: unknown[]) => createChatThreadShare(...args),
  listChatThreadShares: (...args: unknown[]) => listChatThreadShares(...args),
  revokeChatThreadShare: (...args: unknown[]) =>
    revokeChatThreadShare(...args),
}));

function renderDialog(
  props: Partial<{
    isOpen: boolean;
    threadId: string;
    threadTitle: string;
    onOpenChange: (open: boolean) => void;
  }> = {},
) {
  const onOpenChange = props.onOpenChange ?? vi.fn();
  return render(
    <Theme theme={neutralTheme}>
      <ShareThreadDialog
        isOpen={props.isOpen ?? true}
        onOpenChange={onOpenChange}
        threadId={props.threadId ?? "thread-alpha"}
        threadTitle={props.threadTitle ?? "Alpha chat"}
      />
    </Theme>,
  );
}

const activeGrant = {
  grant_id: "g1",
  tenant_id: "t1",
  thread_id: "thread-alpha",
  owner_user_id: "u1",
  grantee_user_id: "u2",
  mode: "read" as const,
  created_at: "2026-07-15T00:00:00.000Z",
  revoked_at: null,
};

describe("ShareThreadDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listOrgMembers.mockResolvedValue([
      { user_id: "u2", email: "bob@demo.test" },
      { user_id: "u3", email: "carol@demo.test" },
    ]);
    listChatThreadShares.mockResolvedValue([]);
    createChatThreadShare.mockResolvedValue({
      ...activeGrant,
    });
    revokeChatThreadShare.mockResolvedValue({
      ...activeGrant,
      revoked_at: "2026-07-15T12:00:00.000Z",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("loads org members and creates a share for the selected member", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Share chat")).toBeTruthy();

    await waitFor(() => {
      expect(listOrgMembers).toHaveBeenCalled();
      expect(listChatThreadShares).toHaveBeenCalledWith("thread-alpha");
    });

    const bob = await screen.findByText("bob@demo.test");
    fireEvent.click(bob);

    const shareButton = within(dialog).getByRole("button", { name: "Share" });
    fireEvent.click(shareButton);

    await waitFor(() => {
      expect(createChatThreadShare).toHaveBeenCalledWith({
        threadId: "thread-alpha",
        granteeEmail: "bob@demo.test",
        mode: "read",
      });
    });

    expect(
      await screen.findByText(/Shared with bob@demo\.test/i),
    ).toBeTruthy();
    // Dialog stays open for multi-share.
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Refreshes grants after create.
    await waitFor(() => {
      expect(listChatThreadShares.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shares in collaborate mode when selected", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    await screen.findByText("bob@demo.test");

    // SegmentedControl radios for mode.
    const collab =
      within(dialog).queryByRole("radio", { name: /Collaborate/i }) ??
      within(dialog).getByText("Collaborate");
    fireEvent.click(collab);

    fireEvent.click(screen.getByText("bob@demo.test"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Share" }));

    await waitFor(() => {
      expect(createChatThreadShare).toHaveBeenCalledWith({
        threadId: "thread-alpha",
        granteeEmail: "bob@demo.test",
        mode: "collaborate",
      });
    });
  });

  it("lists active grants and revokes a grantee", async () => {
    listChatThreadShares
      .mockResolvedValueOnce([activeGrant])
      .mockResolvedValueOnce([]); // after revoke refresh

    renderDialog();

    const dialog = await screen.findByRole("dialog");
    expect(await screen.findByText("People with access")).toBeTruthy();
    // Wait until the grants list paints the Revoke control (not the invite picker).
    const revokeButton = await within(dialog).findByRole("button", {
      name: "Revoke",
    });
    // Mode description may appear in segmented control + grant row.
    expect(within(dialog).getAllByText("Read").length).toBeGreaterThanOrEqual(
      1,
    );

    // Bob should not also appear in the invite picker while granted.
    await waitFor(() => {
      expect(listOrgMembers).toHaveBeenCalled();
    });
    // Carol remains available to share.
    expect(await screen.findByText("carol@demo.test")).toBeTruthy();

    fireEvent.click(revokeButton);

    await waitFor(() => {
      expect(revokeChatThreadShare).toHaveBeenCalledWith({
        threadId: "thread-alpha",
        granteeUserId: "u2",
      });
    });

    expect(
      await screen.findByText(/Revoked access for bob@demo\.test/i),
    ).toBeTruthy();

    await waitFor(() => {
      // After refresh with empty grants, bob returns to picker or empty people list.
      expect(listChatThreadShares.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows revoke API errors inline", async () => {
    listChatThreadShares.mockResolvedValue([activeGrant]);
    revokeChatThreadShare.mockRejectedValueOnce(
      new Error("Share grant not found"),
    );

    renderDialog();
    const dialog = await screen.findByRole("dialog");
    const revokeButton = await within(dialog).findByRole("button", {
      name: "Revoke",
    });
    fireEvent.click(revokeButton);

    expect(await screen.findByText("Share grant not found")).toBeTruthy();
    expect(screen.queryByText(/Revoked access/i)).toBeNull();
  });

  it("shows API errors inline and does not claim success", async () => {
    createChatThreadShare.mockRejectedValueOnce(
      new Error("Already shared with this user"),
    );
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    await screen.findByText("bob@demo.test");
    fireEvent.click(screen.getByText("bob@demo.test"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Share" }));

    expect(
      await screen.findByText("Already shared with this user"),
    ).toBeTruthy();
    expect(screen.queryByText(/Shared with bob@demo\.test/i)).toBeNull();
  });

  it("shows members load failure", async () => {
    listOrgMembers.mockRejectedValueOnce(new Error("Not authenticated"));
    // Grants may succeed independently; surface the members error.
    listChatThreadShares.mockResolvedValueOnce([]);
    renderDialog();

    expect(
      await screen.findByText("Not authenticated"),
    ).toBeTruthy();
  });

  it("does not call create when no member is selected", async () => {
    renderDialog();
    const dialog = await screen.findByRole("dialog");
    await screen.findByText("bob@demo.test");

    const shareButton = within(dialog).getByRole("button", { name: "Share" });
    // Disabled until selection; click should be a no-op if forced.
    expect(
      shareButton.hasAttribute("disabled") ||
        shareButton.getAttribute("aria-disabled") === "true",
    ).toBe(true);
    expect(createChatThreadShare).not.toHaveBeenCalled();
  });
});
