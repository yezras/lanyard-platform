/**
 * Composer model intelligence dropdown (lp-uxy.8).
 * Placed in ChatComposer `sendActions` (left of send).
 */

import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";

import {
  labelForSelection,
  MODEL_INTELLIGENCE_OPTIONS,
  type ModelIntelligenceSelection,
  type ModelIntelligenceTier,
} from "./modelIntelligence.js";

export type ModelIntelligenceSelectorProps = {
  selection: ModelIntelligenceSelection;
  /** When selection is Auto, last/known effective tier for indicator. */
  effectiveTier?: ModelIntelligenceTier | null;
  onChange: (selection: ModelIntelligenceSelection) => void;
  isDisabled?: boolean;
  disabledReason?: string;
  /** Resolved model id for the current selection (tooltip). */
  resolvedModelId?: string | null;
};

export function ModelIntelligenceSelector({
  selection,
  effectiveTier,
  onChange,
  isDisabled = false,
  disabledReason,
  resolvedModelId,
}: ModelIntelligenceSelectorProps) {
  const label = labelForSelection(
    selection,
    selection === "auto" ? effectiveTier : null,
  );
  const modelHint = resolvedModelId?.trim()
    ? ` → ${resolvedModelId.trim()}`
    : "";
  const title = isDisabled
    ? (disabledReason ?? "Model selection unavailable")
    : selection === "auto"
      ? `Auto routing${modelHint}`
      : `${label}${modelHint}`;

  return (
    <span
      data-testid="model-intelligence-selector"
      data-selection={selection}
      data-effective-tier={
        selection === "auto" && effectiveTier ? effectiveTier : selection
      }
      data-model={resolvedModelId?.trim() || ""}
      title={title}
    >
      <DropdownMenu
        hasChevron
        button={{
          label,
          variant: "ghost",
          size: "sm",
          isDisabled,
          "aria-label": `Model intelligence: ${label}`,
        }}
        items={MODEL_INTELLIGENCE_OPTIONS.map((option) => ({
          label:
            option.id === selection ? `✓ ${option.label}` : option.label,
          onClick: () => {
            if (!isDisabled) {
              onChange(option.id);
            }
          },
          isDisabled,
        }))}
      />
    </span>
  );
}
