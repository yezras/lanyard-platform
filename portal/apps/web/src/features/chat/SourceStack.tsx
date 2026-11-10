import { motion } from "motion/react";

import { Source, SourceContent, SourceTrigger } from "../../components/prompt-kit/source.js";

export type StackedSource = {
  url: string;
  title: string;
  description?: string;
  provider?: string;
};

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function SourceStack({
  sources,
  max = 4,
  onOpen,
  onSourceSelect,
  onOverflowSelect,
}: {
  sources: StackedSource[];
  max?: number;
  onOpen?: (url: string) => void;
  onSourceSelect?: (url: string) => void;
  onOverflowSelect?: () => void;
}) {
  const visible = sources.slice(0, max);
  const overflow = sources.length - visible.length;
  if (visible.length === 0) return null;

  return (
    <Source>
      <div
        className="source-stack"
        data-testid="source-stack"
        aria-label={`${sources.length} sources`}
      >
        <div className="source-stack-icons" data-testid="source-stack-icons">
          {visible.map((s, idx) => {
            const host = hostFromUrl(s.url);
            return (
              <span
                key={`${s.url}-${idx}`}
                className="source-stack-icon"
                style={{ zIndex: visible.length - idx } as React.CSSProperties}
                data-testid={`source-stack-icon-${idx}`}
              >
                <SourceTrigger
                  url={s.url}
                  title={s.title}
                  showFavicon
                  faviconFallback={host.slice(0, 1).toUpperCase()}
                  onSelect={onSourceSelect ?? onOpen}
                />
                <SourceContent
                  title={s.title || host}
                  description={s.description}
                  url={s.url}
                  provider={s.provider}
                />
              </span>
            );
          })}
        {overflow > 0 ? (
          <button
            type="button"
            className="source-stack-overflow"
            data-testid="source-stack-overflow"
            aria-label={`${overflow} more sources`}
            onClick={() => {
              if (onOverflowSelect) onOverflowSelect();
              else if (onSourceSelect) onSourceSelect("");
              else if (onOpen) onOpen(sources[0]?.url ?? "");
              else {
                try { window.dispatchEvent(new CustomEvent("lanyard:open-sources-shelf")); } catch {}
              }
            }}
            title={`Show ${overflow} more sources`}
          >
            +{overflow}
          </button>
        ) : null}
      </div>
      <span className="source-stack-label" data-testid="source-stack-label">
        {sources.length === 1 ? "1 source" : `${sources.length} sources`}
      </span>
      </div>
    </Source>
  );
}

export function SourceStackAnimated({
  sources,
  max,
  onOpen,
}: {
  sources: StackedSource[];
  max?: number;
  onOpen?: (url: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <SourceStack sources={sources} max={max} onOpen={onOpen} />
    </motion.div>
  );
}
