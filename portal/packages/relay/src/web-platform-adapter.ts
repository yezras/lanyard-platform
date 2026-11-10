import type { OutboundAction, OutboundResult } from "@lanyard/shared";

import {
  ChatDeliveryHub,
  outboundActionToChatEvents,
} from "./chat-delivery-hub.js";
import { handleOutboundAction } from "./outbound-handler.js";

/**
 * Bridges Hermes gateway outbound ops to portal chat delivery (SSE subscribers).
 */
export class WebPlatformAdapter {
  constructor(private readonly hub: ChatDeliveryHub) {}

  handleOutbound(action: OutboundAction): OutboundResult {
    const result = handleOutboundAction(action);
    if (result.success) {
      for (const event of outboundActionToChatEvents(
        action,
        result.message_id,
      )) {
        this.hub.publish(event);
      }
    }
    return result;
  }
}