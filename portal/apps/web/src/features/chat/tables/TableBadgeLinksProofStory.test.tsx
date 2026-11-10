/**
 * Component + fixture proof for lp-a79.13 (table badge + vault/external links).
 * Browser paint / screenshot: `?story=table-badge-links` + ui-testing.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  FINDINGS_EXTERNAL_HREF,
  FINDINGS_EXTERNAL_LABEL,
  FINDINGS_PROJECT_VAULT_PATH,
  FINDINGS_VAULT_HREF,
  FINDINGS_VAULT_RESOLVED_PATH,
} from "./findingsTableFixture.js";
import { TableBadgeLinksProofStory } from "./TableBadgeLinksProofStory.js";

afterEach(() => {
  cleanup();
});

describe("TableBadgeLinksProofStory", () => {
  it("renders Astryx table in chat with High badge and links (not plain GFM)", () => {
    render(<TableBadgeLinksProofStory />);

    expect(screen.getByTestId("table-badge-links-proof-story")).toBeTruthy();
    expect(screen.getByTestId("table-badge-links-assistant-bubble")).toBeTruthy();

    // PortalTableCard (Astryx Table path), not a raw Markdown <table> dump alone.
    const card = screen.getByTestId("portal-table-card");
    expect(card).toBeTruthy();
    expect(card.getAttribute("data-table-density")).toBe("compact");
    expect(screen.getByTestId("portal-table-title").textContent).toBe(
      "Open findings",
    );

    // Table role from Astryx Table
    const table = within(card).getByRole("table");
    expect(table).toBeTruthy();
    expect(within(table).getByText("ID")).toBeTruthy();
    expect(within(table).getByText("Severity")).toBeTruthy();
    expect(within(table).getByText("F-12")).toBeTruthy();

    // Categorical badge (scope to card — story prose also mentions "High")
    const badges = screen.getAllByTestId("portal-table-badge");
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(within(card).getByText("High")).toBeTruthy();
    expect(within(card).getByText("Low")).toBeTruthy();
    expect(badges.some((b) => b.textContent === "High")).toBe(true);

    // Vault + external links
    const vaultLinks = screen.getAllByTestId("portal-table-vault-link");
    expect(vaultLinks.length).toBeGreaterThanOrEqual(1);
    expect(vaultLinks[0].textContent).toMatch(/runbook\.md/);

    const externals = screen.getAllByTestId("portal-table-external-link");
    expect(externals.length).toBe(1);
    expect(externals[0].getAttribute("href")).toBe(FINDINGS_EXTERNAL_HREF);
    expect(externals[0].getAttribute("target")).toBe("_blank");
    expect(externals[0].textContent).toContain(FINDINGS_EXTERNAL_LABEL);

    // Documented vault path panel
    expect(screen.getByTestId("table-badge-links-vault-href").textContent).toBe(
      FINDINGS_VAULT_HREF,
    );
    expect(
      screen.getByTestId("table-badge-links-vault-resolved").textContent,
    ).toBe(FINDINGS_VAULT_RESOLVED_PATH);
    expect(
      screen.getByTestId("table-badge-links-project-path").textContent,
    ).toBe(FINDINGS_PROJECT_VAULT_PATH);
  });

  it("vault link click records resolved path (document-pane open path)", () => {
    render(<TableBadgeLinksProofStory />);

    const vaultLinks = screen.getAllByTestId("portal-table-vault-link");
    fireEvent.click(vaultLinks[0]);

    const last = screen.getByTestId("table-badge-links-last-vault-click");
    expect(last.textContent).toMatch(/finding-f12\.md/);
    expect(last.textContent).toContain("Core");
    // Matches documented resolved path for the High-row vault doc.
    expect(last.textContent).toBe(FINDINGS_VAULT_RESOLVED_PATH);

    const log = screen.getByTestId("table-badge-links-vault-log");
    expect(log.getAttribute("data-vault-click-count")).toBe("1");
  });
});
