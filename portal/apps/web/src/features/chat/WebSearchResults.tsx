/**
 * Expandable structured web search / Firecrawl result cards (lp-uxy.7).
 *
 * Rendered inside ChatToolCalls resultDetail when a web_search /
 * firecrawl_* / x_search tool completes with parseable results.
 * Final-answer citation chips remain in ChatMessageContent.
 */

import { GlobeAltIcon } from "@heroicons/react/24/outline";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import type { MouseEvent } from "react";

import {
  isHttpUrl,
  type WebSearchResult,
  webCitationTitle,
} from "./webCitations.js";

function openUrl(url: string): void {
  const trimmed = url.trim();
  if (!isHttpUrl(trimmed)) {
    return;
  }
  if (typeof window !== "undefined" && typeof window.open === "function") {
    window.open(trimmed, "_blank", "noopener,noreferrer");
  }
}

function providerLabel(provider?: string): string | null {
  if (!provider?.trim()) {
    return null;
  }
  const p = provider.trim().toLowerCase();
  if (p === "firecrawl") {
    return "Firecrawl";
  }
  if (p === "x" || p === "twitter") {
    return "X";
  }
  if (p === "tavily") {
    return "Tavily";
  }
  if (p === "brave") {
    return "Brave";
  }
  if (p === "web_search" || p === "web_browse") {
    return null;
  }
  return provider.trim();
}

export type WebSearchResultsListProps = {
  results: readonly WebSearchResult[];
  /** Optional heading above the list. */
  heading?: string;
  /** Test id prefix (default web-search-results). */
  testId?: string;
};

/**
 * Card list of structured search/crawl hits (title + snippet + openable URL).
 */
export function WebSearchResultsList({
  results,
  heading = "Search results",
  testId = "web-search-results",
}: WebSearchResultsListProps) {
  if (!results.length) {
    return null;
  }
  return (
    <div className="web-search-results" data-testid={testId}>
      <Text
        type="supporting"
        color="secondary"
        className="web-search-results-heading"
      >
        {heading}
        <span className="web-search-results-count"> ({results.length})</span>
      </Text>
      <ul className="web-search-results-list">
        {results.map((item, index) => {
          const title = item.title?.trim() || webCitationTitle(item.url);
          const host = webCitationTitle(item.url);
          const body = item.snippet?.trim() || item.content_summary?.trim();
          const badge = providerLabel(item.provider);
          const onActivate = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            openUrl(item.url);
          };
          return (
            <li
              key={`${item.url}-${index}`}
              className="web-search-result-card"
              data-testid={`${testId}-item-${index + 1}`}
              data-result-url={item.url}
            >
              <button
                type="button"
                className="web-search-result-card-button"
                onClick={onActivate}
                aria-label={`Open source ${index + 1}: ${title}`}
              >
                <span className="web-search-result-icon" aria-hidden>
                  <Icon icon={GlobeAltIcon} size="xsm" />
                </span>
                <span className="web-search-result-body">
                  <span className="web-search-result-title-row">
                    <span className="web-search-result-title">{title}</span>
                    {badge ? (
                      <span className="web-search-result-provider">{badge}</span>
                    ) : null}
                  </span>
                  <span className="web-search-result-host">{host}</span>
                  {body ? (
                    <span className="web-search-result-snippet">{body}</span>
                  ) : null}
                  {item.published_at ? (
                    <span className="web-search-result-date">
                      {item.published_at}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
