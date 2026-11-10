import type { OutboundAction } from "./frames.js";
import type { MessageEvent } from "./message-event.js";

/** One tap target in an MCQ prompt. */
export type McqChoice = {
  id: string;
  label: string;
};

/** Outbound metadata convention for interactive MCQ bubbles (#16). */
export type McqOutboundMetadata = {
  portal_event: "mcq";
  mcq_id: string;
  choices: McqChoice[];
  /** Optional header override; defaults to outbound `content`. */
  prompt?: string;
};

/** Inbound metadata when the user taps a choice (#16). */
export type McqSelectionInboundMetadata = {
  portal_inbound: "mcq_selection";
  mcq_id: string;
  choice_id: string;
  choice_label: string;
};

const MAX_MCQ_CHOICES = 8;

/** Reserved chat event for WhatsApp QR pairing (portal-connectors.md §6). */
export const CONNECTOR_QR_PORTAL_EVENT = "connector.qr" as const;

export type ConnectorQrPhase =
  | "code"
  | "complete"
  | "failed"
  | "needs_reauth";

export type ConnectorQrOutboundMetadata = {
  portal_event: typeof CONNECTOR_QR_PORTAL_EVENT;
  connector_id: "whatsapp";
  pairing_id: string;
  code: string;
  ts: number;
  phase: ConnectorQrPhase;
  message?: string;
};

export function parseConnectorQrOutboundMetadata(
  action: OutboundAction,
): ConnectorQrOutboundMetadata | null {
  const metadata = action.metadata;
  if (!metadata || metadata.portal_event !== CONNECTOR_QR_PORTAL_EVENT) {
    return null;
  }
  const pairingId =
    typeof metadata.pairing_id === "string" ? metadata.pairing_id.trim() : "";
  if (!pairingId) return null;
  const phaseRaw =
    typeof metadata.phase === "string" ? metadata.phase.trim() : "code";
  const phase: ConnectorQrPhase =
    phaseRaw === "complete" ||
    phaseRaw === "failed" ||
    phaseRaw === "needs_reauth"
      ? phaseRaw
      : "code";
  const code = typeof metadata.code === "string" ? metadata.code : "";
  const ts =
    typeof metadata.ts === "number" && Number.isFinite(metadata.ts)
      ? metadata.ts
      : 0;
  const message =
    typeof metadata.message === "string" && metadata.message.trim()
      ? metadata.message.trim()
      : undefined;
  return {
    portal_event: CONNECTOR_QR_PORTAL_EVENT,
    connector_id: "whatsapp",
    pairing_id: pairingId,
    code,
    ts,
    phase,
    ...(message ? { message } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseChoice(raw: unknown): McqChoice | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!id || !label) return null;
  return { id, label };
}

/**
 * Parse MCQ outbound metadata from a gateway `send` action.
 *
 * Convention (documented in portal/README.md):
 * - `metadata.portal_event === "mcq"`
 * - `metadata.mcq_id` — stable id for correlating the user's tap
 * - `metadata.choices` — array of `{ id, label }` (2–8 items)
 * - optional `metadata.prompt` — header text (falls back to `content`)
 */
export function parseMcqOutboundMetadata(
  action: OutboundAction,
): { mcq_id: string; prompt: string; choices: McqChoice[] } | null {
  const metadata = action.metadata;
  if (!metadata || metadata.portal_event !== "mcq") return null;

  const mcqId = typeof metadata.mcq_id === "string" ? metadata.mcq_id.trim() : "";
  if (!mcqId) return null;

  const rawChoices = metadata.choices;
  if (!Array.isArray(rawChoices)) return null;

  const choices: McqChoice[] = [];
  for (const raw of rawChoices) {
    const choice = parseChoice(raw);
    if (choice) choices.push(choice);
  }

  if (choices.length < 2 || choices.length > MAX_MCQ_CHOICES) return null;

  const promptFromMeta =
    typeof metadata.prompt === "string" && metadata.prompt.trim()
      ? metadata.prompt.trim()
      : null;
  const prompt =
    promptFromMeta ??
    (typeof action.content === "string" ? action.content.trim() : "") ??
    "Choose one:";

  return { mcq_id: mcqId, prompt, choices };
}

/** Build a normalized inbound MessageEvent for an MCQ tap. */
export function buildMcqSelectionMessageEvent(input: {
  selection: {
    mcq_id: string;
    choice_id: string;
    label: string;
    prompt_message_id?: string;
  };
  source: MessageEvent["source"];
}): MessageEvent {
  const { selection, source } = input;
  const metadata: McqSelectionInboundMetadata = {
    portal_inbound: "mcq_selection",
    mcq_id: selection.mcq_id,
    choice_id: selection.choice_id,
    choice_label: selection.label,
  };

  return {
    text: selection.label,
    message_type: "mcq_selection",
    source,
    reply_to_message_id: selection.prompt_message_id,
    metadata,
  };
}