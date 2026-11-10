import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

import { AgentTitleEditor } from "./AgentTitleEditor.js";

function renderEditor(
  props: Partial<ComponentProps<typeof AgentTitleEditor>> = {},
) {
  const onRename = props.onRename ?? vi.fn();
  return {
    onRename,
    ...render(
      <Theme theme={neutralTheme}>
        <AgentTitleEditor
          title="Alpha agent"
          canRename
          onRename={onRename}
          testId="agent-title-test"
          {...props}
        />
      </Theme>,
    ),
  };
}

describe("AgentTitleEditor", () => {
  afterEach(() => {
    cleanup();
  });

  it("enters edit on double-click and saves on Enter with new title", async () => {
    const { onRename } = renderEditor();

    fireEvent.doubleClick(screen.getByTestId("agent-title-test"));
    const input = screen.getByLabelText("Agent name") as HTMLInputElement;
    expect(input.value).toBe("Alpha agent");

    fireEvent.change(input, { target: { value: "Renamed agent" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith("Renamed agent");
    });
  });

  it("cancels on Escape without calling onRename", async () => {
    const { onRename } = renderEditor();

    fireEvent.doubleClick(screen.getByTestId("agent-title-test"));
    const input = screen.getByLabelText("Agent name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Scratch" } });
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });

    await waitFor(() => {
      expect(screen.queryByLabelText("Agent name")).toBeNull();
    });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByTestId("agent-title-test").textContent).toContain(
      "Alpha agent",
    );
  });

  it("ignores double-click when canRename is false", () => {
    renderEditor({ canRename: false });
    fireEvent.doubleClick(screen.getByTestId("agent-title-test"));
    expect(screen.queryByLabelText("Agent name")).toBeNull();
  });

  it("enters edit when requestEdit is true (MoreMenu path)", async () => {
    const onConsumed = vi.fn();
    renderEditor({
      requestEdit: true,
      onRequestEditConsumed: onConsumed,
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toBeTruthy();
    });
    expect(onConsumed).toHaveBeenCalled();
  });

  it("does not save empty or unchanged titles", async () => {
    const { onRename } = renderEditor();

    fireEvent.doubleClick(screen.getByTestId("agent-title-test"));
    const input = screen.getByLabelText("Agent name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.queryByLabelText("Agent name")).toBeNull();
    });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("commits non-empty changed title on blur", async () => {
    const { onRename } = renderEditor();

    fireEvent.doubleClick(screen.getByTestId("agent-title-test"));
    const input = screen.getByLabelText("Agent name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Blur saved" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith("Blur saved");
    });
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("does not commit on blur after Escape cancel", async () => {
    const { onRename } = renderEditor();

    fireEvent.doubleClick(screen.getByTestId("agent-title-test"));
    const input = screen.getByLabelText("Agent name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Should not save" } });
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
    // Blur often follows Escape when focus leaves the unmounted input.
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.queryByLabelText("Agent name")).toBeNull();
    });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("does not double-commit when Enter is followed by blur", async () => {
    const { onRename } = renderEditor();

    fireEvent.doubleClick(screen.getByTestId("agent-title-test"));
    const input = screen.getByLabelText("Agent name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Once only" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith("Once only");
    });
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("uses a compact ~20ch width, not full-bleed", () => {
    renderEditor();

    fireEvent.doubleClick(screen.getByTestId("agent-title-test"));
    const editing = screen.getByTestId("agent-title-test-editing");
    expect(editing.style.width).toBe("20ch");
    expect(editing.style.maxWidth).toBe("20ch");
  });
});
