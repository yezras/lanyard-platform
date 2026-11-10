import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChatMessageContent,
  isVaultPathHref,
  vaultPathFromHref,
} from "./ChatMessageContent.js";
import { createChatRichCodeBlock } from "./ChatRichCodeBlock.js";

describe("resolveVaultCitationPath / citationDisplayTitle", () => {
  it("prepends project vault path for relative citations", async () => {
    const {
      resolveVaultCitationPath,
      resolveVaultCitationClickPath,
      citationDisplayTitle,
    } = await import("../vault/vaultPaths.js");
    expect(resolveVaultCitationPath("README.md", "/home/u/Core")).toBe(
      "/home/u/Core/README.md",
    );
    expect(resolveVaultCitationPath("src/foo.ts", "/home/u/Core")).toBe(
      "/home/u/Core/src/foo.ts",
    );
    expect(
      resolveVaultCitationPath("/home/u/Core/README.md", "/home/u/Core"),
    ).toBe("/home/u/Core/README.md");
    expect(citationDisplayTitle("README.md", "/home/u/Core")).toBe(
      "Core/README.md",
    );
    // Click helper must not invent leading / before project join.
    expect(
      resolveVaultCitationClickPath("src/foo.ts", "/home/u/Core"),
    ).toBe("/home/u/Core/src/foo.ts");
    expect(resolveVaultCitationClickPath("README.md", "/home/u/Core")).toBe(
      "/home/u/Core/README.md",
    );
  });

  it("remaps fixture /Projects/… into project root; keeps vault-root absolute", async () => {
    const { resolveVaultCitationPath } = await import("../vault/vaultPaths.js");
    expect(
      resolveVaultCitationPath("/Projects/A/README.md", "/home/u/Core"),
    ).toBe("/home/u/Core/README.md");
    // Vault-root-relative absolute stays at vault root (lp-95v.3) — not re-scoped
    // under the active project (fixes OnlyOffice path not found).
    expect(resolveVaultCitationPath("/README.md", "/home/u/Core")).toBe(
      "/README.md",
    );
    expect(
      resolveVaultCitationPath("file:///home/u/Core/notes.md", "/home/u/Core"),
    ).toBe("/home/u/Core/notes.md");
    // Bare relative still joins project.
    expect(resolveVaultCitationPath("README.md", "/home/u/Core")).toBe(
      "/home/u/Core/README.md",
    );
  });

  it("projects host absolute Clients paths to vault-relative (lp-vnz.3)", async () => {
    const { resolveVaultCitationPath } = await import("../vault/vaultPaths.js");
    const clients = "/home/operator/Lanyard/Clients";
    expect(
      resolveVaultCitationPath(
        "/home/operator/Lanyard/AGENTS.md",
        clients,
      ),
    ).toBe("/AGENTS.md");
    expect(
      resolveVaultCitationPath(
        "/home/operator/Lanyard/Note.docx",
        clients,
      ),
    ).toBe("/Note.docx");
    expect(
      resolveVaultCitationPath(
        "/home/operator/Lanyard/Clients/Active/Acme/AGENTS.md",
        clients,
      ),
    ).toBe("/Clients/Active/Acme/AGENTS.md");
    expect(
      resolveVaultCitationPath("Active/Acme/Note.docx", clients),
    ).toBe("/Clients/Active/Acme/Note.docx");
  });

  it("strips guest /mnt/vault from workflow state citations (lp-oop.38.22)", async () => {
    const { resolveVaultCitationPath, citationDisplayTitle } = await import(
      "../vault/vaultPaths.js"
    );
    expect(
      resolveVaultCitationPath(
        "/mnt/vault/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
      ),
    ).toBe("/workflows/runs/wf_03e3fb5b2224a1d2/state.json");
    expect(
      citationDisplayTitle(
        "/mnt/vault/workflows/runs/wf_03e3fb5b2224a1d2/state.json",
      ),
    ).toBe("wf_03e3fb5b2224a1d2/state.json");
  });
});

describe("isVaultPathHref / vaultPathFromHref", () => {
  it("accepts absolute vault paths", () => {
    expect(isVaultPathHref("/Projects/A/README.md")).toBe(true);
    expect(isVaultPathHref("./local.md")).toBe(true);
    expect(vaultPathFromHref("/Projects/A/README.md")).toBe(
      "/Projects/A/README.md",
    );
    expect(vaultPathFromHref("./local.md")).toBe("/local.md");
  });

  it("accepts bare project-style paths", () => {
    expect(isVaultPathHref("Projects/A/notes.md")).toBe(true);
    expect(vaultPathFromHref("Projects/A/notes.md")).toBe(
      "/Projects/A/notes.md",
    );
  });

  it("normalizes same-origin absolute URLs to vault paths", () => {
    const sameOrigin = `${window.location.origin}/Projects/A/README.md`;
    expect(vaultPathFromHref(sameOrigin)).toBe("/Projects/A/README.md");
    expect(isVaultPathHref(sameOrigin)).toBe(true);
  });

  it("rejects external URLs", () => {
    expect(isVaultPathHref("https://react.dev")).toBe(false);
    expect(isVaultPathHref("http://example.com/file.md")).toBe(false);
    expect(isVaultPathHref("mailto:a@b.com")).toBe(false);
    expect(vaultPathFromHref("https://react.dev")).toBeNull();
  });
});

describe("ChatMessageContent", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders footer citations and invokes onCitationClick", () => {
    const onCitationClick = vi.fn();
    render(
      <ChatMessageContent
        content="See source"
        citations={[{ path: "/Projects/A/README.md", title: "README.md" }]}
        onCitationClick={onCitationClick}
      />,
    );

    const citation = screen.getByTestId("vault-citation-1");
    fireEvent.click(citation);
    expect(onCitationClick).toHaveBeenCalledWith("/Projects/A/README.md");
  });

  it("lp-95v.5: renders web citation chips that open exact source URLs", () => {
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);
    const onCitationClick = vi.fn();
    render(
      <ChatMessageContent
        content="Spain won the final."
        citations={[
          {
            path: "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
            title: "en.wikipedia.org",
          },
          {
            path: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026",
            title: "fifa.com",
          },
        ]}
        onCitationClick={onCitationClick}
      />,
    );

    const wiki = screen.getByTestId("web-citation-1");
    const fifa = screen.getByTestId("web-citation-2");
    expect(wiki.getAttribute("data-citation-url")).toBe(
      "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
    );
    expect(screen.getByText("en.wikipedia.org")).toBeTruthy();
    expect(screen.getByText("fifa.com")).toBeTruthy();
    // Vault chips must not appear for pure web sources.
    expect(screen.queryByTestId("vault-citation-1")).toBeNull();

    fireEvent.click(wiki);
    expect(openSpy).toHaveBeenCalledWith(
      "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
      "_blank",
      "noopener,noreferrer",
    );
    // Web chips must not deep-link the vault document pane.
    expect(onCitationClick).not.toHaveBeenCalled();

    fireEvent.click(fifa);
    expect(openSpy).toHaveBeenCalledWith(
      "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("lp-95v.5: mixed vault + web citations keep distinct chip types", () => {
    render(
      <ChatMessageContent
        content="See both"
        citations={[
          { path: "/Projects/A/README.md", title: "README.md" },
          {
            path: "https://react.dev",
            title: "react.dev",
          },
        ]}
        onCitationClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("vault-citation-1")).toBeTruthy();
    expect(screen.getByTestId("web-citation-2")).toBeTruthy();
  });

  it("lp-uxy.7: rich web citation cards show title + snippet and open URL", () => {
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);
    render(
      <ChatMessageContent
        content="Spain won the final."
        citations={[
          {
            path: "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
            title: "2026 FIFA World Cup",
            snippet: "The 2026 FIFA World Cup is the 23rd FIFA World Cup.",
          },
        ]}
      />,
    );
    const chip = screen.getByTestId("web-citation-1");
    expect(chip.getAttribute("data-citation-rich")).toBe("true");
    expect(chip.getAttribute("data-citation-url")).toBe(
      "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
    );
    expect(screen.getByText("2026 FIFA World Cup")).toBeTruthy();
    expect(
      screen.getByText("The 2026 FIFA World Cup is the 23rd FIFA World Cup."),
    ).toBeTruthy();
    fireEvent.click(chip.querySelector("button") ?? chip);
    expect(openSpy).toHaveBeenCalledWith(
      "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("renders file-type icons on footer citation chips", () => {
    render(
      <ChatMessageContent
        content="See source"
        citations={[
          { path: "/Projects/A/README.md", title: "README.md" },
          { path: "/Projects/A/src/foo.ts", title: "foo.ts" },
        ]}
        onCitationClick={vi.fn()}
      />,
    );

    // Token chips use Heroicons via Astryx Icon (svg), not img data-URIs.
    const chip1 = screen.getByTestId("vault-citation-1");
    const chip2 = screen.getByTestId("vault-citation-2");
    expect(chip1.querySelector('svg[data-slot="icon"]')).toBeTruthy();
    expect(chip2.querySelector('svg[data-slot="icon"]')).toBeTruthy();
    // Different path kinds → different icon path data.
    const d1 = chip1.querySelector("svg path")?.getAttribute("d") ?? "";
    const d2 = chip2.querySelector("svg path")?.getAttribute("d") ?? "";
    expect(d1).not.toBe("");
    expect(d2).not.toBe("");
    expect(d1).not.toBe(d2);
  });

  it("resolves relative citations against projectVaultPath", () => {
    const onCitationClick = vi.fn();
    render(
      <ChatMessageContent
        content="See source"
        citations={[{ path: "README.md", title: "README.md" }]}
        projectVaultPath="/home/u/Core"
        onCitationClick={onCitationClick}
      />,
    );

    expect(screen.getByText("Core/README.md")).toBeTruthy();
    fireEvent.click(screen.getByTestId("vault-citation-1"));
    expect(onCitationClick).toHaveBeenCalledWith("/home/u/Core/README.md");
  });

  it("resolves multi-segment relative citations under project (not /src/…)", () => {
    const onCitationClick = vi.fn();
    render(
      <ChatMessageContent
        content="See source"
        citations={[{ path: "src/foo.ts", title: "foo.ts" }]}
        projectVaultPath="/home/u/Core"
        onCitationClick={onCitationClick}
      />,
    );

    expect(screen.getByText("Core/src/foo.ts")).toBeTruthy();
    fireEvent.click(screen.getByTestId("vault-citation-1"));
    expect(onCitationClick).toHaveBeenCalledWith("/home/u/Core/src/foo.ts");
    expect(onCitationClick).not.toHaveBeenCalledWith("/src/foo.ts");
  });

  it("renders inline citation markers via Markdown sources", () => {
    const onCitationClick = vi.fn();
    render(
      <ChatMessageContent
        content="React uses a virtual DOM[1]."
        citations={[
          { path: "/Projects/react-notes.md", title: "react-notes.md" },
        ]}
        onCitationClick={onCitationClick}
      />,
    );

    // Inline citation chip; footer chips omitted when markers present.
    expect(screen.getByTestId("vault-citation-1")).toBeTruthy();
    expect(screen.getByText("Projects/react-notes.md")).toBeTruthy();
    fireEvent.click(screen.getByTestId("vault-citation-1"));
    expect(onCitationClick).toHaveBeenCalledWith("/Projects/react-notes.md");
  });

  /** Findings table fixture for ```table fence (lp-a79.12). */
  const FINDINGS_TABLE_FENCE = [
    "Here are the open findings:",
    "",
    "```table",
    JSON.stringify({
      version: 1,
      title: "Open findings",
      description: "Active issues for review",
      columns: [
        { key: "id", header: "ID", type: "text", widthWeight: 1 },
        { key: "severity", header: "Severity", type: "badge", align: "center" },
        { key: "owner", header: "Owner", type: "text" },
        { key: "doc", header: "Doc", type: "link" },
        { key: "ticket", header: "Ticket", type: "link" },
      ],
      rows: [
        {
          id: "F-12",
          severity: { kind: "badge", label: "High", tone: "error" },
          owner: "Alex",
          doc: {
            kind: "link",
            label: "runbook.md",
            href: "docs/runbooks/finding-f12.md",
            target: "vault",
          },
          ticket: {
            kind: "link",
            label: "LIN-204",
            href: "https://linear.app/example/issue/LIN-204",
            target: "external",
            openInNewTab: true,
          },
        },
        {
          id: "F-13",
          severity: { kind: "badge", label: "Low", tone: "success" },
          owner: "Sam",
          doc: {
            kind: "link",
            label: "notes.md",
            href: "projects/alpha/notes.md",
            target: "vault",
          },
          ticket: null,
        },
      ],
      options: { density: "compact", hasHover: true, dividers: "rows" },
    }),
    "```",
  ].join("\n");

  it("renders prose + ```table fence as PortalTableCard", () => {
    render(
      <ChatMessageContent
        content={FINDINGS_TABLE_FENCE}
        projectVaultPath="/home/u/Core"
        onCitationClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Here are the open findings:")).toBeTruthy();
    expect(screen.getByTestId("portal-table-card")).toBeTruthy();
    expect(screen.getByTestId("portal-table-title").textContent).toBe(
      "Open findings",
    );
    expect(screen.getByText("F-12")).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getAllByTestId("portal-table-badge").length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("table vault link invokes onCitationClick (same path as citations)", () => {
    const onCitationClick = vi.fn();
    render(
      <ChatMessageContent
        content={FINDINGS_TABLE_FENCE}
        projectVaultPath="/home/u/Core"
        onCitationClick={onCitationClick}
      />,
    );

    const vaultLinks = screen.getAllByTestId("portal-table-vault-link");
    expect(vaultLinks.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(vaultLinks[0]);
    expect(onCitationClick).toHaveBeenCalledTimes(1);
    const pathArg = onCitationClick.mock.calls[0][0] as string;
    expect(pathArg).toMatch(/finding-f12\.md/);
    expect(pathArg).toContain("Core");
  });

  it("table external links keep target=_blank and noopener", () => {
    render(
      <ChatMessageContent
        content={FINDINGS_TABLE_FENCE}
        onCitationClick={vi.fn()}
      />,
    );

    const externals = screen.getAllByTestId("portal-table-external-link");
    expect(externals.length).toBe(1);
    expect(externals[0].getAttribute("href")).toBe(
      "https://linear.app/example/issue/LIN-204",
    );
    expect(externals[0].getAttribute("target")).toBe("_blank");
    const rel = externals[0].getAttribute("rel") ?? "";
    expect(rel.split(/\s+/)).toEqual(
      expect.arrayContaining(["noopener", "noreferrer"]),
    );
  });

  it("invalid table fence shows error card without throwing", () => {
    const content = [
      "Broken table:",
      "",
      "```table",
      '{"version":1,"columns":"not-an-array"}',
      "```",
    ].join("\n");

    render(<ChatMessageContent content={content} />);

    expect(screen.getByTestId("table-spec-error-card")).toBeTruthy();
    expect(screen.queryByTestId("portal-table-card")).toBeNull();
  });

  it("plain code fences still render as code (not table card)", () => {
    const content = [
      "Example:",
      "",
      "```ts",
      "const x = 1;",
      "```",
    ].join("\n");

    const { container } = render(<ChatMessageContent content={content} />);

    expect(screen.queryByTestId("portal-table-card")).toBeNull();
    expect(screen.queryByTestId("table-spec-error-card")).toBeNull();
    // Default Astryx CodeBlock uses <pre>
    expect(container.querySelector("pre")).toBeTruthy();
    expect(container.textContent).toContain("const x = 1;");
  });

  it("```table-json alias renders PortalTableCard", () => {
    const content = [
      "```table-json",
      JSON.stringify({
        version: 1,
        columns: [{ key: "name", header: "Name" }],
        rows: [{ name: "Ada" }],
      }),
      "```",
    ].join("\n");

    render(<ChatMessageContent content={content} />);

    expect(screen.getByTestId("portal-table-card")).toBeTruthy();
    expect(screen.getByText("Ada")).toBeTruthy();
  });

  /** Bar chart fixture for ```chart fence (lp-a79.5). */
  const REVENUE_CHART_FENCE = [
    "Here is the Q1 comparison:",
    "",
    "```chart",
    JSON.stringify({
      version: 1,
      type: "bar",
      title: "Q1 revenue vs cost",
      description: "Monthly comparison",
      xKey: "month",
      series: [
        { key: "revenue", label: "Revenue" },
        { key: "cost", label: "Cost" },
      ],
      data: [
        { month: "Jan", revenue: 120, cost: 80 },
        { month: "Feb", revenue: 150, cost: 95 },
        { month: "Mar", revenue: 180, cost: 110 },
      ],
      options: { showLegend: true, height: 280 },
    }),
    "```",
  ].join("\n");

  it("renders prose + ```chart fence as PortalChartCard", async () => {
    render(<ChatMessageContent content={REVENUE_CHART_FENCE} />);

    expect(screen.getByText("Here is the Q1 comparison:")).toBeTruthy();
    // lp-uxy.11: default safe static chart (interactive is opt-in).
    const card = await screen.findByTestId("chat-safe-chart-card");
    expect(card).toBeTruthy();
    expect(screen.getByTestId("chat-static-chart-table")).toBeTruthy();
    expect(screen.getByText("Q1 revenue vs cost")).toBeTruthy();
  });

  it("plain code fences still render as code (not chart card)", () => {
    const content = [
      "Example:",
      "",
      "```ts",
      "const x = 1;",
      "```",
    ].join("\n");

    const { container } = render(<ChatMessageContent content={content} />);

    expect(screen.queryByTestId("portal-chart-card")).toBeNull();
    expect(screen.queryByTestId("chart-spec-error-card")).toBeNull();
    expect(container.querySelector("pre")).toBeTruthy();
    expect(container.textContent).toContain("const x = 1;");
  });

  it("invalid chart fence shows error card without throwing", () => {
    const content = [
      "Broken chart:",
      "",
      "```chart",
      '{"version":1,"type":"bar","data":"not-an-array"}',
      "```",
    ].join("\n");

    render(<ChatMessageContent content={content} />);

    expect(screen.getByTestId("chart-spec-error-card")).toBeTruthy();
    expect(screen.queryByTestId("portal-chart-card")).toBeNull();
  });

  it("```chart-json alias renders PortalChartCard", async () => {
    const content = [
      "```chart-json",
      JSON.stringify({
        version: 1,
        type: "pie",
        title: "Share",
        nameKey: "name",
        valueKey: "value",
        data: [
          { name: "A", value: 40 },
          { name: "B", value: 60 },
        ],
      }),
      "```",
    ].join("\n");

    render(<ChatMessageContent content={content} />);

    const card = await screen.findByTestId("chat-safe-chart-card");
    expect(card).toBeTruthy();
    expect(screen.getByText("Share")).toBeTruthy();
  });

  it("chart fence coexists with footer citations", async () => {
    const onCitationClick = vi.fn();
    render(
      <ChatMessageContent
        content={REVENUE_CHART_FENCE}
        citations={[{ path: "/Projects/A/README.md", title: "README.md" }]}
        onCitationClick={onCitationClick}
      />,
    );

    expect(await screen.findByTestId("chat-safe-chart-card")).toBeTruthy();
    expect(screen.getByTestId("vault-citation-1")).toBeTruthy();
    fireEvent.click(screen.getByTestId("vault-citation-1"));
    expect(onCitationClick).toHaveBeenCalledWith("/Projects/A/README.md");
  });
});

/**
 * Streaming skeleton is exercised at the code-block layer: Markdown's
 * useStreamingText delays fence content and trimStreamingArtifacts can hide
 * unclosed fences. Unit-test the factory with isStreaming closed over.
 */
describe("createChatRichCodeBlock (table streaming / errors)", () => {
  afterEach(() => {
    cleanup();
  });

  it("incomplete table JSON while streaming shows skeleton, not error", () => {
    const RichCode = createChatRichCodeBlock({ isStreaming: true });
    render(
      <RichCode
        code={'{"version":1,"title":"Partial",'}
        language="table"
      />,
    );

    expect(screen.getByTestId("rich-spec-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("table-spec-error-card")).toBeNull();
    expect(screen.queryByTestId("portal-table-card")).toBeNull();
  });

  it("incomplete table JSON when not streaming shows error card", () => {
    const RichCode = createChatRichCodeBlock({ isStreaming: false });
    render(
      <RichCode
        code={'{"version":1,"title":"Partial",'}
        language="table"
      />,
    );

    expect(screen.getByTestId("table-spec-error-card")).toBeTruthy();
    expect(screen.queryByTestId("rich-spec-skeleton")).toBeNull();
  });

  it("valid table code renders PortalTableCard via factory", () => {
    const onVaultPath = vi.fn();
    const RichCode = createChatRichCodeBlock({
      isStreaming: false,
      projectVaultPath: "/home/u/Core",
      onVaultPath,
    });
    const code = JSON.stringify({
      version: 1,
      columns: [{ key: "doc", header: "Doc", type: "link" }],
      rows: [
        {
          doc: {
            kind: "link",
            label: "runbook.md",
            href: "docs/runbooks/finding-f12.md",
            target: "vault",
          },
        },
      ],
    });

    render(<RichCode code={code} language="table" />);

    expect(screen.getByTestId("portal-table-card")).toBeTruthy();
    fireEvent.click(screen.getByTestId("portal-table-vault-link"));
    expect(onVaultPath).toHaveBeenCalledTimes(1);
    expect(onVaultPath.mock.calls[0][0]).toMatch(/finding-f12\.md/);
  });

  it("incomplete chart JSON while streaming shows skeleton, not error", () => {
    const RichCode = createChatRichCodeBlock({ isStreaming: true });
    render(
      <RichCode
        code={'{"version":1,"type":"bar","title":"Partial",'}
        language="chart"
      />,
    );

    expect(screen.getByTestId("rich-spec-skeleton")).toBeTruthy();
    expect(
      screen.getByTestId("rich-spec-skeleton").getAttribute("data-skeleton-kind"),
    ).toBe("chart");
    // Chart-height skeleton (no layout jump when chart mounts).
    const skeleton = screen.getByTestId("rich-spec-skeleton");
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByTestId("chart-spec-error-card")).toBeNull();
    expect(screen.queryByTestId("portal-chart-card")).toBeNull();
    // No red-flash error while streaming incomplete fence.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("incomplete chart JSON when not streaming shows error card", () => {
    const RichCode = createChatRichCodeBlock({ isStreaming: false });
    render(
      <RichCode
        code={'{"version":1,"type":"bar","title":"Partial",'}
        language="chart"
      />,
    );

    expect(screen.getByTestId("chart-spec-error-card")).toBeTruthy();
    expect(
      screen.getByTestId("chart-spec-error-card").getAttribute("data-error-code"),
    ).toBe("json");
    expect(screen.queryByTestId("rich-spec-skeleton")).toBeNull();
  });

  it("valid chart code renders PortalChartCard via factory", async () => {
    const RichCode = createChatRichCodeBlock({ isStreaming: false });
    const code = JSON.stringify({
      version: 1,
      type: "bar",
      title: "Factory bar",
      xKey: "month",
      series: [{ key: "v", label: "V" }],
      data: [
        { month: "Jan", v: 1 },
        { month: "Feb", v: 2 },
      ],
    });

    render(<RichCode code={code} language="chart" />);

    expect(await screen.findByTestId("chat-safe-chart-card")).toBeTruthy();
    expect(screen.getByText("Factory bar")).toBeTruthy();
  });

  it("streaming incomplete → final valid transitions to PortalChartCard", async () => {
    let streaming = true;
    const RichCode = createChatRichCodeBlock({
      getOptions: () => ({ isStreaming: streaming }),
    });

    const { rerender } = render(
      <RichCode
        code={'{"version":1,"type":"bar","title":"Live",'}
        language="chart"
      />,
    );
    expect(screen.getByTestId("rich-spec-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("portal-chart-card")).toBeNull();
    expect(screen.queryByTestId("chart-spec-error-card")).toBeNull();

    const finalCode = JSON.stringify({
      version: 1,
      type: "bar",
      title: "Live",
      xKey: "month",
      series: [{ key: "v", label: "V" }],
      data: [
        { month: "Jan", v: 10 },
        { month: "Feb", v: 20 },
      ],
    });
    streaming = false;
    rerender(<RichCode code={finalCode} language="chart" />);

    expect(screen.queryByTestId("chart-spec-error-card")).toBeNull();
    expect(await screen.findByTestId("chat-safe-chart-card")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByTestId("rich-spec-skeleton")).toBeNull();
    });
    expect(screen.getByText("Live")).toBeTruthy();
  });

  it("streaming incomplete → final invalid shows ChartSpecErrorCard (no blank)", () => {
    let streaming = true;
    const RichCode = createChatRichCodeBlock({
      getOptions: () => ({ isStreaming: streaming }),
    });

    const incomplete = '{"version":1,"type":"bar","title":"Broken",';
    const { rerender } = render(
      <RichCode code={incomplete} language="chart" />,
    );
    expect(screen.getByTestId("rich-spec-skeleton")).toBeTruthy();

    // Complete JSON object that fails schema (missing required fields).
    const finalInvalid = JSON.stringify({
      version: 1,
      type: "bar",
      title: "Broken",
      data: [{ month: "Jan" }],
    });
    streaming = false;
    rerender(<RichCode code={finalInvalid} language="chart" />);

    expect(screen.queryByTestId("rich-spec-skeleton")).toBeNull();
    expect(screen.queryByTestId("portal-chart-card")).toBeNull();
    const err = screen.getByTestId("chart-spec-error-card");
    expect(err).toBeTruthy();
    expect(err.getAttribute("data-error-code")).toBe("schema");
    // Optional debug raw is present and collapsed.
    expect(screen.getByTestId("chart-spec-error-card-raw-details")).toBeTruthy();
    // Body is not blank — message has user-safe copy.
    expect(
      screen.getByTestId("chart-spec-error-card-message").textContent?.trim()
        .length,
    ).toBeGreaterThan(0);
  });

  it("over-limit chart shows clear limits error card", () => {
    const RichCode = createChatRichCodeBlock({ isStreaming: false });
    const data = Array.from({ length: 65 }, (_, i) => ({
      month: `M${i}`,
      v: i,
    }));
    const code = JSON.stringify({
      version: 1,
      type: "bar",
      title: "Too many rows",
      xKey: "month",
      series: [{ key: "v", label: "V" }],
      data,
    });

    render(<RichCode code={code} language="chart" />);

    const err = screen.getByTestId("chart-spec-error-card");
    expect(err.getAttribute("data-error-code")).toBe("limits");
    expect(screen.getByTestId("chart-spec-error-card-title").textContent).toBe(
      "Chart too large",
    );
    expect(
      screen.getByTestId("chart-spec-error-card-message").textContent,
    ).toMatch(/64/);
    expect(screen.queryByTestId("portal-chart-card")).toBeNull();
  });

  it("empty chart fence while streaming shows skeleton, not blank body", () => {
    const RichCode = createChatRichCodeBlock({ isStreaming: true });
    render(<RichCode code="   " language="chart" />);

    expect(screen.getByTestId("rich-spec-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("chart-spec-error-card")).toBeNull();
  });

  it("rapid successive chart updates do not throw (timeline crash guard)", async () => {
    let streaming = true;
    const RichCode = createChatRichCodeBlock({
      getOptions: () => ({ isStreaming: streaming }),
    });

    const partials = [
      '{"version":1',
      '{"version":1,"type":"bar"',
      '{"version":1,"type":"bar","title":"Q1",',
      '{"version":1,"type":"bar","title":"Q1","xKey":"m","series":[{"key":"v"}]',
    ];
    const final = JSON.stringify({
      version: 1,
      type: "bar",
      title: "Q1",
      xKey: "m",
      series: [{ key: "v", label: "V" }],
      data: [
        { m: "Jan", v: 1 },
        { m: "Feb", v: 2 },
      ],
    });

    const { rerender } = render(
      <RichCode code={partials[0]!} language="chart" />,
    );
    for (const p of partials.slice(1)) {
      expect(() => {
        rerender(<RichCode code={p!} language="chart" />);
      }).not.toThrow();
      expect(screen.getByTestId("rich-spec-skeleton")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    }
    streaming = false;
    expect(() => {
      rerender(<RichCode code={final} language="chart" />);
    }).not.toThrow();
    expect(await screen.findByTestId("chat-safe-chart-card")).toBeTruthy();
  });
});
