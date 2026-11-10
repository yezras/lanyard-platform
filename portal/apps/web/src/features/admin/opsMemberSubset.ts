/**
 * Member subset UI model (lp-hdzm.23).
 *
 * Allowlist is tool names on (tenant, connector). First-class CLIs are
 * grant on/off only. Unclassified tools never appear.
 */

import type {
  MemberSubsetGroup,
  MemberSubsetKind,
  MemberSubsetTool,
} from "../../api/opsTenantAdmin.js";

export type { MemberSubsetGroup, MemberSubsetKind, MemberSubsetTool };

export const MEMBER_SUBSET_GROUP_LABELS: Record<MemberSubsetGroup, string> = {
  read: "Read",
  write: "Write",
};

export function groupedMemberTools(tools: readonly MemberSubsetTool[]): {
  read: MemberSubsetTool[];
  write: MemberSubsetTool[];
} {
  return {
    read: tools.filter((tool) => tool.group === "read"),
    write: tools.filter((tool) => tool.group === "write"),
  };
}

export function toggleAllowedTool(
  allowed: readonly string[],
  name: string,
  on: boolean,
): string[] {
  if (on) {
    return allowed.includes(name) ? [...allowed] : [...allowed, name];
  }
  return allowed.filter((item) => item !== name);
}

export function showsMemberSubset(kind: MemberSubsetKind, toolCount: number): boolean {
  return kind === "allowlist" && toolCount > 0;
}
