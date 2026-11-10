import type { ReactNode } from "react";

/**
 * Minimal prompt-kit Source aggregation shim (lp-n6e).
 * Mirrors `prompt-kit` docs: <Source><SourceTrigger showFavicon /><SourceContent title description />
 * Implemented locally due to sandbox EROFS — API compatible with real library.
 */

export function Source({ children }: { children: ReactNode }) {
  return <div className="pk-source" data-testid="pk-source">{children}</div>;
}

export function SourceTrigger({
  url,
  title,
  showFavicon,
  faviconFallback,
  onSelect,
}: {
  url: string;
  title?: string;
  showFavicon?: boolean;
  faviconFallback?: string;
  onSelect?: (url: string) => void;
}) {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  })();
  const fav = showFavicon
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`
    : null;
  return (
    <button
      type="button"
      className="pk-source-trigger source-stack-icon"
      data-testid="pk-source-trigger"
      data-source-url={url}
      title={`${title ?? host} — ${host}`}
      aria-label={`Open source: ${title ?? host}`}
      onClick={() => {
        if (onSelect) onSelect(url);
        else window.open(url, "_blank", "noopener");
      }}
      style={{ zIndex: 1 } as React.CSSProperties}
    >
      <span className="source-stack-icon-inner">
        {fav ? (
          <img
            src={fav}
            alt=""
            width={16}
            height={16}
            className="source-stack-favicon"
            loading="lazy"
            onError={(e) => {
              const t = e.currentTarget as HTMLImageElement;
              t.style.display = "none";
            }}
          />
        ) : null}
        <span className="source-stack-favicon-fallback" aria-hidden>
          {(faviconFallback ?? host.slice(0, 1).toUpperCase())}
        </span>
      </span>
    </button>
  );
}

export function SourceContent({
  title,
  description,
  url,
  provider,
}: {
  title?: string;
  description?: string;
  url?: string;
  provider?: string;
}) {
  const host = (() => {
    try {
      return url ? new URL(url).hostname.replace(/^www\./, "") : "";
    } catch {
      return url ?? "";
    }
  })();
  return (
    <span className="source-stack-hover-card pk-source-content" role="tooltip">
      <span className="source-stack-hover-title">{title || host}</span>
      {description ? (
        <span className="source-stack-hover-desc">{description}</span>
      ) : null}
      <span className="source-stack-hover-url">{host}</span>
      {provider ? (
        <span className="source-stack-hover-provider">{provider}</span>
      ) : null}
    </span>
  );
}
