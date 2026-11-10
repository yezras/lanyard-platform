/**
 * Offline findings TableSpec fixture (badge High + vault doc + external ticket).
 *
 * Shared by PortalTableCard / ChatMessageContent tests and the E2E proof story
 * (lp-a79.13). Prefer this over duplicating JSON in multiple files.
 */

import type { TableSpecV1 } from "./types.js";

/** Project root used when joining relative vault table links. */
export const FINDINGS_PROJECT_VAULT_PATH = "/home/u/Core";

/**
 * Vault-relative href from the High-severity finding row.
 * After join: `${FINDINGS_PROJECT_VAULT_PATH}/docs/runbooks/finding-f12.md`
 */
export const FINDINGS_VAULT_HREF = "docs/runbooks/finding-f12.md";

/** Documented expected path after project join (vault link path for evidence). */
export const FINDINGS_VAULT_RESOLVED_PATH =
  `${FINDINGS_PROJECT_VAULT_PATH}/${FINDINGS_VAULT_HREF}`;

/** External ticket on the High-severity row. */
export const FINDINGS_EXTERNAL_HREF =
  "https://linear.app/example/issue/LIN-204";

export const FINDINGS_EXTERNAL_LABEL = "LIN-204";

/** Findings TableSpec object (version 1). */
export const FINDINGS_TABLE_SPEC: TableSpecV1 = {
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
        href: FINDINGS_VAULT_HREF,
        target: "vault",
      },
      ticket: {
        kind: "link",
        label: FINDINGS_EXTERNAL_LABEL,
        href: FINDINGS_EXTERNAL_HREF,
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
};

/** JSON body for ```table fences. */
export const FINDINGS_TABLE_JSON = JSON.stringify(FINDINGS_TABLE_SPEC);

/**
 * Assistant markdown with prose + ```table fence (chat timeline path).
 */
export const FINDINGS_TABLE_MARKDOWN = [
  "Here are the open findings:",
  "",
  "```table",
  FINDINGS_TABLE_JSON,
  "```",
].join("\n");
