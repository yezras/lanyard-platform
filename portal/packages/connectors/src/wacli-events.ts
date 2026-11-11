/**
 * wacli --events NDJSON (stderr). Design: portal-connectors.md §6.
 * Host parses these; the model never sees ASCII QR or the raw code.
 */

export const WACLI_AUTH_ARGV = ["wacli", "auth", "--events"] as const;
export const WACLI_SYNC_ARGV = ["wacli", "sync"] as const;
export const WACLI_AUTH_STATUS_ARGV = ["wacli", "auth", "status", "--json"] as const;

export const WACLI_QR_CODE_EVENT = "qr_code" as const;
export const WACLI_PAIR_CODE_EVENT = "pair_code" as const;
export const WACLI_AUTH_STARTING_EVENT = "auth_starting" as const;
export const WACLI_ERROR_EVENT = "error" as const;

export type WacliQrCodeEvent = {
  event: typeof WACLI_QR_CODE_EVENT;
  data: { code: string };
  ts: number;
};

export type WacliPairCodeEvent = {
  event: typeof WACLI_PAIR_CODE_EVENT;
  data: { phone: string; code: string };
  ts: number;
};

export type WacliAuthStartingEvent = {
  event: typeof WACLI_AUTH_STARTING_EVENT;
  data?: Record<string, unknown> | null;
  ts: number;
};

export type WacliErrorEvent = {
  event: typeof WACLI_ERROR_EVENT;
  data: { message: string; code?: string };
  ts: number;
};

export type WacliUnknownEvent = {
  event: string;
  data?: Record<string, unknown> | null;
  ts: number;
};

export type WacliNdjsonEvent =
  | WacliQrCodeEvent
  | WacliPairCodeEvent
  | WacliAuthStartingEvent
  | WacliErrorEvent
  | WacliUnknownEvent;

export type WacliFailureClass = "passkey" | "unlinked" | "error";

const PASSKEY_RE = /passkey/i;
const UNLINKED_RE =
  /logged[\s_-]?out|not authenticated|unlinked|device.?removed|logged_out/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function dataRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/**
 * Parse one stderr line. Non-JSON and non-objects are ignored (ASCII QR
 * leftover). Never treats terminal art as a pairing code.
 */
export function parseWacliNdjsonLine(line: string): WacliNdjsonEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== "{") {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw.event !== "string" || !raw.event.trim()) {
    return null;
  }
  const event = raw.event.trim();
  const ts = asTs(raw.ts);
  const data = dataRecord(raw.data);

  if (event === WACLI_QR_CODE_EVENT) {
    const code = typeof data.code === "string" ? data.code.trim() : "";
    if (!code) return null;
    return { event, data: { code }, ts };
  }
  if (event === WACLI_PAIR_CODE_EVENT) {
    const code = typeof data.code === "string" ? data.code.trim() : "";
    const phone = typeof data.phone === "string" ? data.phone.trim() : "";
    if (!code) return null;
    return { event, data: { phone, code }, ts };
  }
  if (event === WACLI_AUTH_STARTING_EVENT) {
    return { event, data, ts };
  }
  if (event === WACLI_ERROR_EVENT) {
    const message =
      typeof data.message === "string" && data.message.trim()
        ? data.message.trim()
        : typeof data.error === "string" && data.error.trim()
          ? data.error.trim()
          : "";
    if (!message) return null;
    const code = typeof data.code === "string" ? data.code.trim() : undefined;
    return { event, data: { message, ...(code ? { code } : {}) }, ts };
  }
  return { event, data, ts };
}

export function parseWacliNdjsonStream(text: string): WacliNdjsonEvent[] {
  const events: WacliNdjsonEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseWacliNdjsonLine(line);
    if (parsed) events.push(parsed);
  }
  return events;
}

export function classifyWacliFailure(message: string): WacliFailureClass {
  if (PASSKEY_RE.test(message)) return "passkey";
  if (UNLINKED_RE.test(message)) return "unlinked";
  return "error";
}

export function wacliQrCode(event: WacliNdjsonEvent): string | null {
  if (event.event !== WACLI_QR_CODE_EVENT || event.data == null) return null;
  const code = (event.data as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code : null;
}

export function wacliErrorMessage(event: WacliNdjsonEvent): string | null {
  if (event.event !== WACLI_ERROR_EVENT || event.data == null) return null;
  const message = (event.data as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : null;
}

export function classifyWacliErrorEvent(
  event: WacliNdjsonEvent,
): WacliFailureClass | null {
  const message = wacliErrorMessage(event);
  if (!message) return null;
  return classifyWacliFailure(message);
}
