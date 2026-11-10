import type { OutboundAction, OutboundResult } from "@lanyard/shared";
import { randomUUID } from "node:crypto";

/**
 * Minimal outbound action handler for lanyard_web — acknowledges send/edit/typing.
 * WebPlatformAdapter publishes to ChatDeliveryHub before returning these results.
 */
export function handleOutboundAction(action: OutboundAction): OutboundResult {
  switch (action.op) {
    case "send":
      if (!action.chat_id || action.content === undefined) {
        return { success: false, error: "send requires chat_id and content" };
      }
      return { success: true, message_id: randomUUID() };

    case "edit":
      if (!action.chat_id || !action.message_id || action.content === undefined) {
        return {
          success: false,
          error: "edit requires chat_id, message_id, and content",
        };
      }
      return { success: true };

    case "typing":
      if (!action.chat_id) {
        return { success: false, error: "typing requires chat_id" };
      }
      return { success: true };

    case "get_chat_info":
      if (!action.chat_id) {
        return { success: false, error: "get_chat_info requires chat_id" };
      }
      return {
        success: true,
        chat_info: { name: action.chat_id, type: "dm" },
      };

    case "follow_up":
      return { success: false, error: "follow_up not supported on lanyard_web" };

    default:
      return { success: false, error: `unknown op: ${(action as OutboundAction).op}` };
  }
}