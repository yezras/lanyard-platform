/**
 * Channel transcript bubble grouping (lp-cxhb.15.3).
 *
 * kind==="group" threads render WhatsApp/iMessage style: consecutive rows from
 * the same speaker share one Astryx ChatMessageBubble group (first/middle/last
 * corner tightening), with the dither avatar + sender name only on the first
 * row of the run. Local (speakerless) user sends right-align and group without
 * identity chrome, iMessage-style.
 *
 * Pure module — unit tested in channelTranscript.test.ts.
 */

import type { HistorySpeaker } from "../../api/types.js";
import { speakerKey } from "../../api/groupRoom.js";

export type ChannelBubbleGroup = "first" | "middle" | "last";

export type ChannelRowPlan = {
  /** Astryx ChatMessageBubble group position; undefined for standalone rows. */
  group?: ChannelBubbleGroup;
  /** Alignment column: personas sit left with identity chrome; local human sends right. */
  side: "left" | "right";
  /** Show the dither avatar gutter beside the bubble column. */
  showGutter: boolean;
  /** Show the sender name above the bubbles. */
  showName: boolean;
};

/** Row kinds that participate in speaker-run grouping. */
type GroupableItem = {
  type: string;
  speaker?: HistorySpeaker;
};

function runKeyFor(item: GroupableItem, index: number): string {
  if (item.speaker) {
    return `s:${speakerKey(item.speaker)}`;
  }
  if (item.type === "user") {
    // Consecutive local user sends group iMessage-style.
    return "local-user";
  }
  // Non-transcript chrome (mcq, legacy reasoning) breaks runs.
  return `x:${index}`;
}

function groupPosition(
  offset: number,
  runLength: number,
): ChannelBubbleGroup | undefined {
  if (runLength <= 1) {
    return undefined;
  }
  if (offset === 0) {
    return "first";
  }
  if (offset === runLength - 1) {
    return "last";
  }
  return "middle";
}

/**
 * Plan per-row bubble grouping for a channel transcript. Index-aligned with
 * the input items array.
 */
export function planChannelRows(
  items: readonly GroupableItem[],
): ChannelRowPlan[] {
  const keys = items.map(runKeyFor);
  const plans: ChannelRowPlan[] = [];

  for (let i = 0; i < items.length; i++) {
    const key = keys[i];
    let start = i;
    while (start > 0 && keys[start - 1] === key) {
      start--;
    }
    let end = i;
    while (end + 1 < items.length && keys[end + 1] === key) {
      end++;
    }
    const runLength = end - start + 1;
    const offset = i - start;
    const isFirstOfRun = offset === 0;
    // Channels are one human operator + agent personas: human speakers are the
    // local user (right, no identity chrome); personas are remote peers.
    const isLocalUser = key === "local-user" || items[i].speaker?.kind === "human";

    plans.push({
      group: groupPosition(offset, runLength),
      side: isLocalUser ? "right" : "left",
      showGutter: !isLocalUser && isFirstOfRun,
      showName: !isLocalUser && isFirstOfRun,
    });
  }

  return plans;
}
