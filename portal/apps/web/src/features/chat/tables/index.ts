/**
 * Chat tables — TableSpec v1 types, parse, and PortalTableCard render.
 * Beads: lp-a79.10 (types/parse), lp-a79.11 (PortalTableCard),
 * lp-a79.12 (fence wire-up / TableSpecErrorCard), lp-a79.13 (E2E proof).
 */

export {
  FINDINGS_EXTERNAL_HREF,
  FINDINGS_EXTERNAL_LABEL,
  FINDINGS_PROJECT_VAULT_PATH,
  FINDINGS_TABLE_JSON,
  FINDINGS_TABLE_MARKDOWN,
  FINDINGS_TABLE_SPEC,
  FINDINGS_VAULT_HREF,
  FINDINGS_VAULT_RESOLVED_PATH,
} from "./findingsTableFixture.js";

export {
  TableBadgeLinksProofStory,
} from "./TableBadgeLinksProofStory.js";

export {
  TABLE_BADGE_TONES,
  TABLE_COLUMN_ALIGNS,
  TABLE_COLUMN_TYPES,
  TABLE_SPEC_LIMITS,
  type TableBadgeToneV1,
  type TableCellV1,
  type TableColumnAlignV1,
  type TableColumnTypeV1,
  type TableColumnV1,
  type TableOptionsV1,
  type TableRichCellV1,
  type TableRowV1,
  type TableScalarCellV1,
  type TableSpecV1,
  type TableSpecVersion,
} from "./types.js";

export {
  badgeToneFromLabel,
  isAllowedTableHref,
  parseTableSpec,
  type ParseTableSpecErr,
  type ParseTableSpecOk,
  type ParseTableSpecResult,
} from "./parseTableSpec.js";

export {
  inferLinkTarget,
  resolveTableLink,
  type ResolveTableLinkOptions,
  type ResolvedTableLink,
  type ResolvedTableLinkExternal,
  type ResolvedTableLinkInvalid,
  type ResolvedTableLinkVault,
} from "./resolveTableLink.js";

export {
  badgeVariantFromTone,
  renderTableCell,
  type RenderTableCellContext,
} from "./renderTableCell.js";

export {
  PortalTableCard,
  buildPortalTableColumns,
  injectPortalTableRows,
  type PortalTableCardProps,
  type PortalTableRow,
} from "./PortalTableCard.js";

export {
  TableSpecErrorCard,
  type TableSpecErrorCardProps,
} from "./TableSpecErrorCard.js";
