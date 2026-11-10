/**
 * Component tests for PortalTableCard (lp-a79.11).
 * Covers findings fixture, badge cells, vault + external links, degradation.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PortalTableCard } from "./PortalTableCard.js";
import { parseTableSpec } from "./parseTableSpec.js";
import {
  badgeVariantFromTone,
  renderTableCell,
} from "./renderTableCell.js";
import {
  inferLinkTarget,
  resolveTableLink,
} from "./resolveTableLink.js";
import type { TableSpecV1 } from "./types.js";

afterEach(() => {
  cleanup();
});

/** Findings example (badge + vault + external) — same fixture as parse tests. */
const FINDINGS_TABLE_JSON = JSON.stringify({
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
});

function findingsSpec(): TableSpecV1 {
  const result = parseTableSpec(FINDINGS_TABLE_JSON);
  if (!result.ok) {
    throw new Error(`fixture parse failed: ${result.error}`);
  }
  return result.spec;
}

describe("resolveTableLink", () => {
  it("infers external for http(s) when target is auto", () => {
    expect(inferLinkTarget("https://example.com")).toBe("external");
    expect(inferLinkTarget("docs/a.md")).toBe("vault");
  });

  it("defaults openInNewTab true for external links", () => {
    const resolved = resolveTableLink(
      "https://linear.app/example/issue/LIN-204",
      "external",
    );
    expect(resolved).toEqual({
      kind: "external",
      href: "https://linear.app/example/issue/LIN-204",
      openInNewTab: true,
    });
  });

  it("joins vault paths with projectVaultPath", () => {
    const resolved = resolveTableLink(
      "docs/runbooks/finding-f12.md",
      "vault",
      { projectVaultPath: "/home/u/Core" },
    );
    expect(resolved.kind).toBe("vault");
    if (resolved.kind !== "vault") return;
    expect(resolved.path).toContain("finding-f12.md");
    expect(resolved.path.startsWith("/home/u/Core") || resolved.path.includes("docs/")).toBe(
      true,
    );
  });

  it("rejects javascript: hrefs", () => {
    const resolved = resolveTableLink("javascript:alert(1)", "auto");
    expect(resolved.kind).toBe("invalid");
  });
});

describe("badgeVariantFromTone", () => {
  it("maps TableSpec tones to Badge variants (incl. accent → blue)", () => {
    expect(badgeVariantFromTone("neutral")).toBe("neutral");
    expect(badgeVariantFromTone("success")).toBe("success");
    expect(badgeVariantFromTone("warning")).toBe("warning");
    expect(badgeVariantFromTone("error")).toBe("error");
    expect(badgeVariantFromTone("info")).toBe("info");
    expect(badgeVariantFromTone("accent")).toBe("blue");
    expect(badgeVariantFromTone(undefined)).toBe("neutral");
  });
});

describe("PortalTableCard", () => {
  it("renders findings fixture via Astryx Table (no Markdown)", () => {
    const onVaultPath = vi.fn();
    render(
      <PortalTableCard
        spec={findingsSpec()}
        projectVaultPath="/home/u/Core"
        onVaultPath={onVaultPath}
      />,
    );

    const card = screen.getByTestId("portal-table-card");
    expect(card).toBeTruthy();
    expect(card.getAttribute("data-table-density")).toBe("compact");
    expect(screen.getByTestId("portal-table-title").textContent).toBe(
      "Open findings",
    );
    expect(screen.getByTestId("portal-table-description").textContent).toBe(
      "Active issues for review",
    );
    expect(screen.getByTestId("portal-table-scroll")).toBeTruthy();

    // Headers
    expect(screen.getByText("ID")).toBeTruthy();
    expect(screen.getByText("Severity")).toBeTruthy();
    expect(screen.getByText("Ticket")).toBeTruthy();

    // Scalar cells
    expect(screen.getByText("F-12")).toBeTruthy();
    expect(screen.getByText("Alex")).toBeTruthy();

    // Badge cells
    const badges = screen.getAllByTestId("portal-table-badge");
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText("Low")).toBeTruthy();
  });

  it("external links open new tab with noopener", () => {
    render(
      <PortalTableCard
        spec={findingsSpec()}
        onVaultPath={vi.fn()}
      />,
    );

    const externals = screen.getAllByTestId("portal-table-external-link");
    expect(externals.length).toBe(1);
    const external = externals[0];
    expect(external.getAttribute("href")).toBe(
      "https://linear.app/example/issue/LIN-204",
    );
    expect(external.getAttribute("target")).toBe("_blank");
    const rel = external.getAttribute("rel") ?? "";
    expect(rel.split(/\s+/)).toEqual(
      expect.arrayContaining(["noopener", "noreferrer"]),
    );
    expect(external.textContent).toContain("LIN-204");
  });

  it("vault links call onVaultPath and do not full-navigate", () => {
    const onVaultPath = vi.fn();
    render(
      <PortalTableCard
        spec={findingsSpec()}
        projectVaultPath="/home/u/Core"
        onVaultPath={onVaultPath}
      />,
    );

    const vaultLinks = screen.getAllByTestId("portal-table-vault-link");
    expect(vaultLinks.length).toBe(2);

    const first = vaultLinks[0];
    // No href → Link renders as button; never full-navigates.
    expect(first.getAttribute("href")).toBeNull();
    expect(first.tagName.toLowerCase()).toBe("button");

    fireEvent.click(first);
    expect(onVaultPath).toHaveBeenCalledTimes(1);
    const pathArg = onVaultPath.mock.calls[0][0] as string;
    expect(pathArg).toMatch(/finding-f12\.md/);
    // Joined under project root when provided.
    expect(pathArg).toContain("Core");
  });

  it("defaults density to compact when options omit density", () => {
    const result = parseTableSpec(
      JSON.stringify({
        version: 1,
        columns: [{ key: "name", header: "Name" }],
        rows: [{ name: "Ada" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    render(<PortalTableCard spec={result.spec} />);
    expect(
      screen.getByTestId("portal-table-card").getAttribute("data-table-density"),
    ).toBe("compact");
    expect(screen.getByText("Ada")).toBeTruthy();
  });

  it("degrades invalid / unknown cells to text without crashing", () => {
    const onVaultPath = vi.fn();
    // Bypass parser: construct a minimal valid-shaped spec with a bad rich cell.
    const spec = {
      version: 1 as const,
      columns: [
        { key: "a", header: "A" },
        { key: "b", header: "B", type: "badge" as const },
        { key: "c", header: "C", type: "link" as const },
      ],
      rows: [
        {
          a: null,
          // Unknown kind — render layer must not throw.
          b: { kind: "mystery", label: "x" } as unknown as never,
          c: {
            kind: "link" as const,
            label: "bad",
            href: "javascript:alert(1)",
            target: "external" as const,
          },
        },
      ],
    } as TableSpecV1;

    render(
      <PortalTableCard
        spec={spec}
        onVaultPath={onVaultPath}
      />,
    );

    expect(screen.getByTestId("portal-table-card")).toBeTruthy();
    // Null → em dash
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    // Disallowed javascript link degrades to label text (no external anchor).
    expect(screen.queryByTestId("portal-table-external-link")).toBeNull();
    expect(screen.getByText("bad")).toBeTruthy();
  });
});

describe("renderTableCell (unit)", () => {
  it("renders badge with tone mapping", () => {
    const { container } = render(
      <>
        {renderTableCell(
          { kind: "badge", label: "High", tone: "error" },
          {},
        )}
      </>,
    );
    expect(within(container).getByTestId("portal-table-badge")).toBeTruthy();
    expect(within(container).getByText("High")).toBeTruthy();
  });
});
