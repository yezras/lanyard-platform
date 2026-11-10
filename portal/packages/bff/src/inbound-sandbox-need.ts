/**
 * Plan 0019 §4.2 sandbox_need classifier (lp-k5c4.6).
 *
 * BFF decides at enqueue. Callers pass source + facts, never sandbox_need.
 * Uncertain file/vault intent fails open to toolbox; plain chat stays none.
 */

import type {
  InboundSandboxNeed,
  InboundWorkSource,
} from "@lanyard/shared";

export type ClassifySandboxNeedInput = {
  source: InboundWorkSource;
  /** Prompt, job text, or mailbox wake message. */
  text?: string | null;
  /** Channel media, non-text message_type, or Portal staging paths. */
  hasAttachment?: boolean;
  /** Cron job / fire-path create profile. */
  sandboxCreateProfile?: string | null;
  /** Target thread's last classified need (mailbox inherit). */
  priorNeed?: InboundSandboxNeed | null;
  /** 1:1 mailbox hop: Bill text in hidden_instruction, not a bubble. */
  hiddenInstruction?: boolean;
};

const FILE_TOOL_INTENT = [
  /\/mnt\/vault/i,
  /\bparse_document\b/i,
  /\bmemory_read\b/i,
  /\bbash\b/i,
  /\bgrep\b/i,
  /\bread_file\b/i,
];

export function promptHasFileToolIntent(
  text: string | null | undefined,
): boolean {
  if (!text) return false;
  return FILE_TOOL_INTENT.some((pattern) => pattern.test(text));
}

function needsFileComputer(input: ClassifySandboxNeedInput): boolean {
  return Boolean(input.hasAttachment) || promptHasFileToolIntent(input.text);
}

/**
 * Classify sandbox_need from source + sniffable facts.
 * Callers must not pass a chosen need; this is the only mapping.
 */
export function classifySandboxNeed(
  input: ClassifySandboxNeedInput,
): InboundSandboxNeed {
  switch (input.source) {
    case "web":
      return needsFileComputer(input) ? "toolbox" : "none";
    case "slack":
    case "email":
    case "whatsapp":
      return needsFileComputer(input) ? "toolbox" : "none";
    case "cron":
      return input.sandboxCreateProfile === "tool_only" ? "toolbox" : "none";
    case "mailbox":
      if (input.priorNeed) return input.priorNeed;
      return "none";
    default: {
      const exhaustive: never = input.source;
      return exhaustive;
    }
  }
}
