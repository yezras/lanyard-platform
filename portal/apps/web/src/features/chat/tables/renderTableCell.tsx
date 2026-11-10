/**
 * Map TableSpec cells → Astryx Text / Badge / Link (or button for vault).
 *
 * Bead: lp-a79.11
 */

import type { MouseEvent, ReactNode } from "react";

import { Badge, type BadgeVariant } from "@astryxdesign/core/Badge";
import { Link } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";

import {
  resolveTableLink,
  type ResolveTableLinkOptions,
} from "./resolveTableLink.js";
import type {
  TableBadgeToneV1,
  TableCellV1,
  TableColumnTypeV1,
  TableRichCellV1,
} from "./types.js";

export type RenderTableCellContext = ResolveTableLinkOptions & {
  /** Column role when cell is a bare scalar (fallback formatting). */
  columnType?: TableColumnTypeV1;
  /** Vault open handler — must not full-navigate. */
  onVaultPath?: (path: string) => void;
};

/**
 * Badge tone (TableSpec) → Astryx Badge variant.
 *
 * Mapping (document for agents / future StatusDot work):
 * - neutral → neutral
 * - success → success
 * - warning → warning
 * - error   → error
 * - info    → info
 * - accent  → blue  (closest brand accent; Badge has no "accent" token)
 *
 * Unknown tones fall back to neutral (parser already normalizes).
 * StatusDot is optional and not used when Badge is sufficient.
 */
export function badgeVariantFromTone(
  tone: TableBadgeToneV1 | undefined,
): BadgeVariant {
  switch (tone) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "error":
      return "error";
    case "info":
      return "info";
    case "accent":
      return "blue";
    case "neutral":
    default:
      return "neutral";
  }
}

function formatNumber(
  value: number,
  format: "plain" | "compact" | "percent" | undefined,
): string {
  if (format === "percent") {
    return `${value}%`;
  }
  if (format === "compact") {
    try {
      return new Intl.NumberFormat(undefined, {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function cellToDisplayString(cell: TableCellV1): string {
  if (cell === null) return "";
  if (typeof cell === "string") return cell;
  if (typeof cell === "number") return String(cell);
  if (typeof cell === "boolean") return cell ? "true" : "false";
  if (typeof cell === "object" && cell !== null && "kind" in cell) {
    const rich = cell as TableRichCellV1;
    if (rich.kind === "text") return rich.value;
    if (rich.kind === "number") return formatNumber(rich.value, rich.format);
    if (rich.kind === "badge") return rich.label;
    if (rich.kind === "link") return rich.label;
  }
  return "";
}

function renderDegradedText(value: string): ReactNode {
  if (!value) {
    return (
      <Text type="body" color="secondary">
        —
      </Text>
    );
  }
  return <Text type="body">{value}</Text>;
}

function renderLinkCell(
  cell: Extract<TableRichCellV1, { kind: "link" }>,
  context: RenderTableCellContext,
): ReactNode {
  const resolved = resolveTableLink(cell.href, cell.target ?? "auto", {
    projectVaultPath: context.projectVaultPath,
    openInNewTab: cell.openInNewTab,
  });

  if (resolved.kind === "invalid") {
    return renderDegradedText(cell.label || cell.href);
  }

  if (resolved.kind === "external") {
    // Astryx Link: isExternalLink sets target=_blank + rel=noopener noreferrer.
    // When openInNewTab is explicitly false, render a same-tab anchor.
    if (resolved.openInNewTab) {
      return (
        <Link
          href={resolved.href}
          isExternalLink
          isStandalone
          type="body"
          data-testid="portal-table-external-link"
        >
          {cell.label}
        </Link>
      );
    }
    return (
      <Link
        href={resolved.href}
        isStandalone
        type="body"
        data-testid="portal-table-external-link"
      >
        {cell.label}
      </Link>
    );
  }

  // Vault: button-styled Link (no href) so we never full-navigate.
  const handleClick = (event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    context.onVaultPath?.(resolved.path);
  };

  return (
    <Link
      isStandalone
      type="body"
      onClick={handleClick}
      data-testid="portal-table-vault-link"
      data-vault-path={resolved.path}
      aria-label={`Open ${cell.label} in vault`}
    >
      {cell.label}
    </Link>
  );
}

/**
 * Render a single TableSpec cell. Invalid / unknown shapes degrade to text.
 */
export function renderTableCell(
  cell: TableCellV1 | undefined,
  context: RenderTableCellContext = {},
): ReactNode {
  if (cell === undefined || cell === null) {
    return renderDegradedText("");
  }

  // Bare scalars — column type may already have been normalized by parseTableSpec,
  // but render layer still accepts scalars for resilience.
  if (typeof cell === "string") {
    if (context.columnType === "badge") {
      return (
        <Badge
          label={cell}
          variant={badgeVariantFromTone(undefined)}
          data-testid="portal-table-badge"
        />
      );
    }
    if (context.columnType === "link") {
      return renderLinkCell(
        { kind: "link", label: cell, href: cell, target: "auto" },
        context,
      );
    }
    return renderDegradedText(cell);
  }

  if (typeof cell === "number") {
    return <Text type="body">{formatNumber(cell, "plain")}</Text>;
  }

  if (typeof cell === "boolean") {
    return <Text type="body">{cell ? "true" : "false"}</Text>;
  }

  if (typeof cell !== "object") {
    return renderDegradedText(String(cell));
  }

  const rich = cell as TableRichCellV1;
  switch (rich.kind) {
    case "text":
      return renderDegradedText(rich.value);
    case "number":
      return <Text type="body">{formatNumber(rich.value, rich.format)}</Text>;
    case "badge":
      return (
        <Badge
          label={rich.label}
          variant={badgeVariantFromTone(rich.tone)}
          data-testid="portal-table-badge"
        />
      );
    case "link":
      return renderLinkCell(rich, context);
    default:
      // Unknown kind — degrade without crashing.
      return renderDegradedText(cellToDisplayString(cell));
  }
}
