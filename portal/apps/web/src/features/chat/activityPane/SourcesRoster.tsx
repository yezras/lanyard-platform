import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";

import type { StackedSource } from "../SourceStack.js";

function faviconUrlFor(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (!host) return "";
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return "";
  }
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function SourcesRoster({
  sources,
  selectedUrl,
  onBack,
  onSelect,
}: {
  sources: StackedSource[];
  selectedUrl?: string;
  onBack: () => void;
  onSelect?: (url: string) => void;
}) {
  if (sources.length === 0) {
    return (
      <VStack gap={2} data-testid="sources-roster-empty">
        <Text type="body" color="secondary">No sources for this turn.</Text>
      </VStack>
    );
  }

  const selected = selectedUrl ? sources.find((s) => s.url === selectedUrl) ?? null : null;

  if (selected) {
    const host = hostFromUrl(selected.url);
    const fav = faviconUrlFor(selected.url);
    return (
      <VStack gap={3} data-testid="sources-detail" data-source-url={selected.url}>
        <Button
          label="Back to sources"
          variant="ghost"
          size="sm"
          isIconOnly
          icon={<Icon icon={ArrowLeftIcon} size="sm" />}
          onClick={onBack}
        />
        <VStack gap={2}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <img
              src={fav}
              alt=""
              width={32}
              height={32}
              style={{ width: 32, height: 32, borderRadius: 6, border: "1px solid var(--color-border, #e5e7eb)", flexShrink: 0, objectFit: "cover" }}
              loading="lazy"
              onError={(e) => { const t = e.currentTarget as HTMLImageElement; t.style.display = "none"; }}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <Text type="label" weight="semibold" maxLines={2}>
                {selected.title || host}
              </Text>
              <Text type="supporting" color="secondary" maxLines={1}>
                {host}
                {selected.provider ? ` · ${selected.provider}` : ""}
              </Text>
              <Text type="supporting" color="secondary" style={{ wordBreak: "break-all", marginTop: 4 }}>
                {selected.url}
              </Text>
            </div>
          </div>
          {selected.description ? (
            <Text type="body" color="secondary">
              {selected.description}
            </Text>
          ) : null}
          <Button
            label="Open source"
            variant="primary"
            size="sm"
            onClick={() => window.open(selected.url, "_blank", "noopener")}
          >
            Open
          </Button>
        </VStack>
      </VStack>
    );
  }

  return (
    <VStack gap={3} data-testid="sources-roster">
      <Text type="supporting" color="secondary">
        {sources.length} {sources.length === 1 ? "source" : "sources"} · Click to view
      </Text>
      <VStack gap={2} style={{ width: "100%" }}>
        {sources.map((s) => {
          const host = hostFromUrl(s.url);
          const fav = faviconUrlFor(s.url);
          return (
            <button
              key={s.url}
              type="button"
              data-testid="sources-roster-row"
              data-source-url={s.url}
              onClick={() => onSelect?.(s.url)}
              style={{
                display: "flex",
                gap: 10,
                padding: 10,
                border: "1px solid var(--color-border, #e5e7eb)",
                borderRadius: 8,
                background: "var(--color-background-surface, #fff)",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
              }}
            >
              <img
                src={fav}
                alt=""
                width={32}
                height={32}
                style={{ width: 32, height: 32, borderRadius: 6, flexShrink: 0, objectFit: "cover", border: "1px solid var(--color-border, #e5e7eb)" }}
                loading="lazy"
                onError={(e) => { const t = e.currentTarget as HTMLImageElement; t.style.display = "none"; }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text type="label" weight="semibold" maxLines={1}>
                  {s.title || host}
                </Text>
                <Text type="supporting" color="secondary" maxLines={1}>
                  {s.url}
                </Text>
                {s.description ? (
                  <Text type="supporting" color="secondary" maxLines={2} style={{ marginTop: 2 }}>
                    {s.description}
                  </Text>
                ) : null}
              </div>
            </button>
          );
        })}
      </VStack>
    </VStack>
  );
}
