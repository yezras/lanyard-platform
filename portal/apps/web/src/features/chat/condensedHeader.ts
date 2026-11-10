import {
  extractHttpUrlsFromText,
  isWebBrowseToolName,
  isWebSearchToolName,
  parseWebSearchResults,
  inferWebSearchProvider,
  webCitationTitle,
} from "./webCitations.js";
import type { ChatTimelineToolCall } from "../../hooks/useChatEvents.js";
import type { StackedSource } from "./SourceStack.js";

export function collectStackedSources(
  calls: ChatTimelineToolCall[],
  options?: { max?: number }
): StackedSource[] {
  const max = options?.max ?? 16;
  const seen = new Set<string>();
  const out: StackedSource[] = [];
  for (const call of calls) {
    if (!call) continue;
    const probe = (call.technicalName || call.name || "").trim();
    const isWeb = isWebSearchToolName(probe) || isWebBrowseToolName(probe);
    if (!isWeb) continue;
    const provider = inferWebSearchProvider(probe);
    const hits = parseWebSearchResults(
      { result: call.result, metadata: call.metadata, provider },
      { max: 12 }
    );
    if (hits.length > 0) {
      for (const h of hits) {
        const url = (h.url || "").trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push({
          url,
          title: h.title?.trim() || hostFromUrl(url),
          description: h.snippet?.trim() || h.content_summary?.trim() || undefined,
          provider: h.provider?.trim() || (provider ? String(provider) : undefined),
        });
        if (out.length >= max) return out;
      }
    } else {
      // Fallback: extract bare URLs directly from result/metadata text when structured parse yields nothing
      const fallbackText =
        (typeof call.result === "string" ? call.result : "") +
        " " +
        (call.metadata ? JSON.stringify(call.metadata) : "");
      const urls = extractHttpUrlsFromText(fallbackText, { max: 12 });
      for (const url of urls) {
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push({
          url,
          title: webCitationTitle(url),
          provider: provider ? String(provider) : undefined,
        });
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function shouldHideToolInCondensed(call: ChatTimelineToolCall): boolean {
  const probe = (call.technicalName || call.name || "").trim();
  if (call.kind === "subagent") return true;
  if (isWebSearchToolName(probe) || isWebBrowseToolName(probe)) return true;
  return false;
}

export function filterToolsForCondensed(
  calls: ChatTimelineToolCall[]
): ChatTimelineToolCall[] {
  return calls.filter((c) => !shouldHideToolInCondensed(c));
}
