/**
 * WhatsApp pairing state machine (portal-connectors.md §6).
 * One pairing_id, one QR bubble. New qr_code events replace the code.
 * Passkey errors fail closed — do not rotate another QR.
 */

import {
  classifyWacliErrorEvent,
  wacliErrorMessage,
  wacliQrCode,
  type WacliNdjsonEvent,
} from "./wacli-events.js";

export const CONNECTOR_QR_PORTAL_EVENT = "connector.qr" as const;

export type ConnectorQrPhase =
  | "code"
  | "complete"
  | "failed"
  | "needs_reauth";

export type ConnectorQrPortalEvent = {
  portal_event: typeof CONNECTOR_QR_PORTAL_EVENT;
  connector_id: "whatsapp";
  pairing_id: string;
  code: string;
  ts: number;
  phase: ConnectorQrPhase;
  message?: string;
};

export type WhatsAppPairingStatus =
  | { status: "idle" }
  | { status: "pairing"; code: string; ts: number }
  | { status: "connected"; account_label: string | null }
  | { status: "needs_reauth"; reason: "unlinked" }
  | {
      status: "failed";
      reason: "passkey" | "error";
      message: string;
    };

export type WhatsAppPairingState = {
  pairing_id: string;
  connector_id: "whatsapp";
  status: WhatsAppPairingStatus;
};

export type ApplyWacliEventResult = {
  state: WhatsAppPairingState;
  /** Outbound portal_event. Null when the bubble should not change. */
  portal_event: ConnectorQrPortalEvent | null;
  /** Short status for the model. Never includes the QR payload. */
  llm_status: string | null;
};

const LLM_PAIRING = "WhatsApp pairing in progress.";
const LLM_CONNECTED = "WhatsApp is connected.";
const LLM_PASSKEY =
  "WhatsApp passkey pairing is not supported. Connect from a device that is not passkey-gated.";
const LLM_UNLINKED = "WhatsApp needs to be paired again.";
const LLM_FAILED = "WhatsApp pairing failed.";

export function initialWhatsAppPairingState(
  pairing_id: string,
): WhatsAppPairingState {
  return {
    pairing_id,
    connector_id: "whatsapp",
    status: { status: "idle" },
  };
}

export function llmStatusForPairing(
  status: WhatsAppPairingStatus,
): string {
  switch (status.status) {
    case "idle":
    case "pairing":
      return LLM_PAIRING;
    case "connected":
      return LLM_CONNECTED;
    case "needs_reauth":
      return LLM_UNLINKED;
    case "failed":
      return status.reason === "passkey" ? LLM_PASSKEY : LLM_FAILED;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function buildConnectorQrPortalEvent(input: {
  pairing_id: string;
  code: string;
  ts: number;
  phase: ConnectorQrPhase;
  message?: string;
}): ConnectorQrPortalEvent {
  return {
    portal_event: CONNECTOR_QR_PORTAL_EVENT,
    connector_id: "whatsapp",
    pairing_id: input.pairing_id,
    code: input.code,
    ts: input.ts,
    phase: input.phase,
    ...(input.message ? { message: input.message } : {}),
  };
}

function isTerminal(status: WhatsAppPairingStatus): boolean {
  return (
    status.status === "connected" ||
    status.status === "failed" ||
    status.status === "needs_reauth"
  );
}

/**
 * Reduce one wacli NDJSON event. Passkey/unlinked fail closed: later
 * qr_code lines are ignored so we do not spin unusable codes.
 */
export function applyWacliPairingEvent(
  state: WhatsAppPairingState,
  event: WacliNdjsonEvent,
): ApplyWacliEventResult {
  if (isTerminal(state.status)) {
    return { state, portal_event: null, llm_status: null };
  }

  const qrCode = wacliQrCode(event);
  if (qrCode) {
    const next: WhatsAppPairingState = {
      ...state,
      status: { status: "pairing", code: qrCode, ts: event.ts },
    };
    return {
      state: next,
      portal_event: buildConnectorQrPortalEvent({
        pairing_id: state.pairing_id,
        code: qrCode,
        ts: event.ts,
        phase: "code",
      }),
      llm_status: LLM_PAIRING,
    };
  }

  const errorMessage = wacliErrorMessage(event);
  if (errorMessage) {
    const failure = classifyWacliErrorEvent(event) ?? "error";
    if (failure === "passkey") {
      const next: WhatsAppPairingState = {
        ...state,
        status: {
          status: "failed",
          reason: "passkey",
          message: errorMessage,
        },
      };
      return {
        state: next,
        portal_event: buildConnectorQrPortalEvent({
          pairing_id: state.pairing_id,
          code: "",
          ts: event.ts,
          phase: "failed",
          message: errorMessage,
        }),
        llm_status: LLM_PASSKEY,
      };
    }
    if (failure === "unlinked") {
      const next: WhatsAppPairingState = {
        ...state,
        status: { status: "needs_reauth", reason: "unlinked" },
      };
      return {
        state: next,
        portal_event: buildConnectorQrPortalEvent({
          pairing_id: state.pairing_id,
          code: "",
          ts: event.ts,
          phase: "needs_reauth",
          message: errorMessage,
        }),
        llm_status: LLM_UNLINKED,
      };
    }
    const next: WhatsAppPairingState = {
      ...state,
      status: {
        status: "failed",
        reason: "error",
        message: errorMessage,
      },
    };
    return {
      state: next,
      portal_event: buildConnectorQrPortalEvent({
        pairing_id: state.pairing_id,
        code: "",
        ts: event.ts,
        phase: "failed",
        message: errorMessage,
      }),
      llm_status: LLM_FAILED,
    };
  }

  return { state, portal_event: null, llm_status: null };
}

export function completeWhatsAppPairing(
  state: WhatsAppPairingState,
  account_label: string | null,
  ts: number,
): ApplyWacliEventResult {
  if (state.status.status === "failed") {
    return { state, portal_event: null, llm_status: null };
  }
  const next: WhatsAppPairingState = {
    ...state,
    status: { status: "connected", account_label },
  };
  return {
    state: next,
    portal_event: buildConnectorQrPortalEvent({
      pairing_id: state.pairing_id,
      code: "",
      ts,
      phase: "complete",
    }),
    llm_status: LLM_CONNECTED,
  };
}

export function portalEventOmitsQrForLlm(
  portal: ConnectorQrPortalEvent,
): { portal_event: "connector.qr"; connector_id: "whatsapp"; phase: ConnectorQrPhase } {
  return {
    portal_event: portal.portal_event,
    connector_id: portal.connector_id,
    phase: portal.phase,
  };
}
