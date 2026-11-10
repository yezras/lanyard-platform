/**
 * User-safe error surface for invalid ```table / ```table-json fences.
 * Bead: lp-a79.12
 */

import type { CSSProperties, ReactNode } from "react";

import { Banner } from "@astryxdesign/core/Banner";

import type { ParseTableSpecErr } from "./parseTableSpec.js";

export type TableSpecErrorCardProps = {
  /** Short user-safe message from parseTableSpec. */
  error: string;
  /** Parse error class (json | schema | limits | empty). */
  code?: ParseTableSpecErr["code"];
};

const wrapperStyle: CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
};

/**
 * Compact error card when a table fence fails parse/schema after stream complete.
 * Does not throw; safe inside the chat timeline.
 */
export function TableSpecErrorCard({
  error,
  code,
}: TableSpecErrorCardProps): ReactNode {
  const description =
    code === "json"
      ? "The table JSON could not be parsed."
      : code === "limits"
        ? "The table exceeds supported size limits."
        : code === "empty"
          ? "The table fence was empty."
          : "The table specification is not valid.";

  return (
    <div
      style={wrapperStyle}
      data-testid="table-spec-error-card"
      data-error-code={code ?? "schema"}
      role="alert"
    >
      <Banner
        status="warning"
        title="Could not render table"
        description={`${description} ${error}`.trim()}
        container="section"
      />
    </div>
  );
}
