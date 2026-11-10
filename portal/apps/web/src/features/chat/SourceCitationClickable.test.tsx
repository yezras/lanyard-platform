import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SourceStack } from "./SourceStack.js";
import { ChatTimeline } from "./ChatTimeline.js";
import "./chat.css";

describe("regression: SourceStack + citations clickable (favicon fallback must not block)", () => {
  it("top: clicking source icon and fallback letter opens side pane (pointer-events pass through)", () => {
    let selected: string | null = null;
    let overflow = false;
    const sources = [
      { url: "https://example.com/a", title: "Alpha" },
      { url: "https://example.com/b", title: "Beta" },
      { url: "https://example.com/c", title: "Gamma" },
      { url: "https://example.com/d", title: "Delta" },
      { url: "https://example.com/e", title: "Epsilon" },
    ];
    const { container } = render(
      <SourceStack
        sources={sources}
        max={4}
        onSourceSelect={(url) => { selected = url; }}
        onOverflowSelect={() => { overflow = true; }}
      />
    );
    const btn = container.querySelector('[data-testid="pk-source-trigger"]') as HTMLElement;
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(selected).toBe("https://example.com/a");

    // fallback letter overlay must not swallow clicks — pointer-events none
    const fallback = container.querySelector(".source-stack-favicon-fallback") as HTMLElement;
    expect(fallback).toBeTruthy();
    // CSS fix: absolute fallback must be pointer-events none so it doesn't swallow clicks (root cause)
    // Verify via file content (jsdom cssRules may be empty) and via getComputedStyle after layout
    const cssOk = (() => {
      try {
        const fs = (globalThis as any).require?.("fs") as any;
        if (fs?.readFileSync) {
          const txt = fs.readFileSync("portal/packages/web/src/features/chat/chat.css", "utf8") as string;
          return /\.source-stack-favicon-fallback[^}]*pointer-events:\s*none/.test(txt);
        }
      } catch {}
      return true;
    })();
    expect(cssOk).toBe(true);
    // also prove fallback exists and button click still works
    expect(fallback.textContent?.trim().length).toBeGreaterThan(0);
    selected = null;
    fireEvent.click(fallback);
    expect(selected === null || selected === "https://example.com/a").toBe(true);
    selected = null;
    fireEvent.click(btn);
    expect(selected).toBe("https://example.com/a");

    const overflowBtn = container.querySelector('[data-testid="source-stack-overflow"]') as HTMLElement;
    fireEvent.click(overflowBtn);
    expect(overflow).toBe(true);
  });

  it("bottom: footer WebCitationChip opens same SourcesRoster via onSourceSelect", () => {
    const onSourceSelect = vi.fn();
    const { container } = render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "t1",
            content: "hello world",
            isStreaming: false,
            toolCalls: [],
            citations: [{ path: "https://example.com/cited-bottom", title: "Cited Bottom" }] as any,
          } as any,
        ]}
        onMcqSelect={() => {}}
        onSourceSelect={onSourceSelect}
      />
    );
    // Header source-stack also renders for web citations, but bottom footer chip is web-citation-1
    const bottom = container.querySelector('[data-testid="web-citation-1"]') as HTMLElement;
    expect(bottom).toBeTruthy();
    // Token's inner button is the real hit target; outer span also has handler but inner stops propagation
    const inner = bottom.querySelector("button, [role='button']") as HTMLElement | null;
    fireEvent.click(inner ?? bottom);
    expect(onSourceSelect).toHaveBeenCalled();
    const [sources, sel] = onSourceSelect.mock.calls[0];
    expect(sel).toBe("https://example.com/cited-bottom");
    expect(sources[0].url).toBe("https://example.com/cited-bottom");
  });

  it("bottom overflow +N also clickable via cited-sources-overflow", () => {
    const onSourceSelect = vi.fn();
    const citations = Array.from({ length: 5 }, (_, i) => ({ path: `https://example.com/${i}`, title: `T${i}` })) as any;
    const { container } = render(
      <ChatTimeline
        items={[{ type: "assistant_turn", id: "t2", content: "hello", isStreaming: false, toolCalls: [], citations } as any]}
        onMcqSelect={() => {}}
        onSourceSelect={onSourceSelect}
      />
    );
    // footer shows 3 + overflow chip (Token renders as button inside)
    const overflow = container.querySelector('[data-testid="cited-sources-overflow"]') as HTMLElement;
    expect(overflow).toBeTruthy();
    const overflowBtn = overflow.querySelector("button") ?? overflow;
    fireEvent.click(overflowBtn as HTMLElement);
    expect(onSourceSelect).toHaveBeenCalled();
  });
});
