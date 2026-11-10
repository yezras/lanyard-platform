import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { XMarkIcon, GlobeAltIcon } from "@heroicons/react/24/outline";

import type { StackedSource } from "./SourceStack.js";

export function SourcesShelf({
  sources,
  open,
  onClose,
}: {
  sources: StackedSource[];
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      data-testid="sources-shelf"
      role="dialog"
      aria-label="Sources"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: 380,
        height: "100vh",
        background: "var(--color-background-surface, #fff)",
        borderLeft: "1px solid var(--color-border, #e5e7eb)",
        boxShadow: "-4px 0 12px rgba(15,23,42,0.08)",
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border, #e5e7eb)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text type="label" weight="semibold">
          Sources · {sources.length}
        </Text>
        <Button
          label="Close"
          variant="ghost"
          size="sm"
          isIconOnly
          icon={<Icon icon={XMarkIcon} size="sm" />}
          onClick={onClose}
        />
      </div>
      <div style={{ overflowY: "auto", flex: 1, padding: 12 }}>
        <VStack gap={3}>
          {sources.map((s, idx) => (
            <button
              key={`${s.url}-${idx}`}
              type="button"
              data-testid={`sources-shelf-item-${idx}`}
              data-source-url={s.url}
              onClick={() => window.open(s.url, "_blank", "noopener")}
              style={{
                textAlign: "left",
                border: "1px solid var(--color-border, #e5e7eb)",
                borderRadius: 8,
                padding: 10,
                background: "var(--color-background-surface, #fff)",
                cursor: "pointer",
                width: "100%",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <Icon icon={GlobeAltIcon} size="sm" color="secondary" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text type="label" weight="semibold" maxLines={2}>
                    {s.title || s.url}
                  </Text>
                  <Text type="supporting" color="secondary" maxLines={1}>
                    {(() => {
                      try {
                        return new URL(s.url).hostname.replace(/^www\./, "");
                      } catch {
                        return s.url;
                      }
                    })()}
                    {s.provider ? ` · ${s.provider}` : ""}
                  </Text>
                  {s.description ? (
                    <Text type="supporting" color="secondary" maxLines={3} style={{ marginTop: 4 }}>
                      {s.description}
                    </Text>
                  ) : null}
                </div>
              </div>
            </button>
          ))}
        </VStack>
      </div>
    </div>
  );
}
