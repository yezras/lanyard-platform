/**
 * lp-v62i.20.1 / lp-v62i.25 — persist mailbox hop inbound + addressee
 * harness output without a target GET /events subscriber. Channel hops
 * startTurn(wake_to) on the shared thread. claim() keeps a later SSE drain unique.
 *
 * Prove: pnpm --filter @lanyard/bff exec vitest run mailbox-hop-persist
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  asTurnId,
  MAILBOX_SEND_TOOL_NAME,
  parseMailboxAppendRequest,
  type TurnRequest,
} from "@lanyard/shared";

import { proxyHarnessTurnsUntilAbort } from "../src/chat-delivery-events.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { readableStreamFromText } from "../src/harness-client.js";
import { createHarnessTurnRegistry } from "../src/harness-turn-registry.js";
import type { SpineStartTurn } from "../src/inbound-queue.js";
import {
  isMailboxHopInbound,
  mailboxHopFailureNotice,
  mailboxHopOriginSentNotice,
  mailboxHopWakeFailureNotice,
  persistHarnessOutboundBody,
  persistMailboxHopHarnessOutput,
} from "../src/mailbox-hop.js";
import { MailboxNonceStore } from "../src/mailbox-nonce.js";
import {
  executeMailboxSend,
  hopMailboxFromHarnessEvent,
  hostStampMailboxRoom,
  mailboxSendFromToolEvent,
  type MailboxSpineEnqueue,
} from "../src/mailbox-send.js";
import { createThreadLiveEventsHub } from "../src/thread-live-events.js";
import { createMemoryInboundQueue } from "./inbound-memory-queue.js";

const tenantId = "tenant-mailbox-persist";
const userId = "usr_jack";
const instanceId = "inst-mailbox-persist";

function parseSend(input: {
  from: string;
  to: string;
  room: string;
  text?: string;
  nonce?: string;
}) {
  return parseMailboxAppendRequest({
    from: input.from,
    to: input.to,
    room: input.room,
    text: input.text ?? "Bill, take this",
    nonce: input.nonce ?? "nonce-persist-1",
    tenant_id: tenantId,
  });
}

function seedFredAndBill(store = new ChatThreadStore()) {
  const fred = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Fred",
      objective: "Ping teammates.",
  });
  const bill = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Bill",
      objective: "Lead the room.",
  });
  return { store, fred, bill };
}

function sseBody(event: Record<string, unknown>): ReadableStream<Uint8Array> {
  return readableStreamFromText(`data: ${JSON.stringify(event)}\n\n`);
}
