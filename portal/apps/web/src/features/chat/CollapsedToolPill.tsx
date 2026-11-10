import { useState } from "react";
import { Text } from "@astryxdesign/core/Text";

export function CollapsedToolPill({
  sourceCount,
  agentCount,
  isStreaming,
  onExpand,
  expanded,
  children,
}: {
  sourceCount: number;
  agentCount: number;
  isStreaming: boolean;
  onExpand?: () => void;
  expanded?: boolean;
  children?: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(Boolean(expanded));
  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    onExpand?.();
  };

  const label = isStreaming
    ? agentCount > 0
      ? `Working with ${agentCount} agent${agentCount === 1 ? "" : "s"}`
      : sourceCount > 0
        ? `Searching · ${sourceCount} source${sourceCount === 1 ? "" : "s"}`
        : "Working"
    : agentCount > 0 || sourceCount > 0
      ? `Used ${sourceCount > 0 ? `${sourceCount} source${sourceCount === 1 ? "" : "s"}` : ""}${sourceCount > 0 && agentCount > 0 ? " · " : ""}${agentCount > 0 ? `${agentCount} agent${agentCount === 1 ? "" : "s"}` : ""}`
      : "Tools";

  return (
    <div className="collapsed-tool-pill" data-testid="collapsed-tool-pill">
      <button
        type="button"
        className="collapsed-tool-pill-trigger"
        data-testid="collapsed-tool-pill-trigger"
        aria-expanded={isOpen}
        onClick={toggle}
      >
        <span className="collapsed-tool-pill-dot" aria-hidden />
        <Text type="supporting" color="secondary">
          {label}
        </Text>
        <span className="collapsed-tool-pill-chevron" aria-hidden>
          {isOpen ? "▴" : "▾"}
        </span>
      </button>
      <div
        className="collapsed-tool-pill-content"
        data-testid="collapsed-tool-pill-content"
        hidden={!isOpen}
        style={{ display: isOpen ? "block" : "none" }}
      >
        {children}
      </div>
    </div>
  );
}
