import { describe, expect, it } from "vitest";

import {
  bareToolNameKey,
  extractHttpUrlsFromText,
  formatWebSearchResultsText,
  inferWebSearchProvider,
  isFirecrawlScrapeToolName,
  isFirecrawlSearchToolName,
  isHttpUrl,
  isWebBrowseToolName,
  isWebSearchToolName,
  isXSearchToolName,
  parseWebSearchResults,
  stripTrailingUrlPunctuation,
  webCitationTitle,
  webCitationsFromContent,
  webCitationsFromSearchResults,
  webCitationsFromToolCalls,
  webCitationsFromUrls,
} from "./webCitations.js";

describe("isHttpUrl", () => {
  it("accepts absolute http(s) URLs", () => {
    expect(isHttpUrl("https://en.wikipedia.org/wiki/World_Cup")).toBe(true);
    expect(isHttpUrl("http://example.com/a")).toBe(true);
    expect(isHttpUrl("  https://fifa.com  ")).toBe(true);
  });

  it("rejects vault paths and non-http schemes", () => {
    expect(isHttpUrl("/Projects/a.md")).toBe(false);
    expect(isHttpUrl("README.md")).toBe(false);
    expect(isHttpUrl("file:///tmp/a.md")).toBe(false);
    expect(isHttpUrl("mailto:a@b.com")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
  });
});

describe("bareToolNameKey / web tool classifiers (lp-95v.5)", () => {
  it("strips MCP / server qualification", () => {
    expect(bareToolNameKey("server__web_search")).toBe("web_search");
    expect(bareToolNameKey("mcp__tavily__tavily_search")).toBe("tavily_search");
    expect(bareToolNameKey("brave__web_search")).toBe("web_search");
  });

  it("classifies web search tools including qualified names", () => {
    expect(isWebSearchToolName("web_search")).toBe(true);
    expect(isWebSearchToolName("search_web")).toBe(true);
    expect(isWebSearchToolName("google_search")).toBe(true);
    expect(isWebSearchToolName("tavily_search")).toBe(true);
    expect(isWebSearchToolName("server__web_search")).toBe(true);
    expect(isWebSearchToolName("mcp__brave__brave_search")).toBe(true);
    expect(isWebSearchToolName("websearch")).toBe(true);
  });

  it("does not treat file/code search as web search", () => {
    expect(isWebSearchToolName("vault_search")).toBe(false);
    expect(isWebSearchToolName("codebase_search")).toBe(false);
    expect(isWebSearchToolName("file_search")).toBe(false);
    expect(isWebSearchToolName("search_files")).toBe(false);
    expect(isWebSearchToolName("grep")).toBe(false);
    expect(isWebSearchToolName("bash")).toBe(false);
    expect(isWebSearchToolName("search")).toBe(false);
  });

  it("classifies browse / fetch tools", () => {
    expect(isWebBrowseToolName("web_fetch")).toBe(true);
    expect(isWebBrowseToolName("browse")).toBe(true);
    expect(isWebBrowseToolName("browse_page")).toBe(true);
    expect(isWebBrowseToolName("open_page")).toBe(true);
    expect(isWebBrowseToolName("fetch")).toBe(true);
    expect(isWebBrowseToolName("server__browse_page")).toBe(true);
    expect(isWebBrowseToolName("http_get")).toBe(true);
  });

  it("does not treat shell as browse", () => {
    expect(isWebBrowseToolName("bash")).toBe(false);
    expect(isWebBrowseToolName("run_terminal_command")).toBe(false);
    expect(isWebBrowseToolName("read_file")).toBe(false);
  });

  it("lp-uxy.7: classifies Firecrawl + X tool ids", () => {
    expect(isFirecrawlSearchToolName("firecrawl_search")).toBe(true);
    expect(isWebSearchToolName("firecrawl_search")).toBe(true);
    expect(isWebSearchToolName("mcp__firecrawl__firecrawl_search")).toBe(true);
    expect(isFirecrawlScrapeToolName("firecrawl_scrape")).toBe(true);
    expect(isWebBrowseToolName("firecrawl_scrape")).toBe(true);
    expect(isWebBrowseToolName("firecrawl_crawl")).toBe(true);
    expect(isWebBrowseToolName("firecrawl_map")).toBe(true);
    expect(isWebSearchToolName("firecrawl_scrape")).toBe(false);
    expect(isXSearchToolName("x_search")).toBe(true);
    expect(isWebSearchToolName("x_search")).toBe(true);
    expect(isWebSearchToolName("twitter_search")).toBe(true);
    expect(inferWebSearchProvider("firecrawl_scrape")).toBe("firecrawl");
    expect(inferWebSearchProvider("x_search")).toBe("x");
  });
});

describe("parseWebSearchResults / structured citations (lp-uxy.7)", () => {
  it("parses JSON results array with title + snippet", () => {
    const result = JSON.stringify({
      results: [
        {
          url: "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
          title: "2026 FIFA World Cup",
          snippet: "The 2026 FIFA World Cup is the 23rd FIFA World Cup.",
          published_at: "2026-01-15",
        },
        {
          link: "https://www.fifa.com/en/tournaments",
          title: "FIFA Tournaments",
          description: "Official FIFA tournament hub.",
        },
      ],
    });
    const parsed = parseWebSearchResults({
      result,
      provider: "firecrawl",
    });
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      url: "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
      title: "2026 FIFA World Cup",
      snippet: "The 2026 FIFA World Cup is the 23rd FIFA World Cup.",
      provider: "firecrawl",
    });
    expect(parsed[1]?.url).toBe("https://www.fifa.com/en/tournaments");
  });

  it("parses Firecrawl scrape page object (markdown → content_summary)", () => {
    const result = JSON.stringify({
      url: "https://example.com/docs/intro",
      title: "Intro docs",
      markdown:
        "# Intro\n\nWelcome to the product documentation for operators and agents.",
    });
    const parsed = parseWebSearchResults({
      result,
      provider: "firecrawl",
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.title).toBe("Intro docs");
    expect(parsed[0]?.content_summary).toMatch(/Welcome to the product/);
  });

  it("parses metadata.search_results without result body", () => {
    const parsed = parseWebSearchResults({
      metadata: {
        search_results: [
          {
            url: "https://x.com/status/1",
            title: "A post about Lanyard",
            snippet: "Shipping agent UX",
          },
        ],
      },
      provider: "x",
    });
    expect(parsed).toEqual([
      {
        url: "https://x.com/status/1",
        title: "A post about Lanyard",
        snippet: "Shipping agent UX",
        provider: "x",
      },
    ]);
  });

  it("parses numbered Title — url lines as fallback", () => {
    const result = [
      "1. 2026 FIFA World Cup — https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
      "The 23rd FIFA World Cup tournament.",
      "2. FIFA hub — https://www.fifa.com/en/tournaments",
    ].join("\n");
    const parsed = parseWebSearchResults({ result });
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.title).toBe("2026 FIFA World Cup");
    expect(parsed[0]?.snippet).toMatch(/23rd FIFA/);
  });

  it("webCitationsFromSearchResults prefer titles + snippets", () => {
    expect(
      webCitationsFromSearchResults([
        {
          url: "https://en.wikipedia.org/wiki/X",
          title: "Page X",
          snippet: "About X",
        },
      ]),
    ).toEqual([
      {
        path: "https://en.wikipedia.org/wiki/X",
        title: "Page X",
        snippet: "About X",
      },
    ]);
  });

  it("webCitationsFromToolCalls prefers structured Firecrawl JSON", () => {
    const citations = webCitationsFromToolCalls([
      {
        name: "Searching the web",
        technicalName: "firecrawl_search",
        result: JSON.stringify({
          results: [
            {
              url: "https://en.wikipedia.org/wiki/A",
              title: "Article A",
              snippet: "Summary of A",
            },
          ],
        }),
      },
      {
        name: "Browsing the web",
        technicalName: "firecrawl_scrape",
        result: JSON.stringify({
          url: "https://www.fifa.com/hub",
          title: "FIFA Hub",
          markdown: "Official tournament information and fixtures.",
        }),
      },
    ]);
    expect(citations).toEqual([
      {
        path: "https://en.wikipedia.org/wiki/A",
        title: "Article A",
        snippet: "Summary of A",
      },
      {
        path: "https://www.fifa.com/hub",
        title: "FIFA Hub",
        snippet: "Official tournament information and fixtures.",
      },
    ]);
  });

  it("formatWebSearchResultsText is stable for proof fixtures", () => {
    expect(
      formatWebSearchResultsText([
        {
          url: "https://example.com/a",
          title: "A",
          snippet: "About A",
        },
      ]),
    ).toBe("1. A\nhttps://example.com/a\nAbout A");
  });

  it("edge: metadata.search_results wins over bare result URLs", () => {
    const parsed = parseWebSearchResults({
      result: "See also https://noise.example/x",
      metadata: {
        search_results: [
          {
            url: "https://en.wikipedia.org/wiki/A",
            title: "Article A",
            snippet: "Structured snippet A",
          },
        ],
      },
      provider: "firecrawl",
    });
    expect(parsed).toEqual([
      {
        url: "https://en.wikipedia.org/wiki/A",
        title: "Article A",
        snippet: "Structured snippet A",
        provider: "firecrawl",
      },
    ]);
  });

  it("edge: metadata.search_results as JSON string", () => {
    const parsed = parseWebSearchResults({
      metadata: {
        search_results: JSON.stringify([
          {
            path: "https://example.com/via-path",
            title: "Via path alias",
            description: "Description alias for snippet",
          },
        ]),
      },
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      url: "https://example.com/via-path",
      title: "Via path alias",
      snippet: "Description alias for snippet",
    });
  });

  it("edge: does not treat wrapper url as a hit when results[] present", () => {
    const parsed = parseWebSearchResults({
      result: JSON.stringify({
        url: "https://wrapper.example/should-not-appear",
        title: "Wrapper",
        results: [
          {
            url: "https://en.wikipedia.org/wiki/B",
            title: "Article B",
            snippet: "About B",
          },
        ],
      }),
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.url).toBe("https://en.wikipedia.org/wiki/B");
    expect(parsed.map((r) => r.url)).not.toContain(
      "https://wrapper.example/should-not-appear",
    );
  });

  it("edge: Firecrawl scrape { data: { markdown, metadata } } unwrap", () => {
    const parsed = parseWebSearchResults({
      result: JSON.stringify({
        success: true,
        data: {
          markdown:
            "# Intro\n\nWelcome to the operator guide for Firecrawl scrape.",
          metadata: {
            title: "Operator guide",
            description: "Short og description",
            sourceURL: "https://docs.example.com/guide",
          },
        },
      }),
      provider: "firecrawl",
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      url: "https://docs.example.com/guide",
      title: "Operator guide",
      snippet: "Short og description",
      provider: "firecrawl",
    });
    expect(parsed[0]?.content_summary).toMatch(/Welcome to the operator/);
  });

  it("edge: source URL must not become provider badge", () => {
    const parsed = parseWebSearchResults({
      result: JSON.stringify({
        results: [
          {
            url: "https://example.com/a",
            title: "A",
            snippet: "About A",
            source: "https://example.com/a",
          },
        ],
      }),
      provider: "tavily",
    });
    expect(parsed[0]?.provider).toBe("tavily");
    expect(parsed[0]?.snippet).toBe("About A");
  });

  it("edge: empty metadata arrays fall through to result JSON", () => {
    const parsed = parseWebSearchResults({
      result: JSON.stringify({
        results: [
          {
            link: "https://example.com/from-result",
            title: "From result",
            summary: "Result body hit",
          },
        ],
      }),
      metadata: { search_results: [], web_results: [] },
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.url).toBe("https://example.com/from-result");
    expect(parsed[0]?.snippet).toBe("Result body hit");
  });

  it("edge: rejects non-http path and url-as-title", () => {
    const parsed = parseWebSearchResults({
      result: JSON.stringify({
        results: [
          { path: "/vault/note.md", title: "Vault", snippet: "nope" },
          {
            url: "https://example.com/ok",
            title: "https://example.com/ok",
            snippet: "https://example.com/ok",
          },
          {
            url: "https://example.com/good",
            title: "Good title",
            snippet: "Real snippet",
          },
        ],
      }),
    });
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.title).toBe("example.com");
    expect(parsed[0]?.snippet).toBeUndefined();
    expect(parsed[1]).toMatchObject({
      url: "https://example.com/good",
      title: "Good title",
      snippet: "Real snippet",
    });
  });

  it("webCitationsFromToolCalls uses metadata.search_results when result empty", () => {
    const citations = webCitationsFromToolCalls([
      {
        name: "Searching the web",
        technicalName: "firecrawl_search",
        metadata: {
          search_results: [
            {
              url: "https://en.wikipedia.org/wiki/Meta",
              title: "Meta only",
              snippet: "From metadata",
            },
          ],
        },
      },
    ]);
    expect(citations).toEqual([
      {
        path: "https://en.wikipedia.org/wiki/Meta",
        title: "Meta only",
        snippet: "From metadata",
      },
    ]);
  });
});

describe("webCitationTitle / extractHttpUrlsFromText", () => {
  it("prefers hostname for chip labels", () => {
    expect(
      webCitationTitle("https://en.wikipedia.org/wiki/2026_FIFA_World_Cup"),
    ).toBe("en.wikipedia.org");
    expect(webCitationTitle("https://www.fifa.com/en/tournaments")).toBe(
      "fifa.com",
    );
    expect(
      webCitationTitle("https://www.bbc.com/sport", "BBC World Cup"),
    ).toBe("BBC World Cup");
  });

  it("strips trailing punctuation from bare URLs", () => {
    expect(stripTrailingUrlPunctuation("https://example.com/a.")).toBe(
      "https://example.com/a",
    );
    expect(stripTrailingUrlPunctuation("https://example.com/a),")).toBe(
      "https://example.com/a",
    );
  });

  it("extracts markdown and bare URLs; skips fenced code", () => {
    const text = [
      "Sources",
      "[Wiki](https://en.wikipedia.org/wiki/2026_FIFA_World_Cup)",
      "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026",
      "https://www.bbc.com/sport/football/world-cup",
      "",
      "```",
      "curl https://example.com/should-not-appear",
      "```",
    ].join("\n");
    const urls = extractHttpUrlsFromText(text);
    expect(urls).toEqual([
      "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
      "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026",
      "https://www.bbc.com/sport/football/world-cup",
    ]);
    expect(urls).not.toContain("https://example.com/should-not-appear");
  });

  it("dedupes and respects max", () => {
    const text =
      "https://a.example/x https://a.example/x https://b.example/y";
    expect(extractHttpUrlsFromText(text, { max: 1 })).toEqual([
      "https://a.example/x",
    ]);
  });
});

describe("webCitationsFrom* helpers", () => {
  it("webCitationsFromUrls builds path=exact URL chips", () => {
    expect(
      webCitationsFromUrls([
        "https://en.wikipedia.org/wiki/X",
        "https://en.wikipedia.org/wiki/X",
        "not-a-url",
      ]),
    ).toEqual([
      {
        path: "https://en.wikipedia.org/wiki/X",
        title: "en.wikipedia.org",
      },
    ]);
  });

  it("webCitationsFromContent promotes Sources list URLs", () => {
    const content = [
      "Spain won 1-0.",
      "Sources",
      "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
      "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026",
    ].join("\n");
    expect(webCitationsFromContent(content)).toEqual([
      {
        path: "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
        title: "en.wikipedia.org",
      },
      {
        path: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026",
        title: "fifa.com",
      },
    ]);
  });

  it("webCitationsFromContent returns undefined when no URLs", () => {
    expect(webCitationsFromContent("no links here")).toBeUndefined();
    expect(webCitationsFromContent("")).toBeUndefined();
  });

  it("webCitationsFromToolCalls only uses web search/browse tools", () => {
    const citations = webCitationsFromToolCalls([
      {
        name: "Searching the web",
        technicalName: "web_search",
        result:
          "1. https://en.wikipedia.org/wiki/A\n2. https://www.bbc.com/sport",
      },
      {
        name: "Browsing the web",
        technicalName: "browse_page",
        target: "https://www.fifa.com/hub",
      },
      // Shell curl must not invent web citation chrome from argv alone.
      {
        name: "Running a command",
        technicalName: "bash",
        target: "curl https://evil.example/x",
        result: "https://evil.example/x",
      },
      {
        name: "Reading documents",
        technicalName: "read_file",
        target: "/Projects/a.md",
      },
    ]);
    expect(citations).toEqual([
      {
        path: "https://en.wikipedia.org/wiki/A",
        title: "en.wikipedia.org",
      },
      {
        path: "https://www.bbc.com/sport",
        title: "bbc.com",
      },
      {
        path: "https://www.fifa.com/hub",
        title: "fifa.com",
      },
    ]);
  });

  it("webCitationsFromToolCalls returns undefined without web tools", () => {
    expect(
      webCitationsFromToolCalls([
        {
          name: "Running a command",
          technicalName: "bash",
          result: "https://example.com",
        },
      ]),
    ).toBeUndefined();
  });
});
