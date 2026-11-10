/**
 * Web search / browse tool labeling + http(s) citation helpers (lp-95v.5).
 *
 * Decision: do **not** invent ChatToolCalls rows when the agent never called a
 * tool. When tools stream, label web_search / browse-like ids as
 * "Searching the web" / "Browsing the web". When exact source URLs only appear
 * in assistant prose (markdown links or bare URLs), promote them as footer
 * citation chips that open the real external URL — vault chips stay vault-only.
 */

/** True when a string is an absolute http(s) URL. */
export function isHttpUrl(value: string | null | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return /^https?:\/\/\S+/i.test(value.trim());
}

/**
 * Bare tool id for classification (`mcp__tavily__web_search` → `web_search`,
 * `server__browse_page` → `browse_page`). Human phrases are returned as-is.
 */
export function bareToolNameKey(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  const raw = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) {
    return "";
  }
  // Friendly UI labels keep spaces / long phrases out of bare-id heuristics.
  if (/\s/.test(value.trim()) || value.trim().length > 64) {
    return raw;
  }
  const sep = raw.lastIndexOf("__");
  if (sep >= 0 && sep < raw.length - 1) {
    return raw.slice(sep + 2);
  }
  return raw;
}

/** Known web-search tool ids (exact bare names). */
const WEB_SEARCH_EXACT = new Set([
  "web_search",
  "internet_search",
  "search_web",
  "bing_search",
  "google_search",
  "duckduckgo_search",
  "ddg_search",
  "brave_search",
  "tavily_search",
  "serp_search",
  "serper_search",
  "perplexity_search",
  "exa_search",
  "you_search",
  "websearch",
  "search_internet",
  // Firecrawl search + X (Twitter) search (lp-uxy.7)
  "firecrawl_search",
  "firecrawl_search_web",
  "x_search",
  "twitter_search",
  "x_keyword_search",
  "x_semantic_search",
]);

/** Known browse / fetch / scrape tool ids (exact bare names). */
const WEB_BROWSE_EXACT = new Set([
  "web_fetch",
  "web_browse",
  "browse",
  "browse_page",
  "open_page",
  "open_url",
  "fetch_url",
  "fetch_page",
  "http_get",
  "http_fetch",
  "read_url",
  "read_page",
  "scrape_url",
  "scrape_page",
  "crawl_url",
  // Firecrawl crawl / scrape / map / extract (lp-uxy.7)
  "firecrawl_scrape",
  "firecrawl_crawl",
  "firecrawl_map",
  "firecrawl_extract",
  "firecrawl",
]);
/**
 * True when a tool name (possibly MCP-qualified) is a web search tool.
 * File/code search tools (vault_search, codebase_search, …) return false.
 */
export function isWebSearchToolName(
  toolName: string | null | undefined,
): boolean {
  const bare = bareToolNameKey(toolName);
  if (!bare) {
    return false;
  }
  if (WEB_SEARCH_EXACT.has(bare)) {
    return true;
  }
  // Qualified ids that still contain web_search / search_web segments.
  if (bare.includes("web_search") || bare.includes("search_web")) {
    return true;
  }
  if (bare.includes("internet_search") || bare.includes("search_internet")) {
    return true;
  }
  // Provider_*_search patterns that are clearly web (not file/code).
  if (
    /^(google|bing|duckduckgo|ddg|brave|tavily|serp|serper|perplexity|exa|you|firecrawl|x|twitter)_search$/.test(
      bare,
    )
  ) {
    return true;
  }
  if (isFirecrawlSearchToolName(bare) || isXSearchToolName(bare)) {
    return true;
  }
  // "web" + "search" together, but not file/vault/code semantic search.
  if (bare.includes("web") && bare.includes("search")) {
    if (
      bare.includes("file") ||
      bare.includes("vault") ||
      bare.includes("code") ||
      bare.includes("codebase")
    ) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * True when a tool name is a Firecrawl search tool (not scrape/crawl).
 * Search variants count as web search; scrape/crawl count as browse.
 */
export function isFirecrawlSearchToolName(
  toolName: string | null | undefined,
): boolean {
  const bare = bareToolNameKey(toolName);
  if (!bare) {
    return false;
  }
  if (bare === "firecrawl_search" || bare === "firecrawl_search_web") {
    return true;
  }
  return bare.includes("firecrawl") && bare.includes("search");
}

/**
 * True when a tool name is a Firecrawl scrape / crawl / map / extract tool.
 */
export function isFirecrawlScrapeToolName(
  toolName: string | null | undefined,
): boolean {
  const bare = bareToolNameKey(toolName);
  if (!bare) {
    return false;
  }
  if (
    bare === "firecrawl" ||
    bare === "firecrawl_scrape" ||
    bare === "firecrawl_crawl" ||
    bare === "firecrawl_map" ||
    bare === "firecrawl_extract"
  ) {
    return true;
  }
  if (!bare.includes("firecrawl")) {
    return false;
  }
  // firecrawl_* that is not search
  return !bare.includes("search");
}

/** True when a tool name is X (Twitter) search. */
export function isXSearchToolName(
  toolName: string | null | undefined,
): boolean {
  const bare = bareToolNameKey(toolName);
  if (!bare) {
    return false;
  }
  if (
    bare === "x_search" ||
    bare === "twitter_search" ||
    bare === "x_keyword_search" ||
    bare === "x_semantic_search"
  ) {
    return true;
  }
  if (bare.startsWith("x_") && bare.includes("search")) {
    return true;
  }
  return bare.includes("twitter") && bare.includes("search");
}

/**
 * True when a tool name is a browse/fetch/open-url style web tool.
 * Bare `fetch` is included (common MCP name); file fetchers should use
 * more specific ids.
 */
export function isWebBrowseToolName(
  toolName: string | null | undefined,
): boolean {
  const bare = bareToolNameKey(toolName);
  if (!bare) {
    return false;
  }
  if (WEB_BROWSE_EXACT.has(bare)) {
    return true;
  }
  if (bare === "fetch" || bare === "get_url") {
    return true;
  }
  if (bare.includes("web_fetch") || bare.includes("web_browse")) {
    return true;
  }
  if (isFirecrawlScrapeToolName(bare)) {
    return true;
  }
  if (
    (bare.includes("browse") || bare.includes("fetch") || bare.includes("scrape")) &&
    (bare.includes("web") ||
      bare.includes("url") ||
      bare.includes("page") ||
      bare.includes("http"))
  ) {
    return true;
  }
  if (bare.startsWith("open_page") || bare.startsWith("browse_page")) {
    return true;
  }
  return false;
}

/** Display title for a web citation chip (hostname, else path segment). */
export function webCitationTitle(
  url: string,
  preferredTitle?: string | null,
): string {
  const preferred = preferredTitle?.trim();
  if (preferred && preferred !== url && !isHttpUrl(preferred)) {
    return preferred;
  }
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./i, "");
    if (host) {
      return host;
    }
  } catch {
    // fall through
  }
  const cleaned = url.trim().replace(/\/+$/, "");
  const segment = cleaned.split("/").filter(Boolean).pop();
  return segment || cleaned || url;
}

/** Strip common trailing punctuation stuck to bare URLs in prose. */
export function stripTrailingUrlPunctuation(url: string): string {
  let out = url.trim();
  // Drop unmatched trailing ) ] } . , ; : !
  while (/[.,;:!?)\]}>]$/.test(out)) {
    // Keep ) if balanced (rare in sources lists; prefer strip).
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * Extract unique http(s) URLs from assistant prose.
 * Skips fenced code blocks so example snippets do not become chips.
 * Cap keeps footer rows compact when models dump long link lists.
 */
export function extractHttpUrlsFromText(
  text: string,
  options?: { max?: number },
): string[] {
  if (!text?.trim()) {
    return [];
  }
  const max = options?.max ?? 12;
  // Drop fenced code (```…```) so URLs inside examples are ignored.
  const withoutFences = text.replace(/```[\s\S]*?```/g, "\n");
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string) => {
    const url = stripTrailingUrlPunctuation(raw);
    if (!isHttpUrl(url) || seen.has(url)) {
      return;
    }
    // Skip data: / javascript: already blocked by isHttpUrl.
    seen.add(url);
    out.push(url);
  };

  // Markdown links: [label](https://…)
  const mdLinkRe = /\[[^\]]*]\(\s*(https?:\/\/[^)\s]+)\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = mdLinkRe.exec(withoutFences)) !== null) {
    if (match[1]) {
      push(match[1]);
      if (out.length >= max) {
        return out;
      }
    }
  }

  // Bare URLs (GFM autolink style).
  const bareRe = /https?:\/\/[^\s<>"'`]+/gi;
  while ((match = bareRe.exec(withoutFences)) !== null) {
    if (match[0]) {
      push(match[0]);
      if (out.length >= max) {
        return out;
      }
    }
  }

  return out;
}

export type WebCitation = {
  path: string;
  title: string;
  /** Optional snippet / extracted content summary for richer cards (lp-uxy.7). */
  snippet?: string;
};

/**
 * Structured search / crawl hit emitted by host tools (web_search, Firecrawl,
 * X search, …). Hosts should put a JSON array of these (or `{ results: [...] }`)
 * in tool `result` / `metadata.search_results` so Portal can show title +
 * snippet beyond bare URL chips (lp-uxy.7).
 */
export type WebSearchResult = {
  url: string;
  title: string;
  snippet?: string;
  published_at?: string;
  /** Optional extracted markdown / content summary (Firecrawl scrape). */
  content_summary?: string;
  /** Provider hint for UI badges (firecrawl | x | tavily | web_search | …). */
  provider?: string;
};

/**
 * Build web citation entries from extracted URLs (path = exact source URL).
 */
export function webCitationsFromUrls(
  urls: readonly string[],
): WebCitation[] {
  const out: WebCitation[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const trimmed = stripTrailingUrlPunctuation(url);
    if (!isHttpUrl(trimmed) || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push({
      path: trimmed,
      title: webCitationTitle(trimmed),
    });
  }
  return out;
}

/**
 * Build citations from structured search/crawl results (prefer real titles).
 */
export function webCitationsFromSearchResults(
  results: readonly WebSearchResult[],
): WebCitation[] {
  const out: WebCitation[] = [];
  const seen = new Set<string>();
  for (const item of results) {
    const url = stripTrailingUrlPunctuation(item.url);
    if (!isHttpUrl(url) || seen.has(url)) {
      continue;
    }
    seen.add(url);
    const snippet =
      item.snippet?.trim() || item.content_summary?.trim() || undefined;
    out.push({
      path: url,
      title: webCitationTitle(url, item.title),
      ...(snippet ? { snippet: snippet.slice(0, 400) } : {}),
    });
  }
  return out;
}

function pickString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Flatten Firecrawl-style nested metadata onto a hit record without clobbering
 * explicit top-level fields (title/snippet/url already present win).
 */
function flattenNestedHitMetadata(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const nested = record.metadata;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
    return record;
  }
  const meta = nested as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...record };
  // Prefer top-level; fill gaps from nested metadata / Firecrawl scrape shape.
  const fill = (key: string, ...aliases: string[]) => {
    if (typeof merged[key] === "string" && String(merged[key]).trim()) {
      return;
    }
    for (const alias of [key, ...aliases]) {
      const value = meta[alias];
      if (typeof value === "string" && value.trim()) {
        merged[key] = value.trim();
        return;
      }
    }
  };
  fill("title", "ogTitle", "og:title");
  fill("snippet", "description", "ogDescription", "og:description");
  fill("description", "ogDescription", "og:description");
  fill("url", "sourceURL", "sourceUrl", "source_url", "ogUrl", "url");
  fill("published_at", "publishedAt", "publishedTime", "date");
  return merged;
}

/**
 * True when a string looks like a provider badge (not a URL or free-form source).
 */
function isProviderBadge(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v || isHttpUrl(v) || v.includes("://") || v.includes("/")) {
    return false;
  }
  // Short token-like provider ids only (avoid free-form "source" titles).
  if (v.length > 32 || /\s/.test(v)) {
    return false;
  }
  return true;
}

/**
 * Normalize one host-shaped search/crawl hit into WebSearchResult.
 * Accepts common aliases (link/href/path, description/summary, markdown/content)
 * and Firecrawl nested `metadata` (sourceURL / description).
 */
export function normalizeWebSearchResult(
  entry: unknown,
  options?: { provider?: string },
): WebSearchResult | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const record = flattenNestedHitMetadata(entry as Record<string, unknown>);
  const url = pickString(record, [
    "url",
    "link",
    "href",
    "path",
    "source_url",
    "sourceUrl",
    "sourceURL",
    "page_url",
    "pageUrl",
  ]);
  if (!url || !isHttpUrl(url)) {
    return null;
  }
  const title =
    pickString(record, ["title", "name", "label", "heading"]) ??
    webCitationTitle(url);
  // Snippet aliases — do NOT include `content`/`markdown` here (those are
  // full extracts → content_summary). Prefer short SERP-style fields.
  const snippet = pickString(record, [
    "snippet",
    "description",
    "summary",
    "excerpt",
    "text",
  ]);
  const published_at = pickString(record, [
    "published_at",
    "publishedAt",
    "date",
    "published",
  ]);
  // Firecrawl scrape often returns markdown / content as full page extract.
  const contentRaw = pickString(record, [
    "content_summary",
    "contentSummary",
    "markdown",
    "content",
    "extracted",
    "page_content",
    "pageContent",
  ]);
  let content_summary: string | undefined;
  if (contentRaw) {
    // Prefer short summary for UI cards; keep first ~280 chars.
    const compact = contentRaw.replace(/\s+/g, " ").trim();
    content_summary = compact.slice(0, 280);
  }
  // Provider: never treat a URL-shaped `source` as the badge (common host alias).
  let provider =
    pickString(record, ["provider", "engine"]) ?? options?.provider;
  if (!provider) {
    const source = pickString(record, ["source"]);
    if (source && isProviderBadge(source)) {
      provider = source;
    }
  } else if (!isProviderBadge(provider)) {
    provider = options?.provider;
  }
  const result: WebSearchResult = {
    url: stripTrailingUrlPunctuation(url),
    title: isHttpUrl(title) ? webCitationTitle(url) : title,
  };
  if (snippet && !isHttpUrl(snippet)) {
    result.snippet = snippet.slice(0, 400);
  }
  if (published_at) {
    result.published_at = published_at;
  }
  if (content_summary && content_summary !== snippet) {
    result.content_summary = content_summary;
  }
  if (provider) {
    result.provider = provider;
  }
  return result;
}

function parseJsonLoose(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  // Prefer fenced ```json blocks first.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fence?.[1] ? [fence[1].trim(), trimmed] : [trimmed];
  for (const candidate of candidates) {
    if (
      !(
        candidate.startsWith("{") ||
        candidate.startsWith("[") ||
        candidate.startsWith('"')
      )
    ) {
      continue;
    }
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try to recover a leading JSON array/object substring.
      const arrStart = candidate.indexOf("[");
      const objStart = candidate.indexOf("{");
      let start = -1;
      if (arrStart >= 0 && objStart >= 0) {
        start = Math.min(arrStart, objStart);
      } else {
        start = Math.max(arrStart, objStart);
      }
      if (start < 0) {
        continue;
      }
      const slice = candidate.slice(start);
      try {
        return JSON.parse(slice) as unknown;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function resultsFromUnknown(
  value: unknown,
  options?: { provider?: string; max?: number },
): WebSearchResult[] {
  const max = options?.max ?? 12;
  const out: WebSearchResult[] = [];
  const push = (entry: unknown) => {
    if (out.length >= max) {
      return;
    }
    const normalized = normalizeWebSearchResult(entry, {
      provider: options?.provider,
    });
    if (normalized) {
      out.push(normalized);
    }
  };

  if (typeof value === "string") {
    const parsed = parseJsonLoose(value);
    if (parsed != null) {
      return resultsFromUnknown(parsed, options);
    }
    return out;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      push(entry);
      if (out.length >= max) {
        break;
      }
    }
    return out;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Nested containers common on hosts / Firecrawl search.
    let nestedHitCount = 0;
    for (const key of [
      "results",
      "search_results",
      "web_results",
      "items",
      "data",
      "hits",
      "organic",
    ] as const) {
      const nested = record[key];
      if (Array.isArray(nested)) {
        for (const entry of nested) {
          const before = out.length;
          push(entry);
          if (out.length > before) {
            nestedHitCount += 1;
          }
          if (out.length >= max) {
            return out;
          }
        }
      } else if (
        nested &&
        typeof nested === "object" &&
        !Array.isArray(nested)
      ) {
        // Firecrawl scrape: { success, data: { markdown, metadata: {…} } }
        const before = out.length;
        push(nested);
        if (out.length > before) {
          nestedHitCount += 1;
        }
        if (out.length >= max) {
          return out;
        }
      }
    }
    // Only treat the outer object as a single scrape/hit when no nested hits
    // were produced — avoids wrapping { results: […], url: "…" } pollution.
    if (nestedHitCount === 0) {
      push(record);
    }
  }
  return out;
}

/**
 * Parse structured search/crawl results from tool result text and/or metadata.
 * Prefers JSON; falls back to numbered "Title — url" / "Title\nurl\nsnippet" lines.
 */
export function parseWebSearchResults(
  source: {
    result?: string | null;
    metadata?: Record<string, unknown> | null;
    provider?: string;
  },
  options?: { max?: number },
): WebSearchResult[] {
  const max = options?.max ?? 12;
  const meta = source.metadata ?? undefined;
  const providerHint =
    source.provider ||
    (typeof meta?.provider === "string" ? meta.provider : undefined);

  // 1) Explicit metadata arrays/objects/JSON strings win (host-structured).
  if (meta) {
    for (const key of [
      "search_results",
      "web_results",
      "results",
      "citations",
    ] as const) {
      const raw = meta[key];
      if (raw == null) {
        continue;
      }
      const fromMeta = resultsFromUnknown(raw, {
        provider: providerHint,
        max,
      });
      if (fromMeta.length > 0) {
        return fromMeta;
      }
    }
  }

  const text = source.result?.trim() ?? "";
  if (!text) {
    return [];
  }

  // 2) JSON body / fenced JSON.
  const parsed = parseJsonLoose(text);
  if (parsed != null) {
    const fromJson = resultsFromUnknown(parsed, {
      provider: providerHint,
      max,
    });
    if (fromJson.length > 0) {
      return fromJson;
    }
  }

  // 3) Lightweight numbered list fallback:
  //    1. Title — https://example.com
  //       optional snippet line
  const out: WebSearchResult[] = [];
  const lines = text.split(/\r?\n/);
  const itemRe =
    /^\s*(?:\d+[\).\]]\s+|[-*]\s+)?(.+?)\s+[—–\-|:]\s+(https?:\/\/\S+)/i;
  const bareUrlRe = /^\s*(https?:\/\/\S+)\s*$/i;
  for (let i = 0; i < lines.length && out.length < max; i += 1) {
    const line = lines[i] ?? "";
    const match = itemRe.exec(line);
    if (match?.[1] && match[2]) {
      const url = stripTrailingUrlPunctuation(match[2]);
      if (!isHttpUrl(url)) {
        continue;
      }
      const title = match[1].replace(/^\[|\]$/g, "").trim();
      let snippet: string | undefined;
      const next = lines[i + 1]?.trim();
      if (next && !itemRe.test(next) && !bareUrlRe.test(next) && !isHttpUrl(next)) {
        snippet = next.slice(0, 400);
        i += 1;
      }
      out.push({
        url,
        title: title || webCitationTitle(url),
        ...(snippet ? { snippet } : {}),
        ...(providerHint ? { provider: providerHint } : {}),
      });
      continue;
    }
    // Markdown link: [Title](https://…)
    const md = /^\s*(?:\d+[\).\]]\s+|[-*]\s+)?\[([^\]]+)]\(\s*(https?:\/\/[^)\s]+)\s*\)/.exec(
      line,
    );
    if (md?.[1] && md[2]) {
      const url = stripTrailingUrlPunctuation(md[2]);
      if (isHttpUrl(url)) {
        out.push({
          url,
          title: md[1].trim() || webCitationTitle(url),
          ...(providerHint ? { provider: providerHint } : {}),
        });
      }
    }
  }
  return out;
}

/**
 * Infer provider badge from tool id when host omits provider field.
 */
export function inferWebSearchProvider(
  toolName: string | null | undefined,
): string | undefined {
  const bare = bareToolNameKey(toolName);
  if (!bare) {
    return undefined;
  }
  if (bare.includes("firecrawl")) {
    return "firecrawl";
  }
  if (isXSearchToolName(bare)) {
    return "x";
  }
  if (bare.includes("tavily")) {
    return "tavily";
  }
  if (bare.includes("brave")) {
    return "brave";
  }
  if (isWebSearchToolName(bare)) {
    return "web_search";
  }
  if (isWebBrowseToolName(bare)) {
    return "web_browse";
  }
  return undefined;
}

/**
 * Format structured results as plain text (fallback / copy / tests).
 */
export function formatWebSearchResultsText(
  results: readonly WebSearchResult[],
): string {
  if (!results.length) {
    return "";
  }
  return results
    .map((r, i) => {
      const n = i + 1;
      const bits = [`${n}. ${r.title}`, r.url];
      const body = r.snippet || r.content_summary;
      if (body) {
        bits.push(body);
      }
      if (r.published_at) {
        bits.push(`Published: ${r.published_at}`);
      }
      return bits.join("\n");
    })
    .join("\n\n");
}

/**
 * Promote http(s) URLs from web tool targets / result bodies into citations.
 * Only considers tools that look like web search or browse — shell/file tools
 * are ignored so we do not invent search chrome from `curl` argv alone.
 * Prefers structured title/snippet when the tool result is JSON or list-shaped
 * (lp-uxy.7).
 */
export function webCitationsFromToolCalls(
  toolCalls: ReadonlyArray<{
    name: string;
    technicalName?: string;
    target?: string;
    result?: string;
    metadata?: Record<string, unknown>;
  }>,
): WebCitation[] | undefined {
  const structured: WebSearchResult[] = [];
  const urls: string[] = [];
  for (const call of toolCalls) {
    const probe = call.technicalName?.trim() || call.name;
    if (!isWebSearchToolName(probe) && !isWebBrowseToolName(probe)) {
      continue;
    }
    const provider = inferWebSearchProvider(probe);
    const fromStructured = parseWebSearchResults(
      {
        result: call.result,
        metadata: call.metadata,
        provider,
      },
      { max: 8 },
    );
    if (fromStructured.length > 0) {
      structured.push(...fromStructured);
      continue;
    }
    const target = call.target?.trim();
    if (target && isHttpUrl(target)) {
      urls.push(target);
    }
    if (call.result?.trim()) {
      urls.push(...extractHttpUrlsFromText(call.result, { max: 8 }));
    }
  }
  const fromResults = webCitationsFromSearchResults(structured);
  const fromUrls = webCitationsFromUrls(urls);
  // Merge structured first (richer titles), then bare URL fallbacks.
  const seen = new Set<string>();
  const out: WebCitation[] = [];
  for (const c of [...fromResults, ...fromUrls]) {
    if (seen.has(c.path)) {
      continue;
    }
    seen.add(c.path);
    out.push(c);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Promote http(s) URLs from final assistant content into web citations.
 * Used when the model lists Sources as bare/markdown links without structured
 * metadata.citations. Does not invent tool rows.
 */
export function webCitationsFromContent(
  content: string | null | undefined,
): WebCitation[] | undefined {
  if (!content?.trim()) {
    return undefined;
  }
  const citations = webCitationsFromUrls(extractHttpUrlsFromText(content));
  return citations.length > 0 ? citations : undefined;
}
