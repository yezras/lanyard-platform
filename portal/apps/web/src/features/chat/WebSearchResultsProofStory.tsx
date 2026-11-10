/**
 * Auth-free story: structured web search / Firecrawl results + rich citation
 * cards (lp-uxy.7).
 *
 * Mounted with `?story=web-search-results`.
 *
 * Covers:
 * 1. ChatToolCalls-style expandable search result cards (title + snippet + URL)
 * 2. Firecrawl scrape content_summary card
 * 3. Final answer rich web citation chips that open exact source URLs
 * 4. Cost-gate honesty: fixture-only — no live FIRECRAWL_API_KEY calls
 *
 * No BFF / login / live gateway / paid Firecrawl required for Playwright.
 */

import { useMemo, type CSSProperties } from "react";

import { ChatToolCalls } from "@astryxdesign/core/Chat";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type { ChatTimelineCitation } from "../../hooks/useChatEvents.js";

import "./chat.css";
import { ChatMessageContent } from "./ChatMessageContent.js";
import type { WebSearchResult } from "./webCitations.js";
import { WebSearchResultsList } from "./WebSearchResults.js";

/** Fixture structured results (no live network). */
export const FIXTURE_SEARCH_RESULTS: WebSearchResult[] = [
  {
    url: "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
    title: "2026 FIFA World Cup",
    snippet:
      "The 2026 FIFA World Cup is the 23rd FIFA World Cup tournament, jointly hosted by Canada, Mexico, and the United States.",
    published_at: "2026-01-15",
    provider: "firecrawl",
  },
  {
    url: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026",
    title: "FIFA World Cup 2026",
    snippet: "Official FIFA hub for the 2026 tournament: schedule, venues, news.",
    provider: "firecrawl",
  },
  {
    url: "https://www.bbc.com/sport/football/world-cup",
    title: "World Cup — BBC Sport",
    snippet: "Latest World Cup news, results and analysis from BBC Sport.",
    provider: "web_search",
  },
];

export const FIXTURE_SCRAPE_RESULT: WebSearchResult = {
  url: "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
  title: "2026 FIFA World Cup — Wikipedia",
  content_summary:
    "The 2026 FIFA World Cup will be the first to feature 48 teams. Matches will be played across 16 host cities in three countries.",
  provider: "firecrawl",
};

export const FIXTURE_X_RESULTS: WebSearchResult[] = [
  {
    url: "https://x.com/FIFAcom/status/0000000001",
    title: "FIFA on X",
    snippet: "Official tournament updates and venue announcements.",
    provider: "x",
  },
];

export const SEEDED_ASSISTANT_CONTENT = [
  "**Seeded assistant reply** (lp-uxy.7 web search upgrade).",
  "",
  "Spain are among the favourites for the 2026 FIFA World Cup, which will be",
  "the first 48-team tournament and is co-hosted by Canada, Mexico, and the US.",
  "",
  "Sources cited below open the exact external URL (no vault pane).",
].join("\n");

export const SEEDED_WEB_CITATIONS: ChatTimelineCitation[] = [
  {
    path: FIXTURE_SEARCH_RESULTS[0]!.url,
    title: FIXTURE_SEARCH_RESULTS[0]!.title,
    snippet: FIXTURE_SEARCH_RESULTS[0]!.snippet,
  },
  {
    path: FIXTURE_SEARCH_RESULTS[1]!.url,
    title: FIXTURE_SEARCH_RESULTS[1]!.title,
    snippet: FIXTURE_SEARCH_RESULTS[1]!.snippet,
  },
  {
    path: FIXTURE_SCRAPE_RESULT.url,
    title: FIXTURE_SCRAPE_RESULT.title,
    snippet: FIXTURE_SCRAPE_RESULT.content_summary,
  },
];

const rootStyle: CSSProperties = {
  height: "100dvh",
  width: "100%",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  overflow: "auto",
  background: "var(--color-background-body, #fafafa)",
  padding: "var(--spacing-6, 1.5rem)",
  boxSizing: "border-box",
  gap: "var(--spacing-4, 1rem)",
};

const panelStyle: CSSProperties = {
  border: "1px solid var(--color-border, #e5e7eb)",
  borderRadius: 12,
  background: "var(--color-background-surface, #fff)",
  padding: "12px 16px",
  boxSizing: "border-box",
  maxWidth: 720,
};

const metaStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-secondary, #64748b)",
  marginBottom: 8,
};

export function WebSearchResultsProofStory() {
  const toolCalls = useMemo(
    () => [
      {
        key: "fc-search-1",
        name: "Searching the web",
        status: "complete" as const,
        target: "2026 FIFA World Cup hosts",
        duration: "1.2s",
        resultDetail: (
          <div data-testid="chat-tool-call-advanced">
            <Text type="supporting" color="secondary">
              firecrawl_search
            </Text>
            <WebSearchResultsList
              results={FIXTURE_SEARCH_RESULTS}
              heading="Search results"
            />
          </div>
        ),
      },
      {
        key: "fc-scrape-1",
        name: "Browsing the web",
        status: "complete" as const,
        target: FIXTURE_SCRAPE_RESULT.url,
        duration: "0.8s",
        resultDetail: (
          <div data-testid="chat-tool-call-advanced">
            <Text type="supporting" color="secondary">
              firecrawl_scrape
            </Text>
            <WebSearchResultsList
              results={[FIXTURE_SCRAPE_RESULT]}
              heading="Page content"
            />
          </div>
        ),
      },
      {
        key: "x-search-1",
        name: "Searching the web",
        status: "complete" as const,
        target: "FIFA World Cup",
        duration: "0.4s",
        resultDetail: (
          <div data-testid="chat-tool-call-advanced">
            <Text type="supporting" color="secondary">
              x_search
            </Text>
            <WebSearchResultsList
              results={FIXTURE_X_RESULTS}
              heading="Search results"
            />
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div
      style={rootStyle}
      data-testid="web-search-results-proof-story"
      data-firecrawl-live="false"
      data-cost-gated="true"
    >
      <VStack gap={2} style={{ maxWidth: 720 }}>
        <Heading level={1}>lp-uxy.7 — Web search / Firecrawl proof</Heading>
        <Text type="supporting" color="secondary">
          Fixture-only structured results (title + snippet + openable URL). No
          live <code>FIRECRAWL_API_KEY</code> / paid Firecrawl calls. Cost-gated
          pilot: set the env secret only when intentionally enabling live crawl.
        </Text>
      </VStack>

      <section style={panelStyle} data-testid="web-search-tool-panel">
        <div style={metaStyle}>
          Tool rows · firecrawl_search / firecrawl_scrape / x_search (fixture)
        </div>
        <ChatToolCalls calls={toolCalls} />
      </section>

      <section style={panelStyle} data-testid="web-search-results-panel">
        <div style={metaStyle}>
          Expandable structured results (always-visible fixture strip)
        </div>
        <WebSearchResultsList
          results={FIXTURE_SEARCH_RESULTS}
          heading="Search results"
        />
        <WebSearchResultsList
          results={[FIXTURE_SCRAPE_RESULT]}
          heading="Page content"
          testId="web-search-scrape-results"
        />
      </section>

      <section style={panelStyle} data-testid="web-search-answer-panel">
        <div style={metaStyle}>
          Final answer · rich web citation cards (open external URL)
        </div>
        <ChatMessageContent
          content={SEEDED_ASSISTANT_CONTENT}
          citations={SEEDED_WEB_CITATIONS}
        />
      </section>
    </div>
  );
}
