/**
 * SideNav subtitle activity preview (lp-lv9.3).
 * Pure extract of the latest user/assistant text from a chat timeline — no model call.
 */

/** Minimal timeline item shape used for subtitle extraction. */
export type ActivityPreviewItem = {
  type: string;
  content?: string;
};

/**
 * Walk the timeline from the end and return the latest non-empty user or
 * assistant text. Used as SideNav line-2 subtitle input (then truncated).
 */
export function latestActivityTextFromItems(
  items: readonly ActivityPreviewItem[],
): string | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item) {
      continue;
    }
    if (
      item.type === "user" ||
      item.type === "assistant_turn" ||
      item.type === "assistant"
    ) {
      const text = item.content?.trim();
      if (text) {
        return text.replace(/\s+/g, " ");
      }
    }
  }
  return null;
}
