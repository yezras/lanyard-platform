import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

import type { ChatThreadSummary } from "../../api/types.js";

import {
  AgentSideNavRow,
  agentSideNavSubtitle,
  formatCreatedActivitySubtitle,
  type AgentSideNavRowProps,
} from "./AgentSideNavRow.js";

function makeThread(
  overrides: Partial<ChatThreadSummary> = {},
): ChatThreadSummary {
  return {
    thread_id: "thread-1",
    title: "Alpha agent",
    project_id: "p1",
    project_vault_path: "/Projects/A",
    created_at: "2026-07-01T12:00:00.000Z",
    avatar_seed: "seed-alpha",
    title_source: "default",
    access: "owner",
    ...overrides,
  };
}

function renderRow(props: Partial<AgentSideNavRowProps> = {}) {
  const thread = props.thread ?? makeThread();
  return render(
    <Theme theme={neutralTheme}>
      <AgentSideNavRow
        isSelected={false}
        status={undefined}
        canManage={true}
        onSelect={vi.fn()}
        onShare={vi.fn()}
        onDelete={vi.fn()}
        {...props}
        thread={thread}
      />
    </Theme>,
  );
}

describe("agentSideNavSubtitle", () => {
  it("prefers truncated last activity over created_at", () => {
    const long =
      "This is a very long last user message that should be truncated for the subtitle line in the agent side nav row";
    const sub = agentSideNavSubtitle(
      { created_at: "2026-07-01T12:00:00.000Z" },
      long,
    );
    expect(sub.endsWith("…")).toBe(true);
    expect(sub.length).toBeLessThanOrEqual(48);
  });

  it("falls back to created activity proxy", () => {
    expect(formatCreatedActivitySubtitle("2026-07-01T12:00:00.000Z")).toBe(
      "Jul 1",
    );
    expect(
      agentSideNavSubtitle({ created_at: "2026-07-01T12:00:00.000Z" }),
    ).toBe("Jul 1");
  });
});

describe("AgentSideNavRow", () => {
  afterEach(() => {
    cleanup();
  });

  it("omits leading icon for scheduled-task job streams (lp-fn5.5.2)", () => {
    renderRow({
      thread: makeThread({
        title: "Daily digest",
        kind: "scheduled_task",
        scheduled_job_id: "cron-1",
        title_source: "job",
        project_id: null,
        project_vault_path: null,
      }),
    });

    const row = screen.getByTestId("agent-side-nav-row-thread-1");
    expect(row.getAttribute("data-job-stream")).toBe("true");
    expect(screen.queryByTestId("agent-dither-thread-1")).toBeNull();
    expect(screen.queryByTestId("agent-side-nav-share-icon")).toBeNull();
    expect(screen.getByText("Daily digest")).toBeTruthy();
  });

  it("dims Off job stream and labels StatusDot Off (lp-lv9.2)", () => {
    renderRow({
      status: "off",
      thread: makeThread({
        title: "Paused digest",
        kind: "scheduled_task",
        scheduled_job_id: "cron-off",
        title_source: "job",
        project_id: null,
        project_vault_path: null,
      }),
    });

    const row = screen.getByTestId("agent-side-nav-row-thread-1");
    expect(row.getAttribute("data-job-off")).toBe("true");
    expect(row.getAttribute("data-status")).toBe("off");
    expect(row.style.opacity).toBe("0.55");
    expect(screen.getByLabelText("Off")).toBeTruthy();
    expect(row.getAttribute("aria-label")).toMatch(/Off/i);
  });

  it("shows pulsing Generating for live scheduled-task fire", () => {
    renderRow({
      status: "generating",
      thread: makeThread({
        title: "Live fire",
        kind: "scheduled_task",
        scheduled_job_id: "cron-run",
        title_source: "job",
        project_id: null,
        project_vault_path: null,
      }),
    });

    const row = screen.getByTestId("agent-side-nav-row-thread-1");
    expect(row.getAttribute("data-job-off")).toBe("false");
    expect(row.getAttribute("data-status")).toBe("generating");
    expect(screen.getByLabelText("Generating…")).toBeTruthy();
  });

  it("shows error StatusDot for failed idle job stream", () => {
    renderRow({
      status: "error",
      thread: makeThread({
        title: "Failed job",
        kind: "scheduled_task",
        scheduled_job_id: "cron-fail",
        title_source: "job",
        project_id: null,
        project_vault_path: null,
      }),
    });

    expect(screen.getByLabelText("Response failed")).toBeTruthy();
    const row = screen.getByTestId("agent-side-nav-row-thread-1");
    expect(row.getAttribute("data-job-off")).toBe("false");
  });

  it("shows dither from avatar_seed for owned agents (no chat bubble)", () => {
    renderRow({ thread: makeThread({ avatar_seed: "seed-xyz" }) });

    const dither = screen.getByTestId("agent-dither-thread-1");
    expect(dither.getAttribute("data-avatar-seed")).toBe("seed-xyz");
    expect(dither.getAttribute("data-running")).toBe("false");
    expect(screen.queryByTestId("dither-avatar-pulse")).toBeNull();
    expect(screen.queryByTestId("agent-side-nav-share-icon")).toBeNull();
    // Hero chat-bubble path is not used for owned rows
    expect(document.querySelector("svg.chat-bubble")).toBeNull();
  });

  it("animates dither while status is generating (lp-lv9.8)", () => {
    renderRow({
      status: "generating",
      thread: makeThread({ avatar_seed: "seed-run" }),
    });

    const dither = screen.getByTestId("agent-dither-thread-1");
    expect(dither.getAttribute("data-running")).toBe("true");
    expect(screen.getByTestId("dither-avatar-pulse")).toBeTruthy();
    expect(dither.getAttribute("data-avatar-seed")).toBe("seed-run");
  });

  it("keeps dither static for success / error / off (lp-lv9.8)", () => {
    for (const status of ["success", "error", "off", "neutral"] as const) {
      cleanup();
      renderRow({
        status,
        thread: makeThread({ avatar_seed: "seed-idle" }),
      });
      const dither = screen.getByTestId("agent-dither-thread-1");
      expect(dither.getAttribute("data-running")).toBe("false");
      expect(screen.queryByTestId("dither-avatar-pulse")).toBeNull();
    }
  });

  it("renders 2-line name + subtitle with ellipsis props", () => {
    renderRow({
      thread: makeThread({ title: "Named agent" }),
      lastActivity: "Last thing the user said about quarterly forecasts",
    });

    expect(screen.getByText("Named agent")).toBeTruthy();
    const sub = screen.getByTestId("agent-side-nav-subtitle-thread-1");
    expect(sub.textContent).toMatch(/Last thing/i);
  });

  it("ellipsis-truncates long latest user/assistant preview on line 2 (lp-lv9.3)", () => {
    const long =
      "This is a very long last user message that should be truncated for the subtitle line in the agent side nav row";
    renderRow({
      thread: makeThread({ title: "Named agent" }),
      lastActivity: long,
    });

    const sub = screen.getByTestId("agent-side-nav-subtitle-thread-1");
    expect(sub.textContent?.endsWith("…")).toBe(true);
    expect((sub.textContent ?? "").length).toBeLessThanOrEqual(48);
    // Date proxy must not be used when lastActivity is present.
    expect(sub.textContent).not.toMatch(/Jul 1/);
  });

  it("uses share icon instead of dither for invitee rows", () => {
    renderRow({
      canManage: false,
      thread: makeThread({ access: "read", avatar_seed: "seed-shared" }),
    });

    expect(screen.getByTestId("agent-side-nav-share-icon")).toBeTruthy();
    expect(screen.queryByTestId("agent-dither-thread-1")).toBeNull();
    expect(screen.getByText("Read")).toBeTruthy();
  });

  it("marks selected row for a11y", () => {
    renderRow({ isSelected: true });
    const row = screen.getByTestId("agent-side-nav-row-thread-1");
    expect(row.getAttribute("data-selected")).toBe("true");
    expect(row.getAttribute("aria-current")).toBe("page");
  });

  it("double-click name enters edit and Enter saves via onRename", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderRow({ onRename });

    fireEvent.doubleClick(screen.getByTestId("agent-side-nav-title-thread-1"));
    const input = screen.getByLabelText("Agent name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Sidebar rename" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith("Sidebar rename");
    });
  });

  it("Escape cancels inline rename without onRename", async () => {
    const onRename = vi.fn();
    renderRow({ onRename });

    fireEvent.doubleClick(screen.getByTestId("agent-side-nav-title-thread-1"));
    const input = screen.getByLabelText("Agent name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });

    await waitFor(() => {
      expect(screen.queryByLabelText("Agent name")).toBeNull();
    });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("shows Rename in MoreMenu for owned rows with onRename", async () => {
    const onRename = vi.fn();
    renderRow({ onRename });

    // StatusDot is default; hover Stack reveals MoreMenu.
    const row = screen.getByTestId("agent-side-nav-row-thread-1");
    const hoverTarget = row.parentElement ?? row;
    fireEvent.mouseEnter(hoverTarget);

    const moreMenu = await screen.findByRole("button", {
      name: "Chat actions for Alpha agent",
    });
    fireEvent.click(moreMenu);

    const renameItem = await screen.findByRole("menuitem", { name: /Rename/i });
    fireEvent.click(renameItem);

    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toBeTruthy();
    });
  });

  it("I7: channel row menus expose no Members item (lp-rxr9)", async () => {
    renderRow({
      thread: makeThread({
        thread_id: "ch-1",
        title: "Deal room",
        kind: "group",
      }),
      onRename: vi.fn(),
    });
    const row = screen.getByTestId("agent-side-nav-row-ch-1");
    expect(row.getAttribute("data-channel")).toBe("true");
    fireEvent.mouseEnter(row.parentElement ?? row);
    fireEvent.click(
      await screen.findByRole("button", { name: "Chat actions for Deal room" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /^Share$/ })).toBeTruthy();
    });
    expect(
      screen.queryByRole("menuitem", { name: /^Members$/ }),
    ).toBeNull();
  });
});
