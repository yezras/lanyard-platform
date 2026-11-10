import { GlobeAltIcon } from "@heroicons/react/24/outline";
import { ChatTokenizedText } from "@astryxdesign/core/Chat";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Markdown, type MarkdownSource } from "@astryxdesign/core/Markdown";
import { Token } from "@astryxdesign/core/Token";
import { useMemo, useRef, type MouseEvent } from "react";

import type { ChatTimelineCitation } from "../../hooks/useChatEvents.js";
import { fileTypeIcon } from "../vault/fileTypeIcon.js";
import {
  citationDisplayTitle,
  isVaultPathHref,
  resolveVaultCitationClickPath,
  resolveVaultCitationPath,
} from "../vault/vaultPaths.js";

import {
  createChatRichCodeBlock,
  type ChatRichCodeBlockOptions,
} from "./ChatRichCodeBlock.js";
import { tokensFromMessageContent } from "./chatComposerTriggers.js";
import { isHttpUrl, webCitationTitle } from "./webCitations.js";

export {
  isVaultPathHref,
  resolveVaultCitationClickPath,
  resolveVaultCitationPath,
  vaultPathFromHref,
} from "../vault/vaultPaths.js";

type ChatMessageContentProps = {
  content: string;
  isStreaming?: boolean;
  /** When true, render / @ # tokens as badges instead of Markdown. */
  tokenized?: boolean;
  citations?: ChatTimelineCitation[];
  onCitationClick?: (path: string) => void;
  onSourceSelect?: (sources: { url: string; title?: string }[], selectedUrl?: string) => void;
  /**
   * Hermes project working directory (absolute). Relative citation paths are
   * resolved against this so vault tree deep-links match.
   */
  projectVaultPath?: string | null;
};

/** Whether markdown already contains Astryx citation markers for sources. */
function contentHasCitationMarkers(
  content: string,
  sourceKeys: string[],
): boolean {
  if (!sourceKeys.length) {
    return false;
  }
  for (const key of sourceKeys) {
    // [key] or 【key】
    if (
      content.includes(`[${key}]`) ||
      content.includes(`【${key}】`)
    ) {
      return true;
    }
  }
  return false;
}

function citationsToSources(
  citations: ChatTimelineCitation[],
  projectVaultPath?: string | null,
): Record<string, MarkdownSource> {
  const sources: Record<string, MarkdownSource> = {};
  citations.forEach((citation, index) => {
    const numKey = String(index + 1);
    if (isHttpUrl(citation.path)) {
      const url = citation.path.trim();
      sources[numKey] = {
        title: webCitationTitle(url, citation.title),
        // External source — exact URL so chips/links open the real site.
        url,
      };
      return;
    }
    const resolved = resolveVaultCitationPath(citation.path, projectVaultPath);
    sources[numKey] = {
      title: citationDisplayTitle(
        citation.path,
        projectVaultPath,
        citation.title,
      ),
      // Vault path only for our custom chip onClick (not browser navigation).
      url: resolved,
    };
  });
  return sources;
}

function activateVaultCitation(
  path: string,
  onCitationClick?: (path: string) => void,
  projectVaultPath?: string | null,
): void {
  // Web URLs open externally — never route through vault document pane.
  if (isHttpUrl(path)) {
    openWebCitationUrl(path);
    return;
  }
  const resolved = resolveVaultCitationClickPath(path, projectVaultPath);
  if (!resolved || !onCitationClick) {
    return;
  }
  onCitationClick(resolved);
}

function openWebCitationUrl(url: string): void {
  const trimmed = url.trim();
  if (!isHttpUrl(trimmed)) {
    return;
  }
  if (typeof window !== "undefined" && typeof window.open === "function") {
    window.open(trimmed, "_blank", "noopener,noreferrer");
  }
}

/**
 * Vault citation chip: file-type Heroicon + label.
 * Click routes via onCitationClick (chat document pane by default, lp-5q6.14).
 * Uses Token (not Astryx Citation) so icons are real React icons and clicks
 * never navigate the browser to a raw vault path.
 */
function VaultCitationChip({
  number,
  path,
  title,
  onActivate,
}: {
  number: number;
  path: string;
  title: string;
  onActivate?: (path: string) => void;
}) {
  const label = title || path.split("/").filter(Boolean).pop() || path;
  return (
    <Token
      size="sm"
      label={label}
      description={`Citation ${number}: ${label}`}
      icon={<Icon icon={fileTypeIcon(path)} size="xsm" />}
      onClick={
        onActivate
          ? (event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              onActivate(path);
            }
          : undefined
      }
      data-testid={`vault-citation-${number}`}
    />
  );
}

/**
 * Web citation chip: globe icon + hostname/title; opens exact source URL
 * in a new tab (lp-95v.5). Distinct test id from vault chips for QA.
 * Wrapper span carries data-citation-url because Token may not forward
 * arbitrary data-* attributes.
 *
 * When `snippet` is present (lp-uxy.7 structured search/crawl), render a
 * richer card (title + host + excerpt) instead of a compact Token.
 */
function WebCitationChip({
  number,
  url,
  title,
  snippet,
  onSourceSelect,
}: {
  number: number;
  url: string;
  title: string;
  snippet?: string;
  onSourceSelect?: (url: string) => void;
}) {
  const label = title || webCitationTitle(url);
  const host = webCitationTitle(url);
  const faviconUrl = (() => {
    try {
      const h = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(h)}&sz=64`;
    } catch {
      return "";
    }
  })();
  const onActivate = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (onSourceSelect) {
      onSourceSelect(url);
      return;
    }
    openWebCitationUrl(url);
  };
  const excerpt = snippet?.trim();

  // Rich card when host stamped a snippet / content summary (lp-uxy.7).
  if (excerpt) {
    return (
      <span
        className="web-citation-rich"
        data-testid={`web-citation-${number}`}
        data-citation-url={url}
        data-citation-rich="true"
      >
        <button
          type="button"
          className="web-citation-rich-inner"
          onClick={onActivate}
          aria-label={`Source ${number}: ${label}`}
          title={url}
        >
          <span className="web-citation-rich-title-row">
            {faviconUrl ? (
              <img
                src={faviconUrl}
                alt=""
                width={16}
                height={16}
                style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0 }}
                loading="lazy"
                onError={(e) => { const t = e.currentTarget as HTMLImageElement; t.style.display = "none"; }}
              />
            ) : (
              <Icon icon={GlobeAltIcon} size="xsm" />
            )}
            <span className="web-citation-rich-title">{label}</span>
          </span>
          {host !== label ? (
            <span className="web-citation-rich-host">{host}</span>
          ) : (
            <span className="web-citation-rich-host">{url}</span>
          )}
          <span className="web-citation-rich-snippet">{excerpt}</span>
        </button>
      </span>
    );
  }

  return (
    <span
      data-testid={`web-citation-${number}`}
      data-citation-url={url}
      style={{ display: "inline-flex" }}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (onSourceSelect) onSourceSelect(url);
          else openWebCitationUrl(url);
        }
      }}
      role="link"
      tabIndex={0}
    >
      <Token
        size="sm"
        label={label}
        description={`Source ${number}: ${url}`}
        icon={
          faviconUrl ? (
            <img
              src={faviconUrl}
              alt=""
              width={16}
              height={16}
              style={{ width: 16, height: 16, borderRadius: 3 }}
              loading="lazy"
              onError={(e) => { const t = e.currentTarget as HTMLImageElement; t.style.display = "none"; }}
            />
          ) : (
            <Icon icon={GlobeAltIcon} size="xsm" />
          )
        }
        onClick={onActivate}
      />
    </span>
  );
}

function CitationChip({
  number,
  path,
  title,
  onActivate,
}: {
  number: number;
  path: string;
  title: string;
  onActivate?: (path: string) => void;
}) {
  if (isHttpUrl(path)) {
    return (
      <WebCitationChip
        number={number}
        url={path.trim()}
        title={title || webCitationTitle(path)}
        snippet={undefined}
      />
    );
  }
  return (
    <VaultCitationChip
      number={number}
      path={path}
      title={title}
      onActivate={onActivate}
    />
  );
}

export function ChatMessageContent({
  content,
  isStreaming = false,
  tokenized = false,
  citations,
  onCitationClick,
  onSourceSelect,
  projectVaultPath,
}: ChatMessageContentProps) {
  const sources =
    citations?.length
      ? citationsToSources(citations, projectVaultPath)
      : undefined;
  const sourceKeys = sources ? Object.keys(sources) : [];
  const hasInlineMarkers =
    sources != null && contentHasCitationMarkers(content, sourceKeys);

  const onLinkClick = onCitationClick
    ? (href: string, event: MouseEvent) => {
        // True URLs: only same-origin vault paths. Relatives: project join first
        // (vaultPathFromHref would invent leading / and skip project root).
        const looksVault =
          isVaultPathHref(href) ||
          Boolean(projectVaultPath && href.trim() && !/^https?:\/\//i.test(href));
        if (!looksVault) {
          return undefined;
        }
        const resolved = resolveVaultCitationClickPath(href, projectVaultPath);
        if (!resolved) {
          return undefined;
        }
        event.preventDefault();
        onCitationClick(resolved);
        return false;
      }
    : undefined;

  // Live options for rich fences (lp-a79.6). Read via getOptions so the
  // Markdown `components.code` factory identity stays stable when only
  // isStreaming flips — avoids remounting valid charts/tables mid-turn.
  // Tokenized composer preview skips Markdown entirely — no chart fences there.
  const richCodeOptsRef = useRef<ChatRichCodeBlockOptions>({
    isStreaming,
    onVaultPath: onCitationClick,
    projectVaultPath,
  });
  richCodeOptsRef.current = {
    isStreaming,
    onVaultPath: onCitationClick,
    projectVaultPath,
  };

  // Deps intentionally exclude isStreaming and sources object identity —
  // use citations length / presence instead.
  const hasSources = Boolean(citations?.length);
  const markdownComponents = useMemo(() => {
    const RichCode = createChatRichCodeBlock({
      getOptions: () => richCodeOptsRef.current,
      // Static fallbacks for first paint before getOptions runs.
      isStreaming: richCodeOptsRef.current.isStreaming,
      onVaultPath: onCitationClick,
      projectVaultPath,
    });

    return {
      code: RichCode,
      ...(hasSources
        ? {
            citation: ({
              source,
              number,
            }: {
              source: MarkdownSource;
              number: number;
              variant?: "label" | "number";
            }) => {
              const path = source.url ?? "";
              const title = source.title ?? path;
              if (isHttpUrl(path)) {
                return (
                  <WebCitationChip
                    number={number}
                    url={path}
                    title={title}
                    onSourceSelect={
                      onSourceSelect
                        ? (url) => {
                            const allWeb = (citations ?? [])
                              .filter((c) => /^https?:\/\//i.test(c.path?.trim() ?? ""))
                              .map((c) => ({ url: c.path.trim(), title: c.title }));
                            onSourceSelect(allWeb, url);
                          }
                        : undefined
                    }
                  />
                );
              }
              return (
                <CitationChip
                  number={number}
                  path={path}
                  title={title}
                  onActivate={
                    onCitationClick
                      ? (p) =>
                          activateVaultCitation(
                            p,
                            onCitationClick,
                            projectVaultPath,
                          )
                      : undefined
                  }
                />
              );
            },
          }
        : {}),
    };
  }, [onCitationClick, onSourceSelect, projectVaultPath, hasSources, citations]);

  const body = tokenized ? (
    <ChatTokenizedText tokens={tokensFromMessageContent(content)}>
      {content}
    </ChatTokenizedText>
  ) : (
    <Markdown
      headingLevelStart={3}
      isStreaming={isStreaming}
      autolink="gfm"
      contentWidth="100%"
      sources={sources}
      citationStyle="label"
      onLinkClick={onLinkClick}
      components={markdownComponents}
    >
      {content}
    </Markdown>
  );

  // Footer chips when we have citations but no inline markers in the prose.
  const showFooterChips = Boolean(citations?.length) && !hasInlineMarkers;

  if (!showFooterChips) {
    return body;
  }

  // When finished, cap footer cited sources at 3 +N same as header ( streaming vs finished unified )
  const footerCitations = !isStreaming && citations!.length > 3 ? citations!.slice(0, 3) : citations!;
  const overflowCount = !isStreaming ? citations!.length - footerCitations.length : 0;
  return (
    <>
      {body}
      <HStack gap={1} wrap="wrap" style={{ marginTop: "var(--spacing-2)" }}>
        {footerCitations.map((citation, index) => {
          if (isHttpUrl(citation.path)) {
            const url = citation.path.trim();
            return (
              <WebCitationChip
                key={`${url}-${index}`}
                number={index + 1}
                url={url}
                title={webCitationTitle(url, citation.title)}
                snippet={citation.snippet}
                onSourceSelect={
                  onSourceSelect
                    ? (u) => {
                        const allWeb = (citations ?? [])
                          .filter((c) => /^https?:\/\//i.test(c.path?.trim() ?? ""))
                          .map((c) => ({ url: c.path.trim(), title: c.title, snippet: c.snippet }));
                        onSourceSelect(allWeb, u);
                      }
                    : undefined
                }
              />
            );
          }
          const resolved = resolveVaultCitationPath(
            citation.path,
            projectVaultPath,
          );
          const title = citationDisplayTitle(
            citation.path,
            projectVaultPath,
            citation.title,
          );
          return (
            <VaultCitationChip
              key={`${citation.path}-${index}`}
              number={index + 1}
              path={resolved}
              title={title}
              onActivate={
                onCitationClick
                  ? (p) =>
                      activateVaultCitation(
                        p,
                        onCitationClick,
                        projectVaultPath,
                      )
                  : undefined
              }
            />
          );
        })}
        {overflowCount > 0 ? (
          <Token
            size="sm"
            label={`+${overflowCount}`}
            description={`${overflowCount} more sources — open shelf`}
            onClick={() => {
              if (onSourceSelect && citations) {
                const webSources = citations
                  .filter((c) => /^https?:\/\//i.test(c.path?.trim() ?? ""))
                  .map((c) => ({ url: c.path.trim(), title: c.title }));
                onSourceSelect(webSources);
              } else {
                try {
                  window.dispatchEvent(new CustomEvent("lanyard:open-sources-shelf"));
                } catch {}
              }
            }}
            data-testid="cited-sources-overflow"
          />
        ) : null}
      </HStack>
    </>
  );
}
