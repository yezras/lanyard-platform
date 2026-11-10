/**
 * WhatsApp QR pairing host (lp-xhf4.11).
 *
 * Runs wacli auth --events on the user sandbox, maps stderr NDJSON to
 * reserved portal_event connector.qr, and exports session.db only.
 * The QR payload never goes to the model.
 */

import { randomUUID } from "node:crypto";

import {
  applyWacliPairingEvent,
  completeWhatsAppPairing,
  initialWhatsAppPairingState,
  llmStatusForPairing,
  parseWacliNdjsonLine,
  requireWhatsAppSessionExport,
  WACLI_AUTH_ARGV,
  WACLI_AUTH_STATUS_ARGV,
  WACLI_SYNC_ARGV,
  type ConnectorQrPortalEvent,
} from "@lanyard/connectors";

export { WACLI_AUTH_ARGV, WACLI_AUTH_STATUS_ARGV, WACLI_SYNC_ARGV };

export type WhatsAppAuthStatus = {
  authenticated: boolean;
  linked_jid?: string;
  phone?: string;
};

export type WhatsAppPairingHost = {
  runAuthEvents(input: {
    sandbox_id: string;
    store_dir: string;
  }): AsyncIterable<string>;
  exportSession(input: { sandbox_id: string }): Promise<{
    filename: string;
    contents_base64: string;
  }>;
  runSync(input: { sandbox_id: string }): Promise<{
    exit_code: number;
    stderr: string;
    stdout: string;
  }>;
  authStatus(input: { sandbox_id: string }): Promise<WhatsAppAuthStatus>;
};

export type WhatsAppPairingPublish = (event: {
  type: "connector.qr";
  chat_id: string;
  pairing_id: string;
  connector_id: "whatsapp";
  code: string;
  ts: number;
  phase: ConnectorQrPortalEvent["phase"];
  content: string;
  metadata: ConnectorQrPortalEvent;
  created_at: string;
}) => void;

export type WhatsAppPairingPorts = {
  host: WhatsAppPairingHost;
  sandbox_id: string;
  store_dir: string;
  publish?: WhatsAppPairingPublish;
  thread_id?: string;
};

export type WhatsAppPairingRunResult = {
  pairing_id: string;
  status: "connected" | "failed" | "needs_reauth" | "pairing";
  account_label: string | null;
  session_db_base64: string | null;
  llm_status: string;
  portal_events: ConnectorQrPortalEvent[];
};

function accountLabel(status: WhatsAppAuthStatus): string | null {
  const phone = status.phone?.trim();
  if (phone) return phone.startsWith("+") ? phone : `+${phone}`;
  return status.linked_jid?.trim() || null;
}

function emit(
  ports: WhatsAppPairingPorts,
  pairing_id: string,
  portal: ConnectorQrPortalEvent,
  llm_status: string,
): void {
  if (!ports.publish || !ports.thread_id) return;
  ports.publish({
    type: "connector.qr",
    chat_id: ports.thread_id,
    pairing_id,
    connector_id: "whatsapp",
    code: portal.code,
    ts: portal.ts,
    phase: portal.phase,
    content: llm_status,
    metadata: portal,
    created_at: new Date(portal.ts || Date.now()).toISOString(),
  });
}

export async function runWhatsAppPairing(input: {
  pairing_id?: string;
  ports: WhatsAppPairingPorts;
}): Promise<WhatsAppPairingRunResult> {
  const pairing_id = input.pairing_id?.trim() || randomUUID();
  const portal_events: ConnectorQrPortalEvent[] = [];
  let state = initialWhatsAppPairingState(pairing_id);
  let llm_status = llmStatusForPairing(state.status);

  for await (const line of input.ports.host.runAuthEvents({
    sandbox_id: input.ports.sandbox_id,
    store_dir: input.ports.store_dir,
  })) {
    const parsed = parseWacliNdjsonLine(line);
    if (!parsed) continue;
    const applied = applyWacliPairingEvent(state, parsed);
    state = applied.state;
    if (applied.llm_status) llm_status = applied.llm_status;
    if (applied.portal_event) {
      portal_events.push(applied.portal_event);
      emit(input.ports, pairing_id, applied.portal_event, llm_status);
    }
    if (
      state.status.status === "failed" ||
      state.status.status === "needs_reauth"
    ) {
      return {
        pairing_id,
        status: state.status.status,
        account_label: null,
        session_db_base64: null,
        llm_status,
        portal_events,
      };
    }
  }

  const auth = await input.ports.host.authStatus({
    sandbox_id: input.ports.sandbox_id,
  });
  if (!auth.authenticated) {
    return {
      pairing_id,
      status: state.status.status === "pairing" ? "pairing" : "failed",
      account_label: null,
      session_db_base64: null,
      llm_status,
      portal_events,
    };
  }

  const exported = requireWhatsAppSessionExport(
    await input.ports.host.exportSession({
      sandbox_id: input.ports.sandbox_id,
    }),
  );
  const done = completeWhatsAppPairing(
    state,
    accountLabel(auth),
    Date.now(),
  );
  if (done.portal_event) {
    portal_events.push(done.portal_event);
    emit(input.ports, pairing_id, done.portal_event, done.llm_status ?? llm_status);
  }
  return {
    pairing_id,
    status: "connected",
    account_label: accountLabel(auth),
    session_db_base64: exported.contents_base64,
    llm_status: done.llm_status ?? llm_status,
    portal_events,
  };
}

export function createFixtureWhatsAppPairingHost(input: {
  stderr_lines: string[];
  session_db_base64: string;
  auth?: WhatsAppAuthStatus;
  export_filename?: string;
  sync?: { exit_code: number; stderr: string; stdout?: string };
}): WhatsAppPairingHost {
  return {
    async *runAuthEvents() {
      for (const line of input.stderr_lines) {
        yield line;
      }
    },
    async exportSession() {
      return {
        filename: input.export_filename ?? "session.db",
        contents_base64: input.session_db_base64,
      };
    },
    async runSync() {
      return {
        exit_code: input.sync?.exit_code ?? 0,
        stderr: input.sync?.stderr ?? "",
        stdout: input.sync?.stdout ?? "",
      };
    },
    async authStatus() {
      return (
        input.auth ?? {
          authenticated: true,
          phone: "15551212",
          linked_jid: "15551212@s.whatsapp.net",
        }
      );
    },
  };
}
