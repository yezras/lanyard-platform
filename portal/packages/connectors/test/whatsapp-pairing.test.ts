import { describe, expect, it } from "vitest";

import { gateForActionClass } from "../src/types.js";
import {
  parseWacliNdjsonLine,
  parseWacliNdjsonStream,
  WACLI_AUTH_ARGV,
} from "../src/wacli-events.js";
import {
  requireWhatsAppSessionExport,
  selectWhatsAppSessionExport,
  WhatsAppExportError,
} from "../src/whatsapp-export.js";
import {
  applyWacliPairingEvent,
  completeWhatsAppPairing,
  CONNECTOR_QR_PORTAL_EVENT,
  initialWhatsAppPairingState,
  llmStatusForPairing,
  portalEventOmitsQrForLlm,
} from "../src/whatsapp-pairing.js";

const QR_A =
  "2@ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz,abc,XYZ";
const QR_B =
  "2@QRCODE-ROTATED-PAYLOAD-PLEASE-SCAN-FROM-IMAGE-NOT-ASCII,def,UVW";
const SESSION_B64 = Buffer.from("whatsmeow-session-keys").toString("base64");

const FIXTURE = [
  `{"event":"auth_starting","ts":1700000000000}`,
  "████████████████  (terminal ASCII must be ignored)",
  JSON.stringify({
    event: "qr_code",
    data: { code: QR_A },
    ts: 1700000001000,
  }),
  JSON.stringify({
    event: "qr_code",
    data: { code: QR_B },
    ts: 1700000002000,
  }),
].join("\n");

describe("wacli auth --events pairing fixture (lp-xhf4.11)", () => {
  it("parses qr_code NDJSON and ignores ASCII art", () => {
    const events = parseWacliNdjsonStream(FIXTURE);
    expect(events.map((e) => e.event)).toEqual([
      "auth_starting",
      "qr_code",
      "qr_code",
    ]);
    expect(events[1]).toMatchObject({
      event: "qr_code",
      data: { code: QR_A },
    });
    expect(parseWacliNdjsonLine("not json")).toBeNull();
    expect(WACLI_AUTH_ARGV).toEqual(["wacli", "auth", "--events"]);
  });

  it("replaces the same pairing bubble on a new qr_code event", () => {
    let state = initialWhatsAppPairingState("pair-1");
    const first = applyWacliPairingEvent(
      state,
      parseWacliNdjsonLine(FIXTURE.split("\n")[2] ?? "")!,
    );
    state = first.state;
    const second = applyWacliPairingEvent(
      state,
      parseWacliNdjsonLine(FIXTURE.split("\n")[3] ?? "")!,
    );
    expect(first.portal_event?.pairing_id).toBe("pair-1");
    expect(second.portal_event?.pairing_id).toBe("pair-1");
    expect(first.portal_event?.code).toBe(QR_A);
    expect(second.portal_event?.code).toBe(QR_B);
    expect(second.portal_event?.phase).toBe("code");
    expect(second.llm_status).not.toContain(QR_B);
    expect(portalEventOmitsQrForLlm(second.portal_event!)).toEqual({
      portal_event: CONNECTOR_QR_PORTAL_EVENT,
      connector_id: "whatsapp",
      phase: "code",
    });
  });

  it("fail-closes on passkey and ignores later QR rotation", () => {
    let state = initialWhatsAppPairingState("pair-pk");
    const qr = applyWacliPairingEvent(state, {
      event: "qr_code",
      data: { code: QR_A },
      ts: 1,
    });
    const fail = applyWacliPairingEvent(qr.state, {
      event: "error",
      data: {
        message:
          "WhatsApp requires passkey verification; passkey-gated pairing is not supported",
      },
      ts: 2,
    });
    expect(fail.state.status).toMatchObject({
      status: "failed",
      reason: "passkey",
    });
    expect(fail.portal_event?.phase).toBe("failed");
    expect(fail.llm_status).toMatch(/passkey/i);
    expect(fail.llm_status).not.toContain(QR_A);
    const later = applyWacliPairingEvent(fail.state, {
      event: "qr_code",
      data: { code: QR_B },
      ts: 3,
    });
    expect(later.portal_event).toBeNull();
    expect(later.state.status.status).toBe("failed");
  });

  it("maps unlinked device to needs_reauth", () => {
    const applied = applyWacliPairingEvent(
      initialWhatsAppPairingState("pair-unlink"),
      {
        event: "error",
        data: { message: "Logged out. Run wacli auth." },
        ts: 9,
      },
    );
    expect(applied.state.status).toEqual({
      status: "needs_reauth",
      reason: "unlinked",
    });
    expect(applied.portal_event?.phase).toBe("needs_reauth");
  });

  it("completes pairing without putting the QR on the LLM status string", () => {
    const pairing = applyWacliPairingEvent(
      initialWhatsAppPairingState("pair-ok"),
      { event: "qr_code", data: { code: QR_A }, ts: 1 },
    );
    const done = completeWhatsAppPairing(pairing.state, "+15551212", 4);
    expect(done.state.status).toEqual({
      status: "connected",
      account_label: "+15551212",
    });
    expect(done.portal_event?.phase).toBe("complete");
    expect(done.portal_event?.code).toBe("");
    expect(llmStatusForPairing(done.state.status)).toBe(
      "WhatsApp is connected.",
    );
  });
});

describe("session.db export allowlist", () => {
  it("accepts session.db base64 and rejects wacli.db / media", () => {
    expect(
      selectWhatsAppSessionExport({
        filename: "/var/lib/company-brain-backend/wacli/session.db",
        contents_base64: SESSION_B64,
      }),
    ).toEqual({
      ok: true,
      filename: "session.db",
      contents_base64: SESSION_B64,
    });
    expect(
      selectWhatsAppSessionExport({
        filename: "wacli.db",
        contents_base64: SESSION_B64,
      }),
    ).toMatchObject({ ok: false, reason: "forbidden_file" });
    expect(
      selectWhatsAppSessionExport({
        filename: "media/photo.jpg",
        contents_base64: SESSION_B64,
      }),
    ).toMatchObject({ ok: false, reason: "forbidden_file" });
    expect(() =>
      requireWhatsAppSessionExport({
        filename: "wacli.db",
        contents_base64: SESSION_B64,
      }),
    ).toThrow(WhatsAppExportError);
  });
});

describe("whatsapp.send remains every_call", () => {
  it("does not make send sticky", () => {
    expect(gateForActionClass("whatsapp.send")).toBe("every_call");
    expect(gateForActionClass("whatsapp.read")).toBe("sticky");
  });
});
